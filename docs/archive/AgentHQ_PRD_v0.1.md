# AgentHQ --- Product Requirements Document (PRD)

**Status:** v0.1 / Build-ready\
**Date:** 2026-10-01\
**Working product name:** AgentHQ\
**Tagline:** *See everything your AI coding agents did today.*\
**Initial platform:** macOS first, local-first\
**Initial integrations:** Claude Code + Codex\
**Primary user:** Individual developers using multiple coding agents\
**Long-term category:** AI Agent Control Plane / AI Workforce Management

------------------------------------------------------------------------

## 0. How to use this document

This PRD is implementation-oriented. Build the MVP in the order defined
in §20. Do not add team features, cloud sync, billing, enterprise policy
enforcement, or speculative integrations until the local MVP acceptance
criteria pass.

Vendor hook, telemetry, and configuration formats can change. At
implementation time, current official Claude Code and Codex
documentation is the source of truth for exact payloads/configuration.
Preserve AgentHQ's normalized domain model and isolate vendor
differences inside adapters.

# 1. Executive summary

Developers increasingly use several AI coding agents across several
repositories. Claude Code may be debugging one service while Codex
implements another feature. Each tool has its own sessions, tool calls,
approvals, usage data, and history. The developer quickly loses
situational awareness.

AgentHQ is a **local-first observability and work-ledger product for AI
coding agents**. It installs a local collector, integrates with Claude
Code and Codex using supported lifecycle hooks and/or telemetry,
normalizes activity into one vendor-neutral event model, stores it
locally in SQLite, and presents a dashboard answering:

> **What did my AI agents do today?**

Long-term direction: `Observe → Understand → Control`.

MVP = **Observe + a small, useful layer of Understand**. It is not an
orchestrator, security gateway, or enterprise SaaS platform.

# 2. Problem

A developer with multiple agent sessions loses context across terminal
windows, vendor histories, git state, logs, and memory. Questions that
become hard:

-   What did each agent actually do today?
-   Which repositories did they touch?
-   Which sessions are still running?
-   Which tasks finished, failed, or were abandoned?
-   What commands ran and what files changed?
-   Did tests pass?
-   Did two agents duplicate the same investigation?
-   Did an agent get stuck retrying something?
-   Which activity needs attention?
-   How much usage was reported?
-   What happened while I was away?

Typical failure modes:

1.  A task was attempted but never completed.
2.  An agent changed files but no commit/PR was observed.
3.  Two agents independently investigated the same issue.
4.  An agent repeatedly retried a failing command.
5.  The developer cannot remember which agent touched a repository.
6.  A long session produced little useful output.
7.  The developer manually reconstructs events hours later.
8.  A risky command is noticed only after execution.
9.  Vendor histories provide no cross-agent view.
10. Usage data is disconnected from actual outcomes.

Shell history is insufficient because it does not reliably connect
commands to an agent, session, goal, repo, outcome, file changes, or
cross-agent context.

**Product thesis:** AgentHQ is a **work ledger for AI agents**, not
another chat-history viewer.

# 3. Vision

## Short term

Install AgentHQ, continue using Claude Code/Codex normally, and receive
a unified timeline plus useful end-of-day summary.

## Long term

Agent inventory, identity, ownership, tools/data access, budgets, audit
history, approval policies, anomaly detection, risk controls, and
cross-agent coordination.

Future conceptual identity:

``` text
agent://engineering/codex-backend
Owner: engineering@company.com
Purpose: Backend implementation
Repositories: api, payments
Tools: GitHub, Linear, AWS
Permissions: ...
Budget: ...
Activity history: ...
Policies: ...
```

This is future direction only.

# 4. Positioning

**Initial category:** Observability for AI coding agents.

**Initial promise:** "See everything your AI coding agents did today ---
across Claude Code, Codex, and eventually more."

The dashboard is not the long-term moat. The wedge is collecting
heterogeneous activity, normalizing it, reconstructing meaningful work,
surfacing outcomes/attention items, and eventually becoming a control
layer.

Do not turn v0.1 into generic LLM tracing, a terminal recorder, employee
surveillance, a giant IAM platform, or an autonomous orchestrator.

# 5. Product principles

1.  Local-first by default.
2.  Passive before active.
3.  No fake precision: unknown values remain unknown.
4.  Vendor-neutral core.
5.  Useful within five minutes.
6.  Default UI shows work/outcomes, not telemetry noise.
7.  Privacy is part of the product.
8.  Configuration changes are previewable, backed up, reversible, and
    idempotent.
9.  Missing vendor fields never invalidate an entire session.
10. Adding an adapter should not require rewriting storage/UI.
11. Observed facts and generated inference are visually distinct.
12. Observability failure must never break normal agent execution.

