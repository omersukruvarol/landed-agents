/**
 * Opt-in smoke test against this machine's real Claude Code and Codex history (read-only):
 *   LANDED_REAL_DATA=1 pnpm vitest run packages/ingest/src/smoke.real.test.ts
 * Writes only to a temp database. Prints aggregate numbers, never content.
 */
import { createReadStream, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import {
  createLineFingerprinter,
  generateInstallSecret,
  parseInstallSecret,
} from "@landed/core/fingerprint";
import { listPatches, listSessions, openDatabase, outcomeDistribution } from "@landed/db";
import { listClaudeTranscripts } from "@landed/importer-claude";
import { listCodexRollouts } from "@landed/importer-codex";
import { describe, expect, it } from "vitest";
import { claudeImporter, defaultClaudeProjectsRoot } from "./claude";
import { codexImporter, defaultCodexSessionsRoot } from "./codex";
import { computeOutcomes } from "./outcomes";
import { importSource } from "./pipeline";
import { runScan } from "./scan";
import { loadOrCreateInstallSecret } from "./secret";
import { tempDir } from "./test-helpers";

/**
 * Session files written to since `sinceMs` (agents running right now append to theirs). A
 * re-import may read only these; anything more would break idempotency.
 */
function filesWrittenSince(root: string, sinceMs: number): number {
  let n = 0;
  for (const rel of readdirSync(root, { recursive: true }) as string[]) {
    if (!rel.endsWith(".jsonl")) continue;
    try {
      if (statSync(join(root, rel)).mtimeMs >= sinceMs) n++;
    } catch {}
  }
  return n;
}

describe.skipIf(!process.env.LANDED_REAL_DATA)("real Claude history", () => {
  it("imports, is idempotent, and leaks no prompt text", { timeout: 600_000 }, async () => {
    const root = defaultClaudeProjectsRoot();
    const { db, sqlite } = openDatabase(join(tempDir("landed-smoke-"), "smoke.db"));
    const fingerprinter = createLineFingerprinter(parseInstallSecret(generateInstallSecret()));

    const startedAt = Date.now();
    const t0 = performance.now();
    const first = await importSource(claudeImporter, { db, fingerprinter, root });
    const firstMs = performance.now() - t0;
    const t1 = performance.now();
    const second = await importSource(claudeImporter, { db, fingerprinter, root });
    const secondMs = performance.now() - t1;

    const sessions = listSessions(db, { limit: 100_000 });
    const patches = listPatches(db);
    const byStatus: Record<string, number> = {};
    for (const s of sessions) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    const failures = sqlite
      .prepare("select reason_code, count(*) n from ingestion_failures group by reason_code")
      .all();

    // Privacy: real prompts (read in memory only) must not appear anywhere in the database.
    const prompts = await collectPrompts(listClaudeTranscripts(root).map((f) => f.path));
    const tables = (
      sqlite
        .prepare("select name from sqlite_master where type='table' and name not like 'sqlite%'")
        .all() as { name: string }[]
    ).map((t) => t.name);
    const dump = tables
      .map((t) => JSON.stringify(sqlite.prepare(`select * from "${t}"`).all()))
      .join("\n");
    const leakedPrompts = prompts.filter((p) => dump.includes(p));
    const leaked = leakedPrompts.length;
    // Locate leaks by table/column only — never print the text.
    const leakSites: string[] = [];
    for (const t of tables) {
      for (const row of sqlite.prepare(`select * from "${t}"`).all() as Record<string, unknown>[]) {
        for (const [col, v] of Object.entries(row)) {
          if (typeof v !== "string") continue;
          for (const p of leakedPrompts) {
            if (v.includes(p)) {
              const shape = (x: string) => x.replace(/[A-Za-zÀ-ž]/g, "a").replace(/[0-9]/g, "9");
              leakSites.push(
                `${t}.${col} prompt-shape=${JSON.stringify(shape(p))} at=${v.indexOf(p)}`,
              );
            }
          }
        }
      }
    }

    console.log(
      JSON.stringify(
        {
          firstImport: { ms: Math.round(firstMs), ...first },
          secondImport: {
            ms: Math.round(secondMs),
            filesRead: second.filesRead,
            eventsInserted: second.events.inserted,
          },
          sessions: sessions.length,
          subagentSessions: sessions.filter((s) => s.parentSessionId).length,
          byStatus,
          patches: patches.length,
          patchesInRepos: patches.filter((p) => p.repoId).length,
          failures,
          promptsChecked: prompts.length,
          promptsLeaked: leaked,
          leakSites: [...new Set(leakSites)],
          dbBytes: (
            sqlite
              .prepare(
                "select page_count * page_size b from pragma_page_count(), pragma_page_size()",
              )
              .get() as { b: number }
          ).b,
        },
        null,
        1,
      ),
    );
    // Idempotent: a re-import reads only files written meanwhile (live sessions), nothing else.
    const written = filesWrittenSince(root, startedAt);
    expect(second.filesRead).toBeLessThanOrEqual(written);
    if (written === 0) expect(second.events.inserted).toBe(0);
    expect(leaked).toBe(0);
  });
});

async function collectPrompts(files: string[]): Promise<string[]> {
  const out = new Set<string>();
  for (const file of files) {
    const rl = createInterface({
      input: createReadStream(file),
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    for await (const line of rl) {
      if (!line.includes('"user"') && !line.includes("last-prompt")) continue;
      try {
        const d = JSON.parse(line);
        const text =
          d.type === "last-prompt"
            ? d.lastPrompt
            : typeof d.message?.content === "string"
              ? d.message.content
              : undefined;
        // Prose only: a pasted id or URL legitimately reappears in sanitized commands.
        if (typeof text === "string") addProse(out, text);
      } catch {}
    }
  }
  return [...out];
}

describe.skipIf(!process.env.LANDED_REAL_DATA)("real Codex history", () => {
  it("imports, is idempotent, and leaks no prompt text", { timeout: 1_800_000 }, async () => {
    const root = defaultCodexSessionsRoot();
    const { db, sqlite } = openDatabase(join(tempDir("landed-smoke-"), "smoke.db"));
    const fingerprinter = createLineFingerprinter(parseInstallSecret(generateInstallSecret()));
    let peakRss = 0;
    const peak = { heapUsed: 0, external: 0, arrayBuffers: 0 };
    const baselineRssMb = Math.round(process.memoryUsage().rss / 2 ** 20);
    const timer = setInterval(() => {
      const m = process.memoryUsage();
      peakRss = Math.max(peakRss, m.rss);
      peak.heapUsed = Math.max(peak.heapUsed, Math.round(m.heapUsed / 2 ** 20));
      peak.external = Math.max(peak.external, Math.round(m.external / 2 ** 20));
      peak.arrayBuffers = Math.max(peak.arrayBuffers, Math.round(m.arrayBuffers / 2 ** 20));
    }, 100);

    const startedAt = Date.now();
    const t0 = performance.now();
    const first = await importSource(codexImporter, { db, fingerprinter, root });
    const firstMs = performance.now() - t0;
    clearInterval(timer);
    const t1 = performance.now();
    const second = await importSource(codexImporter, { db, fingerprinter, root });
    const secondMs = performance.now() - t1;

    const sessions = listSessions(db, { limit: 100_000 });
    const patches = listPatches(db);
    const byStatus: Record<string, number> = {};
    for (const s of sessions) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    const failures = sqlite
      .prepare("select reason_code, count(*) n from ingestion_failures group by reason_code")
      .all();
    const tokens = sqlite
      .prepare(
        "select sum(input_tokens) i, sum(cached_input_tokens) c, sum(output_tokens) o, count(*) n from usage_records",
      )
      .get();

    const prompts = await collectCodexPrompts(listCodexRollouts(root).map((f) => f.path));
    const tables = (
      sqlite
        .prepare("select name from sqlite_master where type='table' and name not like 'sqlite%'")
        .all() as { name: string }[]
    ).map((t) => t.name);
    let leaked = 0;
    const leakSites = new Set<string>();
    const shape = (x: string) => x.replace(/[A-Za-zÀ-ž]/g, "a").replace(/[0-9]/g, "9");
    for (const t of tables) {
      for (const row of sqlite.prepare(`select * from "${t}"`).all() as Record<string, unknown>[]) {
        for (const [col, v] of Object.entries(row)) {
          if (typeof v !== "string") continue;
          for (const p of prompts) {
            if (!v.includes(p)) continue;
            leaked++;
            leakSites.add(`${t}.${col} prompt-shape=${JSON.stringify(shape(p))}`);
          }
        }
      }
    }

    console.log(
      JSON.stringify(
        {
          firstImport: {
            ms: Math.round(firstMs),
            baselineRssMb,
            peakRssMb: Math.round(peakRss / 2 ** 20),
            peakMb: peak,
            ...first,
          },
          secondImport: {
            ms: Math.round(secondMs),
            filesRead: second.filesRead,
            eventsInserted: second.events.inserted,
          },
          sessions: sessions.length,
          subagentSessions: sessions.filter((s) => s.parentSessionId).length,
          byStatus,
          patches: patches.length,
          patchesInRepos: patches.filter((p) => p.repoId).length,
          tokens,
          failures,
          promptsChecked: prompts.length,
          promptsLeaked: leaked,
          leakSites: [...leakSites],
          dbBytes: (
            sqlite
              .prepare(
                "select page_count * page_size b from pragma_page_count(), pragma_page_size()",
              )
              .get() as { b: number }
          ).b,
        },
        null,
        1,
      ),
    );
    // Idempotent: a re-import reads only files written meanwhile (live sessions), nothing else.
    const written = filesWrittenSince(root, startedAt);
    expect(second.filesRead).toBeLessThanOrEqual(written);
    if (written === 0) expect(second.events.inserted).toBe(0);
    expect(leaked).toBe(0);
  });
});

/** Multi-word user prompts from UserMessage items, read in memory only. */
async function collectCodexPrompts(files: string[]): Promise<string[]> {
  const out = new Set<string>();
  for (const file of files) {
    const rl = createInterface({
      input: createReadStream(file),
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    for await (const line of rl) {
      if (!line.includes('"UserMessage"')) continue;
      try {
        const content = JSON.parse(line).payload?.item?.content;
        for (const c of Array.isArray(content) ? content : []) {
          const text = c?.text;
          if (typeof text === "string") addProse(out, text);
        }
      } catch {}
    }
  }
  return [...out];
}

/** Keeps the first 64 chars of a prompt when that snippet itself is prose (3+ words). */
function addProse(out: Set<string>, text: string): void {
  const snippet = text.slice(0, 64);
  if (snippet.length >= 24 && snippet.trim().split(/\s+/).length >= 3) out.add(snippet);
}

/**
 * Spike results (spike/FINDINGS.md), in percent. The per-edit numbers are the parity check for the
 * matcher. Session × file numbers differ by design: the product splits Claude subagents into their
 * own sessions (the spike merged them into the parent) and subtracts lines a session removed itself
 * (the spike's net scope did not).
 */
const SPIKE_PER_EDIT: Record<string, Record<string, number>> = {
  "claude-code": { landed: 59.5, uncommitted: 33.9, partial: 2.2, lost: 4.3 },
  codex: { landed: 88.7, uncommitted: 2.5, partial: 2.4, lost: 6.4 },
};
const SPIKE_SESSION_FILE: Record<string, Record<string, number>> = {
  "claude-code": { landed: 47.0, uncommitted: 50.6, partial: 0.9, lost: 1.5 },
  codex: { landed: 92.6, uncommitted: 3.3, partial: 1.3, lost: 2.8 },
};
/** When the spike ran (mtime of spike/edits.jsonl). */
const SPIKE_CUTOFF = "2026-10-01T12:23:10.000Z";
/** This project's own repo was not a git repository when the spike ran, so the spike skipped it. */
const NOT_A_REPO_AT_SPIKE_TIME = "%/Desktop/AgentHQ";

describe.skipIf(!process.env.LANDED_REAL_DATA)("real outcomes vs. spike", () => {
  it("reproduces the spike per-edit distribution within ±2 points", {
    timeout: 1_800_000,
  }, async () => {
    const { db, sqlite } = openDatabase(join(tempDir("landed-smoke-"), "smoke.db"));
    const fingerprinter = createLineFingerprinter(parseInstallSecret(generateInstallSecret()));
    await importSource(claudeImporter, { db, fingerprinter, root: defaultClaudeProjectsRoot() });
    await importSource(codexImporter, { db, fingerprinter, root: defaultCodexSessionsRoot() });
    const t0 = performance.now();
    const report = await computeOutcomes({ db, fingerprinter });
    const ms = Math.round(performance.now() - t0);

    const pct = (d: Partial<Record<string, number>>) => {
      const known = Object.entries(d).filter(([k]) => k !== "unknown");
      const n = known.reduce((s, [, v]) => s + (v ?? 0), 0);
      return {
        n,
        ...Object.fromEntries(known.map(([k, v]) => [k, Math.round((1000 * (v ?? 0)) / n) / 10])),
      } as Record<string, number>;
    };
    const result: Record<string, unknown> = { ms, report };
    const delta = (ours: Record<string, number>, spike: Record<string, number> | undefined) =>
      Object.fromEntries(
        Object.entries(spike ?? {}).map(([k, v]) => [
          k,
          Math.round(((ours[k] ?? 0) - v) * 10) / 10,
        ]),
      );
    const perEditDeltas: Record<string, Record<string, number>> = {};
    for (const provider of ["claude-code", "codex"] as const) {
      // Per edit, as the spike saw it: edits made before it ran, in repos that existed then.
      const perEditRows = sqlite
        .prepare(
          `select o.class c, count(*) n from outcomes o
             join agent_patches p on p.id = o.patch_id
             join sessions s on s.id = o.session_id
             join repos r on r.id = o.repo_id
           where o.scope = 'patch' and s.provider = ? and p.timestamp < ? and r.root_path not like ?
           group by o.class`,
        )
        .all(provider, Date.parse(SPIKE_CUTOFF), NOT_A_REPO_AT_SPIKE_TIME) as {
        c: string;
        n: number;
      }[];
      const perEdit = pct(Object.fromEntries(perEditRows.map((r) => [r.c, r.n])));
      const sessionFile = pct(
        outcomeDistribution(db, { scope: "session-file", provider, to: SPIKE_CUTOFF }),
      );
      perEditDeltas[provider] = delta(perEdit, SPIKE_PER_EDIT[provider]);
      result[provider] = {
        perEdit,
        perEditDeltaVsSpike: perEditDeltas[provider],
        sessionFile,
        sessionFileDeltaVsSpike: delta(sessionFile, SPIKE_SESSION_FILE[provider]),
        sessionFileAllTime: pct(outcomeDistribution(db, { scope: "session-file", provider })),
      };
    }
    const deltas = perEditDeltas;
    result.repoChecks = sqlite
      .prepare(
        "select outcome_confidence c, count(*) n, round(avg(outcome_control_a),3) a, round(max(outcome_control_b),3) b from repos where outcomes_computed_at is not null group by c",
      )
      .all();
    result.claudePerRepoBeforeSpike = sqlite
      .prepare(
        `select replace(r.root_path, ?, '~') repo, count(*) n,
                sum(o.class='landed') landed, sum(o.class='uncommitted') uncommitted
           from outcomes o join agent_patches p on p.id = o.patch_id join sessions s on s.id = o.session_id
           join repos r on r.id = o.repo_id
          where o.scope='patch' and s.provider='claude-code' and o.class != 'unknown' and p.timestamp < ?
          group by r.root_path order by n desc`,
      )
      .all(process.env.HOME ?? "", Date.parse(SPIKE_CUTOFF));
    result.duplicateToolCalls = sqlite
      .prepare(
        `select s.provider, count(*) calls, sum(n) rows, sum(sessions_n > 1) acrossSessions from (
           select tool_call_id, count(*) n, count(distinct session_id) sessions_n from agent_patches
            where tool_call_id is not null group by tool_call_id, path having count(*) > 1) d
         join agent_patches p on p.tool_call_id = d.tool_call_id join sessions s on s.id = p.session_id
         group by s.provider`,
      )
      .all();
    result.unknownReasons = sqlite
      .prepare("select unknown_reason r, count(*) n from outcomes where class='unknown' group by r")
      .all();
    console.log(JSON.stringify(result, null, 1));
    for (const d of Object.values(deltas))
      for (const v of Object.values(d)) expect(Math.abs(v)).toBeLessThanOrEqual(2);
  });
});

describe.skipIf(!process.env.LANDED_REAL_DATA)("real end-to-end scan", () => {
  it("runs the whole pipeline", { timeout: 1_800_000 }, async () => {
    // LANDED_SMOKE_DB keeps the database for inspection (e.g. with sqlite3).
    const dbPath = process.env.LANDED_SMOKE_DB ?? join(tempDir("landed-smoke-"), "smoke.db");
    const { db, sqlite } = openDatabase(dbPath);
    const fingerprinter = createLineFingerprinter(loadOrCreateInstallSecret(dirname(dbPath)));
    const report = await runScan({ db, fingerprinter });
    const loops = sqlite
      .prepare(
        "select type, count(*) n, sum(size_lines) lines from open_loops where state='open' group by type",
      )
      .all();
    const threadStatus = sqlite
      .prepare("select status, count(*) n from threads group by status")
      .all();
    const collisions = sqlite
      .prepare("select kind, count(*) n from collisions group by kind")
      .all();
    const insights = sqlite.prepare("select type, count(*) n from insights group by type").all();
    console.log(
      JSON.stringify(
        {
          durationMs: report.durationMs,
          analysis: report.analysis,
          loops,
          threadStatus,
          collisions,
          insights,
        },
        null,
        1,
      ),
    );
    const again = await runScan({ db, fingerprinter });
    console.log(
      JSON.stringify({
        secondScanMs: again.durationMs,
        loopsOpened: again.analysis.openLoops.opened,
      }),
    );
    expect(again.analysis.openLoops.opened).toBe(0);
  });
});
