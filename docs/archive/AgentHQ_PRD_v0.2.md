# AgentHQ — Product Requirements Document (PRD)

**Status:** v0.2 / Build-ready
**Date:** 2026-10-01
**Working codename:** AgentHQ (to be renamed before public release — see §29)
**Tagline:** *Did your AI agents' work actually land?*
**Initial platform:** macOS first, local-first
**Initial sources:** Claude Code + Codex CLI/app
**Primary user:** Individual developers running multiple coding agents across multiple repositories
**Long-term category:** Outcome analytics and coordination layer for AI coding agents

------------------------------------------------------------------------

## 0. How to use this document

This PRD replaces v0.1. It keeps v0.1's principles and privacy model and changes three things:

1. **Product thesis.** v0.1 described an activity viewer: timeline, sessions, tokens. v0.2 is an **outcome ledger**. It shows what agent work *became*: landed, still uncommitted, lost, churned, colliding, dangling.
2. **Ingestion strategy.** v0.1 put hooks and edits to vendor config at the center. v0.2 is **retro-first**: it imports the session files both vendors already write to disk. That needs **zero configuration changes** and returns months of history on the first run. Live ingestion arrives in v0.2-Live through our own collector.
3. **Build order.** Real local history replaces the simulator as the primary development data source. Fixtures and a synthetic seed generator stay for tests.

Build in the order defined in §24. Do not start a later release (Live, Memory, Team) until the acceptance criteria of the earlier one pass.

Vendor file formats, hook payloads, and telemetry change often. **Current official documentation and real local files are the source of truth** at implementation time. Keep vendor differences inside importer/adapter packages.

### 0.1 Changes from v0.1

| Area | v0.1 | v0.2 |
|---|---|---|
| Core question | "What did my agents do today?" | "What did my agents' work become, and what needs me?" |
| Hero surface | Timeline + Today metrics | Outcomes + Open Loops + Daily Brief |
| Primary ingestion | Hooks / OTel via vendor config edits | Local session-file importers (read-only); hooks later |
| First-run value | Empty state until new sessions run | Months of history analyzed in under a minute |
| Config mutation in MVP | Required (`init` edits settings) | **None** in v0.1-Retro |
| Live collection | MVP | v0.2-Live (own collector, Claude plugin, file watchers) |
| New entities | — | AgentPatch, LineFingerprint, Outcome, WorkThread, OpenLoop, Collision |
| Provenance labels | Observed / Inferred / Generated | Observed / **Derived** / Inferred / Generated |
| Simulator | Primary dev data | Test fixture generator only |

------------------------------------------------------------------------

# 1. Executive summary

Developers now run several AI coding agents across several repositories. Each vendor ships its own history viewer, usage meter, and, increasingly, analytics. Free open-source tools already merge sessions and token usage from many agents into one local dashboard. **Showing activity is commoditized.**

Nobody answers the question a developer, and later their manager, actually has:

> **Of everything my agents produced, what shipped, what is still sitting uncommitted, what was thrown away, and what needs my attention right now?**

AgentHQ is a **local-first outcome ledger for AI coding agents**. It reads the session files Claude Code and Codex already keep, extracts every file edit an agent made as a patch, and matches those patches against git history. From that it derives:

- **Outcomes:** each agent edit is classified as landed, uncommitted, lost, churned, or unknown, with evidence.
- **Open Loops:** agent work left dangling, such as uncommitted output, unmerged agent branches, orphaned worktrees, and sessions that ended waiting for the user.
- **Work Threads:** a unit of work reconstructed across sessions, days, and agents.
- **Collisions:** two agent sessions editing the same files, including one overwriting the other's output.
- **Waste:** tokens and time spent on output that never landed, and repeated failure loops.
- **Daily Brief / Retro Report:** a morning "where you left off" and a shareable retrospective.

Direction: `Observe → Understand outcomes → Coordinate (MCP memory) → Team analytics`.

A spike on real local data (§5) showed the core technique works: about 9,000 agent edits across 14 repos were classified in about 25 seconds, with a coincidental-match rate of 0.1%.

# 2. Problem

A developer running multiple agents loses track of what happened to the work. Day-to-day failure modes:

1. Agent output sits uncommitted for weeks and is forgotten. The spike found one real repo where 94% of an agent's output was never committed, alongside 5,883 uncommitted paths.
2. An agent's branch or worktree is never merged or cleaned up.
3. Two agents edit the same files, and one silently overwrites the other.
4. Work started in one agent continues in another the next day, and nobody can see the thread.
5. Tokens get burned in retry loops and on output that is later discarded.
6. A session ends waiting for an answer or approval, and the developer never returns to it.
7. The developer cannot say which agent works best for which kind of task in *their* codebase.
8. A manager cannot tell whether AI agent spend is turning into shipped code.

Existing tools show *activity*: sessions, tool calls, tokens, cost. None of them link activity to *outcome*.

**Product thesis:** AgentHQ is a ledger of what agent work became. It is not a chat-history viewer or a token meter.

# 3. Market context (research snapshot, 2026-10)

Snapshot for orientation only. Re-verify before external use.

**Already commoditized (do not compete head-on):**
- Local multi-agent session viewers that read session files into SQLite and serve a localhost UI with search, token/cost, heatmaps, and changed-file feeds. Example: agentsview supports 50+ agents.
- Token and cost CLIs, such as ccusage and its Codex mode.
- Hook-based live dashboards for Claude Code, several of them open source.
- Vendor-native features: Claude Code `/insights` local reports, the Codex desktop app, and Anthropic/OpenAI team analytics and compliance APIs.
- Cloud LLM-observability platforms with Claude Code / Codex tracing (Langfuse, LangSmith, Datadog AI Agents Console).
- Orchestrators and session managers that run agents in parallel worktrees (Conductor, Nimbalyst/Crystal, Claude Squad, cmux, GitHub "Agent HQ" mission control).

**Crowded later-stage space:** enterprise agent governance, audit, and identity (Endor Labs, Zenity, Token Security, Okta, gateways such as Bifrost). These are sold to security buyers.

**White space we own:**
1. Patch-level **outcome attribution** of agent edits to git history: landed, lost, churned.
2. **Open Loops**, a dangling-work ledger that spans agents.
3. **Cross-agent collision detection.** Orchestrators avoid collisions through worktrees but do not detect them.
4. **Work Threads** that span sessions and vendors.
5. A **vendor-neutral, evidence-based** comparison of agent outcomes per repo and task type. Vendors are structurally unable to offer this.

**Biggest risks:** vendors moving up-stack, unstable vendor file formats, and "feature, not product" (each pillar alone can be copied). See §27.

# 4. Differentiation and positioning

**Positioning statement:** Other tools show what your agents *did*. AgentHQ shows what that work *became*.

