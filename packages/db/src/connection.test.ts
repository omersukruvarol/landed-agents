import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./connection";
import { databasePath, ensureDataDir, resolveDataDir } from "./paths";
import { getSetting, setSetting } from "./repositories/settings";
import { memoryDb } from "./test-helpers";

const TABLES = [
  "agent_patches",
  "app_settings",
  "collisions",
  "events",
  "git_line_index",
  "ingestion_failures",
  "insights",
  "open_loops",
  "outcomes",
  "patch_line_fps",
  "repos",
  "sessions",
  "source_checkpoints",
  "sources",
  "summaries",
  "thread_sessions",
  "threads",
  "usage_records",
];

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "landed-db-test-"));
  tmpDirs.push(d);
  return d;
}

describe("openDatabase", () => {
  it("creates every PRD table on an empty database", () => {
    const { sqlite, close } = memoryDb();
    const names = sqlite
      .prepare(
        "select name from sqlite_master where type='table' and name not like '\\_%' escape '\\' and name not like 'sqlite%'",
      )
      .all()
      .map((r) => (r as { name: string }).name)
      .sort();
    expect(names).toEqual(TABLES);
    close();
  });

  it("creates the PRD-required indexes", () => {
    const { sqlite, close } = memoryDb();
    const idx = sqlite
      .prepare("select name, sql from sqlite_master where type='index' and sql is not null")
      .all() as { name: string; sql: string }[];
    const byName = new Map(idx.map((i) => [i.name, i.sql]));
    expect(byName.get("events_fingerprint_uq")).toMatch(/UNIQUE INDEX/);
    expect(byName.get("sessions_provider_session_uq")).toMatch(/UNIQUE INDEX/);
    expect(byName.get("usage_records_session_key_uq")).toMatch(/UNIQUE INDEX/);
    for (const name of [
      "events_session_ts_idx",
      "events_ts_idx",
      "events_type_ts_idx",
      "sessions_started_idx",
      "sessions_repo_idx",
      "agent_patches_session_idx",
      "agent_patches_repo_path_idx",
      "outcomes_session_scope_idx",
      "open_loops_state_repo_idx",
      "insights_session_type_idx",
    ]) {
      expect(byName.has(name), name).toBe(true);
    }
    close();
  });

  it("enables foreign keys", () => {
    const { sqlite, close } = memoryDb();
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    close();
  });

  it("is safe to reopen: migrations apply once and data survives", () => {
    const path = databasePath(ensureDataDir(join(tempDir(), "data")));
    const first = openDatabase(path);
    setSetting(first.db, "retention", "30d");
    first.close();
    const second = openDatabase(path);
    expect(getSetting(second.db, "retention")).toBe("30d");
    expect(second.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    second.close();
  });

  it("restricts data dir to 0700 and database files to 0600", () => {
    const dir = ensureDataDir(join(tempDir(), "nested", "data"));
    const handle = openDatabase(databasePath(dir));
    setSetting(handle.db, "k", 1); // force WAL/SHM files into existence
    handle.close();
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(databasePath(dir)).mode & 0o777).toBe(0o600);
  });
});

describe("resolveDataDir", () => {
  it("honors LANDED_DATA_DIR", () => {
    expect(resolveDataDir({ LANDED_DATA_DIR: "/tmp/x" })).toBe("/tmp/x");
  });

  it("defaults to a per-user location", () => {
    expect(resolveDataDir({})).toMatch(/Landed|landed/);
  });
});
