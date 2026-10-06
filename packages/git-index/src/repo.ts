import { redactSecrets } from "@landed/core";
import type { LineFingerprinter } from "@landed/core/fingerprint";
import { catFiles, type GitOptions, gitLines, gitOutput } from "./git";

/** A commit that added a line (fingerprint) to a file. */
export interface LineHit {
  sha: string;
  /** Committer time, ms. Rebases and squashes get a fresh committer time. */
  timeMs: number;
}

export interface CommitInfo {
  timeMs: number;
  /** First line of the message, secrets redacted, at most 120 chars. */
  subject: string;
}

/** relPath → fingerprint → commits that added that line. */
export type LineIndex = Map<string, Map<string, LineHit[]>>;

export interface RepoHistory {
  index: LineIndex;
  commits: Map<string, CommitInfo>;
  /** Commits reachable from the default branch (within the window). */
  onDefaultBranch: Set<string>;
  /** Commits undone by a `git revert` (from "This reverts commit <sha>"). */
  reverted: Set<string>;
  defaultBranch?: string;
  /**
   * The checked-out branch, when it has become the repo's real trunk: it contains the default
   * branch and has carried work for over two weeks. Its commits count as on the default branch.
   */
  workingTrunk?: string;
  /** For commits not on the default branch (or working trunk): a branch that contains them. */
  branchOf: Map<string, string>;
}

/** A checked-out branch carrying unmerged work for longer than this is the working trunk. */
export const WORKING_TRUNK_SPAN_MS = 14 * 24 * 3600_000;

const COMMIT_MARK = "\u0001";
/**
 * Branches, remote branches and tags — not `--all`, which also walks stash commits and other
 * internal refs: work saved only in a stash has not landed anywhere.
 */
const HISTORY_REFS = ["--branches", "--remotes", "--tags"];
const FIELD_SEP = "\u0002";

/** origin/HEAD → main → master → current branch (PRD §12.4). */
export async function resolveDefaultBranch(
  repo: string,
  opts: GitOptions = {},
): Promise<string | undefined> {
  const originHead = await gitOutput(
    repo,
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    opts,
  );
  if (originHead) return originHead.trim();
  for (const name of ["main", "master"]) {
    if (
      (await gitOutput(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`], opts)) !==
      undefined
    )
      return name;
  }
  const head = await gitOutput(repo, ["rev-parse", "--abbrev-ref", "HEAD"], opts);
  return head && head.trim() !== "HEAD" ? head.trim() : undefined;
}

/**
 * The refs that count as "the default branch": both the remote-tracking ref and the local branch,
 * so work committed locally but not yet pushed (or behind a stale remote ref) still counts.
 */
export async function defaultBranchRefs(
  repo: string,
  defaultBranch: string | undefined,
  opts: GitOptions = {},
): Promise<string[]> {
  if (!defaultBranch) return [];
  const local = defaultBranch.startsWith("origin/")
    ? defaultBranch.slice("origin/".length)
    : defaultBranch;
  const refs = [defaultBranch];
  if (
    local !== defaultBranch &&
    (await gitOutput(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${local}`], opts)) !==
      undefined
  ) {
    refs.push(local);
  }
  return refs;
}

/**
 * The checked-out branch, if it is the repo's working trunk: not the default branch, containing
 * the default branch's tip, with its own commits spanning more than WORKING_TRUNK_SPAN_MS. This is
 * the "main went stale, everyone works on `develop`" case.
 */
