import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentPatch } from "@landed/core";
import { createLineFingerprinter, parseInstallSecret } from "@landed/core/fingerprint";
import {
  getRepo,
  getSession,
  insertPatches,
  listOutcomes,
  openDatabase,
  upsertRepo,
  upsertSession,
} from "@landed/db";
import { newUlid } from "@landed/shared";
import { describe, expect, it } from "vitest";
import { computeOutcomes } from "./outcomes";
import { tempDir } from "./test-helpers";

const fingerprinter = createLineFingerprinter(parseInstallSecret("q".repeat(43)));
const T0 = Date.parse("2026-09-01T00:00:00.000Z");
const iso = (s: number) => new Date(T0 + s * 1000).toISOString();
const LINES = [
  "const retries = computeRetries(config);",
  "export const timeoutMs = 5000 * factor;",
];

function gitRepo(root: string, commitAtSec: number | undefined) {
  mkdirSync(join(root, "src"), { recursive: true });
  const git = (atSec: number, ...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=T", "-c", "user.email=t@e.x", "-c", "commit.gpgsign=false", ...args],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: root,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_AUTHOR_DATE: `${T0 / 1000 + atSec} +0000`,
          GIT_COMMITTER_DATE: `${T0 / 1000 + atSec} +0000`,
        },
        stdio: "ignore",
      },
    );
  git(0, "init", "-q", "-b", "main");
  writeFileSync(join(root, "src", "a.ts"), "import x from 'y';\n");
  git(0, "add", "-A");
  git(0, "commit", "-q", "-m", "init");
  writeFileSync(join(root, "src", "a.ts"), `import x from 'y';\n${LINES.join("\n")}\n`);
  if (commitAtSec !== undefined) {
    git(commitAtSec, "add", "-A");
    git(commitAtSec, "commit", "-q", "-m", "feat: agent work");
  }
}

function setup() {
  const home = tempDir();
  const repoRoot = join(home, "app");
  gitRepo(repoRoot, 2000);
  const { db } = openDatabase(":memory:");
  const repo = upsertRepo(db, { rootPath: repoRoot });
  const gone = upsertRepo(db, { rootPath: join(home, "deleted-worktree") });
  const session = upsertSession(db, {
    provider: "codex",
    providerSessionId: "s1",
    startedAt: iso(900),
    lastEventAt: iso(1100),
    status: "completed",
    eventCount: 0,
    failureCount: 0,
    changedFileCount: 0,
    sourceFiles: ["/x"],
    repoId: repo.id,
  });
  const fps = fingerprinter.fingerprintDiff(LINES, []);
  const patch = (o: Partial<AgentPatch>): AgentPatch => ({
    id: newUlid(),
    sessionId: session.id,
    provider: "codex",
    timestamp: iso(1000),
    path: join(repoRoot, "src", "a.ts"),
    repoId: repo.id,
    relPath: "src/a.ts",
    operation: "modify",
    addedLineFps: fps.added,
    removedLineFps: [],
    addedLineCountRaw: 2,
    removedLineCountRaw: 0,
    sourceRef: { file: "/x", offset: 0, parserVersion: "codex@1" },
    ...o,
  });
  const {
    repoId: _r,
    relPath: _p,
    ...outside
  } = patch({ path: "/tmp/scratch/notes.ts", toolCallId: "out" });
  insertPatches(db, [
    patch({ toolCallId: "c1" }),
    outside,
    patch({
      toolCallId: "c3",
      repoId: gone.id,
      path: join(home, "deleted-worktree", "b.ts"),
      relPath: "b.ts",
    }),
  ]);
  return { db, repo, gone, session };
}

describe("computeOutcomes", () => {
  it("classifies per patch and per session-file, with reasons for what it cannot judge", async () => {
    const { db, repo, gone, session } = setup();
    const report = await computeOutcomes({ db, fingerprinter, now: () => T0 + 10_000_000 });
    expect(report).toMatchObject({ repos: 2, reposMissing: 1, reposFailed: 0, patches: 3 });

    const sessionFile = listOutcomes(db, { scope: "session-file", repoId: repo.id });
    expect(sessionFile).toHaveLength(1);
    expect(sessionFile[0]).toMatchObject({
      class: "landed",
      survival: "surviving",
      fracOnDefaultBranch: 1,
      relPath: "src/a.ts",
      commitLagSeconds: 1000,
    });
    expect(sessionFile[0]?.firstCommit?.subject).toBe("feat: agent work");

    const reasons = listOutcomes(db, { scope: "patch" })
      .map((o) => o.unknownReason ?? o.class)
      .sort();
    expect(reasons).toEqual(["landed", "outside-repo", "repo-missing"]);
    expect(getRepo(db, gone.id)?.missing).toBe(true);
    expect(getRepo(db, repo.id)).toMatchObject({
      outcomeControlA: 0,
      outcomeControlB: 0,
      outcomeConfidence: "normal",
    });
    expect(getSession(db, session.id)?.outcomeSummary).toMatchObject({ landed: 1 });
  });

  it("is idempotent: recomputing updates in place and keeps ids", async () => {
    const { db } = setup();
    await computeOutcomes({ db, fingerprinter });
    const first = listOutcomes(db)
      .map((o) => o.id)
      .sort();
    await computeOutcomes({ db, fingerprinter });
    expect(
      listOutcomes(db)
        .map((o) => o.id)
        .sort(),
    ).toEqual(first);
  });

  it("skips a repo whose patches, refs and edited files are unchanged, and redoes it when one changes", async () => {
    const { db, repo } = setup();
    const first = await computeOutcomes({ db, fingerprinter });
    expect(first.reposUnchanged).toBe(0);
    const again = await computeOutcomes({ db, fingerprinter });
    expect(again).toMatchObject({ reposUnchanged: 1, repos: 2 }); // the deleted repo is redone

    // Editing a file the agent touched invalidates the key.
    writeFileSync(join(repo.rootPath, "src", "a.ts"), "import x from 'y';\n// rewritten\n");
    const changed = await computeOutcomes({ db, fingerprinter });
    expect(changed.reposUnchanged).toBe(0);
    expect((await computeOutcomes({ db, fingerprinter, force: true })).reposUnchanged).toBe(0);
  });

  it("marks a repo's outcomes git-error when git cannot read it, without failing the run", async () => {
    const { db, repo } = setup();
    rmSync(join(repo.rootPath, ".git", "HEAD")); // corrupt the repository
    const report = await computeOutcomes({ db, fingerprinter });
    expect(report.reposFailed).toBe(1);
    expect(
      listOutcomes(db, { repoId: repo.id }).every((o) => o.unknownReason === "git-error"),
    ).toBe(true);
  });
});
