# Dogfood log (PRD §24 Phase 13)

This file tracks Landed running daily on the development machine, which has about 1,100 session files, 5 GB of history, and 20 repos. Each entry records:
- the metrics PRD Phase 13 asks for;
- every finding;
- what was done about it.

Findings are judged against git directly (`git status`, `git branch --contains`, `git check-ignore`), not against Landed's own output.

Goal: at least 7 days, then fix everything found before the v0.1 Definition of Done (PRD §30).

## Day 1: 2026-10-06

### Metrics

| Metric | Before | After fixes | Target |
|---|---|---|---|
| Open loops | 52 | 13 (20 → 17 with the 10-line minimum, → 13 excluding `output/` and `.planning/`) | — |
| Collisions | 16 | 3 | — |
| Threads labeled `abandoned` | 166 | 1 | — |
| Incremental scan | 9.4 s | 1.3 s | < 3 s |
| Database size | 149 MB | — | < 300 MB |
| Unknown vendor line types (smoke) | 0 | — | 0 |
| Prompt leaks (smoke, 974 Claude prompts sampled) | 0 | — | 0 |
| Code-line leaks: production DB, 4,000 real code lines from agent-edited files vs 671k string cells | 0 | — | 0 |
| MCP output: absolute home paths over 103 calls on 20 repos | present | 0 | 0 |

### Findings

| # | Area | Finding (verified against git) | Fix |
|---|---|---|---|
| 1 | Outcomes / loops | Agent edits to **gitignored** files (`.env.production`, `local.properties`, `progress.md`, release plists) were classed `uncommitted` and raised loops that can never close. | `outcomes@4`: `git check-ignore` → `unknown/gitignored`. 11 session-files reclassified. |
| 2 | Outcomes / loops | **Stale default branch.** In one repo, `main` stopped on 2026-07-04 while all work lands on `develop`, now 402 commits ahead. Every landed edit there counted as unmerged, producing a 113-commit "unmerged branch" loop, and survival was `unknown`. | `outcomes@4`: the working trunk counts as the default branch (it contains the default tip and its own commits span more than 14 days). |
| 3 | Loops | **26 duplicate unmerged loops** across two repos. Codex subagents started in a scratch folder record no git branch, so each thread got its own loop. | `outcomes@4` records the commit's branch from git (`log --source`). Loops group by it, so there is now one loop per real branch, named. |
| 4 | Collisions | **13 of 16 collisions were handoffs.** One session ended, then another edited the same file within the hour (sequential pipelines, Claude→Codex handoffs). | `concurrent-edit` now requires the two sessions' activity spans to overlap. |
| 5 | Threads | **165 threads with no edits at all** (questions, reviews) were labeled `abandoned`. | `abandoned` requires produced work (lost or superseded) idle 14 days. Threads without edits stay `unknown`. |
| 6 | Loops (copy) | Failed sessions outside any repo read "Failed, never resolved in a repo". | They now read "… outside a git repository (session interrupted)". |
| 7 | Performance | Every scan re-read all repos' git history even when nothing changed (8.8 s of 9.4 s). | A per-repo input key skips unchanged repos: 1.3 s. |
| 8 | Test | The real-data smoke idempotency check failed when a live session appended during the run. | The check now allows re-reading only files written since the run started. |
| 9 | Privacy (MCP) | Sanitized failed commands carried absolute paths (`cd /Users/<name>/…`) into MCP answers. | `privacyFilter` rewrites home directories to `~` (fixed during Phase 20). |
| 10 | Loops | Tiny loops: uncommitted output of 1–2 lines, and unmerged branches of a few lines. | Minimum 10 significant lines for uncommitted and unmerged loops. Lost work keeps its 20-line minimum. |
| 11 | Loops | Agent reports and plans in `output/` and `.planning/` raised uncommitted loops; they are written to be read, not committed. | A `loopIgnorePaths` setting, default `output/` and `.planning/`, editable in Settings. Their outcomes are still computed. |

### Still open (not changed yet; judge over more days)

- **Very long continuation threads.** Up to 200 sessions over 32 days come from explicit vendor continuation (resume, subagents). They are legitimate lineage, but large as a "unit of work".
- **`prior_attempts` matching.** It only sees each file's first commit subject, so later commits' wording is not searchable.

## How to run the daily check

```bash
pnpm landed status                                                        # collector up, live activity
LANDED_REAL_DATA=1 pnpm vitest run packages/ingest/src/smoke.real.test.ts # leaks, unknown lines, parity
```

Then review the Open loops page. Dismiss false ones with a reason; dismissals are the false-positive signal for this log.
