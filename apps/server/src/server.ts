import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import { buildDailyBrief, renderBriefMarkdown, renderReportHtml } from "@landed/brief";
import type { AgentSession, OpenLoop } from "@landed/core";
import type { LineFingerprinter } from "@landed/core/fingerprint";
import {
  countIngestionFailures,
  dismissInsight,
  getSetting,
  type LandedDb,
  listInsights,
  listRepos,
  listSessions,
  listSources,
  setOpenLoopState,
  setSetting,
} from "@landed/db";
import { normalizeClaudeHook } from "@landed/importer-claude";
import { normalizeCodexHook } from "@landed/importer-codex";
import {
  analyze,
  type LiveCollector,
  LOOP_IGNORE_SETTING,
  loopIgnorePaths,
  runScan,
  type ScanReport,
} from "@landed/ingest";
import { normalizeIgnorePaths } from "@landed/loops";
import { createCommandSummarizer } from "@landed/summarizer";
import Fastify, { type FastifyInstance } from "fastify";
import type { Hub } from "./hub";
import { resumeContext } from "./memory";
import { DEFAULT_NOTIFICATIONS, type NotificationSetting } from "./notify";
import {
  briefInputs,
  dayRange,
  loopsView,
  outcomesView,
  reportView,
  sessionDetail,
  sessionsView,
  threadDetail,
  threadsView,
  todayView,
} from "./views";

export const DEFAULT_PORT = 47831;

export interface ServerOptions {
  db: LandedDb;
  dbPath: string;
  dataDir: string;
  fingerprinter: LineFingerprinter;
  /** Built web UI (index.html + assets). Optional: the API works without it. */
  webRoot?: string;
  port?: number;
  /** Required on state-changing requests; generated when omitted. */
  token?: string;
  logger?: boolean;
  /** Live collection (daemon mode): watchers + hook ingestion. */
  live?: LiveCollector;
  hub?: Hub;
  /** Persistent secret the agent hooks send; required by /v1/ingest/*. */
  ingestToken?: string;
}

export interface SummarizerSetting {
  enabled: boolean;
  command: string;
  args: string[];
}

export const DEFAULT_SUMMARIZER: SummarizerSetting = {
  enabled: false,
  command: "claude",
  args: ["-p", "--output-format", "json"],
};

/**
 * Local API + UI server. Loopback only; rejects requests whose Host or Origin is not this server
 * (DNS-rebinding protection), and requires a per-run token on anything that changes state.
 */
