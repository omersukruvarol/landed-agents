import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ParsedChunk } from "@landed/core";
import { createLineFingerprinter, parseInstallSecret } from "@landed/core/fingerprint";
import { createCodexParser } from "./parser";

export const FIXTURES = join(import.meta.dirname, "../../../fixtures/codex/0.154");
export const MAIN = "019a0000-aaaa-7000-8000-00000000000a";
export const FORK = "019a0000-bbbb-7000-8000-00000000000b";
export const MAIN_FILE = `rollout-2026-09-29T10-00-00-${MAIN}.jsonl`;
export const FORK_FILE = `rollout-2026-09-29T10-00-16-${FORK}.jsonl`;
export const FINGERPRINTER = createLineFingerprinter(parseInstallSecret("q".repeat(43)));

export function fixture(name: string, repo = "/Users/dev/app"): string {
  return readFileSync(join(FIXTURES, name), "utf8").replaceAll("{{REPO}}", repo);
}

/** Feeds complete lines with byte offsets, like the ingest reader. `skip` drops leading lines. */
export function parseText(text: string, sourceFile: string, skip = 0): ParsedChunk {
  const parser = createCodexParser({
    sourceFile,
    fingerprinter: FINGERPRINTER,
    receivedAt: "2026-10-02T00:00:00.000Z",
  });
  let offset = 0;
  text
    .split("\n")
    .slice(0, -1)
    .forEach((line, i) => {
      if (i >= skip) parser.push(line, offset);
      offset += Buffer.byteLength(line, "utf8") + 1;
    });
  return parser.finish();
}
