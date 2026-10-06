# Architecture

This document covers the current implemented state. For the target architecture, see PRD §21.

## Package graph

```text
@landed/shared            ids (ULID), canonical JSON — no internal deps
   ▲
@landed/core              enums, Zod schemas, provenance           (isomorphic)
@landed/core/fingerprint  line + event fingerprints, install secret (Node-only)
   ▲
db · importer-claude · importer-codex · git-index · threads · loops · insights · brief · summarizer
   ▲                                       ▲
outcomes (may also use git-index) ─────────┘
   ▲
ingest                   (import pipeline: db + importer-*; reused by both apps)
   ▲
apps/server · apps/cli   (composition roots; may use every package)
apps/web                 (core + shared only)
```

`scripts/check-boundaries.mjs` enforces the graph above. It also rejects vendor literals outside `core` and `importer-*`.

## Contracts

### Line fingerprint (`@landed/core/fingerprint`)

| Step | Rule |
|---|---|
| normalize | Unicode NFC, then collapse every whitespace run (`\s+`, Unicode-aware) to one space, then trim |
| significant | at least 8 code points and at least one `\p{L}` or `\p{N}` |
| fingerprint | `HMAC-SHA256(installSecret, normalized)`, first 16 hex chars (64 bits) |
| diff | Added lines whose normalized form also appears among the removed lines are dropped (moved or re-indented, not new work) |
| install secret | 32 random bytes, stored base64url in the data dir with 0600 permissions, never transmitted |

Patch extraction (Phases 3–4) and the git index (Phase 5) must both go through `createLineFingerprinter`. Any change to normalization invalidates stored fingerprints and requires a re-index.

### Event fingerprint (idempotency)

`eventFingerprint(event)` is the first 32 hex chars (128 bits) of `SHA-256` over the canonical JSON of:

`v` (fingerprint version), `provider`, `providerEventId`, `providerEventType`, `sessionId`, `eventType`, `at` (timestamp normalized to UTC), `sequence`, `tool.callId`, `file.path`, `command.display`.

Excluded on purpose: `id`, `receivedAt`, `sourceRef`. Re-importing the same vendor line, even from a moved file, yields the same fingerprint. Bump `EVENT_FINGERPRINT_VERSION` whenever the inputs change.

### Schema invariants enforced in `core`

- `NormalizedEvent`:
  - Strict keys.
  - `content.*` is allowed only when the matching `privacy.*Captured` flag is true.
- `AgentSession`:
  - Time ordering is valid.
  - Every title carries a provenance.
  - `failureCount ≤ eventCount`.
- `AgentPatch`:
  - The path is absolute.
  - `relPath` is repo-relative without `..`, and requires a `repoId`.
  - Fingerprint counts do not exceed raw line counts.
- `Outcome`:
  - Always `derived`.
  - `landed` requires `firstCommit`.
  - Survival applies only to `landed`.
  - `fracOnDefaultBranch ≤ fracCommitted`.
- `WorkThread`: multi-session threads must carry link evidence, and that evidence may reference member sessions only.
- `OpenLoop` and `Collision`:
  - Never `generated`.
  - `awaiting-user` and `possible-duplicate` must be `inferred`.

## Storage (`@landed/db`)

- **Engine:** SQLite through better-sqlite3 13 (prebuilt binaries, no native build step) with Drizzle ORM.
  - We did not use `node:sqlite`: Drizzle has no driver for it, and it is still experimental in Node 22.
- **Schema:** `packages/db/src/schema.ts` defines 18 tables.
  - Migrations are generated into `packages/db/migrations/` with `pnpm --filter @landed/db db:generate`, and they are committed.
  - CI runs `db:check`, which fails if the schema changed without a new migration.
- **Opening:** `openDatabase(path)` sets `foreign_keys=ON` and `busy_timeout=5000`. For file databases it also sets `journal_mode=WAL` and `synchronous=NORMAL`. It then applies pending migrations and chmods the db, WAL, and SHM files to `0600`.
- **Data dir:** `resolveDataDir()` honors `LANDED_DATA_DIR` and otherwise uses `~/Library/Application Support/Landed` on macOS. `ensureDataDir()` sets it to `0700`.
- **Column conventions:**
  - Instants are INTEGER epoch milliseconds (UTC). The domain uses ISO strings, and repositories convert between the two.
  - JSON columns hold evidence and aggregates only.