**What we compete on:** outcome truth, open loops, collisions, cross-agent threads, and trustworthy provenance.

**What we do not compete on:** the prettiest timeline, the widest agent coverage, real-time token meters, orchestration, or running agents.

**Why a neutral third party wins here:** Anthropic will not tell a user that Codex lands more code in their repo, and OpenAI will not say the reverse. Outcome comparison across vendors needs a neutral tool. Because the analysis runs locally, users can trust us with transcripts they would not upload.

**Five product pillars**

| Pillar | User question | Release |
|---|---|---|
| Outcomes | "What happened to the code my agents wrote?" | v0.1-Retro |
| Open Loops | "What did I leave hanging?" | v0.1-Retro |
| Work Threads | "Show me this task across every session and agent." | v0.1-Retro (deterministic) |
| Collisions | "Did my agents step on each other?" | v0.1-Retro (retrospective), v0.2-Live (live warning) |
| Waste & Fit | "Where are tokens wasted, and which agent fits which work here?" | v0.1-Retro (waste), v0.2 (fit, with controls) |

# 5. Evidence: feasibility spike (2026-10-01)

The spike code and full report are in `spike/` (`FINDINGS.md`, `extract.py`, `match.py`, `validate.py`).

**Data:** 143 Claude Code transcripts plus subagent files; 996 Codex rollouts (5.4 GB total).

**Edits extracted:**
- Claude: 928 edits, of which 763 are in live git repos. Taken from `toolUseResult.structuredPatch`.
- Codex: 9,189 edits, of which 8,123 are in live git repos. Taken from `item_completed → FileChange.unified_diff`, plus legacy `apply_patch`.

**Method:**
1. Extract added lines from each edit and normalize them: collapse whitespace, drop lines under 8 characters or without alphanumerics, drop lines that are only moved within the same hunk.
2. Index the `+` lines of every commit on all refs, for touched files only.
3. Classify each edit:
   - **landed:** at least 50% of its lines appear in a commit made after the edit (120 s slack).
   - **uncommitted:** not landed, but at least 50% of its lines are present in the working tree.
   - **partial:** some lines matched, but neither threshold was reached.
   - **lost:** no lines matched anywhere.

**Validation:**

| Check | Claude | Codex |
|---|---|---|
| Control: random other file, commits after edit (coincidental match) | 0.1% | 0.1% |
| Control: same file, commits *before* edit (pre-existing lines; upper bound on false positives) | 2.4% | 4.8% |
| Landed edits with a 100% line match | 93% | 80% |

Manual sample review (18 items) was consistent with the classification.

**Results** (session × file, net of intra-session rewrites):

| Agent | n | landed | uncommitted | partial | lost |
|---|---|---|---|---|---|
| Claude | 328 | 47% | 51% | 1% | 2% |
| Codex | 2,957 | 93% | 3% | 1% | 3% |

Other measurements:
- Median edit-to-commit lag was 0.8 h; p90 was 24 h.
- About 14% of landed edits had since been changed or removed (churn).
- 31% of Codex session×file outputs were docs or evidence files.
- 12% of edits pointed at deleted worktrees or non-repo paths and were classified unknown.

**Lessons that shape this PRD:**
1. The technique is sound and fast enough for an instant first-run experience.
2. **A single "landed %" saturates** in disciplined workflows (93%). The value is in the tails: uncommitted, lost, churn, and overhead. The hero view is an **outcome distribution plus a list of open loops**, not a single score.
3. **Naive agent-vs-agent comparison is misleading.** In the spike, the Claude/Codex difference came mostly from repo and workflow differences. Comparisons must be controlled by repo and task type, or not shown (§12.6).

# 6. Product principles

Kept from v0.1:

1. Local-first by default.
2. Passive before active.
3. No fake precision: unknown stays unknown.
4. Vendor-neutral core.
5. Useful within five minutes. Retro import makes this **useful within one minute**.
6. Show work and outcomes by default, not telemetry noise.
7. Privacy is part of the product.
8. Configuration changes are previewable, backed up, reversible, and idempotent.
9. A missing vendor field never invalidates a whole session.
10. Adding a source must not require rewriting storage or UI.
11. Observability failure never breaks agent execution.

New in v0.2:

12. **Outcomes over activity.** Every screen should answer "so what happened?" before "what ran?".
13. **Evidence-based attribution.** Authorship is claimed only from the agent's own recorded patch matched to git. A working-tree diff alone is never enough.
14. **Four provenance levels**, always visible:
    - **Observed:** read directly from a source file or git.
    - **Derived:** deterministic computation over observed data, for example an outcome class.
    - **Inferred:** a heuristic that may be wrong, for example "possible duplicate".
    - **Generated:** produced by an LLM.
15. **No leaderboards without controls.** Agent comparisons appear only with a sufficient sample, the same repo, and the same task type, and always show n and confidence.
16. **Read-only before write.** v0.1-Retro never modifies vendor config, git state, or files.

# 7. Target users and buyers

## Primary: multi-agent individual developer (v0.1–v0.3)

Uses Claude Code and/or Codex daily, works on 2+ repos, often runs parallel sessions, values privacy, and does not want to keep a manual journal.

Jobs:
- "Tell me where I left off."
- "Show me what's dangling."
- "Did my agents' work land?"
- "Did they collide?"
- "Where am I wasting tokens?"

## Secondary: tech lead / engineering manager (Team, post-validation)

Wants to know whether agent spend is turning into shipped code, where agents work well, and where work gets abandoned. **This is the paying buyer for the company.** Do not build team features before the individual validation gate (§26) passes. Do design the data model so that team aggregation later needs only aggregates, never raw transcripts.

# 8. Releases and scope

## v0.1-Retro (MVP)

Read-only analysis of local history plus git, served through a local web UI.

**Must have:**
- Importers for Claude Code transcripts (including subagent files) and Codex rollouts. Incremental, with checkpoints.
- Git indexer for each repo touched by agents.
- Outcome engine (§12).
- Open Loops (§13).
- Work Threads, deterministic (§14).
- Retrospective Collisions (§15).
- Waste metrics and deterministic insights: repeated failure, stale session, interrupted session (§16).
- Usage aggregation with coverage labels and correct deduplication (§17).
- Today, Outcomes, Open Loops, Threads, Sessions, and Settings views (§20).
- Deterministic Daily Brief, plus an optional generated narrative (§18).
- Retro Report ("Agent Wrapped"): a shareable, privacy-safe summary (§19).
- CLI commands: `scan`, `open`, `brief`, `report`, `doctor`, `data prune|reset`, `uninstall` (§22).

