import type { OutcomeConfidence } from "@landed/core";
import type { RepoHistory } from "@landed/git-index";
import { DEFAULT_CONFIG, type OutcomeConfig } from "./classify";

/** Thresholds above which a repo's outcomes are flagged low-confidence (PRD §12.5). */
export const CONTROL_A_MAX = 0.08;
export const CONTROL_B_MAX = 0.01;
/** Below this many patches the controls are too noisy to judge. */
export const MIN_CONTROL_SAMPLE = 20;

export interface ControlInput {
  relPath: string;
  atMs: number;
  fps: readonly string[];
}

export interface SelfCheck {
  /** Share of patches whose lines mostly appear in commits made BEFORE the edit. */
  controlA: number;
  /** Share of patches whose lines mostly appear, after the edit, in a different file. */
  controlB: number;
  sample: number;
  confidence: OutcomeConfidence;
}

/**
 * The spike's negative controls, run on every scan. Both measure how often the matcher would
 * "find" an edit that the agent did not cause: high values mean boilerplate-heavy or generated
 * code where outcome numbers deserve less trust. The "other file" is chosen deterministically
 * by hash rather than by sorted order — neighbours in sorted order are often sibling files that
 * share boilerplate, which would inflate control B — so results stay reproducible.
 */
export function selfCheck(
  patches: readonly ControlInput[],
  history: RepoHistory,
  cfg: OutcomeConfig = DEFAULT_CONFIG,
): SelfCheck | undefined {
  const usable = patches.filter((p) => p.fps.length > 0);
  if (usable.length === 0) return undefined;
  const files = [...new Set(usable.map((p) => p.relPath))].sort();
  let a = 0;
  let b = 0;
  let bSample = 0;
  for (const p of usable) {
    const own = history.index.get(p.relPath);
    const cutoff = p.atMs - cfg.slackMs;
    const before = p.fps.filter((fp) => own?.get(fp)?.some((h) => h.timeMs < cutoff)).length;
    if (before / p.fps.length >= cfg.landedThreshold) a++;
    if (files.length > 1) {
      const other = otherFile(files, p.relPath);
      const otherIndex = history.index.get(other);
      const after = p.fps.filter((fp) =>
        otherIndex?.get(fp)?.some((h) => h.timeMs >= cutoff),
      ).length;
      bSample++;
      if (after / p.fps.length >= cfg.landedThreshold) b++;
    }
  }
  const controlA = a / usable.length;
  const controlB = bSample ? b / bSample : 0;
  const judged = usable.length >= MIN_CONTROL_SAMPLE;
  const confidence: OutcomeConfidence =
    judged && (controlA > CONTROL_A_MAX || controlB > CONTROL_B_MAX) ? "low" : "normal";
  return { controlA, controlB, sample: usable.length, confidence };
}

/** A deterministic, well-spread choice of a file other than `own`. */
function otherFile(files: readonly string[], own: string): string {
  let h = 2166136261;
  for (let i = 0; i < own.length; i++) h = Math.imul(h ^ own.charCodeAt(i), 16777619);
  const start = (h >>> 0) % files.length;
  for (let k = 0; k < files.length; k++) {
    const f = files[(start + k) % files.length] as string;
    if (f !== own) return f;
  }
  return own;
}
