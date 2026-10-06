import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, rmSync, statSync, writeFileSync } from "node:fs";
import { buildDailyBrief, renderBriefMarkdown, renderReportHtml } from "@landed/brief";
import {
  countIngestionFailures,
  DATA_DIR_MODE,
  databasePath,
  getSetting,
  listOpenLoops,
  listRepos,
  listSessions,
  listSources,
  outcomeDistribution,
  pruneSessions,
  resolveDataDir,
} from "@landed/db";
import {
  analyze,
  claudeImporter,
  codexImporter,
  defaultClaudeProjectsRoot,
  defaultCodexSessionsRoot,
  INSTALL_SECRET_FILE,
  runScan,
  verifyInstallSecret,
} from "@landed/ingest";
import {
  briefInputs,
  DEFAULT_SUMMARIZER,
  dayRange,
  loopsView,
  reportView,
  type SummarizerSetting,
} from "@landed/server";
import { openContext } from "./context";
import { agentName, bar, bold, cyan, dim, fmt, green, pct, red, yellow } from "./print";

const out = (s = "") => process.stdout.write(`${s}\n`);

export async function scanCommand(opts: { quiet?: boolean } = {}): Promise<void> {
  const ctx = openContext();
  const { db } = ctx.handle;
  out(
    bold("Landed — read-only scan") +
      dim(" (no agent config, session files or repositories are modified)"),
  );
  out();
  const report = await runScan({
    db,
    fingerprinter: ctx.fingerprinter,
    onProgress: (step) => {
      if (!opts.quiet) out(dim(`  · ${step}…`));
    },
  });
  out();
  out(bold("Sources"));
  for (const r of report.imports) {
    const sessions = listSessions(db, { provider: r.provider, limit: 1_000_000 }).filter(
      (s) => !s.parentSessionId,
    ).length;
    const ok = r.filesSeen > 0;
    out(
      `  ${ok ? green("✓") : yellow("–")} ${agentName(r.provider).padEnd(12)} ${ok ? `${sessions} sessions · ${r.filesSeen} files${r.filesRead ? ` (${r.filesRead} read)` : ""}` : dim("no history found")}`,
    );
  }
  out();
  out(bold("Privacy"));
  out(`  Prompt text   ${dim("not stored")}`);
  out(`  Code lines    ${dim("stored as salted fingerprints only")}`);
  out(`  Network       ${dim("none")}`);
  out();
  printOutcomes(db);
  const loops = listOpenLoops(db, { state: "open" });
  const biggest = [...loops].sort((a, b) => (b.size.lines ?? 0) - (a.size.lines ?? 0))[0];
  out(
    `${bold("Open loops")}     ${loops.length}${biggest ? dim(`   (largest: ${loopsView(db, "open")[0]?.description ?? ""})`) : ""}`,
  );
  out(`${bold("Collisions")}     ${report.analysis.collisions}`);
  out(`${bold("Threads")}        ${report.analysis.threads}`);
  out();
  out(`${dim(`Done in ${(report.durationMs / 1000).toFixed(1)}s. `)}Next: ${cyan("landed open")}`);
  ctx.handle.close();
}

function printOutcomes(db: ReturnType<typeof openContext>["handle"]["db"]): void {
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const d = outcomeDistribution(db, { scope: "session-file", from });
  const known = (d.landed ?? 0) + (d.uncommitted ?? 0) + (d.partial ?? 0) + (d.lost ?? 0);
  out(bold("Outcomes (sessions in the last 30 days)"));
  if (!known) {
    out(dim("  No agent edits in git repositories yet."));
  } else {
    const row = (label: string, n: number) =>
      out(
        `  ${label.padEnd(12)} ${pct(n / known).padStart(4)}  ${bar(n / known)}  ${dim(String(n))}`,
      );
    row("Landed", d.landed ?? 0);
    row("Uncommitted", d.uncommitted ?? 0);
    row("Partial", d.partial ?? 0);
    row("Lost", d.lost ?? 0);
  }
  out();
}

export function briefCommand(opts: { date?: string; json?: boolean }): void {
  const ctx = openContext();
  const range = dayRange(opts.date);
  const brief = buildDailyBrief(briefInputs(ctx.handle.db, range.from, range.to, range.date));
  out(opts.json ? JSON.stringify(brief, null, 2) : renderBriefMarkdown(brief));
  ctx.handle.close();
}

