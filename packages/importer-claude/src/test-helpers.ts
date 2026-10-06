import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ParsedChunk } from "@landed/core";
import { createLineFingerprinter, parseInstallSecret } from "@landed/core/fingerprint";
import { createClaudeParser } from "./parser";

export const FIXTURES = join(import.meta.dirname, "../../../fixtures/claude/2.1");
export const FINGERPRINTER = createLineFingerprinter(parseInstallSecret("q".repeat(43)));
export const RECEIVED_AT = "2026-10-02T00:00:00.000Z";

/** Fixture text with `{{REPO}}` substituted. */
export function fixture(name: string, repo = "/Users/dev/app"): string {
  return readFileSync(join(FIXTURES, name), "utf8").replaceAll("{{REPO}}", repo);
}

/** Feeds complete lines with their byte offsets, as the ingest reader does. */
export function parseText(
  text: string,
  sourceFile = "/x/session.jsonl",
  startOffset = 0,
): ParsedChunk {
  const parser = createClaudeParser({
    sourceFile,
    fingerprinter: FINGERPRINTER,
    receivedAt: RECEIVED_AT,
  });
  let offset = startOffset;
  for (const line of text.split("\n").slice(0, -1)) {
    parser.push(line, offset);
    offset += Buffer.byteLength(line, "utf8") + 1;
  }
  return parser.finish();
}
