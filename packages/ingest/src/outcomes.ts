import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentPatch, Outcome, OutcomeClass, OutcomeScope } from "@landed/core";
import type { LineFingerprinter } from "@landed/core/fingerprint";
import {
  getRepo,
  getSetting,
  type LandedDb,
  listOutcomes,
  listPatches,
  markRepoMissing,
  setRepoOutcomeCheck,
  setSessionOutcomeSummary,
  setSetting,
  upsertOutcomes,
  upsertRepo,
} from "@landed/db";
import {
  fingerprintsAt,
  type GitOptions,
  gitOutput,
  ignoredPaths,
  type RepoHistory,
  readRepoHistory,
} from "@landed/git-index";
import {
  type Classification,
  classify,
  DEFAULT_CONFIG,
  ENGINE_VERSION,
  type FileState,
  netSessionFile,
  type OutcomeConfig,
  selfCheck,
  unknownOutcome,
} from "@landed/outcomes";
import { newUlid } from "@landed/shared";

export interface OutcomeRunOptions {
  db: LandedDb;
  fingerprinter: LineFingerprinter;
  now?: () => number;
  git?: GitOptions;
  config?: OutcomeConfig;
  /** Recompute every repo even when its inputs are unchanged. */
  force?: boolean;
}

export interface OutcomeRunReport {
  repos: number;
  reposMissing: number;
  reposFailed: number;
  /** Repos whose patches, refs and edited files were unchanged since the last run. */
  reposUnchanged: number;
  patches: number;
  byScope: Record<OutcomeScope, Partial<Record<OutcomeClass, number>>>;
  lowConfidenceRepos: number;
}

const MAX_TREE_FILE_BYTES = 5 * 2 ** 20;

/**
 * Recomputes every outcome from stored patches and current git state (read-only). Each repo is
 * processed independently: a missing repo or a git failure marks only that repo's outcomes
 * unknown, with the reason.
 */
export async function computeOutcomes(opts: OutcomeRunOptions): Promise<OutcomeRunReport> {
  const { db, fingerprinter } = opts;
  const now = opts.now ?? Date.now;
  const cfg = opts.config ?? DEFAULT_CONFIG;
  const report: OutcomeRunReport = {
    repos: 0,
    reposMissing: 0,
    reposFailed: 0,
    reposUnchanged: 0,
    patches: 0,
    byScope: { patch: {}, "session-file": {} },
    lowConfidenceRepos: 0,
  };

  const byRepo = new Map<string | undefined, AgentPatch[]>();
  for (const p of listPatches(db)) {
    const key = p.repoId && p.relPath ? p.repoId : undefined;
    const list = byRepo.get(key);
    if (list) list.push(p);
    else byRepo.set(key, [p]);
    report.patches++;
  }

  const computedAt = new Date(now()).toISOString();
  const toOutcome = (
    scope: OutcomeScope,
    c: Classification,
    p: { sessionId: string; patchId?: string; repoId?: string; relPath?: string },
  ): Outcome => {
    report.byScope[scope][c.class] = (report.byScope[scope][c.class] ?? 0) + 1;
    return {
      id: newUlid(now()),
      scope,
      sessionId: p.sessionId,
      ...(p.patchId ? { patchId: p.patchId } : {}),
      ...(p.repoId ? { repoId: p.repoId } : {}),
      ...(p.relPath ? { relPath: p.relPath } : {}),
      class: c.class,
      ...(c.unknownReason ? { unknownReason: c.unknownReason } : {}),
      survival: c.survival,
      fracCommitted: c.fracCommitted,
      fracOnDefaultBranch: c.fracOnDefaultBranch,
      fracInWorkingTree: c.fracInWorkingTree,
      ...(c.firstCommit
        ? {
            firstCommit: {
              sha: c.firstCommit.sha,
              time: new Date(c.firstCommit.timeMs).toISOString(),
              ...(c.firstCommit.subject ? { subject: c.firstCommit.subject } : {}),
              ...(c.firstCommit.branch ? { branch: c.firstCommit.branch } : {}),
            },
            commitLagSeconds: (c.commitLagMs ?? 0) / 1000,
          }
        : {}),
      lineCount: c.lineCount,
      provenance: "derived",
      computedAt,
      engineVersion: ENGINE_VERSION,
    };
  };

  for (const [repoId, patches] of byRepo) {
    const outcomes: Outcome[] = [];
    if (repoId === undefined) {
      for (const p of patches) {
        outcomes.push(
          toOutcome("patch", unknownOutcome("outside-repo", p.addedLineFps.length), {
            sessionId: p.sessionId,
            patchId: p.id,
          }),
        );
      }
      upsertOutcomes(db, outcomes);
      continue;
    }
    const repo = getRepo(db, repoId);
    if (!repo) continue;
    report.repos++;

    let history: RepoHistory | undefined;
    let files = new Map<string, FileState>();
    let failure: "repo-missing" | "git-error" | undefined;
    const keySetting = `outcomeInputs:${repoId}`;
    const key = existsSync(join(repo.rootPath, ".git"))
      ? await inputKey(repo.rootPath, patches, cfg, opts.git)
      : undefined;
    if (key && !opts.force && getSetting<string>(db, keySetting) === key) {
      report.reposUnchanged++;
      continue;
    }
    if (!existsSync(join(repo.rootPath, ".git"))) {
      failure = "repo-missing";
      markRepoMissing(db, repoId);
      report.reposMissing++;
    } else {
      try {
        const relPaths = new Set(patches.map((p) => p.relPath as string));
        const sinceSec =
          Math.floor(Math.min(...patches.map((p) => Date.parse(p.timestamp))) / 1000) - 86_400;
        history = await readRepoHistory(repo.rootPath, relPaths, sinceSec, fingerprinter, opts.git);
        if (history.defaultBranch && history.defaultBranch !== repo.defaultBranch) {
          upsertRepo(db, { rootPath: repo.rootPath, defaultBranch: history.defaultBranch }, now());
        }
        const heads = await fingerprintsAt(
          repo.rootPath,
          "HEAD",
          [...relPaths],
          fingerprinter,
          opts.git,
        );
        const ignored = await ignoredPaths(repo.rootPath, [...relPaths], opts.git);
        files = new Map(
          [...relPaths].map((rel) => {
            const head = heads.get(rel) ?? undefined;
            const workingTree = readTreeFingerprints(join(repo.rootPath, rel), fingerprinter);
            return [
              rel,
              {
                ...(head ? { head } : {}),
                ...(workingTree ? { workingTree } : {}),
                ...(ignored.has(rel) ? { ignored: true } : {}),
              },
            ];
          }),
        );
      } catch {
        failure = "git-error";
        report.reposFailed++;
      }
    }

    const at = (p: AgentPatch) => Date.parse(p.timestamp);
    const judge = (fps: readonly string[], atMs: number, rel: string) =>
      failure || !history
        ? unknownOutcome(failure ?? "git-error", fps.length)
        : classify(fps, atMs, rel, history, files.get(rel) ?? {}, cfg);

    for (const p of patches) {
      outcomes.push(
        toOutcome("patch", judge(p.addedLineFps, at(p), p.relPath as string), {
          sessionId: p.sessionId,
          patchId: p.id,
          repoId,
          relPath: p.relPath as string,
        }),
      );
    }
    const groups = new Map<string, AgentPatch[]>();
    for (const p of patches) {
      const key = `${p.sessionId}\u0000${p.relPath}`;
      const g = groups.get(key);
      if (g) g.push(p);
      else groups.set(key, [p]);
    }
    for (const g of groups.values()) {
      const first = g[0] as AgentPatch;
      const net = netSessionFile(
        g.map((p) => ({
          timeMs: at(p),
          addedLineFps: p.addedLineFps,
          removedLineFps: p.removedLineFps,
        })),
      );
      if (!net) continue;
      outcomes.push(
        toOutcome("session-file", judge(net.fps, net.atMs, first.relPath as string), {
          sessionId: first.sessionId,
          repoId,
          relPath: first.relPath as string,
        }),
      );
    }

    const check = history
      ? selfCheck(
          patches.map((p) => ({ relPath: p.relPath as string, atMs: at(p), fps: p.addedLineFps })),
          history,
          cfg,
        )
      : undefined;
    if (check?.confidence === "low") report.lowConfidenceRepos++;
    db.transaction(() => {
      upsertOutcomes(db, outcomes);
      setRepoOutcomeCheck(db, repoId, check, now());
      // Only a clean run is reused; a failed one is retried next time.
      if (key && !failure) setSetting(db, keySetting, key, now());
    });
  }

  refreshSessionSummaries(db, now());
  return report;
}