**Explicitly not in v0.1:** vendor config edits, hooks, a background daemon, live updates beyond re-scan, cloud, accounts, team features, a policy engine, orchestration, Windows/Linux, or extra agents.

## v0.2-Live

- Own collector daemon on `127.0.0.1` with a LaunchAgent.
- File watchers on vendor session directories for near-real-time import. This needs no config change.
- **Claude Code plugin** with `http` hooks posting to the collector, for signals missing from transcripts: permission waits, notifications, stop reasons. Plugin install is opt-in and uses the vendor's plugin mechanism. Never hand-edit `settings.json`.
- Optional Codex hooks for live session start/stop. Codex hooks require the user's trust review.
- Live Open Loop and Collision notifications (macOS notifications).
- Agent/task-type fit, with the controls in §12.6.

## v0.3-Memory

- A local **MCP server** that agents can query:
  - `recent_work(repo, path?)`: what other agents did here recently.
  - `open_loops(repo)`
  - `prior_attempts(query)`: failed approaches and their outcomes.
  - `active_sessions(repo)`: who else is editing these files now.
- A "Resume packet": a handoff summary for continuing a Work Thread in any agent.
- This is coordination without orchestration. AgentHQ never drives agents.

## v1-Team (only after §26 gate)

- Opt-in upload of **aggregates only**: outcome distributions, open-loop counts, usage, and fit. Never transcripts, code, prompts, or paths by default.
- A team dashboard with "AI spend → shipped code" reporting.
- Self-host option. SSO and RBAC only when a paying design partner needs them.

# 9. Core user journeys

## 9.1 First run (v0.1)

Illustrative output. The numbers are loosely based on the spike and are not exact.

```text
$ agenthq scan

AgentHQ — read-only scan (no config or files will be modified)

Sources
✓ Claude Code   143 sessions  ·  Jun 2 → today
✓ Codex         996 sessions  ·  Oct 2025 → today
Repositories    14 found  ·  2 missing (moved/deleted worktrees)

Privacy
  Prompt text        not stored
  Code lines         stored as salted fingerprints only
  File paths         stored locally
  Network            none

Analyzed 9,903 agent edits in 24s.

Outcomes (last 30 days)
  Landed        86%   ███████████████████████████▌
  Uncommitted    8%   ██▌
  Lost/churned   4%   █▍
  Unknown        2%   ▌

Open loops      7   (largest: mobile-app — 174 agent outputs never committed)
Collisions      3   (Claude & Codex edited the same file within 1h)

→ agenthq open
```

## 9.2 Morning (daily habit)

The user opens the dashboard or runs `agenthq brief` and reads:
- **Where you left off:** threads that were active yesterday and are still unfinished.
- **Open loops:** sorted by age and size.
- **What landed yesterday:** per repo, with commits.
- **Attention:** repeated-failure sessions, collisions, and sessions that ended waiting for input.

## 9.3 Investigating a thread

Today → Thread "webhook retry fix" shows 4 sessions across 2 agents over 2 days. Each session's edits are listed with their outcomes. 3 files are still uncommitted. The last session ended after 4 failed `pnpm test` runs. A **Copy resume context** button produces a plain-text handoff the user can paste into any agent.

## 9.4 Retro Report

`agenthq report --period 30d` produces a shareable HTML/PNG card showing outcome distribution, open loops closed, top waste sources, and agent mix. **Default output contains no paths, repo names, or code.** The user explicitly opts in to naming repos.

# 10. Information architecture

```text
Today        — brief, open loops, attention, what landed
Outcomes     — distribution by repo / agent / period, lost & churn drill-down
Open Loops   — dangling work ledger with actions
Threads      — reconstructed units of work
Sessions     — raw session list and detail (secondary)
Settings     — sources, repos, privacy, summarizer, retention, diagnostics
```

The first usable build needs Today, Open Loops, Sessions, and Settings. Outcomes and Threads follow.

# 11. Domain model

Vendor files are immutable input. Normalized entities are product truth.

## 11.1 Enumerations

```ts
type AgentProvider = "claude-code" | "codex" | "unknown";

type SessionStatus =
  | "active" | "completed" | "failed" | "interrupted"
  | "awaiting-user" | "abandoned" | "unknown";

type Provenance = "observed" | "derived" | "inferred" | "generated";

type OutcomeClass =
  | "landed"        // matched in a commit after the edit
  | "uncommitted"   // present in working tree, not committed
  | "partial"       // some lines matched, below thresholds
  | "lost"          // nowhere in commits or working tree
  | "superseded"    // replaced later by the same session (net view hides it)
  | "unknown";      // repo missing / file outside repo / unreadable

type Survival = "surviving" | "churned" | "reverted" | "unknown";
```

`completed` still requires reliable evidence: a vendor completion event (Codex `task_complete`, Claude `stop_reason` at turn end) and no pending tool call.

## 11.2 NormalizedEvent

Keep v0.1 §12.4 with these changes:
- Add `sourceRef: { file: string; offset: number; parserVersion: string }` for traceability.
- Add `tool.callId?: string`.
- Add `eventType` values `"edit.applied"` and `"session.awaiting-user"`.
- `content.*` remains absent unless the user enables capture.

## 11.3 AgentPatch (new)

One file edit recorded by an agent tool.

```ts
interface AgentPatch {
  id: string;                 // ULID
  sessionId: string;
  provider: AgentProvider;
  toolCallId?: string;        // Claude tool_use_id / Codex item id
  timestamp: string;
  repoId?: string;
  path: string;               // absolute, as recorded
  relPath?: string;           // relative to repo root
  operation: "create" | "modify" | "delete" | "rename";
  addedLineFps: string[];     // fingerprints of normalized significant added lines
  removedLineFps: string[];
  addedLineCountRaw: number;
  removedLineCountRaw: number;
  sourceRef: SourceRef;
}
```

## 11.4 LineFingerprint

```text
fp = HMAC-SHA256(installSecret, normalize(line))[0..16]  (hex)
normalize = collapse internal whitespace, trim
significant = length ≥ 8 AND contains [A-Za-z0-9]
```

Only fingerprints are persisted, never line text. The git index uses the same function, so matching works on fingerprints. The install secret lives in the data directory with `0600` permissions and never leaves the machine.

## 11.5 Outcome

```ts
interface Outcome {
  id: string;
  scope: "patch" | "session-file";       // session-file = net of intra-session rewrites
  patchId?: string;
  sessionId: string;
  repoId?: string;
  relPath?: string;
  class: OutcomeClass;
  survival: Survival;
  fracCommitted: number;                 // 0..1
  fracOnDefaultBranch: number;           // 0..1
  fracInWorkingTree: number;             // 0..1
  firstCommit?: { sha: string; time: string; subject?: string };
  commitLagSeconds?: number;
  lineCount: number;
  provenance: "derived";
  computedAt: string;
  engineVersion: string;
}
```

