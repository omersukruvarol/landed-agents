import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { catFiles, GitError, gitLines } from "./git";
import { parseHeaderPath, resolveDefaultBranch } from "./repo";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo(branch = "main"): string {
  const root = mkdtempSync(join(tmpdir(), "landed-git-"));
  dirs.push(root);
  const git = (...args: string[]) =>
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
        },
        stdio: "ignore",
      },
    );
  git("init", "-q", "-b", branch);
  writeFileSync(join(root, "a.txt"), "hello world line\n");
  writeFileSync(join(root, "bin.dat"), Buffer.from([0, 1, 2, 3]));
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return root;
}

describe("git runner", () => {
  it("refuses subcommands that could write", async () => {
    const root = repo();
    for (const sub of ["commit", "push", "checkout", "gc", "config"]) {
      await expect(gitLines(root, [sub], () => {})).rejects.toBeInstanceOf(GitError);
    }
  });

  it("reads blobs in one batch; missing and binary files are null", async () => {
    const root = repo();
    const out = await catFiles(root, ["HEAD:a.txt", "HEAD:nope.txt", "HEAD:bin.dat"]);
    expect(out.get("HEAD:a.txt")).toBe("hello world line\n");
    expect(out.get("HEAD:nope.txt")).toBeNull();
    expect(out.get("HEAD:bin.dat")).toBeNull();
  });

  it("times out long commands", async () => {
    const root = repo();
    await expect(
      gitLines(root, ["log", "--all"], () => {}, { timeoutMs: 0 }),
    ).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("resolveDefaultBranch", () => {
  it("prefers origin/HEAD, then main, then master, then the current branch", async () => {
    const main = repo("main");
    expect(await resolveDefaultBranch(main)).toBe("main");
    const master = repo("master");
    expect(await resolveDefaultBranch(master)).toBe("master");
    const trunk = repo("trunk");
    expect(await resolveDefaultBranch(trunk)).toBe("trunk");
    execFileSync("git", ["update-ref", "refs/remotes/origin/develop", "HEAD"], { cwd: trunk });
    execFileSync(
      "git",
      ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop"],
      { cwd: trunk },
    );
    expect(await resolveDefaultBranch(trunk)).toBe("origin/develop");
  });
});

describe("parseHeaderPath", () => {
  it.each([
    ["b/src/a.ts", "src/a.ts"],
    ["b/my project/x.ts", "my project/x.ts"],
    ["b/my project/x.ts\t", "my project/x.ts"],
    ['"b/tab\\there.ts"', "tab\there.ts"],
    ['"b/\\305\\237ehir.ts"', "şehir.ts"],
    ["/dev/null", undefined],
  ])("%s -> %s", (raw, expected) => {
    expect(parseHeaderPath(raw)).toBe(expected);
  });
});