- **Repositories** are synchronous functions that take a `LandedDb`.
  - Every write is validated against the `@landed/core` schemas first, so the privacy invariants also hold at the storage boundary.

### Idempotency keys

Each table that a re-scan can re-populate has a natural unique key:

| Table | Unique key | Notes |
|---|---|---|
| `events` | `fingerprint` (`eventFingerprint`) | |
| `sessions` | `(provider, provider_session_id)` | |
| `usage_records` | `(session_id, usage_key)` | Claude `message.id`, Codex turn id. Makes the PRD §17 dedupe a storage guarantee. A repeated key keeps the **max of each token field**, because Claude rewrites streamed usage with growing output. |
| `agent_patches` | `patch_key` | Content-addressed over session, tool call, path, time, operation, and fingerprints. Independent of the source file location. |
| `source_checkpoints` | `path` | |
| `ingestion_failures` | `(source_file, offset, parser_version)` | |
| `outcomes` | `(scope, subject_key)` | |
| `open_loops` | `loop_key` | |
| `collisions` | `collision_key` | |
| `insights` | `insight_key` | |
| `summaries` | `(scope, subject_key, input_hash)` | |

### Ownership rules

- `upsertSession` replaces the fields the importer owns. It never overwrites `generatedSummary` or `outcomeSummary`, which later stages own and change through dedicated functions.
- Thread membership lives only in `thread_sessions`. A session belongs to at most one thread. `AgentSession.threadId` is filled by a join.
- `insertEvents` rejects events whose provider and vendor session id do not match the target session.
- `ingestion_failures.message` is capped at 200 characters and must never contain the failing line's text.

## Import pipeline (`@landed/ingest`)

```text
importer.listFiles(root) ──► stat ──► planRead(checkpoint) ──► streamCompleteLines(from, size)
        │                                skip / read / reset              │ (one line in memory at a time;
        │                                                                 │  parser.skipLine(head) drops
        │                                                                 │  heavy lines unbuffered)
        ▼                                                                 ▼
importer.createParser(ctx).push(line, offset) … finish() ──► ParsedChunk (drafts, no content)
        │
        ▼  one SQLite transaction per file
merge SessionFacts ─► drop history copied from other sessions ─► insertEvents
  ─► insertPatches (repo resolved) ─► insertUsageRecords
  ─► recordIngestionFailure ─► refresh aggregates + deriveSessionStatus ─► saveCheckpoint
```

### Contract between importers and the pipeline

- The contract lives in `@landed/core` (`ingest.ts`): `SourceFileParser`, `ParsedChunk`, `SessionFacts`, `PatchDraft`, `UsageDraft`, `FailureDraft`.
- Importers are pure line parsers. They never touch the database. Drafts reference sessions by vendor id; the pipeline assigns internal ids.
- Each importer exports its provider constant and parser version. The pipeline itself contains no vendor names.

### Checkpoints (`planRead`)

| Condition | Action |
|---|---|
| New file | Read from 0. |
| Unchanged size | Skip. |
| Grown | Read from the checkpoint offset. |
| Truncated, new inode, or parser version changed | Reset: delete the file's events and patches, then read from 0. |

- A trailing line without a newline is left for the next pass.
- Usage records carry no source file. Re-reading them is safe because of the max-merge upsert.

### Robustness

- A file whose chunk fails to persist is rolled back. The failure is recorded as `persist-error`, with only the failing schema path in the message, and the scan continues. The checkpoint does not move, so the file is retried on the next scan.

### Session aggregates

- Counts, token totals, `usageCoverage`, and status are recomputed from stored rows after every chunk. Stored rows are the source of truth; parser facts are not.
- Status comes from `deriveSessionStatus` over the latest 200 events and is vendor-neutral. See `docs/sources.md` for the rules.

### Repo resolution

- Repos are found by walking up to the nearest `.git` directory or file. The walk is read-only and cached.
- A deleted file or directory still resolves to an existing enclosing repo.
- A session's repo comes from its `cwd`. A patch's repo comes from its file path, falling back to the session's repo when the path lies inside it.

### Install secret

