# Source formats

How each vendor's local history is laid out and how Landed reads it. This file is the reference for the importer packages. Re-run the inventory when a vendor version changes. Every number here was measured on the development machine without reading any content: only line types, key names, and counts.

## Claude Code (`@landed/importer-claude`, parser `claude-code@2`)

Inventory taken 2026-10-02 against Claude Code 2.1.281, with entrypoints `cli`, `claude-desktop`, and `sdk-ts`.

### Layout

```text
$CLAUDE_CONFIG_DIR/projects/          (default ~/.claude/projects)
  <encoded-cwd>/<session-id>.jsonl                      main transcript
  <encoded-cwd>/<session-id>/subagents/agent-<id>.jsonl subagent transcript
  <encoded-cwd>/<session-id>/subagents/agent-<id>.meta.json
                                         {agentType, description, toolUseId, spawnDepth, parentAgentId?}
```

- On the dev machine: 29 main files and 114 subagent files.
- One main file held lines from two `sessionId`s, so the parser groups lines by the `sessionId` on each line, never by file.
- Claude Code deletes old transcripts after `cleanupPeriodDays`. Landed's stored history outlives them, which is one more reason to import regularly.

### Line types and handling

| Type | Count | Handling |
|---|---|---|
| `assistant` | 35.4k | `tool_use` blocks become `command.started` (Bash), `subagent.started` (Agent/Task), or `tool.started`; `AskUserQuestion` adds `session.awaiting-user`. `stop_reason: end_turn` becomes `turn.completed`, deduplicated on `message.id`. Usage is keyed by `message.id` (falling back to `requestId`). `isApiErrorMessage` becomes `error`. |
| `user` | 22.0k | Plain text or string content becomes `prompt.submitted`, with no text kept. A `[Request interrupted by user…` marker or `interruptedByShutdown` becomes `agent.interrupted`. A `tool_result` becomes `command.completed/failed`, `tool.completed/failed`, or `subagent.ended`, using `is_error`. `toolDenialKind` becomes `approval.resolved` (denied). Successful Edit/Write results with a `structuredPatch` become a patch plus `edit.applied`. `isMeta` and `isCompactSummary` lines are skipped. |
| `system` | 2.8k | `subtype: api_error` becomes `error`. Every other subtype is ignored: `stop_hook_summary`, `turn_duration`, `away_summary`, `compact_boundary`, `local_command`, `model_refusal_fallback`, and others. |
| `custom-title` | 2.5k | Session title, provenance `observed` (set by the user). |
| `ai-title` | 301 | Session title, provenance `generated`. It never replaces an observed title. |
| `cost-state` | 22 | `totalCostUSD` becomes the session's `estimatedCostUsd`. This is Claude's own estimate; for subscription plans it is notional (PRD §17). |
| `attachment`, `queue-operation`, `mode`, `permission-mode`, `file-history-snapshot`, `file-history-delta`, `bridge-session`, `frame-link`, `atis-latch`, `agent-name`, `artifact-*`, `summary` | — | Ignored. |
| `last-prompt` | 3.1k | Ignored, because it holds prompt text. |
| `pr-link` | 255 | Recognized but deferred: `{prNumber, prRepository, prUrl}` is an observed outcome signal for Phase 5. |
| `continued-in` | 1 | Recognized but deferred: `continuedInSessionId` is a thread-continuation link for Phase 8. |
| anything else | — | Counted in `stats.unknownTypes` and kept as a minimal `unknown` event when it has a `sessionId` and a `timestamp`. |

### Key facts

- **Common fields:** `uuid`, `parentUuid`, `sessionId`, `timestamp`, `cwd`, `gitBranch`, `version`, `entrypoint`, `isSidechain`, `agentId` (subagents only), `slug`, and `sessionKind`.
- **Subagent lines carry the parent's `sessionId`.** Landed identifies a subagent session as `<sessionId>:<agentId>` and links it to the parent.
- **Usage repeats across split lines.** One API message is written as several lines that share `message.id`, and later lines carry larger `output_tokens`: in 4,003 of 16,608 repeats the value differed and always grew. Landed keeps the per-field maximum per `message.id`; the storage upsert does the same.
  - Summing every line over-counts (the spike measured about 1.6×).
  - Keeping only the first line under-counts output.
- **Token mapping:**
  - `inputTokens` = `input_tokens` + `cache_creation_input_tokens`
  - `cachedInputTokens` = `cache_read_input_tokens`
  - `outputTokens` = `output_tokens`
  - Lines with `model: "<synthetic>"` carry no usage.
