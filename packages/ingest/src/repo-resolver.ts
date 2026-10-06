import { existsSync, statSync } from "node:fs";
import { dirname, relative, sep } from "node:path";

export interface RepoResolver {
  /** Nearest enclosing git work tree (`.git` dir or file) of a file or directory path. */
  rootFor(path: string): string | undefined;
}

/** Read-only, cached walk up the directory tree. Missing paths simply resolve to undefined. */
export function createRepoResolver(): RepoResolver {
  const cache = new Map<string, string | null>();
  const lookup = (dir: string): string | undefined => {
    const visited: string[] = [];
    let current = dir;
    let found: string | null = null;
    for (;;) {
      const cached = cache.get(current);
      if (cached !== undefined) {
        found = cached;
        break;
      }
      visited.push(current);
      if (existsSync(`${current}${sep}.git`)) {
        found = current;
        break;
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    for (const v of visited) cache.set(v, found);
    return found ?? undefined;
  };
  return {
    rootFor(path) {
      if (!path.startsWith("/")) return undefined;
      return lookup(isDirectory(path) ? path : dirname(path));
    },
  };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Path relative to a repo root, or undefined when the path is outside it. */
export function relativeToRoot(root: string, path: string): string | undefined {
  const rel = relative(root, path);
  if (rel === "" || rel.startsWith("..") || rel.startsWith(sep)) return undefined;
  return rel.split(sep).join("/");
}