/**
 * Everything a repo's outcomes depend on: the engine and its config, the patches, every ref and
 * HEAD, and the edited files and ignore rules on disk (size and mtime). When it is unchanged the
 * previous outcomes still hold, so the repo's git history need not be read again.
 */
async function inputKey(
  root: string,
  patches: readonly AgentPatch[],
  cfg: OutcomeConfig,
  git?: GitOptions,
): Promise<string | undefined> {
  const refs = await gitOutput(root, ["show-ref", "--head"], git).catch(() => undefined);
  if (refs === undefined) return undefined;
  const h = createHash("sha256");
  h.update(`${ENGINE_VERSION}\n${JSON.stringify(cfg)}\n${refs}\n`);
  for (const p of patches) h.update(`${p.id}\n`);
  const stat = (rel: string) => {
    try {
      const st = statSync(join(root, rel));
      return `${rel}:${st.size}:${st.mtimeMs}`;
    } catch {
      return `${rel}:-`;
    }
  };
  for (const rel of [...new Set(patches.map((p) => p.relPath as string))].sort())
    h.update(`${stat(rel)}\n`);
  h.update(`${stat(".gitignore")}\n${stat(".git/info/exclude")}\n`);
  return h.digest("hex");
}

/** Per-session counts of session-file outcomes by class. */
function refreshSessionSummaries(db: LandedDb, now: number): void {
  const bySession = new Map<string, Record<string, number>>();
  for (const o of listOutcomes(db, { scope: "session-file" })) {
    const counts = bySession.get(o.sessionId) ?? {};
    counts[o.class] = (counts[o.class] ?? 0) + 1;
    bySession.set(o.sessionId, counts);
  }
  db.transaction(() => {
    for (const [sessionId, counts] of bySession)
      setSessionOutcomeSummary(db, sessionId, counts, now);
  });
}

function readTreeFingerprints(
  path: string,
  fingerprinter: LineFingerprinter,
): Set<string> | undefined {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > MAX_TREE_FILE_BYTES) return undefined;
    const buf = readFileSync(path);
    if (buf.includes(0)) return undefined; // binary
    return new Set(fingerprinter.fingerprintAll(buf.toString("utf8").split(/\r?\n/)));
  } catch {
    return undefined;
  }
}