- **No structured Bash exit code.** The only signals are `is_error` and an occasional `returnCodeInterpretation`.
- **Bash `toolUseResult.gitOperation`** records git operations the agent ran itself, in the shapes `{commit: {sha, kind}}`, `{push: {branch}}`, `{pr: {number, url, action}}`, and `{branch: {ref, action}}`. It is deferred to Phase 5: it answers PRD §31.4, whether the agent committed.
- **Edit results:** `{filePath, oldString, newString, originalFile, structuredPatch[], userModified, replaceAll}`.
- **Write results:** `{type: create|update, filePath, content, structuredPatch[], originalFile}`. A create has an empty `structuredPatch`, so its added lines come from `content`.
- **No explicit session end.** Status is derived from normalized events by `deriveSessionStatus` in `@landed/ingest`:
  - `completed`: a turn completed and no tool call was left open after it.
  - `awaiting-user`: an `AskUserQuestion` call is still open.
  - `interrupted` and `failed`: come from direct evidence.
  - Everything else is `unknown`.

### Resumed sessions copy history

- When a session is resumed, Claude writes a new file that repeats earlier lines. The copies keep the same `uuid`, `timestamp`, `message.id` and tool ids; usually only `sessionId`, `version` and `promptId` change.
- On the dev machine, 233 of 697 edit results appear in more than one file.
- The pipeline's cross-session dedupe attributes these copies to the original session (see docs/architecture.md). Without it, the 2026-10-02 data would have double counted 4.5k events, 201 patches and 1,950 usage records.

### Privacy

The parser reads prompt text, assistant text, thinking, tool input and output, and file contents in memory only. It emits:
- file paths;
- sanitized commands (first line only, secrets redacted, at most 300 characters);
- titles;
- line fingerprints.

Two tests enforce this:
- The fixtures in `fixtures/claude/2.1` plant `CANARY_` strings everywhere, and tests assert none reaches the parser output or the database.
- The opt-in real-data smoke test (`LANDED_REAL_DATA=1`) checks that none of the machine's real prompts (925 multi-word prompts) appears in the database.

### Measured on the dev machine (2026-10-02)

- **First import:** 143 files and 88k lines in about 7.4 s. Produced 141 sessions (114 subagents), 43.7k events, 1,166 patches (85% resolved to a repo), and 18.2k usage records.
- **Second import:** 6 ms, nothing inserted.
- **Session status:** 126 completed, 8 unknown, 4 failed, 3 interrupted.
- **Database size:** about 51 MB.

## Codex (`@landed/importer-codex`, parser `codex@3`)

Inventory taken 2026-10-02. It covers 1,006 rollouts (5.0 GB) from Codex CLI 0.50 through 0.159.

The originators in that set:

| Originator | Rollouts |
|---|---|
| Codex Desktop | 354 |
| `codex_sdk_ts` | 289 |
| `codex_exec` | 226 |
| `codex_work_desktop` | 209 |
| `codex_cli_rs` | 5 |

### Layout

```text
$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread-id>.jsonl   (default ~/.codex)
$CODEX_HOME/archived_sessions/rollout-*.jsonl                            archived threads (also read)
$CODEX_HOME/session_index.jsonl   {id, thread_name, updated_at}          thread names; later lines win
```

- Thread names become session titles with provenance `generated`, because Codex writes them itself.
- The index is read last, so it only titles sessions that already exist, and it never counts as a session's source file.

- The thread id in the file name equals `session_meta.id` in 1,005 of 1,006 files. Landed takes the session id from the file name, so incremental passes that start mid-file still know their session.
- Every line has the form `{"timestamp", "ordinal", "type", "payload"}`, always in that key order. Ordinals strictly increase.
- Subagents get their own rollout files. They are linked to their parent through `session_meta.parent_thread_id` or `source.subagent.thread_spawn.parent_thread_id`. This data set has 532 subagent sessions.

### Line types and handling

| Type (payload type) | Share of bytes | Handling |
|---|---|---|
| `response_item` (`message`, `reasoning`, `*_tool_call`, `*_output`, …) | 49% | Skipped by its first 256 bytes. It is never buffered or parsed. Tool activity comes from `item_completed` instead. |
| `compacted` | 35% | Skipped by head. These are context snapshots of up to about 16 MB per line. |
| `world_state`, `inter_agent_communication_metadata`, `token_usage_record` | ~1% | Skipped by head. |
| `session_meta` | | Only the file's first line counts. It becomes `session.started` plus the session facts: cwd, `cli_version`, `git.branch` / `commit_hash`, and the parent link. `base_instructions` and `git.repository_url` are never kept. |
| `turn_context` | | Supplies `cwd` and `model`. |
| `event_msg` / `item_completed` | 15% | See the item table below. |
| `event_msg` / `task_complete` | | `turn.completed`, or `error` when `error` is set. |
| `event_msg` / `turn_aborted` | | `agent.interrupted`. Every observed reason was `interrupted`. |
| `event_msg` / `token_count` | | Usage; see below. |
| `event_msg` / `task_started`, `thread_settings_applied`, `thread_goal_updated` | | Ignored. |