export async function resolveWorkingTrunk(
  repo: string,
  defaultBranch: string | undefined,
  opts: GitOptions = {},
): Promise<string | undefined> {
  if (!defaultBranch) return undefined;
  const head = (await gitOutput(repo, ["rev-parse", "--abbrev-ref", "HEAD"], opts))?.trim();
  if (!head || head === "HEAD") return undefined;
  if (head === defaultBranch || head === defaultBranch.replace(/^origin\//, "")) return undefined;
  const behind = await gitOutput(repo, ["rev-list", "--count", `${head}..${defaultBranch}`], opts);
  if (behind?.trim() !== "0") return undefined;
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  await gitLines(
    repo,
    ["log", "--format=%ct", `${defaultBranch}..${head}`],
    (l) => {
      const t = Number(l) * 1000;
      if (Number.isFinite(t) && t > 0) {
        min = Math.min(min, t);
        max = Math.max(max, t);
      }
    },
    opts,
  );
  return max - min > WORKING_TRUNK_SPAN_MS ? head : undefined;
}

/**
 * Branch names by the short ref names git prints (`%S`): `x` → `x` for a local branch,
 * `origin/x` → `x` for a remote-tracking one. Built from `git show-ref`, so a local branch that
 * merely contains a slash is never mistaken for a remote.
 */
export async function branchNames(
  repo: string,
  opts: GitOptions = {},
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  await gitLines(
    repo,
    ["show-ref"],
    (l) => {
      const ref = l.slice(l.indexOf(" ") + 1);
      const name = shortBranch(ref);
      if (name) names.set(ref.replace(/^refs\/(heads|remotes)\//, ""), name);
    },
    opts,
  );
  return names;
}

/** `refs/heads/x` → `x`, `refs/remotes/origin/x` → `x`. */
export function shortBranch(ref: string): string | undefined {
  if (ref.startsWith("refs/heads/")) return ref.slice("refs/heads/".length);
  const m = /^refs\/remotes\/[^/]+\/(.+)$/.exec(ref);
  return m?.[1] && m[1] !== "HEAD" ? m[1] : undefined;
}

/**
 * Untracked files the repo ignores (tracked files are never reported, even if a pattern matches).
 * Agents write to such files (`.env.local`, build outputs) that are, by design, never committed.
 */
export async function ignoredPaths(
  repo: string,
  relPaths: readonly string[],
  opts: GitOptions = {},
): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < relPaths.length; i += 200) {
    const chunk = relPaths.slice(i, i + 200);
    // Exit code 1 means "none ignored"; paths with unusual characters come back C-quoted.
    await gitLines(
      repo,
      ["check-ignore", "--", ...chunk],
      (l) => {
        if (l) out.add(l.startsWith('"') ? unquoteC(l) : l);
      },
      opts,
    );
  }
  return out;
}

/**
 * Builds the line index for the given files from `git log --branches --remotes --tags -p -U0`
 * since `sinceSec`, plus default-branch reachability and revert markers. Only files in `relPaths` are indexed; their
 * content is fingerprinted on the fly and never kept.
 */
export async function readRepoHistory(
  repo: string,
  relPaths: ReadonlySet<string>,
  sinceSec: number,
  fingerprinter: LineFingerprinter,
  opts: GitOptions = {},
): Promise<RepoHistory> {
  const index: LineIndex = new Map();
  const commits = new Map<string, CommitInfo>();
  let sha: string | undefined;
  let timeMs = 0;
  let file: Map<string, LineHit[]> | undefined;
  let inHeader = false;

  const code = await gitLines(
    repo,
    [
      "log",
      ...HISTORY_REFS,
      "-p",
      "-U0",
      "--no-ext-diff",
      "--no-renames",
      "--no-color",
      `--since=${sinceSec}`,
      `--format=${COMMIT_MARK}%H${FIELD_SEP}%ct${FIELD_SEP}%s`,
    ],
    (line) => {
      if (line.startsWith(COMMIT_MARK)) {
        const [h, ct, subject] = line.slice(1).split(FIELD_SEP);
        sha = h;
        timeMs = Number(ct) * 1000;
        if (sha)
          commits.set(sha, { timeMs, subject: redactSecrets(subject ?? "").text.slice(0, 120) });
        file = undefined;
        return;
      }
      if (line.startsWith("diff --git ")) {
        inHeader = true;
        file = undefined;
        return;
      }
      if (inHeader) {
        if (line.startsWith("+++ ")) {
          const path = parseHeaderPath(line.slice(4));
          file = path !== undefined && relPaths.has(path) ? getOrCreate(index, path) : undefined;
        } else if (line.startsWith("@@")) {
          inHeader = false;
        }
        return;
      }
      if (line.startsWith("@@")) return;
      if (file && sha && line.startsWith("+")) {
        const fp = fingerprinter.fingerprint(line.slice(1));
        if (fp) {
          const hits = file.get(fp);
          const hit = { sha, timeMs };
          if (hits) hits.push(hit);
          else file.set(fp, [hit]);
        }
      }
    },
    opts,
  );
  if (code !== 0) throw new Error(`git log exited with ${code}`);

  const defaultBranch = await resolveDefaultBranch(repo, opts);
  const workingTrunk = await resolveWorkingTrunk(repo, defaultBranch, opts);
  const trunkRefs = [
    ...(await defaultBranchRefs(repo, defaultBranch, opts)),
    ...(workingTrunk ? [workingTrunk] : []),
  ];
  const onDefaultBranch = new Set<string>();
  for (const ref of trunkRefs) {
    await gitLines(
      repo,
      ["rev-list", `--since=${sinceSec}`, ref],
      (l) => onDefaultBranch.add(l.trim()),
      opts,
    );
  }
  const reverted = new Set<string>();
  await gitLines(
    repo,
    ["log", ...HISTORY_REFS, `--since=${sinceSec}`, "--grep=This reverts commit", "--format=%b"],
    (l) => {
      const m = /This reverts commit ([0-9a-f]{7,40})/.exec(l);
      if (m?.[1]) reverted.add(m[1]);
    },
    opts,
  );
  // Which branch carries each unmerged commit: `--source` names the ref each commit was reached
  // through, so agent work is attributed to a branch even when the session recorded none.
  const branchOf = new Map<string, string>();
  if (trunkRefs.length) {
    const names = await branchNames(repo, opts);
    await gitLines(
      repo,
      [
        "log",
        "--source",
        "--branches",
        "--remotes",
        `--since=${sinceSec}`,
        `--format=%H${FIELD_SEP}%S`,
        "--not",
        ...trunkRefs,
      ],
      (l) => {
        const [sha, ref] = l.split(FIELD_SEP);
        const branch = ref ? names.get(ref) : undefined;
        if (sha && branch) branchOf.set(sha, branch);
      },
      opts,
    );
  }
  return {
    index,
    commits,
    onDefaultBranch,
    reverted: expandShas(reverted, commits),
    ...(defaultBranch ? { defaultBranch } : {}),
    ...(workingTrunk ? { workingTrunk } : {}),
    branchOf,
  };
}

/** Fingerprints of each file at a revision (e.g. HEAD); null when absent or binary. */
export async function fingerprintsAt(
  repo: string,
  rev: string,
  relPaths: readonly string[],
  fingerprinter: LineFingerprinter,
  opts: GitOptions = {},
): Promise<Map<string, Set<string> | null>> {
  const blobs = await catFiles(
    repo,
    relPaths.map((p) => `${rev}:${p}`),
    opts,
  );
  const out = new Map<string, Set<string> | null>();
  for (const p of relPaths) {
    const text = blobs.get(`${rev}:${p}`);
    out.set(p, text == null ? null : new Set(fingerprinter.fingerprintAll(text.split(/\r?\n/))));
  }
  return out;
}

function getOrCreate(index: LineIndex, path: string): Map<string, LineHit[]> {
  let m = index.get(path);
  if (!m) {
    m = new Map();
    index.set(path, m);
  }
  return m;
}

/** `b/src/a.ts`, `b/with space.ts<TAB>` or C-quoted `"b/\303\244.ts"` → repo-relative path; `/dev/null` → undefined. */
export function parseHeaderPath(raw: string): string | undefined {
  // Git appends a TAB after paths that contain spaces, to delimit them.
  const trimmed = raw.replace(/\t$/, "");
  const value = trimmed.startsWith('"') ? unquoteC(trimmed) : trimmed;
  if (value === "/dev/null") return undefined;
  return value.startsWith("b/") ? value.slice(2) : value;
}

function unquoteC(quoted: string): string {
  const body = quoted.slice(1, quoted.lastIndexOf('"'));
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch !== "\\") {
      bytes.push(...Buffer.from(ch, "utf8"));
      continue;
    }
    const next = body[++i] ?? "";
    if (/[0-7]/.test(next)) {
      bytes.push(Number.parseInt(body.slice(i, i + 3), 8));
      i += 2;
    } else {
      const map: Record<string, number> = {
        n: 10,
        t: 9,
        r: 13,
        '"': 34,
        "\\": 92,
        a: 7,
        b: 8,
        f: 12,
        v: 11,
      };
      bytes.push(map[next] ?? next.charCodeAt(0));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Revert messages may cite abbreviated shas; map them to full shas we know. */
function expandShas(shas: Set<string>, commits: Map<string, CommitInfo>): Set<string> {
  const out = new Set<string>();
  for (const s of shas) {
    if (s.length === 40) out.add(s);
    else for (const full of commits.keys()) if (full.startsWith(s)) out.add(full);
  }
  return out;
}
