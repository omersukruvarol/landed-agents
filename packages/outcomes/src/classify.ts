import type { OutcomeClass, OutcomeUnknownReason, Survival } from "@landed/core";
import type { LineHit, RepoHistory } from "@landed/git-index";

/** Bump with every rule or threshold change, together with the golden tests (PRD §28.13). */
export const ENGINE_VERSION = "outcomes@4";

export interface OutcomeConfig {
  /** Clock slack between the agent's edit and the commit (PRD §12.2). */
  slackMs: number;
  landedThreshold: number;
  workingTreeThreshold: number;
  survivalThreshold: number;
}

export const DEFAULT_CONFIG: OutcomeConfig = {
  slackMs: 120_000,
  landedThreshold: 0.5,
  workingTreeThreshold: 0.5,
  survivalThreshold: 0.5,
};

/** What is known about one file right now. */
export interface FileState {
  /** Fingerprints of the working-tree file; undefined when it does not exist. */
  workingTree?: ReadonlySet<string>;
  /** Fingerprints of the file at HEAD; undefined when absent there. */
  head?: ReadonlySet<string>;
  /** Untracked and ignored by the repo: never meant to be committed. */
  ignored?: boolean;
}

export interface Classification {
  class: OutcomeClass;
  unknownReason?: OutcomeUnknownReason;
  survival: Survival;
  fracCommitted: number;
  fracOnDefaultBranch: number;
  fracInWorkingTree: number;
  firstCommit?: { sha: string; timeMs: number; subject?: string; branch?: string };
  commitLagMs?: number;
  lineCount: number;
}

export function unknownOutcome(reason: OutcomeUnknownReason, lineCount = 0): Classification {
  return {
    class: "unknown",
    unknownReason: reason,
    survival: "unknown",
    fracCommitted: 0,
    fracOnDefaultBranch: 0,
    fracInWorkingTree: 0,
    lineCount,
  };
}

/**
 * Classifies a set of added-line fingerprints edited at `atMs` (PRD §12.2–12.3). Only commits made
 * after the edit (minus slack) count, so lines that already existed earlier never make an edit
 * look landed.
 */
export function classify(
  fps: readonly string[],
  atMs: number,
  relPath: string,
  history: RepoHistory,
  file: FileState,
  cfg: OutcomeConfig = DEFAULT_CONFIG,
): Classification {
  const n = fps.length;
  if (n === 0) return unknownOutcome("no-signal");
  const hitsByFp = history.index.get(relPath);
  const cutoff = atMs - cfg.slackMs;

  let committed = 0;
  let onDefault = 0;
  let inTree = 0;
  let first: LineHit | undefined;
  for (const fp of fps) {
    const hits = hitsByFp?.get(fp)?.filter((h) => h.timeMs >= cutoff) ?? [];
    if (hits.length > 0) {
      committed++;
      if (hits.some((h) => history.onDefaultBranch.has(h.sha))) onDefault++;
      for (const h of hits) if (!first || h.timeMs < first.timeMs) first = h;
    }
    if (file.workingTree?.has(fp)) inTree++;
  }

  const fracCommitted = committed / n;
  const fracOnDefaultBranch = onDefault / n;
  const fracInWorkingTree = inTree / n;
  let cls: OutcomeClass;
  if (fracCommitted >= cfg.landedThreshold) cls = "landed";
  else if (fracInWorkingTree >= cfg.workingTreeThreshold) cls = "uncommitted";
  else if (committed > 0 || inTree > 0) cls = "partial";
  else cls = "lost";

  // An ignored file is never meant to be committed, so "uncommitted" or "lost" would be noise.
  if (cls !== "landed" && file.ignored) return unknownOutcome("gitignored", n);
  const base = { fracCommitted, fracOnDefaultBranch, fracInWorkingTree, lineCount: n };
  if (cls !== "landed" || !first) return { ...base, class: cls, survival: "unknown" };

  const subject = history.commits.get(first.sha)?.subject;
  const branch = history.branchOf.get(first.sha);
  return {
    ...base,
    class: "landed",
    survival: survivalOf(fps, first.sha, fracOnDefaultBranch, history, file, cfg),
    firstCommit: {
      sha: first.sha,
      timeMs: first.timeMs,
      ...(subject ? { subject } : {}),
      ...(branch ? { branch } : {}),
    },
    commitLagMs: Math.max(0, first.timeMs - atMs),
  };
}

/**
 * Whether landed work is still there (PRD §12.3), refined: work that never reached the default
 * branch and is not in HEAD may simply live on another branch, so it is `unknown` rather than
 * `churned` — unmerged branches are an open-loop concern, not churn.
 */
function survivalOf(
  fps: readonly string[],
  firstSha: string,
  fracOnDefaultBranch: number,
  history: RepoHistory,
  file: FileState,
  cfg: OutcomeConfig,
): Survival {
  if (history.reverted.has(firstSha)) return "reverted";
  const head = file.head;
  const alive = head ? fps.filter((fp) => head.has(fp)).length / fps.length : 0;
  if (alive >= cfg.survivalThreshold) return "surviving";
  return fracOnDefaultBranch >= cfg.survivalThreshold ? "churned" : "unknown";
}

export interface PatchLike {
  timeMs: number;
  addedLineFps: readonly string[];
  removedLineFps: readonly string[];
}

/**
 * Net result of one session's edits to one file (PRD §12.2): lines it added and did not itself
 * remove later. Classified at the time of the session's first edit.
 */
export function netSessionFile(
  patches: readonly PatchLike[],
): { fps: string[]; atMs: number } | undefined {
  if (patches.length === 0) return undefined;
  const ordered = [...patches].sort((a, b) => a.timeMs - b.timeMs);
  const live = new Set<string>();
  for (const p of ordered) {
    for (const fp of p.removedLineFps) live.delete(fp);
    for (const fp of p.addedLineFps) live.add(fp);
  }
  return { fps: [...live], atMs: ordered[0]?.timeMs ?? 0 };
}