## 11.6 Other entities

```ts
interface AgentSession {      // v0.1 §12.5 plus:
  status: SessionStatus;
  sourceFiles: string[];
  title?: string; titleProvenance?: Provenance;
  outcomeSummary?: Record<OutcomeClass, number>;
  threadId?: string;
}

interface WorkThread {
  id: string; repoId: string;
  sessionIds: string[]; providers: AgentProvider[];
  startedAt: string; lastActivityAt: string;
  title: string; titleProvenance: Provenance;
  branch?: string;
  status: "active" | "landed" | "dangling" | "abandoned" | "unknown";
  linkEvidence: ThreadLinkEvidence[];   // why sessions were grouped
}

interface OpenLoop {
  id: string; type: OpenLoopType; repoId?: string;
  threadId?: string; sessionIds: string[];
  since: string; size: { files?: number; lines?: number; commits?: number };
  evidence: unknown; provenance: Provenance;
  state: "open" | "dismissed" | "resolved"; resolvedBy?: "auto" | "user";
}

interface Collision {
  id: string; repoId: string; relPath: string;
  sessionA: string; sessionB: string;
  kind: "concurrent-edit" | "overwrite" | "possible-duplicate";
  window: { start: string; end: string };
  evidence: unknown; provenance: Provenance;
}
```

# 12. Outcome engine

## 12.1 Inputs

- AgentPatches, from the importers.
- Git index, per repo: for each touched `relPath`, the map `fp → [(commitTime, sha, onDefaultBranch)]`, built from `git log --all -p -U0 --no-ext-diff`. Index only files that agents touched.
- Working-tree fingerprints for touched files, read at scan time.

## 12.2 Classification (defaults are configurable; engine is versioned)

For each patch with at least 1 significant added line:

```text
fracCommitted     = share of fps found in commits with time ≥ patch.time − 120s
fracInWorkingTree = share of fps present in current file
class =
  landed       if fracCommitted ≥ 0.5
  uncommitted  else if fracInWorkingTree ≥ 0.5
  partial      else if fracCommitted > 0 or fracInWorkingTree > 0
  lost         else
  unknown      if repo missing / file outside any repo
```

Patches with no significant added lines (pure deletions, whitespace changes) get `class = unknown` with reason `no-signal` and are excluded from distributions. Pure deletions can be checked in a later engine version by matching removed fingerprints.

**Session-file net scope** (default in UI): union of a session's added fingerprints for a file, minus fingerprints removed by a later edit in the same session. Classify that set with the first patch time.

## 12.3 Survival

For landed outcomes:
- **surviving:** at least 50% of fingerprints are still in the current HEAD version of the file.
- **churned:** below that threshold.
- **reverted:** the landing commit was reverted, detected through the revert-commit message or an exact inverse diff.

## 12.4 Default branch

Resolve from `origin/HEAD`, then `main`, then `master`, then the current HEAD. Show `fracOnDefaultBranch` as "merged" versus "landed on side branch".

## 12.5 Built-in self-check (trust feature)

Each scan computes the two spike controls and reports them in `doctor` and Settings:
- **Control A:** match rate against commits *before* each patch.
- **Control B:** match rate against a random other file.

Thresholds: Control B ≤ 1% and Control A ≤ 8%. Above that, mark the outcome confidence for the affected repo as *low* in the UI, for example in repos with heavy boilerplate or generated code.

## 12.6 Agent / task-type comparison rules

- Compare only within the same repo, and optionally the same task type: file category (code, test, docs) plus thread type.
- Require at least 30 session-file outcomes per agent in the cell.
- Show n, the distribution, and a 90% interval. Never show a single "score".
- Label the comparison **Derived** and show the caveat: "Differences may reflect how you used each agent, not agent capability."

## 12.7 Known limitations (must be shown in UI help)

- Shell-made changes (sed, codegen, formatters, package managers) are invisible to patch attribution.
- Reformatting after the edit can lower match rates. These cases surface as partial.
- Deleted worktrees: try matching against the main repo through branch refs before declaring unknown. This is a v0.1 should-have.
- Who committed (agent or human) is not determined in v0.1. Show agent trailers as Observed metadata when present.

# 13. Open Loops

Each loop type has a deterministic detector, an age, a size, evidence, and actions.

| Type | Detector | Provenance |
|---|---|---|
| `uncommitted-output` | Session-file outcomes classed uncommitted, grouped by repo/thread, older than 24h (configurable) | Derived |
| `unmerged-agent-branch` | Branch with commits containing landed agent patches, not merged to default, no activity for 7 days | Derived |
| `orphan-worktree` | Worktree created during an agent session (Codex/Claude worktree events or path conventions) that still exists and is dirty or unmerged | Observed/Derived |
| `awaiting-user` | Session's last event is a pending permission/approval or an assistant turn ending in a question, with no later session in the thread | Inferred |
| `failed-unresolved` | Session ended failed/interrupted and no later session in the same thread landed changes to the same files | Derived |
| `lost-work` | A thread with significant lost output (≥ N lines) and no landed outcome | Derived |

**Actions:**
- Open in terminal at the repo.
- Copy resume context.
- Dismiss, with a reason.
- Mark resolved.

A loop is auto-resolved when a later scan shows its condition is no longer true, for example when the changes get committed.

**Severity:** a function of age × size. Never color-only: always show text and an icon.

# 14. Work Threads

v0.1 uses deterministic linking only. Every link stores evidence.

Sessions are linked into one thread when **all** hold:
- Same repo.
- Time gap between sessions ≤ 72 h (configurable).

And **any one** of:
- Explicit continuation: Claude `resume`/`fork` from the same transcript lineage, or a Codex thread/subagent relationship.
- Same non-default branch.
- File-set Jaccard ≥ 0.3 over edited files.
- A later session's patches modify lines added by an earlier session (fingerprint overlap in removed or added sets).

**Thread title** priority, with prompt capture OFF:
1. Branch name, humanized.
2. First landing commit subject.
3. Top touched directory.
4. Vendor-provided session title, if present (for example a Claude `custom-title`).

With prompt capture ON and a summarizer configured, a **Generated** title is allowed.

**Thread status:**
- `landed`: all outcomes are landed.
- `dangling`: any open loop.
- `abandoned`: no activity for 14 days and nothing landed.
- `active`: activity within 2 h, or live (v0.2).

# 15. Collisions

**Retrospective in v0.1:**
- **concurrent-edit:** two sessions (any agents) edited the same `relPath` while their active windows overlapped, or within 60 min of each other. Derived.
- **overwrite:** session B's patch removed fingerprints that session A had added earlier and that had not yet landed. Derived. This is the high-value signal.
- **possible-duplicate:** same repo, overlapping windows, different threads, with at least 2 of: similar file sets, a similar command signature set, similar branch/commit vocabulary. Inferred. Always show the evidence.

