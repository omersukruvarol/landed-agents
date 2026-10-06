import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface RolloutFile {
  path: string;
}

/** Codex keeps rollouts under `$CODEX_HOME/sessions/YYYY/MM/DD/` (default `~/.codex`). */
export function defaultCodexSessionsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions");
}

/** Codex's thread-name index, a sibling of the sessions folder. */
export const THREAD_INDEX_FILE = "session_index.jsonl";

/**
 * Lists rollouts in path order — chronological (date directories, then a timestamp in the file
 * name), so parent threads are imported before the subagents they spawn. Archived rollouts
 * (`$CODEX_HOME/archived_sessions`) follow, and the thread-name index comes last so the sessions
 * it names already exist.
 */
export function listCodexRollouts(root: string): RolloutFile[] {
  const out: RolloutFile[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir).sort()) {
      const p = join(dir, entry);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && entry.startsWith("rollout-") && entry.endsWith(".jsonl"))
        out.push({ path: p });
    }
  };
  walk(root);
  walk(join(dirname(root), "archived_sessions"));
  const index = join(dirname(root), THREAD_INDEX_FILE);
  if (existsSync(index)) out.push({ path: index });
  return out;
}
