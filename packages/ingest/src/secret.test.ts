import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  createLineFingerprinter,
  generateInstallSecret,
  parseInstallSecret,
} from "@landed/core/fingerprint";
import { openDatabase } from "@landed/db";
import { describe, expect, it } from "vitest";
import {
  INSTALL_SECRET_FILE,
  InstallSecretMismatchError,
  loadOrCreateInstallSecret,
  verifyInstallSecret,
} from "./secret";
import { tempDir } from "./test-helpers";

describe("loadOrCreateInstallSecret", () => {
  it("creates a 0600 secret once and reuses it", () => {
    const dir = tempDir();
    const a = loadOrCreateInstallSecret(dir);
    const b = loadOrCreateInstallSecret(dir);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    const path = join(dir, INSTALL_SECRET_FILE);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8").trim()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("verifyInstallSecret", () => {
  it("accepts the secret a database was built with and rejects any other", () => {
    const { db } = openDatabase(":memory:");
    const fpr = (s: string) => createLineFingerprinter(parseInstallSecret(s));
    const original = generateInstallSecret();
    verifyInstallSecret(db, fpr(original));
    expect(() => verifyInstallSecret(db, fpr(original))).not.toThrow();
    expect(() => verifyInstallSecret(db, fpr(generateInstallSecret()))).toThrow(
      InstallSecretMismatchError,
    );
  });
});