Never state duplicate work as fact unless it is provable.

**Live in v0.2:** a notification when an active session starts editing a file that another active session edited in the last 60 min.

# 16. Waste and deterministic insights

- **Repeated failure:** the same normalized command or tool signature fails ≥ 3 times in one session.
  - Claude: `tool_result.is_error` and the PostToolUseFailure equivalent in the transcript.
  - Codex: `CommandExecution.exit_code ≠ 0`.
- **Tokens on non-landed output:** usage of sessions whose net outcomes are mostly lost or uncommitted. Label it "attributed by session", not exact.
- **Overhead share:** the fraction of outputs to docs/evidence/log files. Informational.
- **Stale session:** a session marked active with no events for longer than the threshold.
- **Interrupted/failed session:** from reliable lifecycle evidence.
- **High activity:** informational only. Never equate tool calls with productivity.

Every insight has: type, severity, message, evidence JSON, provenance, createdAt, and an optional dismissedAt.

# 17. Usage and cost semantics

Rules carried over from v0.1:
- Never invent cost.
- Prefer raw tokens.
- Label dollar values **Estimated**, together with the pricing table version.
- Expose coverage as `none | partial | complete`.

New, mandatory dedupe rules:
- **Claude transcripts:** one API message is split across several lines that repeat the same `usage`. Deduplicate by `message.id`, falling back to `requestId`. The spike measured about 1.6× over-count without this.
- **Codex rollouts:** `token_count` carries cumulative `total_token_usage` and per-turn `last_token_usage`. Use per-turn values, deduplicated by turn, and reconcile against the final cumulative value. Never sum the cumulative values.
- Subscription plans: show tokens and do not show a dollar figure unless the user selects a pricing mode.

# 18. Daily Brief and summarization

**The deterministic brief always works.** It needs no LLM.

Sections:
- Where you left off: active and dangling threads.
- Open loops: new, aging, and resolved.
- What landed: per repo, with commits.
- Attention: failures, collisions, awaiting-user sessions.
- Usage, with coverage.

**Generated narrative (optional)** goes through a provider-neutral `Summarizer` interface (v0.1 §19). Provider options, in order of preference:
1. The user's **installed agent CLI in non-interactive mode** (for example `claude -p` or `codex exec`). No new API key is needed. Data goes to a vendor the user already uses. It still requires explicit opt-in, and the summarizer sees only sanitized structured facts.
2. Local Ollama.
3. A direct API key.

Rules:
- Input is structured facts (thread titles, outcomes, counts, commit subjects). Prompt text, code, and tool output are never included unless the user has enabled capture.
- Output is strict JSON, validated. Show it with the **Generated** label. On failure, fall back silently to the deterministic brief.
- Export to Markdown.

# 19. Retro Report ("Agent Wrapped")

A growth surface.

- Periods: 7, 30, or 90 days, or a custom range.
- Content:
  - Outcome distribution.
  - Agents used, and the mix.
  - Open loops created and closed.
  - Biggest thread.
  - Waste highlights.
  - Commit lag.
  - "Most-touched area", shown as a category, not a path.
- **Privacy-safe by default:** no repo names, paths, code, prompts, or commit subjects. Any of these can be turned on per item.
- Output: a local HTML file and a PNG card. No upload happens from AgentHQ. The user shares it manually.

# 20. UI / UX requirements

- A professional developer tool: calm, information-dense, desktop-first, fast.
- Every number and claim carries a provenance chip (Observed / Derived / Inferred / Generated). Hovering shows the evidence.
- Status is communicated with text and icon, not color alone.
- Low-level events are grouped in timelines, for example "Read 17 files".
- **Language rule:** never write "Claude wrote X" from a git diff. Use "Changes from this session's edits landed in commit abc123". The engine has patch evidence, so "this session's edits" is accurate.

**Empty state** (no sources found):

```text
No agent history found.

AgentHQ reads Claude Code (~/.claude/projects) and Codex (~/.codex/sessions)
session files. Run a session in either tool, then run `agenthq scan`.

[Run diagnostics]
```

**Low-confidence repo state:** "Outcome confidence is low in this repo (heavy generated or boilerplate code). Treat numbers as approximate."

# 21. Architecture

## 21.1 v0.1-Retro

```text
~/.claude/projects/**.jsonl ─┐
~/.codex/sessions/**.jsonl ──┤  (read-only)
                             ▼
                   ┌───────────────────┐
                   │ Importers         │  versioned parsers, checkpoints
                   │ claude / codex    │  → NormalizedEvent, AgentPatch, Usage
                   └─────────┬─────────┘
                             ▼
git repos (read-only) → ┌──────────┐
                        │ Git index│  fp → commits, working tree fps
                        └────┬─────┘
                             ▼
                   ┌───────────────────┐
                   │ SQLite            │
                   └─────────┬─────────┘
       ┌─────────────┬───────┼─────────┬──────────────┐
       ▼             ▼       ▼         ▼              ▼
  Sessionizer   Outcome   Threads   Open Loops /   Brief / Report
                engine              Collisions /
                                    Insights
                             │
                             ▼
                 Local API (127.0.0.1) → Web UI
```

`agenthq open` starts the local server in the foreground and runs an incremental scan on start and on demand.

## 21.2 v0.2-Live additions

```text
File watchers (FSEvents) ──┐
Claude plugin http hooks ──┼──► Collector daemon (127.0.0.1, LaunchAgent)
Codex hooks (optional) ────┘        │ same pipeline, incremental
                                    ▼
                         SSE → Web UI, macOS notifications
```

## 21.3 Ingestion details

**Checkpoints:** one per source file, storing `(path, inode, size, mtime, byteOffset, parserVersion)`.
- Append-only files resume from `byteOffset`.
- On inode change, truncation, or a `parserVersion` bump, re-parse the whole file.

**Parser versioning:** each importer has a `parserVersion`. Fixtures are pinned per vendor version, for example Claude `2.1.x` and Codex `0.14x`.
- Unknown line types are counted and kept as minimal `unknown` events. They never fail a file.
- Unparseable lines go to `ingestion_failures` with the file, offset, and reason. Never store the line text.

**Known source facts** (verify at build time):
- **Claude lines:**
  - Common fields: `type`, `uuid`, `parentUuid`, `sessionId`, `timestamp`, `cwd`, `gitBranch`, `version`, `isSidechain`.
  - `assistant.message`: `{id, model, content[], usage, stop_reason}`.
  - `user.toolUseResult`: Edit/Write results with `{filePath, oldString, newString, structuredPatch[], originalFile, userModified}`.
  - Subagents: `<session>/subagents/agent-<id>.jsonl` plus `.meta.json`.
  - No structured Bash exit code; use the `is_error` flag.