# 6. Target users

## Primary: multi-agent individual developer

Uses Claude Code/Codex, works across repositories, runs multiple
sessions, wants visibility without manual journaling, and values
privacy.

Jobs: - "Tell me what my agents accomplished today." - "Show me what is
running now." - "Let me reconstruct failures." - "Tell me what needs
attention." - "Help me remember where I left off tomorrow."

## Secondary: technical lead

Post-MVP. Needs team visibility, auditability, and eventually policy. Do
not optimize v0.1 for this persona.

# 7. MVP scope

## Must-have installation

Commands:

``` bash
agenthq init
agenthq start
agenthq stop
agenthq status
agenthq doctor
agenthq open
agenthq uninstall
```

`agenthq init`: - detect macOS; - initialize data directory and
SQLite; - detect Claude Code/Codex; - show planned config changes; -
require confirmation; - back up modified config; - install AgentHQ-owned
entries idempotently; - verify collector connectivity; - show privacy
defaults.

`agenthq uninstall`: - remove only AgentHQ-owned config; - preserve
unrelated user config; - offer to preserve/delete AgentHQ data; - never
delete vendor history.

## Must-have collection

Where reliably exposed: - provider/version; - session start/end/ID; -
parent/subagent relationship; - working directory/repo root; - git
branch/HEAD; - task/prompt only when permitted; - tool name; - shell
command metadata; - tool status; - timestamps/duration; - errors; -
changed-file evidence; - token usage/model; - approval/permission
events; - interruption/cancellation.

## Must-have dashboard

Today overview, active/recent sessions, unified timeline, session
detail, project grouping, failures, changed files, usage where reported,
Daily Brief, settings/privacy.

## Must-have understanding

Session summary, daily summary, failed/unfinished signal,
repeated-failure signal, basic duplicate-work signal, and "changed files
but no observed commit" signal.

## Explicit non-goals

No cloud accounts/sync, team workspace, auth, billing, RBAC, SSO, remote
execution, orchestration, command blocking, approval interception,
secret vault, Windows, formal Linux support, extra agent adapters,
GitHub/Linear/Slack integrations, browser extension, mobile app,
compliance dashboard, or agent performance score.

# 8. Success criteria

Activation: install → `agenthq init` → use Claude/Codex normally →
`agenthq open` → useful session visible within 5 minutes.

Quality: - no noticeable agent latency; - hook failure never blocks
agent; - ingestion idempotent; - malformed events do not crash
collector; - responsive at 10k events/day; - config install/uninstall
reversible; - loopback-only collector by default.

Validation gate before enterprise work: - 10 external installs; - 5 use
it on 3+ days; - 3 would be meaningfully annoyed if it disappeared; -
identify whether strongest pull is Daily Brief, live visibility,
debugging, usage/cost, or safety.

# 9. Core user journeys

## First install

``` text
$ agenthq init

AgentHQ setup
✓ macOS detected
✓ Claude Code detected
✓ Codex detected
✓ Local database initialized

Privacy defaults
  Prompt content      OFF
  Tool arguments      REDACTED
  Tool results        OFF
  File contents       NEVER
  Local storage       ON
  Cloud sync          NONE

Configuration changes will be shown before applying.
Continue? [y/N]
```

## Today view

``` text
TODAY
5 sessions     2 agents     3 projects
42 tool calls  4 failures   2h 18m observed activity

Needs attention
⚠ Codex · api-service
  Session ended after repeated test failures.

⚠ Claude Code · dashboard
  6 files changed; no commit was observed.
```

## Session detail

Show goal, observed outcome, generated summary, repo, branch, changed
files, usage, and chronological timeline.

## Daily Brief

Separate **Observed**, **Generated summary**, **Needs attention**,
**Failed/unfinished**, **Possible duplicate work**, and **Usage**. Every
inferred item must be labeled as inference.

# 10. Information architecture

Primary navigation:

``` text
Today
Sessions
Projects
Insights
Settings
```

First usable build only requires Today, Sessions, Settings.

## Today

-   date selector;
-   summary metrics;
-   active sessions;
-   needs-attention cards;
-   project activity;
-   unified timeline;
-   Daily Brief.

## Sessions

Filters: date, provider, project, status, has failures.

Each item: provider, title/goal, project, start, duration, event count,
changed-file count, status.

## Session detail

Observed metadata, generated summary, outcome, usage, changed files,
timeline, normalized raw event inspector. Vendor raw payload is visible
only in explicit debug mode.

## Settings

Integration status, privacy, summarization provider, retention, storage
path, diagnostics, export, uninstall/restore.

# 11. System architecture