- `loadOrCreateInstallSecret(dataDir)` creates `install-secret` (32 bytes, base64url, 0600) on first use. It is never rotated implicitly, because a lost secret makes stored fingerprints unmatchable.

### Redaction (`@landed/core`)

- `redactSecrets` covers the PRD §23 patterns plus common token formats (GitHub, Slack, AWS, Google, npm, JWT).
- `sanitizeCommand` keeps the first line only, redacts it, masks quoted prose (three or more words, or more than 48 characters) as `"[TEXT]"`, caps it at 300 characters, and extracts the executable. It skips env assignments, `sudo`/`env`, and `cd` segments.
- Redaction is defense in depth, not a guarantee.

### Cross-session deduplication

Vendors copy history into resumed or forked sessions, keeping the original ids. Before inserting, the pipeline drops a draft when its key is already stored for a different session, or was claimed earlier in the same chunk by a different session.

| Draft | Key |
|---|---|
| Events | `(providerEventId, eventType, tool.callId)`. Events without a vendor id fall back to `(timestamp, providerEventType, eventType)`, since copies keep timestamps exactly. |
| Patches | `(toolCallId, path)` |
| Usage | `usageKey` |

- Importers must therefore emit usage keys that are unique across sessions. Claude's `message.id` is; Codex keys are prefixed with the session id.
- Ownership goes to the older session, because importers list files oldest first (Claude by file birth time; Codex by its date-ordered path).
- Session `startedAt` and `lastEventAt` are recomputed from stored events.

## Outcome engine (Phase 5)

```text
patches (db) ─► per repo: input key unchanged? → skip (outcomes still hold)
               readRepoHistory  (git log --branches --remotes --tags -p -U0, touched files only)
                          fingerprintsAt(HEAD) via one `git cat-file --batch`
                          working-tree fingerprints (fs, ≤5 MB text files), git check-ignore
            ─► classify per patch and per session-file net ─► selfCheck (controls A/B)
            ─► upsertOutcomes + repo check + session outcome summaries
```

### `@landed/git-index`

- Runs only the read-only subcommands `log`, `rev-list`, `rev-parse`, `symbolic-ref`, `show-ref`, `cat-file` and `check-ignore`. Anything else is refused. Every call uses an argument array, a timeout (120 s by default), `GIT_OPTIONAL_LOCKS=0`, and `core.quotepath=false`.
- **Diff parsing:**
  - Header lines are only those between `diff --git` and the first `@@`, so content lines starting with `++` are never mistaken for `+++` headers.
  - Git appends a TAB to header paths that contain spaces; it is stripped.
  - C-quoted paths are unquoted.
- **Default branch:** `origin/HEAD`, then `main`, then `master`, then the current branch.
  - Reachability uses both the remote-tracking ref and the local branch of the same name (`outcomes@2`). Work committed locally but not pushed, or sitting behind a stale `origin/main`, still counts as merged.
- **Working trunk** (`outcomes@4`): the checked-out branch also counts as the default branch when it is the repo's real trunk.
  - It must not be the default branch, it must contain the default branch's tip, and its own commits must span more than 14 days.
  - This covers the case where `main` went stale and all work lands on `develop`.
  - A checked-out feature branch younger than that stays unmerged.
- **Branch attribution** (`outcomes@4`): `git log --source --branches --remotes --not <trunk refs>` names a branch for each unmerged commit, resolved through `show-ref` (so `origin/x` → `x`). It is stored as `firstCommit.branch`. Open loops prefer it to the session's branch, which is missing when an agent edits a repo from outside it (e.g. a subagent started in a scratch folder).
- **Ignored files** (`outcomes@4`): `git check-ignore` lists untracked ignored files (`.env.local`, build output). An edit to one that did not land is `unknown/gitignored`, not uncommitted or lost.
- **History refs:** `--branches --remotes --tags`, never `--all` (`outcomes@3`). `--all` also walks stash commits, which made stashed work look landed. Work saved only in a stash currently counts as lost; recognizing stashes is planned for v0.2.
- **Reverts:** found through "This reverts commit <sha>" in commit messages.
- Line content is fingerprinted on the fly and never kept. Commit subjects are kept: secrets redacted, at most 120 characters.

### `@landed/outcomes` (engine `outcomes@4`)

