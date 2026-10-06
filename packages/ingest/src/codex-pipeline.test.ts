import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLineFingerprinter, parseInstallSecret } from "@landed/core/fingerprint";
import {
  getSessionByProviderId,
  listEvents,
  listPatches,
  listSessions,
  openDatabase,
} from "@landed/db";
import { describe, expect, it } from "vitest";
import { codexImporter } from "./codex";
import { importSource } from "./pipeline";
import { tempDir } from "./test-helpers";

const FIXTURES = join(import.meta.dirname, "../../../fixtures/codex/0.154");
const MAIN = "019a0000-aaaa-7000-8000-00000000000a";
const FORK = "019a0000-bbbb-7000-8000-00000000000b";
const MAIN_FILE = `rollout-2026-09-29T10-00-00-${MAIN}.jsonl`;
const FORK_FILE = `rollout-2026-09-29T10-00-16-${FORK}.jsonl`;
const NOW = Date.parse("2026-10-02T00:00:00.000Z");
const fingerprinter = createLineFingerprinter(parseInstallSecret("q".repeat(43)));

function setup() {
  const home = tempDir();
  const repo = join(home, "app");
  mkdirSync(join(repo, ".git"), { recursive: true });
  const sessions = join(home, "sessions");
  const day = join(sessions, "2026", "09", "29");
  mkdirSync(day, { recursive: true });
  for (const f of [MAIN_FILE, FORK_FILE]) {
    writeFileSync(
      join(day, f),
      readFileSync(join(FIXTURES, f), "utf8").replaceAll("{{REPO}}", repo),
    );
  }
  const { db, sqlite } = openDatabase(":memory:");
  const run = () =>
    importSource(codexImporter, { db, fingerprinter, root: sessions, now: () => NOW });
  return { db, sqlite, repo, mainFile: join(day, MAIN_FILE), run };
}

describe("importSource(codex)", () => {
  it("imports rollouts with parent links, exit codes, patches and reconciled usage", async () => {
    const { db, repo, run } = setup();
    const report = await run();
    expect(report).toMatchObject({
      filesSeen: 2,
      filesRead: 2,
      failures: 1,
      patches: { inserted: 3, duplicates: 0 },
    });

    const main = getSessionByProviderId(db, "codex", MAIN);
    const fork = getSessionByProviderId(db, "codex", FORK);
    expect(main).toMatchObject({
      status: "completed",
      repoRoot: repo,
      projectName: "app",
      gitBranchStart: "feat/codex",
      model: "gpt-5.5-codex",
      failureCount: 2, // failed command + failed MCP call; the declined patch is not a failure
      changedFileCount: 2,
      inputTokens: 300,
      cachedInputTokens: 900,
      outputTokens: 400,
      reasoningTokens: 80,
      usageCoverage: "complete",
    });
    expect(fork).toMatchObject({
      parentSessionId: main?.id,
      status: "interrupted",
      changedFileCount: 1,
      outputTokens: 150,
    });

    const failed = listEvents(db, { eventTypes: ["command.failed"] });
    expect(failed[0]?.command?.exitCode).toBe(1);
    expect(new Set(listPatches(db).map((p) => p.relPath))).toEqual(
      new Set(["src/retry.ts", "src/added.ts", "src/config.ts"]),
    );
  });

  it("is idempotent and picks up appended lines", async () => {
    const { db, mainFile, run } = setup();
    await run();
    expect(await run()).toMatchObject({ filesRead: 0, events: { inserted: 0 } });
    appendFileSync(
      mainFile,
      `${JSON.stringify({ timestamp: "2026-09-29T11:00:00.000Z", ordinal: 100, type: "event_msg", payload: { type: "turn_aborted", turn_id: "t2", reason: "interrupted" } })}\n`,
    );
    expect(await run()).toMatchObject({ filesRead: 1, linesRead: 1, events: { inserted: 1 } });
    expect(getSessionByProviderId(db, "codex", MAIN)?.status).toBe("interrupted");
    expect(listSessions(db)).toHaveLength(2);
  });

  it("stores no canary content anywhere", async () => {
    const { sqlite, run } = setup();
    await run();
    const tables = sqlite
      .prepare("select name from sqlite_master where type='table' and name not like 'sqlite%'")
      .all() as { name: string }[];
    const dump = tables
      .map(({ name }) => JSON.stringify(sqlite.prepare(`select * from "${name}"`).all()))
      .join("\n");
    expect(dump).not.toMatch(/CANARY_/);
    expect(dump).not.toContain("sk-");
  });
});