``` text
Claude Code ─── Adapter ──────┐
                              │
Codex ───────── Adapter ──────┤
                              ▼
                     ┌─────────────────┐
                     │ Local Collector │
                     │ 127.0.0.1 only  │
                     └────────┬────────┘
                              │ validate/normalize
                              ▼
                     ┌─────────────────┐
                     │ Event Pipeline  │
                     │ redact/dedupe   │
                     └────────┬────────┘
                              ▼
                     ┌─────────────────┐
                     │ SQLite          │
                     └───────┬─────────┘
                             │
               ┌─────────────┼─────────────┐
               ▼             ▼             ▼
         Sessionizer    Insight Engine    API
                                             │
                                             ▼
                                        Dashboard
```

## Repository layout

``` text
agenthq/
├─ apps/
│  ├─ cli/
│  ├─ collector/
│  └─ web/
├─ packages/
│  ├─ core/
│  ├─ db/
│  ├─ adapter-claude/
│  ├─ adapter-codex/
│  ├─ insights/
│  ├─ summarizer/
│  ├─ config/
│  └─ shared/
├─ fixtures/
│  ├─ claude/
│  └─ codex/
├─ docs/
│  ├─ architecture.md
│  ├─ privacy.md
│  └─ integrations.md
├─ PRD.md
├─ CLAUDE.md
├─ package.json
└─ pnpm-workspace.yaml
```

## Recommended stack

-   TypeScript;
-   current supported Node.js LTS;
-   pnpm workspaces;
-   Fastify collector/API;
-   Zod validation;
-   SQLite;
-   Drizzle ORM;
-   React + Vite;
-   Tailwind CSS;
-   TanStack Query;
-   Server-Sent Events for live updates;
-   Vitest;
-   Playwright;
-   Pino structured logging;
-   ULID or UUIDv7 identifiers.

Avoid Electron/Tauri in v0.1. A local daemon + browser UI is faster to
validate. A native shell can be added later.

# 12. Normalized domain model

Vendor payloads are immutable input; normalized entities are product
truth.

## 12.1 AgentProvider

``` ts
type AgentProvider = "claude-code" | "codex" | "unknown";
```

## 12.2 SessionStatus

``` ts
type SessionStatus =
  | "active"
  | "completed"
  | "failed"
  | "interrupted"
  | "abandoned"
  | "unknown";
```

Do not infer `completed` merely because a process ended. Completion
requires reliable evidence or remains `unknown`.

## 12.3 EventType

``` ts
type EventType =
  | "session.started"
  | "session.ended"
  | "prompt.submitted"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "command.started"
  | "command.completed"
  | "command.failed"
  | "file.changed"
  | "approval.requested"
  | "approval.resolved"
  | "usage.reported"
  | "subagent.started"
  | "subagent.ended"
  | "agent.interrupted"
  | "error"
  | "unknown";
```

## 12.4 NormalizedEvent

``` ts
interface NormalizedEvent {
  id: string;
  schemaVersion: number;

  provider: AgentProvider;
  providerEventId?: string;
  providerEventType: string;
  providerVersion?: string;

  sessionId: string;
  parentSessionId?: string;
  userId?: string;

  timestamp: string;
  receivedAt: string;
  sequence?: number;

  eventType: EventType;
  status?: "started" | "success" | "failure" | "denied" | "unknown";

  cwd?: string;
  repoRoot?: string;
  repoRemoteHash?: string;
  projectName?: string;
  gitBranch?: string;
  gitHead?: string;

  model?: string;

  tool?: {
    name: string;
    category?: "shell" | "file" | "search" | "mcp" | "network" | "other";
  };

  command?: {
    executable?: string;
    display?: string;
    exitCode?: number;
  };

  file?: {
    path: string;
    operation?: "read" | "create" | "modify" | "delete" | "rename" | "unknown";
  };

  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    reasoningTokens?: number;
    estimatedCostUsd?: number;
    costConfidence?: "exact" | "estimated";
  };

  error?: {
    code?: string;
    message?: string;
  };

  content?: {
    prompt?: string;
    toolArguments?: unknown;
    toolResult?: unknown;
  };

  privacy: {
    promptCaptured: boolean;
    argumentsCaptured: boolean;
    resultCaptured: boolean;
    redactionsApplied: number;
  };

  rawPayloadRef?: string;
}
```

## 12.5 Session

``` ts
interface AgentSession {
  id: string;
  provider: AgentProvider;
  providerSessionId: string;
  parentSessionId?: string;

  startedAt: string;
  endedAt?: string;
  lastEventAt: string;
  status: SessionStatus;

  cwd?: string;
  repoRoot?: string;
  projectName?: string;
  gitBranchStart?: string;
  gitBranchEnd?: string;
  gitHeadStart?: string;
  gitHeadEnd?: string;

  model?: string;
  title?: string;
  observedOutcome?: string;
  generatedSummary?: string;

  eventCount: number;
  failureCount: number;
  changedFileCount: number;

  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
}
```

