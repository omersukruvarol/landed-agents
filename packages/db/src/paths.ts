import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export const DATA_DIR_MODE = 0o700;
export const DATA_FILE_MODE = 0o600;

/**
 * Where Landed keeps its database and install secret. `LANDED_DATA_DIR` overrides the
 * OS default (macOS: ~/Library/Application Support/Landed).
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.LANDED_DATA_DIR) return env.LANDED_DATA_DIR;
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "Landed");
  return join(env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "landed");
}

/** Creates the data dir if needed and makes it user-only (PRD §23). */
export function ensureDataDir(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: DATA_DIR_MODE });
  chmodSync(dir, DATA_DIR_MODE);
  return dir;
}

export function databasePath(dataDir: string): string {
  return join(dataDir, "landed.db");
}