- **Codex lines:**
  - Shape: `{timestamp, type, payload}`.
  - `session_meta`: `id`, `cwd`, `cli_version`, `originator`, `git{branch, commit_hash, repository_url}`.
  - `turn_context`.
  - `event_msg`: `task_started`, `task_complete`, `token_count`.
  - `item_completed.item`: `CommandExecution{command, cwd, exit_code, duration, status}`, `FileChange{changes{path: {type: add|update|delete, unified_diff|content, move_path}}}`, `SubAgentActivity`, `McpToolCall`.
  - Legacy `custom_tool_call: apply_patch` input.
  - Desktop app sessions (`originator: codex_work_desktop`) live in the same directory.
- **Large files:** stream line by line. Never load a whole file. The biggest observed file was 229 MB.

**Repo resolution:** walk up from the edited file to the nearest `.git` (directory or file). Cache the result per directory. For a missing path, try the session `cwd`, then the Codex `session_meta.git`, and only then mark the repo unknown.

**Remote identity:** store `repoRemoteHash = HMAC(installSecret, normalizedRemoteUrl)`. Show the raw remote URL only locally.

## 21.4 Repository layout

```text
agenthq/
├─ apps/
│  ├─ cli/
│  ├─ server/            # local API + static web; becomes collector daemon in v0.2
│  └─ web/
├─ packages/
│  ├─ core/              # domain types, zod schemas, provenance, fingerprints
│  ├─ db/                # drizzle schema, migrations, repositories
│  ├─ importer-claude/
│  ├─ importer-codex/
│  ├─ git-index/
│  ├─ outcomes/
│  ├─ threads/
│  ├─ loops/             # open loops + collisions
│  ├─ insights/
│  ├─ brief/             # deterministic brief + report rendering
│  ├─ summarizer/
│  └─ shared/
├─ fixtures/
│  ├─ claude/<version>/
│  ├─ codex/<version>/
│  └─ git/               # scripted synthetic repos for outcome tests
├─ spike/                # feasibility spike (reference only, not shipped)
├─ docs/  architecture.md  privacy.md  sources.md  outcomes.md
├─ PRD.md
├─ CLAUDE.md
├─ package.json
└─ pnpm-workspace.yaml
```

## 21.5 Stack

- TypeScript on Node.js 22 LTS. Node 22 is installed on the dev machine.
- pnpm workspaces. pnpm is **not installed** on the dev machine; enable it through `corepack enable`.
- Fastify for the local API, Zod for validation, Pino for logs.
- SQLite through better-sqlite3 with Drizzle ORM. WAL mode.
- `git` through the CLI as a child process, always with argument arrays and never a shell. Never write to git.
- React + Vite + Tailwind + TanStack Query. SSE in v0.2.
- Vitest and Playwright.
- ULID identifiers.
- No Electron or Tauri before v0.3. A native menu-bar shell is an option after validation.

# 22. CLI specification

| Command | Release | Behavior |
|---|---|---|
| `agenthq scan [--since 90d] [--repo PATH]` | 0.1 | Incremental read-only import and analysis; prints the summary from §9.1 |
| `agenthq open` | 0.1 | Starts the local server (foreground) and opens the browser |
| `agenthq brief [--date YYYY-MM-DD] [--md]` | 0.1 | Prints or exports the Daily Brief |
| `agenthq report [--period 30d] [--include-names]` | 0.1 | Writes the Retro Report HTML/PNG locally |
| `agenthq loops [--repo PATH]` | 0.1 | Lists open loops |
| `agenthq doctor [--verbose]` | 0.1 | PASS/WARN/FAIL checks for sources, DB, data dir permissions, git availability, parser coverage (unknown-line %), outcome self-check, summarizer |
| `agenthq export --date … [--json\|--md]` | 0.1 | Respects privacy settings |
| `agenthq data prune --older-than 30d` / `data reset` | 0.1 | Reset requires typed confirmation |
| `agenthq uninstall` | 0.1 | Removes AgentHQ data (with confirmation); never touches vendor files |
| `agenthq start` / `stop` / `status` | 0.2 | Daemon lifecycle (LaunchAgent) |
| `agenthq plugin install claude` / `remove` | 0.2 | Uses Claude Code's plugin mechanism; shows a preview first |
| `agenthq hooks install codex` / `remove` | 0.2 | Parse-merge-backup of Codex hook config, with a preview; reminds the user about trust review |

`doctor` never prints secrets, and it never prints line content.

# 23. Privacy and security

Defaults:

```text
Prompt text stored            OFF
Assistant text stored         OFF
Tool arguments stored         redacted metadata only (command executable + sanitized display)
Tool results stored           OFF
Code lines stored             NEVER (salted fingerprints only)
File contents                 NEVER
Environment variables         NEVER
Raw vendor lines retained     OFF (debug mode: opt-in, 7-day cap)
Network egress                NONE (summarizer is opt-in and explicit)
Bind address                  127.0.0.1
Data dir permissions          0700, DB 0600
```

- **Reading is not storing.** Importers read vendor files, which contain prompts and code, in memory and persist only normalized metadata and fingerprints. The UI and `privacy.md` must say this plainly.
- **Redaction** before persisting any display string (commands, titles): API keys and tokens, Authorization/Bearer headers, passwords in CLI flags or URLs, `.env`-style assignments, private key blocks, and cloud credential patterns. Redaction is defense in depth, not a guarantee.
- **Local API:**
  - Loopback only.
  - Reject non-loopback `Host`/`Origin` values (DNS-rebinding protection).
  - Use a per-install token for state-changing routes.
  - Enforce body limits.
  - Never execute ingested content.
- **Git:** argument arrays only, read-only subcommands only, with a timeout per call.
- **Retro Report:** no names, paths, or code by default.

# 24. Build plan for Claude Code

Implement in order. Each phase leaves the repo runnable, with lint, typecheck, and tests passing.

## v0.1-Retro

**Phase 0: bootstrap.**
- pnpm workspace through corepack, TS configs, lint/format, Vitest, basic CI, package skeletons from §21.4.
- `CLAUDE.md` documenting §28.
- Exit criteria: `pnpm install && pnpm lint && pnpm typecheck && pnpm test` passes.

**Phase 1: domain core.**
- Deliver: enums, Zod schemas, provenance, the fingerprint function (HMAC, normalize, significant), and an event fingerprint for idempotency.
- Tests: schema validity, optional fields, invalid timestamps, deterministic fingerprints, normalization edge cases.

