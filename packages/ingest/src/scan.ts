import type { LineFingerprinter } from "@landed/core/fingerprint";
import { type LandedDb, setSetting } from "@landed/db";
import { type AnalysisReport, analyze } from "./analyze";
import { claudeImporter, defaultClaudeProjectsRoot } from "./claude";
import { codexImporter, defaultCodexSessionsRoot } from "./codex";
import { computeOutcomes, type OutcomeRunReport } from "./outcomes";
import { type ImportReport, importSource } from "./pipeline";
import { verifyInstallSecret } from "./secret";

export interface ScanOptions {
  db: LandedDb;
  fingerprinter: LineFingerprinter;
  claudeRoot?: string;
  codexRoot?: string;
  now?: () => number;
  /** Progress messages for a CLI; never content. */
  onProgress?: (step: string) => void;
}

export interface ScanReport {
  startedAt: string;
  durationMs: number;
  /** Wall time per stage, for performance tracking (PRD §25). */
  stageMs: { import: number; outcomes: number; analysis: number };
  imports: ImportReport[];
  outcomes: OutcomeRunReport;
  analysis: AnalysisReport;
}

export const LAST_SCAN_SETTING = "lastScan";

/** The whole read-only pipeline: import both sources, compute outcomes, analyze. */
export async function runScan(opts: ScanOptions): Promise<ScanReport> {
  const now = opts.now ?? Date.now;
  const started = now();
  const progress = opts.onProgress ?? (() => {});
  verifyInstallSecret(opts.db, opts.fingerprinter, started);
  const imports: ImportReport[] = [];
  progress("Reading Claude Code history");
  imports.push(
    await importSource(claudeImporter, {
      db: opts.db,
      fingerprinter: opts.fingerprinter,
      root: opts.claudeRoot ?? defaultClaudeProjectsRoot(),
      now,
    }),
  );
  progress("Reading Codex history");
  imports.push(
    await importSource(codexImporter, {
      db: opts.db,
      fingerprinter: opts.fingerprinter,
      root: opts.codexRoot ?? defaultCodexSessionsRoot(),
      now,
    }),
  );
  const importDone = now();
  progress("Matching agent edits against git history");
  const outcomes = await computeOutcomes({ db: opts.db, fingerprinter: opts.fingerprinter, now });
  const outcomesDone = now();
  progress("Finding threads, open loops and collisions");
  const analysis = analyze(opts.db, now());
  const done = now();
  const report: ScanReport = {
    startedAt: new Date(started).toISOString(),
    durationMs: done - started,
    stageMs: {
      import: importDone - started,
      outcomes: outcomesDone - importDone,
      analysis: done - outcomesDone,
    },
    imports,
    outcomes,
    analysis,
  };
  setSetting(
    opts.db,
    LAST_SCAN_SETTING,
    { at: new Date(now()).toISOString(), durationMs: report.durationMs },
    now(),
  );
  return report;
}
