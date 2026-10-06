# Landed

[![CI](https://github.com/omersukruvarol/landed-agents/actions/workflows/ci.yml/badge.svg)](https://github.com/omersukruvarol/landed-agents/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/landed-agents)](https://www.npmjs.com/package/landed-agents)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

**Did your AI agents' work actually land?**

Landed is a local-first outcome ledger for AI coding agents, starting with Claude Code and Codex. It reads the session files those agents already keep and matches every edit an agent made against your git history. From that it shows:

- what landed in a commit;
- what is still uncommitted;
- what was lost;
- which branches were never merged;
- where two agents collided;
- where you left off.

It changes no configuration and sends nothing off your machine.

> Status: **v0.3 beta**. Retro analysis, live collection, and a read-only MCP server agents can query. macOS first. See "Limitations" below.

## Quick start

Requires macOS (Linux works for scans; live autostart is macOS-only), Node.js ≥ 22.12, and git.

```bash
npm install -g landed-agents
landed scan        # read your agent history and check it against git (about 1 minute the first time)
landed open        # dashboard at http://127.0.0.1:47831
```

Or run it once without installing: `npx landed-agents scan`.

To remove it, run `landed uninstall`. It reverses everything Landed added (autostart, MCP registrations, the plugin, the hooks) and deletes its data, after asking. Your agents' history and your repositories are never touched. Then run `npm uninstall -g landed-agents`.

### From source

```bash
corepack enable pnpm
pnpm install
pnpm build                # builds the web UI and bundles the CLI into apps/cli/dist/landed.mjs
pnpm landed scan          # same commands as above, through the workspace
```

## Live mode

```bash
landed start                          # collect in the background; the dashboard updates within seconds
landed status                         # collector, live activity, sessions running now
landed autostart on --yes             # optional: start at login (macOS LaunchAgent)
landed plugin install claude --yes    # optional: permission-wait and session-end signals from Claude Code
landed hooks install codex --yes      # optional: the same for Codex (appended; your hooks are kept)
```

Live collection needs no agent configuration. Agents append to their session files as they work, and Landed watches those files.

The plugin and hooks add the signals session files lack: an agent waiting for your approval, and a session ending.
- Every install command previews what it will change and does nothing without `--yes`.
- They go through Claude's own plugin manager, or a backed-up, merge-only edit of `~/.codex/hooks.json`.
- Each can be undone with `landed plugin remove claude` / `landed hooks remove codex` / `landed autostart off`.
- Hooks time out after 2 seconds and never block or steer an agent.

When an agent waits for you, or two agents edit the same file within an hour, Landed shows a macOS notification. Turn this off in Settings.

## Agent memory (MCP)

```bash
landed mcp install claude --yes    # register Landed's read-only MCP server with Claude Code
landed mcp install codex --yes     # …and with Codex
```

Agents can then ask Landed before they start work:

| Tool | Answers |
|---|---|
| `active_sessions` | Who else is editing files in this repo right now, and does that overlap with the paths I plan to touch? |
| `recent_work` | What did agents do here (or in this file or directory) recently, and did it land? |
| `open_loops` | What agent work is dangling here? |
| `prior_attempts` | Has this been tried before, how did it end, and what kept failing? |
| `resume_packet` | Give me a handoff to continue this work thread. |

This is coordination without orchestration: Landed never drives an agent.
- The tools only read, through a read-only database connection.
- They return metadata: titles, branches, repo-relative paths, commit subjects, and sanitized failed commands. They never return prompts or code, which Landed does not store.
- Every answer passes through the redaction filter again.

Registration goes through each agent's own `mcp add` command, and `landed mcp remove claude|codex` undoes it. The same resume packet is behind the dashboard's "Copy resume context" button.

## Commands

| Command | What it does |
|---|---|
| `landed scan` | Reads Claude Code and Codex history incrementally, matches edits to git, and finds threads, open loops, collisions and insights |
| `landed open [--port N]` | Opens the dashboard; starts live collection in the foreground if `landed start` isn't running |
| `landed start` / `stop` / `status` | Runs the live collector in the background |
| `landed autostart on\|off [--yes]` | Starts the collector at login (LaunchAgent) |
| `landed plugin install\|remove claude [--yes]` | Installs or removes the Claude Code hooks plugin |
| `landed hooks install\|remove codex [--yes]` | Installs or removes the Codex hooks |
| `landed mcp install\|remove claude\|codex [--yes]` | Registers or removes the read-only MCP memory server |
| `landed mcp` | Runs the MCP server over stdio (agents start it themselves) |
| `landed brief [--date YYYY-MM-DD] [--json]` | Prints the Daily Brief |
| `landed loops` | Lists open loops |
| `landed report [--days 30] [--names] [--out FILE]` | Writes a shareable Retro Report as self-contained HTML. It has no repo names unless you pass `--names` |
| `landed export [--date D] [--md]` | Exports a day's brief as JSON or Markdown |
| `landed doctor [--verbose]` | Runs PASS/WARN/FAIL checks and suggests fixes |
| `landed data prune --older-than 30d` | Forgets old sessions |
| `landed data reset` / `landed uninstall` | Deletes Landed's database, or all of its data |

## What it shows

The dashboard speaks plain English or Turkish (switch in the header) and shows:

- **Overview:** what your agents did this week, as committed, not committed yet, and lost files; what is waiting for you; and what is running now.
- **To do:** agent work left dangling (folders such as `output/` and `.planning/`, where agents write reports for you, are excluded; edit the list in Settings). These are uncommitted output, unmerged agent branches, lost work, sessions waiting for your answer, and failures nobody resolved. Each item says what happened, why it matters and what to do. It offers a read-only git command to copy and a handoff to paste into any agent, and can be marked done or not needed.
- **Projects:** per project, the committed / not committed yet / lost mix, survival of landed work, and edit-to-commit lag. Agents are compared only within one repo and only with at least 30 outcomes each, shown with a 90% interval and a caveat (PRD §12.6).
- **History:** units of work rebuilt across sessions, days and agents, and every session with a timeline, files and each file's outcome. Sessions that changed no files are hidden unless you ask for them.

Every claim carries a label:

| Label | Meaning |
|---|---|
| Observed | Read from session files or git |
| Derived | Computed deterministically |
| Inferred | A heuristic |
| Generated | Written by an LLM; optional and off by default |

## Privacy

- **What Landed reads:** `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR`), `~/.codex/sessions` plus its archive and thread-name index (or `$CODEX_HOME`), and your git repositories. Access is read-only.
- **What it stores**, in `~/Library/Application Support/Landed` (or `$LANDED_DATA_DIR`, folder mode 0700, database mode 0600):
  - session metadata;
  - file paths;
  - commands, with only the first line kept, secrets redacted and quoted prose masked;
  - commit subjects;
  - token counts;
  - code lines only as **salted fingerprints** (HMAC with a per-install secret).
- **What it never stores:** prompt text, assistant text, tool output, file contents, or environment values.
- **Network:** none. The one exception is the optional generated summary, which sends structured facts (titles, counts, commit subjects) to your installed agent CLI, and only after you turn it on in Settings.
- The local API binds to 127.0.0.1, rejects foreign Host and Origin headers, and requires a per-run token for any change.

Redaction is defense in depth, not a guarantee: commands and paths can still be sensitive.

## How outcomes are computed

Each agent edit (Claude `structuredPatch`, Codex `FileChange`) is reduced to the fingerprints of its added lines. Those fingerprints are matched against `git log --branches --remotes --tags -p` for the same file, counting only commits made after the edit.

| Class | Rule |
|---|---|
| landed | at least 50% of the lines are in such a commit |
| uncommitted | otherwise, at least 50% are in the working tree |
| partial | some lines matched, below both thresholds |
| lost | nothing matched |
| unknown | no meaningful lines, outside any repo, the repo is gone, the file is ignored by git, or git failed |

Every scan also runs two negative controls and flags repos where matches are unreliable. On the development machine the engine reproduces the feasibility spike within ±1 point (see `docs/architecture.md`).

## Architecture

TypeScript monorepo (pnpm):

```text
packages/  core (domain + schemas) · db (SQLite/Drizzle) · importer-claude · importer-codex ·
           git-index · outcomes · threads · loops · insights · brief · summarizer ·
           ingest (pipelines)
apps/      server (Fastify API) · web (React + Vite + Tailwind) · cli (the `landed` binary)
```

Further reading:
- [PRD.md](PRD.md): the product spec.
- [docs/architecture.md](docs/architecture.md): contracts.
- [docs/sources.md](docs/sources.md): the vendor file formats.
- [CLAUDE.md](CLAUDE.md): rules for contributors.

## Development

```bash
pnpm lint && pnpm typecheck && pnpm test
LANDED_REAL_DATA=1 pnpm vitest run packages/ingest/src/smoke.real.test.ts   # read-only check against your real history
pnpm --filter @landed/web dev        # UI with hot reload (expects `landed open` on :47831)
```

## Limitations (v0.1)

- **What matching sees:** only edits made through the agents' edit tools. Changes made by shell commands (sed, codegen, formatters) are invisible.
- **Reformatting** after an edit lowers match rates and can turn landed work into partial.
- **Stashes:** work saved only in a git stash counts as lost. Orphaned worktrees are not detected yet.
- **Working trunk:** if you work on a long-lived branch instead of `main`, Landed treats the checked-out branch as the trunk once it contains `main` and has carried work for over 14 days. Before that, its commits count as unmerged.
- **Who committed** (the agent or you) is not distinguished yet.
- **Live mode:** outcomes are recomputed when agents go quiet (after 2 minutes) or every 10 minutes. Session activity and notifications are near-instant.
- **Memory:** the first scan of very large histories (5 GB) peaks around 0.8 GB of process memory.

## Contributing and security

- [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, the privacy rules every change must follow, and how to report a wrong result without pasting code.
- Report vulnerabilities privately; see [SECURITY.md](SECURITY.md).
- This project follows a [code of conduct](CODE_OF_CONDUCT.md).

## License

Apache License 2.0. See [LICENSE](LICENSE).
