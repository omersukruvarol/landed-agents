import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRepoResolver, relativeToRoot } from "./repo-resolver";
import { tempDir } from "./test-helpers";

describe("createRepoResolver", () => {
  it("finds the nearest .git directory or worktree .git file", () => {
    const root = tempDir();
    const repo = join(root, "app");
    const wt = join(root, "app-wt");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(join(repo, "src", "deep"), { recursive: true });
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, ".git"), "gitdir: ../app/.git/worktrees/wt\n");
    const r = createRepoResolver();
    expect(r.rootFor(join(repo, "src", "deep", "a.ts"))).toBe(repo);
    expect(r.rootFor(join(repo, "src"))).toBe(repo);
    expect(r.rootFor(join(wt, "b.ts"))).toBe(wt);
    expect(r.rootFor(join(root, "loose.txt"))).toBeUndefined();
  });

  it("resolves files that no longer exist inside an existing repo, and ignores relative paths", () => {
    const repo = tempDir();
    mkdirSync(join(repo, ".git"));
    const r = createRepoResolver();
    // Deleted files (even in deleted subdirectories) still belong to the enclosing repo.
    expect(r.rootFor(join(repo, "deleted", "x.ts"))).toBe(repo);
    expect(r.rootFor(join(repo, "gone.ts"))).toBe(repo);
    expect(r.rootFor("relative/path.ts")).toBeUndefined();
  });
});

describe("relativeToRoot", () => {
  it("returns posix relative paths inside the root only", () => {
    expect(relativeToRoot("/r/app", "/r/app/src/a.ts")).toBe("src/a.ts");
    expect(relativeToRoot("/r/app", "/r/app")).toBeUndefined();
    expect(relativeToRoot("/r/app", "/r/other/a.ts")).toBeUndefined();
  });
});