export function loopsCommand(): void {
  const ctx = openContext();
  const loops = loopsView(ctx.handle.db, "open");
  if (!loops.length) out(green("No open loops."));
  for (const l of loops) {
    const days = Math.floor((Date.now() - Date.parse(l.since)) / 86_400_000);
    out(
      `${l.provenance === "inferred" ? yellow("?") : yellow("◐")} ${l.description} ${dim(`· ${days}d`)}`,
    );
  }
  ctx.handle.close();
}

export function reportCommand(opts: { days?: number; names?: boolean; out?: string }): void {
  const ctx = openContext();
  const days = opts.days ?? 30;
  const file = opts.out ?? `landed-report-${dayRange().date}.html`;
  writeFileSync(file, renderReportHtml(reportView(ctx.handle.db, days, opts.names === true)));
  out(
    `Wrote ${cyan(file)} ${dim(opts.names ? "(includes repo names)" : "(no repo names, paths or code)")}`,
  );
  ctx.handle.close();
}

export function exportCommand(opts: { date?: string; md?: boolean }): void {
  briefCommand({ ...(opts.date ? { date: opts.date } : {}), json: !opts.md });
}

type Check = { status: "PASS" | "WARN" | "FAIL"; name: string; detail: string; fix?: string };

export function doctorCommand(opts: { verbose?: boolean }): number {
  const checks: Check[] = [];
  const dataDir = resolveDataDir();
  const dbPath = databasePath(dataDir);
  if (!existsSync(dataDir)) {
    checks.push({
      status: "WARN",
      name: "Data folder",
      detail: "not created yet",
      fix: "Run `landed scan`.",
    });
  } else {
    const mode = statSync(dataDir).mode & 0o777;
    checks.push(
      mode === DATA_DIR_MODE
        ? { status: "PASS", name: "Data folder", detail: opts.verbose ? dataDir : "private (0700)" }
        : {
            status: "WARN",
            name: "Data folder",
            detail: `permissions ${mode.toString(8)}`,
            fix: `chmod 700 "${dataDir}"`,
          },
    );
  }
  let ctx: ReturnType<typeof openContext> | undefined;
  try {
    ctx = openContext();
    checks.push({
      status: "PASS",
      name: "Database",
      detail: `${(statSync(dbPath).size / 2 ** 20).toFixed(1)} MB${opts.verbose ? ` · ${dbPath}` : ""}`,
    });
  } catch (e) {
    checks.push({
      status: "FAIL",
      name: "Database",
      detail: (e as Error).name,
      fix: "Run `landed data reset` to start over.",
    });
  }
  if (ctx) {
    const { db } = ctx.handle;
    try {
      verifyInstallSecret(db, ctx.fingerprinter);
      checks.push({
        status: "PASS",
        name: "Install secret",
        detail: `matches the database (${INSTALL_SECRET_FILE})`,
      });
    } catch {
      checks.push({
        status: "FAIL",
        name: "Install secret",
        detail: "does not match the database",
        fix: "Restore the original install-secret file, or `landed data reset`.",
      });
    }
    for (const [provider, root] of [
      [claudeImporter.provider, defaultClaudeProjectsRoot()],
      [codexImporter.provider, defaultCodexSessionsRoot()],
    ] as const) {
      checks.push(
        existsSync(root)
          ? {
              status: "PASS",
              name: agentName(provider),
              detail: opts.verbose ? root : "history found",
            }
          : {
              status: "WARN",
              name: agentName(provider),
              detail: "no history folder",
              fix: `Use ${agentName(provider)} once, or ignore if you don't.`,
            },
      );
    }
    const last = getSetting<{ at: string }>(db, "lastScan");
    const ageDays = last ? (Date.now() - Date.parse(last.at)) / 86_400_000 : undefined;
    checks.push(
      ageDays === undefined
        ? { status: "WARN", name: "Last scan", detail: "never", fix: "Run `landed scan`." }
        : ageDays > 7
          ? {
              status: "WARN",
              name: "Last scan",
              detail: `${Math.floor(ageDays)} days ago`,
              fix: "Run `landed scan`.",
            }
          : {
              status: "PASS",
              name: "Last scan",
              detail: new Date(last?.at ?? "").toLocaleString(),
            },
    );
    const failures = countIngestionFailures(db);
    checks.push(
      failures === 0
        ? { status: "PASS", name: "Parser coverage", detail: "every line parsed" }
        : {
            status: "WARN",
            name: "Parser coverage",
            detail: `${failures} lines could not be parsed`,
            fix: "Usually harmless; a newer agent version may have changed its format.",
          },
    );
    const low = listRepos(db).filter((r) => r.outcomeConfidence === "low");
    checks.push(
      low.length === 0
        ? { status: "PASS", name: "Outcome self-check", detail: "normal in every repo" }
        : {
            status: "WARN",
            name: "Outcome self-check",
            detail: `${low.length} repo(s) with low confidence (boilerplate-heavy?)`,
            fix: "Treat outcome numbers there as approximate.",
          },
    );
    const summarizer = getSetting<SummarizerSetting>(db, "summarizer") ?? DEFAULT_SUMMARIZER;
    if (summarizer.enabled) {
      const found =
        spawnSync("sh", ["-c", `command -v ${JSON.stringify(summarizer.command)}`]).status === 0;
      checks.push(
        found
          ? { status: "PASS", name: "Summarizer", detail: `${summarizer.command} found` }
          : {
              status: "WARN",
              name: "Summarizer",
              detail: `${summarizer.command} not on PATH`,
              fix: "Install it or turn the generated summary off in Settings.",
            },
      );
    } else {
      checks.push({ status: "PASS", name: "Summarizer", detail: "off (deterministic brief only)" });
    }
    if (opts.verbose)
      checks.push({
        status: "PASS",
        name: "Sources",
        detail:
          listSources(db)
            .map((s) => `${s.provider}: ${s.rootPath}`)
            .join("; ") || "none yet",
      });
    ctx.handle.close();
  }
  try {
    const v = execFileSync("git", ["--version"], { encoding: "utf8" }).trim();
    checks.push({ status: "PASS", name: "git", detail: v });
  } catch {
    checks.push({
      status: "FAIL",
      name: "git",
      detail: "not found",
      fix: "Install git; outcomes need it.",
    });
  }
  for (const c of checks) {
    const tag =
      c.status === "PASS" ? green("PASS") : c.status === "WARN" ? yellow("WARN") : red("FAIL");
    out(`${tag}  ${c.name.padEnd(20)} ${c.detail}${c.fix ? dim(`  → ${c.fix}`) : ""}`);
  }
  return checks.some((c) => c.status === "FAIL") ? 1 : 0;
}

