# Landed beta: tester guide

Thanks for trying Landed. It reads your Claude Code and Codex history, matches every file edit an agent made against your git history, and shows what that work became:
- landed in a commit;
- still uncommitted;
- lost;
- left on a branch that was never merged;
- clashing with another agent's work.

It runs entirely on your machine.

## Install (2 minutes)

Requires macOS, Node.js 22.12 or newer, and git.

```bash
npm install -g landed-agents
landed scan
landed open
```

The first scan takes about a minute for a large history. After that, `landed open` shows the dashboard at http://127.0.0.1:47831.

## What to try

1. **Open loops:** agent work left dangling. For each loop, either close it in your repo, dismiss it, or press "Copy resume context" and paste that into an agent. If a loop is wrong, **dismiss it with a reason**. Those reasons are the most useful feedback you can give.
2. **Today:** where you left off, and what landed.
3. **Outcomes:** how much agent work actually lands, per repo.
4. **Optional, live mode:** `landed start` keeps the dashboard current while agents work. `landed autostart on --yes` starts it at login.
5. **Optional, agent memory:** `landed mcp install claude --yes` (or `codex`) lets your agents ask Landed:
   - who else is editing these files;
   - what was tried before;
   - what is still open.

Every command that changes agent configuration shows what it will do first and needs `--yes`.

## Privacy

- **Read-only:** Landed only reads agent session files and git.
- **Stored:** session metadata, file paths, sanitized commands, commit subjects, token counts, and salted fingerprints of code lines.
- **Never stored:** prompts, assistant text, tool output, file contents, or environment values.
- **No network:** nothing leaves your machine. There is no telemetry.
- **Deletion:** `landed uninstall` removes everything Landed added and all its data.

## Feedback (after about a week)

Report wrong results as you find them, using the "Wrong result" issue template at https://github.com/omersukruvarol/landed-agents/issues. Never paste code or prompts.

After about a week, please answer these, even briefly:

1. On how many days did you open Landed?
2. Did it show you work you had forgotten about? Did you close at least one open loop because of it?
3. Which part was most useful: Open loops, Outcomes, Today, collisions, the Retro Report, or the MCP tools?
4. What was wrong? Name loops, outcomes or threads that did not match reality.
5. How would you feel if you could no longer use Landed: very disappointed, somewhat disappointed, or not disappointed?

`landed report --out report.html` writes a shareable summary. It has no repo names unless you pass `--names`. Attach it if you are comfortable doing so.

## Uninstall

```bash
landed uninstall
npm uninstall -g landed-agents
```