# 13. Storage model

Minimum tables:

``` text
sessions
events
projects
session_files
usage_records
insights
summaries
integration_state
app_settings
ingestion_failures
```

Important indexes: - events(session_id, timestamp); -
events(timestamp); - events(event_type, timestamp); - sessions(provider,
provider_session_id) unique; - sessions(started_at); -
sessions(repo_root); - insights(session_id, type); - ingestion event
fingerprint unique.

## Event idempotency

Compute a stable fingerprint from the strongest available fields:

``` text
provider
provider event id OR deterministic payload subset
session id
event type
timestamp/sequence
tool call id when present
```

Never rely on database auto-ID alone for dedupe.

## Raw payload policy

Raw vendor payload storage is **off by default** for normal operation.
Debug mode may retain encrypted/local raw payloads with explicit opt-in
and retention limits. Normalized data should be enough for product
behavior.

# 14. Integration architecture

Every adapter implements:

``` ts
interface AgentAdapter {
  provider: AgentProvider;

  detect(): Promise<DetectionResult>;
  planInstall(): Promise<ConfigChangePlan>;
  install(plan: ConfigChangePlan): Promise<void>;
  verify(): Promise<VerificationResult>;
  uninstall(): Promise<void>;

  normalize(input: unknown): Promise<NormalizedEvent[]>;
}
```

## Claude Code

Prefer official lifecycle hooks. Capture only events needed for session
lifecycle, tool execution, permission/approval signals, interruption,
and completion.

Requirements: - never overwrite the entire Claude settings file; - parse
and merge; - preserve unrelated hooks; - mark AgentHQ-owned entries; -
create timestamped backup; - hook handler must return quickly; - handler
should enqueue/send locally and fail open; - exact hook names/payload
fields must be verified against current official docs.

## Codex

Prefer supported lifecycle hooks when they provide required coverage.
OpenTelemetry/OTLP is an additional or fallback ingestion path where it
provides richer trace/usage information.

Requirements: - preserve unrelated `~/.codex/config.toml`; - user-level
telemetry configuration may be required; - do not enable raw prompt
logging without explicit consent; - support OTLP/HTTP receiver only if
needed; - map Codex-specific telemetry into normalized events; - exact
current config keys and payloads must be verified against official docs.

## Why adapters matter

The rest of AgentHQ must never contain code such as:

``` ts
if (provider === "claude-code") { ... }
```

except inside adapter/integration-specific boundaries. Core logic
operates on normalized events.

# 15. Ingestion pipeline

Pipeline:

``` text
receive
→ authenticate local source
→ size limit
→ schema identify
→ adapter parse
→ normalize
→ redact
→ validate
→ deduplicate
→ enrich with safe local git metadata
→ persist
→ update session aggregate
→ evaluate deterministic insights
→ publish UI update
```

## Local endpoints

Illustrative API:

``` text
POST /v1/ingest/claude
POST /v1/ingest/codex
POST /v1/ingest/otlp
GET  /v1/health
GET  /v1/sessions
GET  /v1/sessions/:id
GET  /v1/events
GET  /v1/today
GET  /v1/insights
POST /v1/summaries/daily
GET  /v1/stream
```

Exact OTLP routes must follow protocol if OTLP is implemented.

## Reliability

Hooks must never wait for summarization. Event ingestion should be fast.
Expensive work runs asynchronously after persistence.

If collector is unavailable: - hook exits successfully; - optionally
append a bounded local spool file; - collector imports spool when
healthy; - spool has size/retention limits.

# 16. Privacy and security

This is a first-class requirement.

## Defaults

``` text
Prompt text               OFF
Full tool arguments       OFF / redacted metadata only
Full tool results         OFF
File contents             NEVER
Environment variables     NEVER
Raw payload retention     OFF
Cloud sync                NONE
Bind address              127.0.0.1
```

## Redaction

Before persistence, redact common secret patterns: - API keys/tokens; -
Authorization/Bearer headers; - passwords in common CLI flags/URLs; -
`.env` values; - private key blocks; - common cloud credential patterns.

Redaction is defense-in-depth, not a guarantee. UI must communicate that
telemetry may contain sensitive paths/commands.

## Command capture

Prefer a sanitized display form. Example:

``` text
curl -H "Authorization: [REDACTED]" https://...
```

Never intentionally collect environment dumps.

## Local API

-   bind only to loopback;
-   reject non-loopback Host/origin by default;
-   use a locally generated installation secret for ingestion if
    practical;