**Phase 2: storage.**
- Deliver: Drizzle schema and migrations for `sources`, `source_checkpoints`, `sessions`, `events`, `agent_patches`, `patch_line_fps`, `repos`, `git_line_index`, `outcomes`, `threads`, `thread_sessions`, `open_loops`, `collisions`, `insights`, `usage_records`, `summaries`, `app_settings`, `ingestion_failures`.
- Indexes:
  - `events(session_id, timestamp)` and `events(timestamp)`
  - `sessions(provider, provider_session_id)`, unique
  - `agent_patches(session_id)` and `agent_patches(repo_id, rel_path)`
  - `git_line_index(repo_id, rel_path, fp)`
  - `outcomes(session_id, scope)`
  - `open_loops(state, repo_id)`
  - an event fingerprint, unique
- Tests: migrations on an empty DB, idempotent insert, session upsert, queries by date/provider/repo.

**Phase 3: Claude importer.**
- Before coding, sample real local files and record the line-type inventory in `docs/sources.md`.
- Deliver: a streaming parser, checkpoints, session building (including subagents), AgentPatch extraction, usage deduplicated by `message.id`, command metadata with redaction, and status evidence.
- Fixtures: sanitized real snippets, with code replaced by placeholders and prompts removed.
- Tests: every fixture normalizes predictably, re-scans are idempotent, partial files work, and unknown line types are counted.

**Phase 4: Codex importer.**
- Same scope as Phase 3, plus: `item_completed` items, legacy `apply_patch`, deduplication of patches that appear both as an apply_patch call and as a FileChange, turn-level token usage, exit codes, and desktop-app sessions.

**Phase 5: git index and outcome engine.**
- Port the spike logic into `git-index` and `outcomes`.
- Deliver: patch and session-file scopes, survival, default branch, the self-check controls, and worktree fallback.
- **Golden tests:** `fixtures/git` scripts build synthetic repos covering each class: landed, uncommitted, partial, lost, churned, reverted, squash-merged, rebased, and formatter-modified.
- Exit criteria: running on the dev machine reproduces the spike numbers within ±2 points.

**Phase 6: local API and dashboard foundation.**
- Fastify routes:
  - `/v1/health`
  - `/v1/today`
  - `/v1/sessions`, `/v1/sessions/:id`
  - `/v1/outcomes`
  - `/v1/loops`
  - `/v1/threads`
  - `/v1/insights`
  - `/v1/scan` (POST)
- Web: Today, Sessions, Session detail, Settings, plus empty/loading/error states and provenance chips.
- `pnpm dev:seed` generates synthetic sources and repos for UI work on machines without history.

**Phase 7: Open Loops and insights.**
- Deliver: the §13 detectors with auto-resolve, and the §16 insights.
- UI: the Open Loops page with its actions.

**Phase 8: threads and collisions.**
- Deliver: the §14 linking with evidence and the §15 retrospective collisions.
- UI: Threads pages, plus collisions on Today.

**Phase 9: Outcomes view.**
- Deliver: distributions by repo, agent, period, and file category; lost/churn drill-down; low-confidence banners.

**Phase 10: brief and summarizer.**
- Deliver: the deterministic brief, the `Summarizer` interface, a CLI-agent provider (`claude -p`) with strict JSON validation and fallback, and Markdown export.

**Phase 11: Retro Report.**
- Deliver: HTML and PNG output, privacy-safe defaults, and `--include-names`.

**Phase 12: CLI polish.**
- Deliver: `scan` output, `doctor`, `export`, `data prune|reset`, and `uninstall`.

**Phase 13: dogfood.**
- Use the tool daily for at least 7 days on the dev machine.
- Track: wrong outcomes, false open loops, wrong thread links, parser unknown-line rate, scan time, DB size, and privacy leaks. Run grep audits of the DB for line text and prompt text.
- Fix everything found before moving to v0.2.

## v0.2-Live (after v0.1 DoD and early validation)

- **Phase 14:** daemon, LaunchAgent, and `start`/`stop`/`status`.
- **Phase 15:** FSEvents watchers, incremental import, and SSE.
- **Phase 16:** Claude Code plugin with http hooks, plus verification and fail-open tests with the collector stopped.
- **Phase 17:** Codex hooks (optional), parse-merge-backup, and the uninstall restore test.
- **Phase 18:** live collision and open-loop notifications.
- **Phase 19:** agent/task-type fit, following the §12.6 rules.

## v0.3-Memory

- **Phase 20:** MCP server with read-only tools and resume packets. Privacy filters apply to everything the MCP server returns.

# 25. Testing strategy

- **Unit tests:** schemas, normalization and fingerprints, redaction, parsers, usage deduplication, outcome classification, survival, thread linking, loop detectors, collisions, brief assembly.
- **Fixture and contract tests:** sanitized real vendor lines per supported version. A new vendor version must not silently change normalized output; snapshot tests catch drift.
- **Golden git tests:** scripted repos with known outcome labels (§24, Phase 5).
- **Integration tests:**
  - Seed sources → scan → DB → API.
  - Re-scan idempotency.
  - Interrupted scan resumes.
  - File truncation/rotation.
- **E2E (Playwright):** Today, Open Loops actions, Session detail, Outcomes filters, Settings, empty/error states, report generation.
- **Performance targets** on the dev machine (about 1,100 session files, 5.4 GB):
  - First scan under 60 s.
  - Incremental scan under 3 s.
  - Dashboard p95 API latency under 150 ms.
  - DB under 300 MB.
- **Privacy tests:** after a full scan, the DB contains none of a set of canary strings planted in fixture prompts, code, and env values.

# 26. Success metrics and validation gates

## v0.1 activation

Install → `agenthq scan` → at least one non-trivial finding (an open loop, collision, or lost work) in under 2 minutes, for at least 70% of testers.

## Gate 1: individual pull (before v0.2-Live)

- 20 external developers install it.
- At least 10 run it on 3+ days in their first two weeks.
- At least 5 close at least one open loop because AgentHQ surfaced it.
- At least 5 would be "very disappointed" if it went away (Sean Ellis question).
- Identify the strongest pull: Open Loops, Outcomes, Brief, Collisions, or Report.

## Gate 2: buyer pull (before v1-Team)

- At least 3 tech leads or eng managers ask for team aggregation unprompted, or agree to a paid design-partner pilot.
- Identify the team metric they would pay for, for example "AI spend → landed code" or "abandoned agent work".

## North-star metric (product)

Weekly **open loops resolved** per active user. This measures real action, not just viewing.

## Investor-facing metrics

- Weekly active developers and D30 retention.
- Retro Reports shared and the resulting install conversion.
- Repos analyzed and agent edits under ledger.
- Design partners in the pipeline.

