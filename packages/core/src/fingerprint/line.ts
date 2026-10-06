import { createHmac } from "node:crypto";
import { LINE_FP_HEX_LENGTH } from "../primitives";
import type { InstallSecret } from "./secret";

/** Lines shorter than this (in code points, after normalization) carry too little signal. */
export const MIN_SIGNIFICANT_LENGTH = 8;

const WHITESPACE_RUN = /\s+/gu;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * Canonical form of a source line for matching: Unicode NFC, every whitespace run collapsed to a
 * single space, trimmed. Must stay identical between patch extraction and git indexing.
 */
export function normalizeLine(line: string): string {
  return line.normalize("NFC").replace(WHITESPACE_RUN, " ").trim();
}

/** A line is significant when it is long enough and contains at least one letter or digit. */
export function isSignificantLine(line: string): boolean {
  const n = normalizeLine(line);
  return codePointLength(n) >= MIN_SIGNIFICANT_LENGTH && LETTER_OR_DIGIT.test(n);
}

function codePointLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export interface LineFingerprinter {
  /** Fingerprint of a line, or `null` when the line is not significant. */
  fingerprint(line: string): string | null;
  /** Unique fingerprints of the significant lines, in first-occurrence order. */
  fingerprintAll(lines: Iterable<string>): string[];
  /**
   * Fingerprints for a diff. Added lines whose normalized form also appears among the removed
   * lines were only moved or re-indented, so they are not counted as new work.
   */
  fingerprintDiff(
    added: Iterable<string>,
    removed: Iterable<string>,
  ): { added: string[]; removed: string[] };
}

/**
 * Keyed fingerprints: HMAC-SHA256(secret, normalizeLine(line)), truncated to 64 bits (hex).
 * Only fingerprints are ever persisted — never line text (PRD §11.4, §23).
 */
export function createLineFingerprinter(secret: InstallSecret): LineFingerprinter {
  const key = secret.bytes;

  const hash = (normalized: string): string =>
    createHmac("sha256", key).update(normalized, "utf8").digest("hex").slice(0, LINE_FP_HEX_LENGTH);

  const significantNormalized = (lines: Iterable<string>): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const line of lines) {
      const n = normalizeLine(line);
      if (seen.has(n) || codePointLength(n) < MIN_SIGNIFICANT_LENGTH || !LETTER_OR_DIGIT.test(n)) {
        continue;
      }
      seen.add(n);
      out.push(n);
    }
    return out;
  };

  return {
    fingerprint(line) {
      return isSignificantLine(line) ? hash(normalizeLine(line)) : null;
    },
    fingerprintAll(lines) {
      return significantNormalized(lines).map(hash);
    },
    fingerprintDiff(added, removed) {
      const removedNorm = significantNormalized(removed);
      const removedSet = new Set(removedNorm);
      const addedNorm = significantNormalized(added).filter((n) => !removedSet.has(n));
      return { added: addedNorm.map(hash), removed: removedNorm.map(hash) };
    },
  };
}