-   apply body-size limits;
-   validate all input;
-   never execute ingested content.

## Filesystem

Use OS-appropriate app data directory with restrictive permissions.
Database and config should be user-readable only where possible.

# 17. Sessionization and enrichment

Use vendor session IDs whenever available. Do not invent session
boundaries from time windows if a reliable provider session ID exists.

At session start, safely capture: - cwd; - repo root
(`git rev-parse --show-toplevel`); - branch; - HEAD; - optional remote
fingerprint.

Do not send raw git remote URLs to future cloud services by default.
Hash or normalize identity if needed.

At session end: - refresh branch/HEAD; - compute changed-file evidence
from git; - calculate aggregate event/failure counts; - queue
deterministic insights; - queue optional generated summary.

A git diff is evidence of current working-tree state, not proof that a
specific agent authored every change. The UI must use language such as
"changes observed during/after session," not falsely claim authorship.

# 18. Insight engine

Insights have two classes.

## Deterministic insights

These should not require an LLM.

### Repeated failure

Trigger when the same normalized command/tool signature fails \>=3 times
within one session.

### Changed files, no observed commit

If changed-file evidence exists and HEAD is unchanged between session
start/end.

Wording: "Changes observed; no new commit detected during this session."

### Long-running active session

Session has activity beyond configurable threshold and no end event.

### Interrupted/failed session

Based on reliable lifecycle/error evidence.

### High activity

Informational only. Do not equate number of tool calls with
productivity.

## Inference insights

These may use an LLM/embedding later and must be labeled "Possible" or
"Generated."

### Possible duplicate work

Candidate generation: - same repo; - overlapping or close time window; -
different sessions; - similar task/title/commands/files.

MVP implementation: 1. deterministic candidate filter; 2. optional text
similarity on sanitized session descriptions; 3. conservative threshold;
4. show evidence explaining why it was flagged.

Never state duplication as fact unless directly provable.

# 19. Summarization

Summarization is optional. Core observability must work without an LLM
API key.

Define:

``` ts
interface Summarizer {
  summarizeSession(input: SessionSummaryInput): Promise<GeneratedSummary>;
  summarizeDay(input: DailySummaryInput): Promise<GeneratedSummary>;
}
```

Start with one provider adapter, but keep interface provider-neutral. A
local Ollama adapter is a valuable early addition for privacy but must
not block MVP.

The summarizer receives **sanitized structured facts**, not arbitrary
raw history by default.

Session prompt concept:

``` text
You summarize observed AI coding-agent activity.
Never invent completion.
Distinguish observed facts from uncertainty.
Return strict JSON:
{
  "summary": "...",
  "completed": [],
  "unfinished": [],
  "attention": [],
  "confidence": 0.0
}
```

Daily brief is generated from session aggregates + insights, not every
raw event if avoidable.

If summarization fails, the dashboard still works and shows
deterministic data.

# 20. Build plan for Claude Code

Claude Code should implement this sequentially. Each phase must leave
the repo runnable and tested.

## Phase 0 --- repository bootstrap

Deliver: - pnpm workspace; - TypeScript configs; - lint/format; -
Vitest; - basic CI; - `apps/cli`, `apps/collector`, `apps/web`; -
package boundaries; - `CLAUDE.md` with architecture rules.

Exit criteria: - `pnpm install`; - `pnpm lint`; - `pnpm typecheck`; -
`pnpm test`; - all pass.

## Phase 1 --- normalized event core

Deliver: - enums/types; - Zod schemas; - normalization contracts; -
fixture framework; - event fingerprint utility.

Tests: - valid normalized event; - optional fields; - invalid
timestamps; - unknown provider event; - deterministic fingerprint.

Do not integrate vendors yet.

## Phase 2 --- SQLite persistence

Deliver: - Drizzle schema/migrations; - event repository; - session
repository; - project repository; - idempotent event insert; -
integration state.

Tests: - migrations on empty DB; - duplicate insert; - session upsert; -
query by date/provider/project.

## Phase 3 --- collector

Deliver: - Fastify service; - health endpoint; - ingestion endpoints; -
body limits; - validation; - structured logs; - loopback binding; -
graceful shutdown; - event stream.

Tests: - health; - valid ingestion; - malformed ingestion; - oversized
payload; - duplicate ingestion; - collector does not crash.

## Phase 4 --- fake adapter + simulator

Before touching real vendor config, build a simulator:

``` bash
pnpm dev:simulate
```

It should create: - one successful Claude-like session; - one failed
Codex-like session; - file changes; - command failures; - usage event.

This unblocks UI development and prevents vendor integration from
becoming the entire project.

## Phase 5 --- dashboard foundation