- Pure functions, as specified in PRD §12.2–12.5. Only commits after `edit − 120 s` count, so lines that existed before the edit never make it look landed.
- **Survival:**
  - `reverted` if the first landing commit was reverted.
  - `surviving` if at least 50% of the fingerprints are in HEAD.
  - `churned` only if the work had reached the default branch.
  - Otherwise `unknown`: side-branch work.
- **Self-check:** control A uses the same file before the edit; control B uses the next touched file in sorted order (deterministic). A repo is flagged `low` confidence only with at least 20 patches and A > 8% or B > 1%.
- **Golden tests** use scripted real git repos (`packages/outcomes/src/golden.test.ts`), covering:
  - the classes: landed, uncommitted, lost, partial, no-signal, gitignored (and a tracked file matching an ignore pattern);
  - survival: churned, reverted;
  - branches: squash-merged, side branch with its branch name, working trunk versus a young feature branch, rebased;
  - edge cases: formatter changes, pre-existing lines, clock slack, non-ASCII paths with spaces.

### Orchestration (`computeOutcomes` in `@landed/ingest`)

- Processes each repo independently:
  - A repo whose `.git` is gone gets `repo-missing` (and is marked missing).
  - A git failure gets `git-error`.
  - Patches outside any repo get `outside-repo`.
- Outcomes are upserted by `(scope, subjectKey)`, so recomputation keeps ids.
- **Unchanged repos are skipped.** A per-repo input key (setting `outcomeInputs:<repoId>`) hashes everything the outcomes depend on:
  - the engine version and config;
  - the patch ids;
  - `git show-ref --head`;
  - size and mtime of each edited file, `.gitignore` and `.git/info/exclude`.

  When the key matches, the repo's git history is not read. Only a clean run stores a key. Pass `force: true` to recompute everything.
  - On the dev machine this took an incremental scan from 9.4 s to 1.3 s (`stageMs` in the scan report).
- The git line index is held in memory per repo during a run and not persisted yet. The `git_line_index` table is reserved for incremental indexing.

### Parity with the spike (real data, 2026-10-02)

Per-edit distributions for edits made before the spike ran, matching what the spike saw:

| Agent | n | landed | uncommitted | partial | lost |
|---|---|---|---|---|---|
| Claude | 773 | 59.0 (−0.5) | 33.8 (−0.1) | 2.5 (+0.3) | 4.8 (+0.5) |
| Codex | 7,052 | 89.7 (+1.0) | 1.8 (−0.7) | 2.5 (+0.1) | 6.0 (−0.4) |

Session×file numbers differ slightly, by design:
- Claude subagents are now their own sessions.
- The net scope subtracts lines a session removed itself.

Run the check with `LANDED_REAL_DATA=1 pnpm vitest run packages/ingest/src/smoke.real.test.ts`.

## Analysis (`threads`, `loops`, `insights`, run by `analyze()` in `@landed/ingest`)

These are pure functions over stored sessions, patches and session-file outcomes. They are recomputed after every scan.

### Threads (PRD §14)

- **Subagents** always join their parent (`continuation`).
- **Other sessions** link to the most recent earlier session in the same repo, within 72 h, when any of these holds:
  - they share a work branch;
  - one edits lines the other added;
  - their file sets have a Jaccard similarity of at least 0.3.
- **Excluded branches:** the default branch, both the local and the `origin/` name, and trunk-like branches (used for more than 14 days) never link sessions.
- **Span cap:** no thread grows beyond 7 days except through subagents.
- **Title priority:** branch, then commit subject, then session title, then top directory, then "<agent> session on <branch> (no edits)".
- **Status:** `active` within 2 h, then `dangling` (uncommitted or partial), `landed`, or `abandoned`. `abandoned` needs produced work (lost or superseded edits) idle for 14 days. A thread without edits stays `unknown`.

### Open loops (PRD §13)

- **Detected loop types:**
  - uncommitted output older than 24 h, per thread, at least 10 lines;
  - unmerged agent work, per repo and branch, idle 7 days, at least 10 lines;
  - lost work of at least 20 lines with nothing landed;
  - awaiting-user (inferred);
  - failed or interrupted sessions without a later landing.
