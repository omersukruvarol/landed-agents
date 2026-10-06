import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { streamCompleteLines } from "./read-lines";

/** Collects streamed lines, for assertions. */
async function readCompleteLines(path: string, start: number, end: number) {
  const lines: { text: string; offset: number }[] = [];
  const endOffset = await streamCompleteLines(path, start, end, (text, offset) =>
    lines.push({ text, offset }),
  );
  return { lines, endOffset };
}

import { tempDir } from "./test-helpers";

function file(content: string | Buffer): string {
  const p = join(tempDir(), "f.jsonl");
  writeFileSync(p, content);
  return p;
}

describe("readCompleteLines", () => {
  it("returns complete lines with byte offsets, including multibyte text", async () => {
    const text = 'a\n{"t":"şehir 😀"}\nlast\n';
    const { lines, endOffset } = await readCompleteLines(file(text), 0, Buffer.byteLength(text));
    expect(lines.map((l) => l.text)).toEqual(["a", '{"t":"şehir 😀"}', "last"]);
    expect(lines.map((l) => l.offset)).toEqual([
      0,
      2,
      2 + Buffer.byteLength('{"t":"şehir 😀"}') + 1,
    ]);
    expect(endOffset).toBe(Buffer.byteLength(text));
  });

  it("leaves a trailing partial line for the next pass", async () => {
    const p = file("one\ntwo\npart");
    const r = await readCompleteLines(p, 0, 12);
    expect(r.lines.map((l) => l.text)).toEqual(["one", "two"]);
    expect(r.endOffset).toBe(8);
  });

  it("resumes from an offset and respects the end bound", async () => {
    const p = file("one\ntwo\nthree\nfour\n");
    const r = await readCompleteLines(p, 4, 14); // "two\nthree\n"
    expect(r.lines).toEqual([
      { text: "two", offset: 4 },
      { text: "three", offset: 8 },
    ]);
    expect(r.endOffset).toBe(14);
  });

  it("strips CR from CRLF lines", async () => {
    const p = file("a\r\nb\r\n");
    expect((await readCompleteLines(p, 0, 6)).lines.map((l) => l.text)).toEqual(["a", "b"]);
  });

  it("handles lines that span the 1 MiB read chunks", async () => {
    const big = "x".repeat((1 << 20) + 123);
    const p = file(`${big}\nshort\n`);
    const r = await readCompleteLines(p, 0, big.length + 7);
    expect(r.lines.map((l) => l.text.length)).toEqual([big.length, 5]);
    expect(r.lines[1]?.offset).toBe(big.length + 1);
  });

  it("returns nothing for an empty range", async () => {
    const p = file("abc\n");
    expect(await readCompleteLines(p, 4, 4)).toEqual({ lines: [], endOffset: 4 });
  });
});

describe("streamCompleteLines — skipping by head", () => {
  it("skips lines by their head, including lines far larger than a read chunk", async () => {
    const huge = `{"type":"skip","pad":"${"y".repeat(3 << 20)}"}`;
    const p = file(`{"type":"keep","n":1}\n${huge}\n{"type":"skip"}\n{"type":"keep","n":2}\n`);
    const kept: string[] = [];
    const skipped: number[] = [];
    const end = await streamCompleteLines(p, 0, Number.MAX_SAFE_INTEGER, {
      onLine: (text) => kept.push(text),
      skipLine: (head) => head.startsWith('{"type":"skip"'),
      onSkip: (offset) => skipped.push(offset),
    });
    expect(kept).toEqual(['{"type":"keep","n":1}', '{"type":"keep","n":2}']);
    expect(skipped).toEqual([22, 22 + huge.length + 1]);
    expect(end).toBeGreaterThan(huge.length);
  });

  it("keeps offsets exact for lines after a skipped one", async () => {
    const p = file('{"type":"skip"}\nabc\n');
    const seen: [string, number][] = [];
    await streamCompleteLines(p, 0, 20, {
      onLine: (t, o) => seen.push([t, o]),
      skipLine: (h) => h.includes("skip"),
    });
    expect(seen).toEqual([["abc", 16]]);
  });
});