Deliver: - Today page; - Sessions list; - Session detail; - Settings
shell; - live SSE updates; - empty/loading/error states.

Use simulator data.

Exit criteria: - a simulated session appears live; - page refresh
preserves data; - session timeline is readable.

## Phase 6 --- Claude Code adapter

First research current official Claude Code hooks. Add captured fixture
payloads with secrets removed.

Deliver: - detection; - config-change planner; - backup; - idempotent
install; - hook receiver/handler; - normalization; - verification; -
uninstall; - doctor checks.

Acceptance: - start real Claude Code session; - AgentHQ sees start; - at
least one tool event appears; - end/stop is reflected; - repo metadata
correct; - Claude Code still works if collector is stopped.

## Phase 7 --- Codex adapter

Research current official Codex hooks and telemetry. Prefer simplest
supported path that provides lifecycle/tool coverage. Add OTLP only
where useful.

Deliver same lifecycle as Claude adapter.

Acceptance: - real Codex session appears; - tool/command activity
appears where exposed; - repo metadata correct; - usage appears only if
actually reported; - Codex still works if collector is stopped.

## Phase 8 --- sessionization/enrichment

Deliver: - session aggregates; - repo/project association; - start/end
git snapshots; - changed-file evidence; - status logic; - duration; -
usage aggregation.

Critical rule: do not claim an agent authored a file solely because git
shows it changed.

## Phase 9 --- deterministic insights

Implement: - repeated failure; - changed files/no commit; -
interrupted/failed; - stale active session.

Each insight includes: - type; - severity; - human-readable message; -
evidence JSON; - createdAt; - dismissedAt optional.

## Phase 10 --- summaries

Implement provider-neutral interface and one initial provider. Add
structured output validation and graceful fallback.

Never send data that privacy settings prohibit.

## Phase 11 --- Daily Brief

Deliver: - deterministic observed section; - generated summary
section; - attention section; - possible duplicate section; - usage
section; - Markdown export.

## Phase 12 --- CLI setup/doctor/uninstall

Polish complete install path.

`agenthq doctor` checks: - collector; - DB; - config permissions; -
Claude integration; - Codex integration; - writable data directory; -
last event time; - optional summarizer.

Never print secrets.

## Phase 13 --- dogfood hardening

Use AgentHQ itself for at least several development days.

Track: - missing events; - wrong session boundaries; - confusing UI; -
false insights; - config breakage; - collector CPU/memory; - DB
growth; - privacy leaks.

Fix these before adding integrations.

# 21. CLI specification

## `agenthq init`

Interactive setup. Supports `--dry-run`.

## `agenthq start`

Starts collector. MVP may use foreground mode first; later install a
macOS LaunchAgent.

## `agenthq stop`

Stops AgentHQ-owned collector only.

## `agenthq status`

``` text
AgentHQ
Collector      running · pid 12345
Dashboard      http://127.0.0.1:47831
Database       healthy · 8.4 MB

Integrations
Claude Code    connected · last event 2m ago
Codex          connected · last event 18m ago

Today
Sessions       7
Events         431
Failures       3
```

## `agenthq doctor`

Every check reports PASS/WARN/FAIL and an actionable remediation.

## `agenthq open`

Opens local dashboard.

## `agenthq export --date YYYY-MM-DD`

Exports normalized JSON and/or Markdown brief. Must respect privacy
settings.

# 22. API response examples

## GET /v1/today

``` json
{
  "date": "2026-10-01",
  "metrics": {
    "sessions": 5,
    "activeSessions": 1,
    "providers": 2,
    "projects": 3,
    "events": 214,
    "failures": 4,
    "observedDurationSeconds": 8280,
    "inputTokens": 91000,
    "outputTokens": 18000,
    "usageCoverage": "partial"
  },
  "needsAttention": [],
  "recentSessions": []
}
```

`usageCoverage` is important: `none | partial | complete`. Never imply
complete usage when providers did not report all data.

# 23. UI/UX requirements

Visual direction: - professional developer tool; - calm,
information-dense, not cyberpunk; - desktop-first; - fast; - clear
typography; - status communicated by text/icon as well as color; - raw
telemetry is secondary.

Every generated conclusion must carry a subtle label: - Observed -
Inferred - Generated

Session timeline groups noisy low-level events when possible. Example:
17 sequential file reads can collapse into "Read 17 files," expandable
on demand.

Empty state:

``` text
No agent activity yet.

Start a Claude Code or Codex session normally.
AgentHQ will record supported activity automatically.

[Run diagnostics]
```

# 24. Cost and usage semantics

Cost is difficult because subscription plans, cached tokens, vendor
pricing, local models, and missing telemetry can make exact dollar
amounts unavailable.