# 27. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Vendors ship outcome views natively | Cross-vendor neutrality, local trust, collisions/threads across agents; move fast on Memory (MCP) as a coordination wedge |
| Vendor file formats change | Versioned parsers, fixture snapshots per version, unknown-line telemetry in `doctor`, graceful degradation; v0.2 hooks/OTel as secondary signal |
| Outcome misattribution erodes trust | Self-check controls, confidence banners, evidence on hover, golden tests, conservative language |
| "Feature, not product" | Ship the pillars together as a habit loop (morning brief → resolve loops), then the team aggregate as the paid product |
| Privacy concern about reading transcripts | Read-only, fingerprints only, no egress, open-source the importers, canary tests |
| Agent comparison misused as a leaderboard | §12.6 rules; never a single score |
| Name/trademark conflict | Rename before public launch (§29) |

# 28. Engineering constraints (for Claude Code)

1. v0.1 never writes to vendor config, vendor session files, git repos, or user files.
2. Never persist code line text, prompt text, tool output, or environment values by default. Fingerprints only.
3. Stream vendor files. Never load an entire file into memory.
4. Never assume any vendor field exists. Unknown is a valid state everywhere.
5. Never put UI logic on vendor payloads. Vendor code lives only in `importer-*` packages and, later, in adapter packages.
6. Never claim authorship from git state alone. Outcomes require patch evidence.
7. Never sum Claude usage without `message.id` deduplication. Never sum Codex cumulative token totals.
8. Never show an agent comparison without the §12.6 controls.
9. Never claim exact cost from incomplete usage.
10. Run git with argument arrays, read-only subcommands, and timeouts.
11. Bind only to loopback, and check Host/Origin.
12. No cloud infrastructure in v0.1–v0.3.
13. Add fixtures and tests with every parser behavior. Add golden git tests with every outcome rule change, and bump `engineVersion`.
14. Prefer small vertical slices. Update `docs/` when contracts change.
15. (v0.2+) Parse, merge, back up, and atomically write any vendor config. Preserve unrelated entries, and keep uninstall reversible.

# 29. Naming

"AgentHQ" collides with **GitHub Agent HQ** (mission control for Claude/Codex/Copilot agents). It must change before any public release. Keep "AgentHQ" as the internal codename until a decision is made.

Criteria:
- Evokes outcome or landing, not monitoring or surveillance.
- Short, so it works as a CLI command.
- No collision in dev tools or AI agents.
- Domain and trademark available (not yet verified for any candidate).

**Desk check, 2026-10-01** (web search only; trademark and domain checks still required):

| Candidate | Rationale | Collision check |
|---|---|---|
| **Landed** (recommended) | The product *is* the question "did it land?". The metric vocabulary ("landed", "landed rate") matches the brand. CLI: `landed scan`, `landed loops`. | No dev-tool or AI-agent collision found. "Landed Inc." is a US home-financing company in an unrelated class. |
| **Landfall** | The moment work reaches shore; distinctive and ownable. | Only Landfall Games, unrelated. Hurricane connotation is a mild negative. |
| **Debrief** | Retrospective-first, daily-brief habit. | No product found, but the word is generic and SEO is weak. "Debrief" is also used as a concept in agent tooling. |
| **Tidemark** | What remains after the tide goes out. | **Rejected:** an FP&A software company plus an AI-quota monitoring tool already use it. |
| **Hindsight** | Retrospective. | **Rejected:** an existing agent-memory product with Claude Code integration. |
| **Wake / Agentwake** | The trail agents leave. | **Rejected:** existing multi-agent session tools and an agent notification gateway. |
| **OpenLoops** | The Open Loops pillar. | **Rejected:** several AI-agent products use it. |

**Recommendation:** shortlist **Landed** and **Landfall**. Before Gate 1, check `.dev`/`.ai`/`.app` domains, the npm and Homebrew package names, the GitHub org, and a USPTO/EUIPO class 9/42 search.

# 30. Definition of Done: v0.1-Retro

- [ ] A fresh macOS machine works through `npx`/Homebrew install → `scan` → `open` with no config changes.
- [ ] Claude Code and Codex history import correctly, including subagents, legacy Codex formats, and desktop-app sessions.
- [ ] Outcome engine golden tests pass. The dev-machine run reproduces the spike within ±2 points, and the self-check controls are reported.
- [ ] Open Loops, Threads, Collisions, and Insights work, with acceptable false positives in dogfooding.
- [ ] The deterministic Daily Brief works. The generated brief is optional and falls back cleanly.
- [ ] The Retro Report is generated and privacy-safe by default.
- [ ] Usage deduplication is correct and coverage labels are shown.
- [ ] Privacy canary tests pass: no prompt or code text in the DB.
- [ ] Performance targets in §25 are met on the dev machine.
- [ ] Automated tests pass, and at least 7 days of dogfooding are complete.
- [ ] The README explains install, what is read, what is stored, architecture, outcome methodology, and limitations.

# 31. Open questions

1. Is the daily habit driven by Open Loops or by the Brief? Measure at Gate 1.
2. Open-source strategy: the importers alone, or the full local app? Recommendation: open-source the local app (trust, plus help keeping parsers current) and monetize the Team aggregate.
3. Which third source should come next: Cursor, Gemini CLI, or OpenCode? Decide by user demand.
4. Should "who committed" (agent or human) become a first-class outcome dimension?
5. Pricing hypotheses: free local core; Pro at around $8–12/mo for the generated brief, extended history, and MCP Memory; Team per seat. Validate with design partners.
6. Should the Retro Report include an opt-in public share link? (That would require cloud; not before v1.)

# 32. Suggested first Claude Code instruction

After placing this PRD at the repository root as `PRD.md`:

```text
Read PRD.md completely before changing anything. Also read spike/FINDINGS.md.

We are building v0.1-Retro. Treat the PRD as the product source of truth.

Start ONLY with Phase 0 and Phase 1 from section 24:
1. enable pnpm via corepack and bootstrap the TypeScript monorepo per §21.4,
2. establish package boundaries,
3. implement the domain model (§11) with Zod schemas and provenance types,
4. implement line normalization + HMAC fingerprints and event fingerprints,
5. add tests,
6. create CLAUDE.md documenting the constraints in §28.

Do not implement importers, git indexing, UI, hooks, or any vendor config changes yet.
Do not add cloud services, auth, billing, Electron/Tauri, or extra features.

Before coding: inspect the environment, propose the exact file tree and
technical choices, call out any deviation from the PRD, then implement.

When finished: run lint, typecheck, tests; fix failures; summarize exactly
what was created; list the Phase 2 tasks without implementing them.
```

# 33. One-sentence north star

> **AgentHQ tells developers what their AI agents' work actually became — what landed, what's dangling, what collided, and what needs them next.**
