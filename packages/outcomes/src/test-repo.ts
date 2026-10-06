import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createLineFingerprinter, parseInstallSecret } from "@landed/core/fingerprint";
import { afterEach } from "vitest";

export const FINGERPRINTER = createLineFingerprinter(parseInstallSecret("q".repeat(43)));
/** Synthetic timeline origin; tests express times as seconds after it. */
export const T0 = Date.parse("2026-09-01T00:00:00.000Z") / 1000;
export const at = (s: number) => (T0 + s) * 1000;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * A scripted git repository for golden tests. Commit times are pinned, and the user's global and
 * system git config (hooks, signing) are ignored so tests are hermetic.
 */
export class TestRepo {
  readonly root: string;

  constructor(defaultBranch = "main") {
    this.root = mkdtempSync(join(tmpdir(), "landed-golden-"));
    dirs.push(this.root);
    this.git(0, "init", "-q", "-b", defaultBranch);
  }

  git(atSec: number, ...args: string[]): string {
    const date = `${T0 + atSec} +0000`;
    return execFileSync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      {
        cwd: this.root,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: this.root,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_AUTHOR_DATE: date,
          GIT_COMMITTER_DATE: date,
          GIT_EDITOR: "true",
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  }

  write(rel: string, lines: string[]): this {
    const p = join(this.root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `${lines.join("\n")}\n`);
    return this;
  }

  commit(atSec: number, message = `commit at ${atSec}`): string {
    this.git(atSec, "add", "-A");
    this.git(atSec, "commit", "-q", "--allow-empty", "-m", message);
    return this.git(atSec, "rev-parse", "HEAD");
  }
}

export const fpsOf = (lines: string[]) => FINGERPRINTER.fingerprintAll(lines);