Rules: 1. Never invent cost. 2. Prefer raw token counts when reliable.
3. If pricing is known and applicable, label dollar value **Estimated**.
4. Store pricing table version/date with estimate. 5. If subscription
usage cannot be mapped to per-token spend, show usage without dollar
cost. 6. Daily totals expose coverage (`none/partial/complete`).

# 25. Risk classification

MVP risk labels are informational and do not block execution.

Possible categories: - filesystem destructive; - git destructive/history
rewrite; - package/system install; - network mutation; -
credential/security; - infrastructure mutation; - database mutation; -
unknown.

Never use a simplistic regex as an authoritative security decision. In
MVP this is context for the timeline only.

# 26. Error handling

Principle: AgentHQ must fail open relative to the coding agent.

-   Collector down → hook returns success and optionally spools.
-   DB locked → retry boundedly, then spool/log.
-   malformed vendor event → ingestion_failures.
-   unknown event → preserve minimal normalized `unknown`.
-   summarizer down → no impact on collection.
-   web UI down → collector continues.
-   git unavailable → session still exists without git metadata.
-   config parse failure → abort installation before mutation and
    explain.

# 27. Testing strategy

## Unit

-   schemas;
-   redaction;
-   fingerprinting;
-   adapter normalization;
-   session status logic;
-   insights;
-   usage aggregation;
-   config merge.

## Fixture/contract

Keep sanitized real payload fixtures for supported vendor versions. Each
fixture must normalize predictably.

## Integration

-   collector + SQLite;
-   simulator → collector → DB;
-   adapter event → normalized event → session;
-   config install/uninstall in temporary HOME.

## E2E

Playwright: - Today; - session detail; - filters; - settings; - brief
generation; - empty/error states.

## Manual smoke

For each supported vendor: 1. clean temp config; 2. init; 3. run
session; 4. execute tool; 5. create failure; 6. finish; 7. verify
dashboard; 8. stop collector and confirm agent still works; 9.
uninstall; 10. confirm unrelated config remains.

# 28. Observability for AgentHQ itself

Local structured logs: - startup/shutdown; - ingestion count; -
normalization failure; - DB latency/errors; - adapter install/verify; -
summary failures.

Do not log raw prompts, tool arguments, tool results, secrets, or file
contents by default.

`agenthq doctor --verbose` may show paths and diagnostic metadata but
must still redact secrets.

# 29. Data retention

Default: retain normalized metadata locally until user deletes it.

Settings should support: - 7 days; - 30 days; - 90 days; - forever.

If debug raw payload retention exists, default should be much shorter
and opt-in.

Provide:

``` bash
agenthq data prune --older-than 30d
agenthq data reset
```

Reset requires explicit confirmation.

# 30. Product analytics

MVP local build should not require telemetry back to AgentHQ.

If product analytics is later added: - explicit disclosure; - opt-out; -
never send prompts, commands, paths, source, tool results, or raw
events; - use coarse product events only.

# 31. Future roadmap --- after validation

## v0.2

-   OpenCode/Gemini/Cursor depending user demand;
-   improved duplicate-work detection;
-   local Ollama summarization;
-   richer git/PR correlation;
-   searchable historical work;
-   morning "where I left off" brief.

## v0.3

-   optional cloud sync;
-   team workspace;
-   GitHub/Linear correlation;
-   team Daily Brief;
-   shared agent inventory.

## v1 enterprise direction

-   agent identities;
-   ownership;
-   RBAC;
-   policy;
-   approval gateway;
-   MCP/tool inventory;
-   secrets/access boundaries;
-   budget controls;
-   audit export;
-   SSO;
-   SIEM integration.

Do not start v1 work until user pull justifies it.

# 32. Key product questions to validate

1.  Is the primary value retrospective Daily Brief or live monitoring?
2.  Do users care more about outcomes than individual tool calls?
3.  How much prompt content are users willing to capture?
4.  Is local-only a selling point or onboarding friction?
5.  Is duplicate-work detection genuinely useful?
6.  Do users want cost visibility if it is only partial?
7.  Does "needs attention" create repeat daily use?
8.  Will developers install hooks into agent config?
9.  Which third agent integration is requested most?
10. Does the product naturally spread from individual developers to
    teams?

# 33. Definition of Done for MVP

MVP is done only when all are true:

-   fresh macOS install path works;
-   Claude Code real session works end-to-end;
-   Codex real session works end-to-end;
-   both can appear in one unified Today view;
-   session detail is useful;
-   deterministic insights work with acceptable false positives;
-   Daily Brief works;
-   privacy defaults are enforced;
-   prompt capture is off by default;
-   collector failure never blocks coding agents;
-   install is reversible;
-   uninstall preserves unrelated vendor config;
-   automated tests pass;
-   at least several days of dogfooding completed;
-   README explains install, privacy, architecture, limitations.

