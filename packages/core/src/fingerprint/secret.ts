import { randomBytes } from "node:crypto";

/** Minimum key size for line-fingerprint HMACs. */
export const INSTALL_SECRET_BYTES = 32;

/**
 * Per-install key for fingerprints and remote hashes. Generated once, stored in the data dir with
 * 0600 permissions, never transmitted (PRD §11.4). Without it, fingerprints cannot be reversed by
 * hashing candidate lines.
 */
export interface InstallSecret {
  readonly bytes: Uint8Array;
}

/** New random secret, encoded as base64url for storage. */
export function generateInstallSecret(): string {
  return randomBytes(INSTALL_SECRET_BYTES).toString("base64url");
}

export function parseInstallSecret(encoded: string): InstallSecret {
  const trimmed = encoded.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new TypeError("install secret must be base64url");
  }
  const bytes = Buffer.from(trimmed, "base64url");
  if (bytes.length < INSTALL_SECRET_BYTES) {
    throw new RangeError(`install secret must be at least ${INSTALL_SECRET_BYTES} bytes`);
  }
  return Object.freeze({ bytes: new Uint8Array(bytes) });
}