**`item_completed` items:**

| Item | Event emitted |
|---|---|
| `UserMessage` | `prompt.submitted`, with no text |
| `CommandExecution` | `command.completed` or `command.failed`. Carries the real `exit_code` (725 of 9,305 are nonzero) and a sanitized command. `["/bin/zsh","-lc", cmd]` is unwrapped to `cmd`. |
| `FileChange` with status `completed` | One `edit.applied` per path, plus a patch. `add` gives a create (lines from `content`); `update` gives a modify, or a rename when `move_path` is set (lines from `unified_diff`); `delete` gives the event only. |
| `FileChange` with status `declined` | `approval.resolved` (denied) |
| `McpToolCall` | `tool.completed` or `tool.failed`, named `mcp__<server>__<tool>` |
| `WebSearch`, `DynamicToolCall`, `CollabAgentToolCall` | `tool.*` |
| `SubAgentActivity` | `started` gives `subagent.started`; `completed` and `interrupted` give `subagent.ended`. These events carry no call id, because Codex rarely reports a subagent's end and an unpaired start would make the parent look stuck. |
| `AgentMessage`, `Reasoning`, `ImageView`, `ContextCompaction`, `Extension`, … | Ignored |

**`apply_patch`:** All 2,194 successful `apply_patch` calls have a `FileChange` item with the same id. The 80 without one all failed. So patches come from `FileChange` only, and the legacy `apply_patch` input is not parsed.

### Key facts

- **Forked rollouts copy parent history.**
  - 207 rollouts have `forked_from_id`. Some of them start with the parent's history, written in one burst at fork time; in 77 files that history is headed by a second `session_meta`.
  - Landed drops a line when all of these hold: the rollout is forked, `0 < ordinal < subagent_history_start_ordinal`, and the line's timestamp is within 1 s of the fork. Otherwise the parent's patches, commands, and token counts would be counted twice.
  - Non-forked subagent files also carry `subagent_history_start_ordinal`, but their earlier lines are genuine work (1,967 `FileChange` items), so they are kept.
- **Usage comes from cumulative totals.**
  - `token_count.info.total_token_usage` is cumulative, and a resumed thread's new rollout continues the old counter (one file starts at 3.56 billion).
  - Each new cumulative value contributes its difference from the previous one, so the sum always reconciles with the vendor total. The first value in a pass falls back to its own `last_token_usage`. Repeated emissions of the same total collapse on the usage key `<session>:cum:<total>`. The key is scoped to the session because identical totals occur by coincidence across unrelated sessions: 138 of 150 shared values were unrelated, typically identical first calls of scripted `codex exec` runs.
  - Summing `last_token_usage` instead missed emissions in 12% of files.
  - `token_usage_record` (keyed by `response_id`) only exists from about 0.147 on, so it is not used.
- **Token mapping:** OpenAI counts cached input inside `input_tokens`.
  - `inputTokens` = input − cached
  - `cachedInputTokens` = cached
  - `outputTokens` = output, which includes reasoning
  - `reasoningTokens` = `reasoning_output_tokens`
- **Status** comes from the same vendor-neutral `deriveSessionStatus`. Codex emits no "started" events for commands, so no call is ever left open.

### Measured on the dev machine (2026-10-02)

- **First import:** 1,006 files and 480k lines in about 16 s. Produced 1,006 sessions (532 subagents), 34.5k events, 8,300 patches (88% resolved to a repo), and 77.8k usage records.
- **Second import:** 35 ms, nothing inserted.
- **Session status:** 787 completed, 166 unknown, 52 interrupted, 1 failed.
- **Memory:** the JS heap peaks at about 94 MB. Process RSS peaks around 0.8 GB because the native allocator does not return memory to the OS during the 5 GB pass; this is noted for Phase 13.
- **Database size:** about 80 MB.
- **Privacy:** none of 724 real multi-word prompts appears in the database.

## Command sanitizing (both vendors)

Commands keep:
- their first line only;
- secrets redacted (`redactSecrets`);
- quoted prose masked as `"[TEXT]"` (three or more words, or more than 48 characters);
- a 300-character cap.

The masking rule exists because the real-data check found a user's sentence inside a nested `codex exec "…"` command. Commit messages and echo text carry the same risk.
