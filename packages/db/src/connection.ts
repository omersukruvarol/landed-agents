import { chmodSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { DATA_FILE_MODE } from "./paths";
import * as schema from "./schema";

export type LandedDb = BetterSQLite3Database<typeof schema>;

export interface DatabaseHandle {
  db: LandedDb;
  /** Underlying connection, for pragmas and diagnostics only. */
  sqlite: Database.Database;
  path: string;
  close(): void;
}

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));
const IN_MEMORY = ":memory:";

/**
 * Opens (and creates) the database, applies pragmas and pending migrations, and restricts file
 * permissions to the current user. Pass ":memory:" for tests.
 */
export interface OpenOptions {
  /** Where the SQL migrations live; bundled apps ship their own copy. */
  migrationsFolder?: string;
}

export function openDatabase(path: string, options: OpenOptions = {}): DatabaseHandle {
  const sqlite = new Database(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  if (path !== IN_MEMORY) {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("synchronous = NORMAL");
  }
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: options.migrationsFolder ?? MIGRATIONS_DIR });
  if (path !== IN_MEMORY) restrictPermissions(path);
  return { db, sqlite, path, close: () => sqlite.close() };
}

function restrictPermissions(path: string): void {
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(file)) chmodSync(file, DATA_FILE_MODE);
  }
}