- **Excluded folders:** files under repo-root folders listed in the `loopIgnorePaths` setting raise no uncommitted, unmerged or lost-work loops. These are reports and plans agents write for you to read, not to commit. The default is `output/` and `.planning/`, editable in Settings (`PUT /v1/settings/loops`, which re-analyzes at once). Outcomes for these files are still computed and shown.
- **Unmerged work grouping:** by repo and branch, using the commit's git branch first, then the session's branch, then the thread.
- `syncOpenLoops` keeps dismissals and auto-resolves loops that are no longer detected.
- Orphaned worktrees are not detected yet.

### Collisions (PRD §15)

- **concurrent-edit:** unrelated sessions edited the same file within 60 minutes while both were running (their activity spans overlap). One session ending before the other starts is a handoff, not a collision.
- **overwrite:** a later session removed unlanded lines an earlier one added, within 7 days.
- Parent/subagent pairs never count as collisions.

### Insights (PRD §16)

- repeated failure (the same sanitized command or tool failed at least 3 times);
- failed or interrupted sessions;
- tokens spent on non-landed work (at least 200k, attributed by session).

## Brief and report (`@landed/brief`), summarizer (`@landed/summarizer`)

- `buildDailyBrief` is deterministic and covers a local calendar day. `renderBriefMarkdown` exports it.
- `buildRetroReport` and `renderReportHtml` produce a self-contained page. By default it has no repo names, paths or code; areas are content-free categories.
- The summarizer is optional and off by default. It pipes structured facts to an installed agent CLI (`claude -p --output-format json`), validates strict JSON, and returns `undefined` on any failure.

## Server (`apps/server`)

- **Framework:** Fastify, listening on 127.0.0.1:47831.
- **Guards:**
  - The Host header must be this server; Origin, when present, must be too (DNS-rebinding protection).
  - `POST`/`PUT` requests require `x-landed-token`. The token is generated per run and injected into the served `index.html`.
  - The body limit is 64 KB.
- **Routes:** `/v1/{health,today,sessions,sessions/:id,outcomes,loops,loops/:id,threads,threads/:id,threads/:id/resume,insights,brief,brief/generate,report,scan,analyze,settings,settings/summarizer}`.
- **Read models** live in `views.ts`. The CLI reuses them.

## Web (`apps/web`)

- **Stack:** React 19, Vite, Tailwind 4 and TanStack Query, with a tiny history router.
- **Pages:** Today, Open loops, Outcomes, Threads (and detail), Sessions (and detail), Settings.
- **Theming:** colors are CSS variables with a dark mode. Status is always shown with text and an icon, never color alone.
- **Typechecking:** the app has its own `tsconfig.json` (DOM and JSX), checked by `pnpm typecheck`.

## CLI (`apps/cli`)

- **Build:** `build.mjs` bundles the CLI with esbuild into `dist/landed.mjs`, keeping `better-sqlite3`, `fastify` and `@fastify/static` external. It then copies `packages/db/migrations` to `dist/migrations` and the built UI to `dist/web`.
- **Asset lookup:** `assetDir()` finds those assets next to the bundle, or in the workspace when running from source.

## Live collection (v0.2)

```text
FSEvents (fs.watch recursive) on ~/.claude/projects, ~/.codex/sessions (+ archive, thread index)
      │ touch(path), 1.5 s debounce
      ▼
createLiveCollector ── importSource(onlyPaths) ── raise notices ── schedule analysis
      ▲                                              │                (2 min quiet / every 10 min:
      │ recordHook(signal)                           ▼                 computeOutcomes + analyze)
/v1/ingest/claude ◄── Claude plugin HTTP hooks    hub.publish ──► /v1/stream (SSE) ──► web refresh
/v1/ingest/codex  ◄── `landed hook codex` relay   notifier ──► macOS notification (osascript)
```

- **Serialization:** `exclusive()` runs live imports, hooks, analysis and full scans one at a time.
- **Hooks:** a hook signal (`HookSignal` in core) imports its transcript immediately, then records events that session files lack:
  - `approval.requested`: Claude `PermissionRequest`, or a `permission_prompt` notification;
  - `session.ended`.

  Payloads are read for ids and event names only.