# 34. Explicit engineering constraints

Claude Code implementing this project MUST:

1.  Never edit an entire vendor config file by string replacement.
2.  Parse, merge, back up, and atomically write config.
3.  Never assume every vendor event contains every field.
4.  Never make UI logic depend directly on vendor payloads.
5.  Never store secrets intentionally.
6.  Never enable prompt capture without explicit user action.
7.  Never block agent execution because AgentHQ is unavailable.
8.  Never claim file authorship based only on git state.
9.  Never claim exact cost from incomplete usage.
10. Never add cloud infrastructure to solve a local MVP problem.
11. Add tests with every adapter behavior.
12. Add sanitized fixtures for real integration payloads.
13. Keep integration-specific code inside adapter packages.
14. Prefer small vertical slices over large speculative abstractions.
15. Update architecture docs when contracts change.

# 35. Initial backlog

### P0

-   monorepo bootstrap
-   domain schemas
-   SQLite
-   collector
-   simulator
-   Today UI
-   session UI
-   Claude adapter
-   Codex adapter
-   config backup/merge
-   doctor
-   privacy/redaction
-   deterministic insights
-   Daily Brief
-   uninstall

### P1

-   SSE polish
-   filters/search
-   Markdown export
-   retention
-   risk labels
-   local summarizer
-   LaunchAgent background service

### P2

-   extra integrations
-   cloud/team
-   policy/control

# 36. Example acceptance scenarios

## A: Claude success

Given AgentHQ is running and Claude Code is integrated, when a session
starts in a git repo, edits files, runs tests successfully, and ends,
then Today shows the session, repo, timing, observed changed files,
successful test command evidence, and summary.

## B: Codex failure

Given Codex is integrated, when the same test command fails three times,
then the session timeline contains the failures and a deterministic
repeated-failure insight is shown.

## C: Collector unavailable

Given AgentHQ collector is stopped, when Claude/Codex runs, AgentHQ
hooks must not prevent the agent from functioning.

## D: Privacy

Given prompt capture is disabled, when a user submits a prompt,
persisted normalized data must not contain raw prompt text.

## E: Config preservation

Given a user has unrelated custom hooks/settings, when AgentHQ is
installed and removed, unrelated configuration remains semantically
unchanged.

## F: Partial usage

Given only one of two sessions reports token usage, Today must say usage
coverage is partial and must not imply a complete daily cost.

# 37. Research notes / standards

Architecture should stay compatible in spirit with OpenTelemetry's GenAI
semantic conventions: common agent/conversation identifiers, operation
names, tool execution, model usage, and trace concepts. Do not copy
unstable conventions blindly into the public AgentHQ schema; map them
through adapters.

Current product research indicates: - Claude Code supports lifecycle
hooks suitable for local event capture. - Current Codex configuration
supports hooks and OpenTelemetry-related configuration; exact
capabilities must be checked against installed/current docs. -
OpenTelemetry GenAI conventions include concepts such as agent
identifiers, conversation identifiers, token usage, `execute_tool`, and
`invoke_agent`; these conventions remain an evolving area.

Official references: - Claude Code documentation:
https://code.claude.com/docs/ - OpenAI Codex / developer documentation:
https://developers.openai.com/ - OpenTelemetry semantic conventions:
https://opentelemetry.io/docs/concepts/semantic-conventions/ -
OpenTelemetry GenAI attributes:
https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/

# 38. Suggested first Claude Code instruction

After placing this PRD at repository root as `PRD.md`, use:

``` text
Read PRD.md completely before changing anything.

We are building AgentHQ v0.1. Treat the PRD as the product source of truth.

Start ONLY with Phase 0 and Phase 1 from section 20:
1. bootstrap the TypeScript/pnpm monorepo,
2. establish package boundaries,
3. implement the vendor-neutral normalized event domain model and Zod validation,
4. implement deterministic event fingerprinting,
5. add tests,
6. create CLAUDE.md documenting architecture constraints from section 34.

Do not implement the real Claude Code or Codex integrations yet.
Do not add cloud services, auth, billing, Electron/Tauri, or extra features.

Before coding:
- inspect the environment,
- propose the exact file tree and technical choices,
- call out any deviation from PRD,
- then implement.

When finished:
- run lint, typecheck, and tests,
- fix failures,
- summarize exactly what was created,
- list the next Phase 2 tasks without implementing them.
```

------------------------------------------------------------------------

# 39. One-sentence north star

> **AgentHQ gives developers one trustworthy place to understand what
> all of their AI coding agents did, what changed, what failed, and what
> needs attention.**