export async function createServer(
  opts: ServerOptions,
): Promise<{ app: FastifyInstance; token: string; port: number }> {
  const { db } = opts;
  const port = opts.port ?? DEFAULT_PORT;
  const token = opts.token ?? randomBytes(24).toString("base64url");
  // forceCloseConnections: open SSE streams must not keep a shutdown waiting.
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 64 * 1024,
    forceCloseConnections: true,
  });
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  app.addHook("onRequest", async (req, reply) => {
    const host = req.headers.host ?? "";
    const origin = req.headers.origin;
    if (
      !allowedHosts.has(host) ||
      (origin !== undefined && !allowedHosts.has(origin.replace(/^https?:\/\//, "")))
    ) {
      return reply.code(403).send({ error: "forbidden host" });
    }
    if (req.url.startsWith("/v1/ingest/")) {
      // Agent hooks authenticate with the persistent ingest token, not the per-run UI token.
      if (!opts.ingestToken || req.headers["x-landed-ingest"] !== opts.ingestToken)
        return reply.code(401).send({ error: "invalid ingest token" });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-landed-token"] !== token) {
      return reply.code(401).send({ error: "missing or invalid token" });
    }
  });

  let scanning: Promise<ScanReport> | undefined;
  const scan = () => {
    const run = () => runScan({ db, fingerprinter: opts.fingerprinter });
    scanning ??= (opts.live ? opts.live.exclusive(run) : run()).finally(() => {
      scanning = undefined;
    });
    return scanning;
  };
  const startedAt = new Date().toISOString();

  // Hooks answer at once and never decide anything: the agent must not wait on Landed.
  const ingest = (normalize: typeof normalizeClaudeHook) => async (req: { body: unknown }) => {
    const signal = normalize(req.body, new Date().toISOString());
    if (signal && opts.live) void opts.live.recordHook(signal).catch(() => {});
    return {};
  };
  app.post("/v1/ingest/claude", { bodyLimit: 8 * 2 ** 20 }, ingest(normalizeClaudeHook));
  app.post("/v1/ingest/codex", { bodyLimit: 8 * 2 ** 20 }, ingest(normalizeCodexHook));

  app.get("/v1/live", async () => ({
    live: opts.live !== undefined,
    since: startedAt,
    lastActivityAt: opts.live?.lastActivityAt ?? null,
    viewers: opts.hub?.size ?? 0,
  }));

  app.get("/v1/stream", (req, reply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    reply.raw.write(`event: hello\ndata: ${JSON.stringify({ live: opts.live !== undefined })}\n\n`);
    const unsubscribe =
      opts.hub?.subscribe((e) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`)) ?? (() => {});
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);
    req.raw.on("close", () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  app.put<{ Body: { enabled?: boolean } }>("/v1/settings/notifications", async (req) => {
    const next: NotificationSetting = { enabled: req.body?.enabled === true };
    setSetting(db, "notifications", next, Date.now());
    return next;
  });

  // Directories whose files never raise output loops (agent reports, plans). Re-analyzes at once.
  app.put<{ Body: { ignorePaths?: unknown } }>("/v1/settings/loops", async (req, reply) => {
    const raw = req.body?.ignorePaths;
    if (
      !Array.isArray(raw) ||
      raw.length > 50 ||
      raw.some((p) => typeof p !== "string" || p.length > 200)
    )
      return reply.code(400).send({ error: "ignorePaths must be up to 50 strings" });
    const ignorePaths = normalizeIgnorePaths(raw as string[]);
    setSetting(db, LOOP_IGNORE_SETTING, ignorePaths, Date.now());
    const run = async () => analyze(db);
    const report = await (opts.live ? opts.live.exclusive(run) : run());
    opts.hub?.publish({ type: "analysis", at: new Date().toISOString() });
    return { ignorePaths, openLoops: report.openLoops };
  });

  app.get("/v1/health", async () => ({ ok: true }));
  app.get<{ Querystring: { date?: string } }>("/v1/today", async (req) =>
    todayView(db, req.query.date),
  );
  app.get<{ Querystring: Record<string, string | undefined> }>("/v1/sessions", async (req) => {
    const q = req.query;
    const range = q.date ? dayRange(q.date) : undefined;
    return sessionsView(db, {
      ...(range ? { from: range.from, to: range.to } : {}),
      ...(q.provider ? { provider: q.provider as AgentSession["provider"] } : {}),
      ...(q.repoId ? { repoId: q.repoId } : {}),
      ...(q.status ? { status: q.status as AgentSession["status"] } : {}),
      limit: Math.min(Number(q.limit ?? 100), 500),
      offset: Number(q.offset ?? 0),
      subagents: q.subagents === "1",
    });
  });
  app.get<{ Params: { id: string } }>(
    "/v1/sessions/:id",
    async (req, reply) =>
      sessionDetail(db, req.params.id) ?? reply.code(404).send({ error: "not found" }),
  );
  app.get<{ Querystring: { days?: string } }>("/v1/outcomes", async (req) =>
    outcomesView(db, req.query.days ? Number(req.query.days) : undefined),
  );
  app.get<{ Querystring: { state?: OpenLoop["state"] } }>("/v1/loops", async (req) =>
    loopsView(db, req.query.state),
  );
  app.post<{ Params: { id: string }; Body: { action?: string; reason?: string } }>(
    "/v1/loops/:id",
    async (req, reply) => {
      const action = req.body?.action;
      const state =
        action === "dismiss"
          ? "dismissed"
          : action === "resolve"
            ? "resolved"
            : action === "reopen"
              ? "open"
              : undefined;
      if (!state)
        return reply.code(400).send({ error: "action must be dismiss, resolve or reopen" });
      return setOpenLoopState(db, req.params.id, state, Date.now(), req.body?.reason)
        ? { ok: true }
        : reply.code(404).send({ error: "not found" });
    },
  );
  app.get<{ Querystring: { status?: string } }>("/v1/threads", async (req) =>
    threadsView(db, req.query.status),
  );
  app.get<{ Params: { id: string } }>(
    "/v1/threads/:id",
    async (req, reply) =>
      threadDetail(db, req.params.id) ?? reply.code(404).send({ error: "not found" }),
  );
  app.get<{ Params: { id: string } }>("/v1/threads/:id/resume", async (req, reply) => {
    const text = resumeContext(db, req.params.id);
    return text === undefined
      ? reply.code(404).send({ error: "not found" })
      : reply.type("text/plain; charset=utf-8").send(text);
  });
  app.get("/v1/insights", async () => listInsights(db));
  app.post<{ Params: { id: string } }>("/v1/insights/:id/dismiss", async (req, reply) =>
    dismissInsight(db, req.params.id, Date.now())
      ? { ok: true }
      : reply.code(404).send({ error: "not found" }),
  );
  app.get<{ Querystring: { date?: string; format?: string } }>("/v1/brief", async (req, reply) => {
    const range = dayRange(req.query.date);
    const brief = buildDailyBrief(briefInputs(db, range.from, range.to, range.date));
    return req.query.format === "md"
      ? reply.type("text/markdown; charset=utf-8").send(renderBriefMarkdown(brief))
      : brief;
  });
  app.post<{ Querystring: { date?: string } }>("/v1/brief/generate", async (req, reply) => {
    const setting = getSetting<SummarizerSetting>(db, "summarizer") ?? DEFAULT_SUMMARIZER;
    if (!setting.enabled)
      return reply
        .code(409)
        .send({ error: "The generated summary is off. Enable it in Settings." });
    const range = dayRange(req.query.date);
    const brief = buildDailyBrief(briefInputs(db, range.from, range.to, range.date));
    // Only structured, already sanitized facts leave the machine — and only after opt-in.
    const facts = {
      activity: brief.activity,
      threads: brief.whereYouLeftOff.map((t) => ({
        title: t.title,
        status: t.status,
        agents: t.providers,
      })),
      openLoops: brief.openLoops.top.map((l) => ({ type: l.type, size: l.size })),
      landed: brief.landed.map((r) => ({
        files: r.files,
        lines: r.lines,
        commits: r.commits.map((c) => c.subject ?? ""),
      })),
      attention: brief.attention.map((a) => a.kind),
    };
    const summary = await createCommandSummarizer({
      command: setting.command,
      args: setting.args,
      name: "agent-cli",
    }).summarizeDay(facts);
    if (!summary)
      return reply.code(502).send({ error: "The summarizer did not return a valid summary." });
    const saved = { date: range.date, ...summary };
    setSetting(db, `generatedBrief:${range.date}`, saved, Date.now());
    return saved;
  });
  app.get<{ Querystring: { days?: string; names?: string } }>("/v1/report", async (req, reply) => {
    const html = renderReportHtml(
      reportView(db, Number(req.query.days ?? 30), req.query.names === "1"),
    );
    return reply.type("text/html; charset=utf-8").send(html);
  });
  app.post("/v1/scan", async () => {
    const report = await scan();
    return report;
  });
  app.post("/v1/analyze", async () => analyze(db));
  app.get("/v1/settings", async () => ({
    dataDir: opts.dataDir,
    dbPath: opts.dbPath,
    dbBytes: existsSync(opts.dbPath) ? statSync(opts.dbPath).size : 0,
    lastScan: getSetting(db, "lastScan"),
    sources: listSources(db).map((s) => ({
      provider: s.provider,
      rootPath: s.rootPath,
      exists: existsSync(s.rootPath),
      lastScanAt: s.lastScanAt ? new Date(s.lastScanAt).toISOString() : null,
    })),
    sessions: listSessions(db, { limit: 1_000_000 }).length,
    repos: listRepos(db).map((r) => ({
      rootPath: r.rootPath,
      missing: r.missing,
      defaultBranch: r.defaultBranch,
      confidence: r.outcomeConfidence,
      controlA: r.outcomeControlA,
      controlB: r.outcomeControlB,
    })),
    ingestionFailures: countIngestionFailures(db),
    summarizer: getSetting<SummarizerSetting>(db, "summarizer") ?? DEFAULT_SUMMARIZER,
    notifications: getSetting<NotificationSetting>(db, "notifications") ?? DEFAULT_NOTIFICATIONS,
    loopIgnorePaths: loopIgnorePaths(db),
    live: opts.live !== undefined,
    privacy: {
      promptText: "not stored",
      codeLines: "stored as salted fingerprints only",
      toolOutput: "not stored",
      commands: "first line, secrets redacted, quoted prose masked",
      network:
        "none (the optional generated summary is the only exception, and it is off by default)",
    },
  }));
  app.put<{ Body: { enabled?: boolean } }>("/v1/settings/summarizer", async (req) => {
    const current = getSetting<SummarizerSetting>(db, "summarizer") ?? DEFAULT_SUMMARIZER;
    const next = { ...current, enabled: req.body?.enabled === true };
    setSetting(db, "summarizer", next, Date.now());
    return next;
  });

  if (opts.webRoot && existsSync(join(opts.webRoot, "index.html"))) {
    const indexHtml = readFileSync(join(opts.webRoot, "index.html"), "utf8").replace(
      "</head>",
      `<meta name="landed-token" content="${token}"></head>`,
    );
    await app.register(fastifyStatic, { root: opts.webRoot, index: false, wildcard: false });
    app.get("/assets/*", async (req, reply) =>
      reply.sendFile((req.params as { "*": string })["*"], join(opts.webRoot as string, "assets")),
    );
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith("/v1/")) return reply.code(404).send({ error: "not found" });
      return reply.type("text/html; charset=utf-8").send(indexHtml);
    });
  }

  return { app, token, port };
}

/** Starts listening on loopback only. */
export async function startServer(
  opts: ServerOptions,
): Promise<{ app: FastifyInstance; url: string; token: string }> {
  const { app, token, port } = await createServer(opts);
  await app.listen({ host: "127.0.0.1", port });
  return { app, url: `http://127.0.0.1:${port}`, token };
}
