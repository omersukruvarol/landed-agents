import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  generateInstallSecret,
  type InstallSecret,
  type LineFingerprinter,
  parseInstallSecret,
} from "@landed/core/fingerprint";
import { getSetting, type LandedDb, setSetting } from "@landed/db";

export const INSTALL_SECRET_FILE = "install-secret";

/**
 * Loads the per-install fingerprint key from the data dir, creating it (0600) on first use.
 * Losing it makes stored fingerprints unmatchable, so it is never rotated implicitly.
 */
export function loadOrCreateInstallSecret(dataDir: string): InstallSecret {
  const path = join(dataDir, INSTALL_SECRET_FILE);
  if (!existsSync(path)) {
    try {
      writeFileSync(path, `${generateInstallSecret()}\n`, { mode: 0o600, flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; // a concurrent run created it
    }
  }
  chmodSync(path, 0o600);
  return parseInstallSecret(readFileSync(path, "utf8"));
}

const SECRET_CHECK_SETTING = "installSecretCheck";
const SECRET_CHECK_LINE = "landed install secret check line";

export class InstallSecretMismatchError extends Error {
  constructor() {
    super(
      "This database was built with a different install secret, so its fingerprints cannot be matched. " +
        "Restore the original install-secret file, or reset the data with `landed data reset`.",
    );
    this.name = "InstallSecretMismatchError";
  }
}

/**
 * Guards against silently wrong outcomes: stored fingerprints only match git fingerprints made
 * with the same secret. The first use records a check fingerprint; later uses must reproduce it.
 */
export function verifyInstallSecret(
  db: LandedDb,
  fingerprinter: LineFingerprinter,
  now: number = Date.now(),
): void {
  const check = fingerprinter.fingerprint(SECRET_CHECK_LINE);
  const stored = getSetting<string>(db, SECRET_CHECK_SETTING);
  if (stored === undefined) setSetting(db, SECRET_CHECK_SETTING, check, now);
  else if (stored !== check) throw new InstallSecretMismatchError();
}
