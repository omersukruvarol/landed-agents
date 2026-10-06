/**
 * Golden outcome tests (PRD §24 Phase 5): real git repositories scripted with pinned commit times,
 * each with a known expected classification. Changing a rule must update these and bump
 * ENGINE_VERSION.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fingerprintsAt, ignoredPaths, readRepoHistory } from "@landed/git-index";
import { describe, expect, it } from "vitest";
import { classify, DEFAULT_CONFIG, netSessionFile } from "./classify";
import { selfCheck } from "./self-check";
import { at, FINGERPRINTER, fpsOf, T0, TestRepo } from "./test-repo";

const BASE = ["import { config } from './config';"];
const AGENT = [
  "const retries = computeRetries(config);",
  "export function backoff(attempt: number) {",
  "return Math.min(30000, 2 ** attempt * 100);",
];
const REL = "src/retry.ts";
const EDIT = 1000; // the agent's edit happens 1000 s after T0

async function evaluate(repo: TestRepo, lines = AGENT, editAt = EDIT, rel = REL) {
  const history = await readRepoHistory(repo.root, new Set([rel]), T0 - 86_400, FINGERPRINTER);
  const head =
    (await fingerprintsAt(repo.root, "HEAD", [rel], FINGERPRINTER)).get(rel) ?? undefined;
  const path = join(repo.root, rel);
  const workingTree = existsSync(path)
    ? new Set(fpsOf(readFileSync(path, "utf8").split("\n")))
    : undefined;
  const ignored = (await ignoredPaths(repo.root, [rel])).has(rel);
  return classify(fpsOf(lines), at(editAt), rel, history, {
    ...(head ? { head } : {}),
    ...(workingTree ? { workingTree } : {}),
    ...(ignored ? { ignored } : {}),
  });
}

function base(): TestRepo {
  const repo = new TestRepo();
  repo.write(REL, BASE).commit(0, "initial");
  return repo;
}

describe("golden outcomes", () => {
  it("landed: committed on the default branch after the edit, still present", async () => {
    const repo = base();
    const sha = repo.write(REL, [...BASE, ...AGENT]).commit(2000, "feat: retries");
    const r = await evaluate(repo);
    expect(r).toMatchObject({
      class: "landed",
      survival: "surviving",
      fracCommitted: 1,
      fracOnDefaultBranch: 1,
      fracInWorkingTree: 1,
    });
    expect(r.firstCommit).toMatchObject({ sha, timeMs: at(2000), subject: "feat: retries" });
    expect(r.commitLagMs).toBe(1_000_000);
  });

  it("uncommitted: present in the working tree only", async () => {
    const repo = base();
    repo.write(REL, [...BASE, ...AGENT]);
    expect(await evaluate(repo)).toMatchObject({
      class: "uncommitted",
      survival: "unknown",
      fracCommitted: 0,
      fracInWorkingTree: 1,
    });
  });

  it("lost: neither committed nor in the working tree", async () => {
    const repo = base();
    repo.write(REL, [...BASE, ...AGENT]).write(REL, BASE); // edited, then discarded
    expect(await evaluate(repo)).toMatchObject({
      class: "lost",
      fracCommitted: 0,
      fracInWorkingTree: 0,
    });
  });

  it("partial: some lines matched, below both thresholds", async () => {
    const repo = base();
    repo.write(REL, [...BASE, AGENT[0] as string]).commit(2000);
    const r = await evaluate(repo);
    expect(r.class).toBe("partial");
    expect(r.fracCommitted).toBeCloseTo(1 / 3);
  });

  it("churned: landed on the default branch, later removed", async () => {
    const repo = base();
    repo.write(REL, [...BASE, ...AGENT]).commit(2000);
    repo.write(REL, BASE).commit(3000, "refactor: drop retries");
    expect(await evaluate(repo)).toMatchObject({ class: "landed", survival: "churned" });
  });

  it("reverted: the landing commit was reverted", async () => {
    const repo = base();
    const sha = repo.write(REL, [...BASE, ...AGENT]).commit(2000);
    repo.git(3000, "revert", "--no-edit", sha);
    expect(await evaluate(repo)).toMatchObject({ class: "landed", survival: "reverted" });
  });

  it("squash-merged: counts as on the default branch", async () => {
    const repo = base();
    repo.git(1500, "checkout", "-q", "-b", "feat");
    const featSha = repo.write(REL, [...BASE, ...AGENT]).commit(2000);
    repo.git(2500, "checkout", "-q", "main");
    repo.git(3000, "merge", "--squash", "feat");
    repo.commit(3000, "feat: retries (#12)");
    const r = await evaluate(repo);
    expect(r).toMatchObject({ class: "landed", fracOnDefaultBranch: 1, survival: "surviving" });
    expect(r.firstCommit?.sha).toBe(featSha); // earliest landing, on the branch
  });

  it("local default branch ahead of a stale origin/main still counts as merged", async () => {
    const repo = base();
    repo.git(100, "update-ref", "refs/remotes/origin/main", "HEAD");
    repo.git(100, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    repo.write(REL, [...BASE, ...AGENT]).commit(2000); // committed locally, not pushed
    expect(await evaluate(repo)).toMatchObject({
      class: "landed",
      fracOnDefaultBranch: 1,
      survival: "surviving",
    });
  });

  it("work saved only in a git stash has not landed", async () => {
    const repo = base();
    repo.write(REL, [...BASE, ...AGENT]);
    repo.git(2000, "stash", "push", "--include-untracked", "-q");
    expect(await evaluate(repo)).toMatchObject({ class: "lost", fracCommitted: 0 });
  });

  it("side branch only: landed but not merged, survival unknown while HEAD is elsewhere", async () => {
    const repo = base();
    repo.git(1500, "checkout", "-q", "-b", "feat");
    repo.write(REL, [...BASE, ...AGENT]).commit(2000);
    repo.git(2500, "checkout", "-q", "main");
    const r = await evaluate(repo);
    expect(r).toMatchObject({
      class: "landed",
      fracOnDefaultBranch: 0,
      survival: "unknown",
    });
    expect(r.firstCommit?.branch).toBe("feat"); // from git, not from the session
  });

  it("working trunk: a checked-out branch carrying work for over 14 days counts as merged", async () => {
    const repo = base();
    repo.git(500, "checkout", "-q", "-b", "develop");
    repo.write("src/a.ts", ["export const firstOnDevelop = 1;"]).commit(600);
    repo.write(REL, [...BASE, ...AGENT]).commit(2000);
    repo.write("src/b.ts", ["export const fifteenDaysLater = 2;"]).commit(600 + 15 * 86_400);
    const r = await evaluate(repo);
    expect(r).toMatchObject({ class: "landed", fracOnDefaultBranch: 1, survival: "surviving" });
    expect(r.firstCommit?.branch).toBeUndefined();
  });

  it("a checked-out feature branch younger than 14 days is still unmerged", async () => {
    const repo = base();
    repo.git(500, "checkout", "-q", "-b", "agent/feature");
    repo.write(REL, [...BASE, ...AGENT]).commit(2000);
    repo.write("src/b.ts", ["export const fiveDaysLater = 2;"]).commit(2000 + 5 * 86_400);
    const r = await evaluate(repo);
    expect(r).toMatchObject({ class: "landed", fracOnDefaultBranch: 0 });
    expect(r.firstCommit?.branch).toBe("agent/feature");
  });

  it("gitignored: an agent's edit to an ignored file is unknown, not uncommitted", async () => {
    const repo = base();
    repo.write(".gitignore", [".env.local"]).commit(100);
    repo.write(".env.local", ["SERVICE_URL=http://localhost:8080/api/v1"]);
    expect(
      await evaluate(repo, ["SERVICE_URL=http://localhost:8080/api/v1"], EDIT, ".env.local"),
    ).toMatchObject({ class: "unknown", unknownReason: "gitignored" });
  });

  it("a tracked file matching an ignore pattern is judged normally", async () => {
    const repo = base();
    repo.write("config/app.env", ["APP_NAME=landed-demo-service"]).commit(100);
    repo.write(".gitignore", ["*.env"]).commit(200);
    repo.write("config/app.env", ["APP_NAME=landed-demo-service", "APP_REGION=eu-central-1"]);
    expect(await evaluate(repo, ["APP_REGION=eu-central-1"], EDIT, "config/app.env")).toMatchObject(
      { class: "uncommitted" },
    );
  });

  it("rebased: the rewritten commit counts with its new committer time", async () => {
    const repo = base();
    repo.git(1500, "checkout", "-q", "-b", "feat");
    repo.write(REL, [...BASE, ...AGENT]).commit(2000);
    repo.git(2100, "checkout", "-q", "main");
    repo.write("README.md", ["# app"]).commit(2200);
    repo.git(3000, "checkout", "-q", "feat");
    repo.git(3000, "rebase", "-q", "main");
    repo.git(3100, "checkout", "-q", "main");
    repo.git(3100, "merge", "-q", "--ff-only", "feat");
    const r = await evaluate(repo);
    expect(r).toMatchObject({ class: "landed", fracOnDefaultBranch: 1, survival: "surviving" });
    expect(r.firstCommit?.timeMs).toBe(at(3000));
  });

  it("formatter changes: whitespace survives, a quote-style change does not (known limitation)", async () => {
    const repo = base();
    const lines = [
      "const greeting = render('hello', name);",
      "export const total = items.reduce(add, 0);",
    ];
    repo
      .write(REL, [
        ...BASE,
        "    const   greeting = render('hello',   name);",
        "export const total = items.reduce(add, 0);",
      ])
      .commit(2000);
    expect(await evaluate(repo, lines)).toMatchObject({ class: "landed", fracCommitted: 1 });
    const repo2 = base();
    repo2
      .write(REL, [
        ...BASE,
        'const greeting = render("hello", name);',
        'export const greeting2 = render("x", y);',
      ])
      .commit(2000);
    expect(await evaluate(repo2, lines)).toMatchObject({ class: "lost" });
  });

  it("pre-existing lines committed before the edit do not count as landing", async () => {
    const repo = new TestRepo();
    repo.write(REL, [...BASE, ...AGENT]).commit(0);
    repo.write(REL, BASE).commit(500);
    // The agent re-adds the same lines at EDIT and nothing is committed afterwards.
    repo.write(REL, [...BASE, ...AGENT]);
    expect(await evaluate(repo)).toMatchObject({ class: "uncommitted", fracCommitted: 0 });
  });

  it("allows 120 s of clock slack, no more", async () => {
    const within = base();
    within.write(REL, [...BASE, ...AGENT]).commit(EDIT - 60);
    expect((await evaluate(within)).class).toBe("landed");
    const beyond = base();
    beyond.write(REL, [...BASE, ...AGENT]).commit(EDIT - DEFAULT_CONFIG.slackMs / 1000 - 60);
    beyond.write(REL, BASE).commit(EDIT + 100);
    expect((await evaluate(beyond)).class).toBe("lost");
  });

  it("an edit with no significant lines is unknown/no-signal", async () => {
    const repo = base();
    expect(await evaluate(repo, ["}", "  ", "});"])).toMatchObject({
      class: "unknown",
      unknownReason: "no-signal",
    });
  });

  it("indexes files whose names contain spaces and non-ASCII letters", async () => {
    const repo = base();
    const rel = "my project/şehir ayarları.ts";
    repo.write(rel, AGENT).commit(2000);
    expect(await evaluate(repo, AGENT, EDIT, rel)).toMatchObject({
      class: "landed",
      fracCommitted: 1,
    });
  });
});

describe("session-file net scope", () => {
  it("drops lines a session added and then removed itself", async () => {
    const [a, b, c] = AGENT as [string, string, string];
    const net = netSessionFile([
      { timeMs: at(1000), addedLineFps: fpsOf([a, b]), removedLineFps: [] },
      { timeMs: at(1100), addedLineFps: fpsOf([c]), removedLineFps: fpsOf([b]) },
    ]);
    expect(net).toEqual({ fps: fpsOf([a, c]), atMs: at(1000) });
    const repo = base();
    repo.write(REL, [...BASE, a, c]).commit(2000);
    const history = await readRepoHistory(repo.root, new Set([REL]), T0 - 86_400, FINGERPRINTER);
    expect(classify(net?.fps ?? [], net?.atMs ?? 0, REL, history, {}).fracCommitted).toBe(1);
  });
});

describe("selfCheck", () => {
  it("flags repos where edits mostly match commits that predate them", async () => {
    const repo = new TestRepo();
    const files = Array.from({ length: 25 }, (_, i) => `src/gen${i}.ts`);
    for (const f of files)
      repo.write(f, [`export const generated${f.length} = createBoilerplate("${f}");`]);
    repo.commit(0, "generated");
    const history = await readRepoHistory(repo.root, new Set(files), T0 - 86_400, FINGERPRINTER);
    const patches = files.map((f) => ({
      relPath: f,
      atMs: at(EDIT),
      fps: fpsOf([`export const generated${f.length} = createBoilerplate("${f}");`]),
    }));
    const check = selfCheck(patches, history);
    expect(check).toMatchObject({ controlA: 1, controlB: 0, sample: 25, confidence: "low" });
  });

  it("is normal when edits do not match earlier or unrelated commits", async () => {
    const repo = base();
    repo
      .write(REL, [...BASE, ...AGENT])
      .write("src/other.ts", ["export const unrelatedThing = 42;"])
      .commit(2000);
    const history = await readRepoHistory(
      repo.root,
      new Set([REL, "src/other.ts"]),
      T0 - 86_400,
      FINGERPRINTER,
    );
    const patches = Array.from({ length: 20 }, () => ({
      relPath: REL,
      atMs: at(EDIT),
      fps: fpsOf(AGENT),
    }));
    expect(selfCheck(patches, history)).toMatchObject({
      controlA: 0,
      controlB: 0,
      confidence: "normal",
    });
  });
});