export function pruneCommand(olderThan: string): void {
  const m = /^(\d+)d$/.exec(olderThan);
  if (!m) throw new UsageError("--older-than must look like 30d");
  const ctx = openContext();
  const removed = pruneSessions(ctx.handle.db, Date.now() - Number(m[1]) * 86_400_000);
  analyze(ctx.handle.db);
  out(
    `Removed ${removed} session(s) older than ${m[1]} days. Agent history files were not touched.`,
  );
  ctx.handle.close();
}

export async function resetCommand(opts: { yes?: boolean; everything?: boolean }): Promise<void> {
  const dataDir = resolveDataDir();
  const what = opts.everything ? `the whole data folder ${dataDir}` : `the database in ${dataDir}`;
  if (
    !opts.yes &&
    !(await confirm(
      `This deletes ${what}. Your agents' own history and your repositories are not touched. Type "delete" to continue: `,
      "delete",
    ))
  ) {
    out("Cancelled.");
    return;
  }
  if (opts.everything) rmSync(dataDir, { recursive: true, force: true });
  else
    for (const f of ["landed.db", "landed.db-wal", "landed.db-shm"])
      rmSync(`${dataDir}/${f}`, { force: true });
  out(green(`Deleted ${what}.`));
}

export async function confirm(question: string, expected: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  process.stdout.write(question);
  const answer = await new Promise<string>((resolve) =>
    process.stdin.once("data", (d) => resolve(String(d).trim())),
  );
  process.stdin.pause();
  return answer === expected;
}

export class UsageError extends Error {}

export { fmt };
