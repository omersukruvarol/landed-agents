import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLineFingerprinter, type LineFingerprinter } from "@landed/core/fingerprint";
import {
  type DatabaseHandle,
  databasePath,
  ensureDataDir,
  openDatabase,
  resolveDataDir,
} from "@landed/db";
import { loadOrCreateInstallSecret } from "@landed/ingest";

/** Where bundled assets live: next to dist/landed.mjs, or in the workspace during development. */
export function assetDir(name: "migrations" | "web"): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates =
    name === "migrations"
      ? [join(here, "migrations"), join(here, "../../../packages/db/migrations")]
      : [join(here, "web"), join(here, "../../web/dist")];
  return candidates.find((c) => existsSync(c));
}

export interface Context {
  dataDir: string;
  dbPath: string;
  handle: DatabaseHandle;
  fingerprinter: LineFingerprinter;
}

export function openContext(): Context {
  const dataDir = ensureDataDir(resolveDataDir());
  const dbPath = databasePath(dataDir);
  const migrations = assetDir("migrations");
  const handle = openDatabase(dbPath, migrations ? { migrationsFolder: migrations } : {});
  const fingerprinter = createLineFingerprinter(loadOrCreateInstallSecret(dataDir));
  return { dataDir, dbPath, handle, fingerprinter };
}
