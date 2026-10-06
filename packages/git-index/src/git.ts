import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/** Read-only git subcommands Landed may run (PRD §28.10). Anything else is refused. */
const ALLOWED_SUBCOMMANDS = new Set([
  "log",
  "rev-list",
  "rev-parse",
  "symbolic-ref",
  "show-ref",
  "cat-file",
  "check-ignore",
]);

export class GitError extends Error {
  constructor(
    message: string,
    readonly code: "timeout" | "exit" | "spawn" | "forbidden",
  ) {
    super(message);
    this.name = "GitError";
  }
}

export interface GitOptions {
  /** Per-command timeout. */
  timeoutMs?: number;
}

const BASE_ARGS = ["-c", "core.quotepath=false", "-c", "color.ui=false", "--no-pager"];

function checkArgs(args: readonly string[]): void {
  const sub = args[0];
  if (!sub || !ALLOWED_SUBCOMMANDS.has(sub))
    throw new GitError(`git ${sub ?? ""} is not allowed`, "forbidden");
}

/**
 * Runs `git -C repo <args>` and streams stdout line by line. Never uses a shell; arguments are
 * passed as an array. Resolves with the exit code; non-zero codes are returned, not thrown, since
 * some read-only probes (e.g. symbolic-ref) use them as answers.
 */
export function gitLines(
  repo: string,
  args: readonly string[],
  onLine: (line: string) => void,
  opts: GitOptions = {},
): Promise<number> {
  try {
    checkArgs(args);
  } catch (e) {
    return Promise.reject(e);
  }
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", repo, ...BASE_ARGS, ...args], {
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs ?? 120_000);
    const rl = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
    rl.on("line", onLine);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new GitError(e.message, "spawn"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new GitError(`git ${args[0]} timed out`, "timeout"));
      else resolve(code ?? 1);
    });
  });
}

/** Collects stdout of a short git command; non-zero exit → undefined. */
export async function gitOutput(
  repo: string,
  args: readonly string[],
  opts: GitOptions = {},
): Promise<string | undefined> {
  const lines: string[] = [];
  const code = await gitLines(repo, args, (l) => lines.push(l), opts);
  return code === 0 ? lines.join("\n") : undefined;
}

/**
 * Reads blobs via `git cat-file --batch` (one process for many files). Returns content per spec
 * (e.g. "HEAD:src/a.ts"), or null when the object does not exist.
 */
export function catFiles(
  repo: string,
  specs: readonly string[],
  opts: GitOptions & { maxBytes?: number } = {},
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (specs.length === 0) return Promise.resolve(out);
  const maxBytes = opts.maxBytes ?? 5 * 2 ** 20;
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", repo, ...BASE_ARGS, "cat-file", "--batch"], {
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 120_000);
    let buf: Buffer = Buffer.alloc(0);
    let index = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      for (;;) {
        const nl = buf.indexOf(0x0a);
        if (nl === -1) return;
        const header = buf.subarray(0, nl).toString("utf8");
        const spec = specs[index];
        if (spec === undefined) return;
        if (header.endsWith(" missing") || header.endsWith(" ambiguous")) {
          out.set(spec, null);
          buf = buf.subarray(nl + 1);
          index++;
          continue;
        }
        const size = Number(header.split(" ")[2]);
        if (!Number.isFinite(size)) {
          out.set(spec, null);
          buf = buf.subarray(nl + 1);
          index++;
          continue;
        }
        if (buf.length < nl + 1 + size + 1) return; // wait for the whole blob
        const body = buf.subarray(nl + 1, nl + 1 + size);
        out.set(spec, size > maxBytes || body.includes(0) ? null : body.toString("utf8"));
        buf = buf.subarray(nl + 1 + size + 1);
        index++;
      }
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new GitError(e.message, "spawn"));
    });
    child.on("close", () => {
      clearTimeout(timer);
      for (const s of specs) if (!out.has(s)) out.set(s, null);
      resolve(out);
    });
    child.stdin.end(`${specs.join("\n")}\n`);
  });
}