- **Status rule:** a pending `approval.requested` makes a session `awaiting-user`, until anything newer happens.
- **Session end:** `session.ended` sets `endedAt`, unless activity resumed after it.
- **Notices** (`awaiting-user`, collisions within the last hour) are raised once per key. Existing state is marked silently at startup.
- **Running now:** a session counts as running when its last event is under 10 minutes old, it has no later end signal, and it has not failed.
- **Process model:**
  - `landed serve` runs in the foreground; `start` spawns it detached with a pid file and a log file; the LaunchAgent runs `serve`.
  - The LaunchAgent uses `KeepAlive.SuccessfulExit = false`: it restarts after a crash, and stays stopped after `landed stop`.
- **Installers:**
  - The Claude plugin is a local marketplace in the data dir, installed with `claude plugin marketplace add` and `claude plugin install landed@landed-local --scope user`. Its hooks are HTTP with a 2 s timeout and send the `x-landed-ingest` header.
  - Codex hooks are merged into `hooks.json`: parse first, append Landed's groups after the user's entries (Codex trust state is keyed by position), back up, then write atomically. Removal deletes only Landed's entries.

## Agent fit (Phase 19)

`/v1/outcomes` adds `fit` per repo. It compares agents within one repo and one kind of work (`categoryOf`: Code, Tests, UI, Docs, Config, Database, Infra). A comparison appears only when every agent has at least 30 outcomes in that cell, and it is shown with a 90% Wilson interval and the caveat (PRD §12.6).

## Agent memory: MCP (v0.3, Phase 20)

```text
agent (Claude Code / Codex) ──stdio──► `landed mcp` ──► SQLite (query_only) ◄── collector / scan
```

- **Transport:** the agent starts `landed mcp` itself over stdio (newline-delimited JSON-RPC 2.0).
  - `apps/server/src/mcp.ts` implements only what tools need: `initialize` (protocol 2024-11-05 through 2025-11-25), `ping`, `tools/list`, `tools/call`.
  - Notifications are ignored. Other methods return -32601.
  - Stdout carries protocol messages only.
  - Conformance is tested with the official MCP SDK client (dev dependency only).
- **Database access:**
  - The database is opened lazily, so a server started before the first scan works once data exists.
  - The connection sets `PRAGMA query_only = ON`, so it cannot write.
  - Freshness comes from the collector or `landed scan`. Every answer carries `dataAsOf`.
- **Tools.** All are annotated `readOnlyHint: true`. Read models live in `apps/server/src/memory.ts`.

  | Tool | Input | Returns |
  |---|---|---|
  | `active_sessions` | `repo?`, `paths?` | Sessions active in the last 10 min with files they edited; overlap with `paths` |
  | `recent_work` | `repo?`, `path?`, `days?` (7), `limit?` (20) | Sessions (subagents folded in) with per-file outcome and first commit |
  | `open_loops` | `repo?` | Open loops with description and `threadId` |
  | `prior_attempts` | `query`, `repo?`, `limit?` | Threads whose titles, branches, files, commit subjects or failed commands match; verdict, outcome mix, failing commands |
  | `resume_packet` | `threadId?`, `repo?`, `branch?` | Handoff text plus structure; defaults to the latest thread with edits |

- **Repo resolution:** `repo` is an absolute path anywhere inside a known repo (longest root wins), or a display name. It defaults to the server's working directory, which agents set to their project. Unknown repos return a tool error, never a list of other repos.
- **Errors:** bad arguments, unknown repos and a missing database are tool results with `isError: true`. An unknown tool is a JSON-RPC error.
- **Privacy filter:** `privacyFilter` runs on every result and error message.
  - It applies `redactSecrets` to every string again, as defense in depth.
  - It rewrites home directories (`/Users/<name>`, `/home/<name>`) to `~`, because sanitized commands can contain absolute paths.
  - It caps strings at 500 characters; rendered `text` is capped at 20,000.
  - Results carry repo-relative paths and repo display names. File paths are never absolute.
- **Search limits:** `prior_attempts` can only match stored metadata. Landed never stores prompts, so it cannot search what was asked. Each outcome keeps only its first commit's subject.
- **Registration:** `landed mcp install claude|codex --yes` previews first, then runs the agent's own CLI:
  - `claude mcp add --scope user landed -- <node> <landed.mjs> mcp`;
  - `codex mcp add landed -- …`.

  A re-install removes the old entry first. `landed mcp remove …` undoes it.
- **Resume packet:** the same function backs `/v1/threads/:id/resume`, the dashboard's "Copy resume context" button.
