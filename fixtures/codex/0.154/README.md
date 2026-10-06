# Codex rollout fixtures (0.154)

Hand-written lines that mirror the structure of real Codex 0.154 rollouts; see `docs/sources.md`.
All content is synthetic. `{{REPO}}` is replaced at test time.

- `rollout-…-…0a.jsonl`: a main session covering commands (failing and passing), a multi-file
  patch (update, add, delete), a declined patch, a failed MCP call, subagent activity, repeated
  and cumulative `token_count`, skipped heavy lines, future types, and one broken line.
- `rollout-…-…0b.jsonl`: a forked subagent whose first lines are copied parent history
  (`ordinal < subagent_history_start_ordinal`, same instant as the fork). That history must not
  be attributed to the subagent.
- Strings containing `CANARY_` must never reach parser output or storage. The exceptions are a
  secret inside a command, which redaction must remove, and a second command line, which must be
  dropped.
