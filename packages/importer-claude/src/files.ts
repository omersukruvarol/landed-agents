import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface TranscriptFile {
  path: string;
  kind: "main" | "subagent";
}

/** Claude Code keeps transcripts under `$CLAUDE_CONFIG_DIR/projects` (default `~/.claude`). */
export function defaultClaudeProjectsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
}

/**
 * Lists transcripts: `<project>/<session>.jsonl` and `<project>/<session>/subagents/*.jsonl`.
 * Main files come first so parent sessions exist before their subagents are imported; within each
 * group, oldest first.
 */
export function listClaudeTranscripts(root: string): TranscriptFile[] {
  if (!existsSync(root)) return [];
  const main: TranscriptFile[] = [];
  const subagents: TranscriptFile[] = [];
  for (const project of readdirSync(root).sort()) {
    const projectDir = join(root, project);
    if (!isDir(projectDir)) continue;
    for (const entry of readdirSync(projectDir).sort()) {
      const p = join(projectDir, entry);
      if (entry.endsWith(".jsonl") && isFile(p)) {
        main.push({ path: p, kind: "main" });
      } else if (isDir(p)) {
        const subDir = join(p, "subagents");
        if (!isDir(subDir)) continue;
        for (const f of readdirSync(subDir).sort()) {
          const sp = join(subDir, f);
          if (f.endsWith(".jsonl") && isFile(sp)) subagents.push({ path: sp, kind: "subagent" });
        }
      }
    }
  }
  // Oldest first: a resumed session copies its predecessor's history, which must be attributed
  // to the session where it happened, i.e. the one imported first.
  return [...byCreation(main), ...byCreation(subagents)];
}

function byCreation(files: TranscriptFile[]): TranscriptFile[] {
  const born = (p: string) => {
    try {
      const st = statSync(p);
      return st.birthtimeMs || st.mtimeMs;
    } catch {
      return 0;
    }
  };
  return files
    .map((f) => ({ f, t: born(f.path) }))
    .sort((a, b) => a.t - b.t || a.f.path.localeCompare(b.f.path))
    .map(({ f }) => f);
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
