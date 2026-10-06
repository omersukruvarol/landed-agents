import { createReadStream } from "node:fs";
import { LINE_HEAD_BYTES } from "@landed/core";

const NEWLINE = 0x0a;

export interface LineHandlers {
  onLine(text: string, offset: number): void;
  /** Return true to skip a line from its first bytes without buffering or decoding the rest. */
  skipLine?(head: string): boolean;
  /** Called for each skipped line. */
  onSkip?(offset: number): void;
}

/**
 * Streams complete lines from `[start, end)` with their byte offsets and returns the offset just
 * past the last complete line (where the next pass starts). A trailing line without a newline is
 * left for the next pass — the writer may still be appending it. At most one line is buffered, and
 * a line the caller skips by its head is not buffered at all, so multi-GB files with
 * multi-hundred-MB lines stay out of memory (PRD §28.3).
 */
export async function streamCompleteLines(
  path: string,
  start: number,
  end: number,
  handlers: LineHandlers | ((text: string, offset: number) => void),
): Promise<number> {
  const h: LineHandlers = typeof handlers === "function" ? { onLine: handlers } : handlers;
  if (end <= start) return start;
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let lineStart = start;
  let skipping = false;
  let headChecked = false;
  let position = start;

  /** The first LINE_HEAD_BYTES of a line without copying the rest of it. */
  const headOf = (bufs: Buffer[]) => {
    const parts: Buffer[] = [];
    let n = 0;
    for (const b of bufs) {
      if (n >= LINE_HEAD_BYTES) break;
      const take = b.subarray(0, LINE_HEAD_BYTES - n);
      parts.push(take);
      n += take.length;
    }
    return Buffer.concat(parts, n).toString("utf8");
  };
  const resetLine = (next: number) => {
    pending = [];
    pendingBytes = 0;
    skipping = false;
    headChecked = false;
    lineStart = next;
  };

  const stream = createReadStream(path, { start, end: end - 1, highWaterMark: 1 << 20 });
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    let from = 0;
    let nl = chunk.indexOf(NEWLINE, from);
    while (nl !== -1) {
      const piece = chunk.subarray(from, nl);
      if (skipping) {
        h.onSkip?.(lineStart);
      } else {
        const parts = pendingBytes ? [...pending, piece] : [piece];
        if (!headChecked && h.skipLine?.(headOf(parts))) {
          h.onSkip?.(lineStart);
        } else {
          const bytes = parts.length === 1 ? piece : Buffer.concat(parts);
          h.onLine(bytes.toString("utf8").replace(/\r$/, ""), lineStart);
        }
      }
      resetLine(position + nl + 1);
      from = nl + 1;
      nl = chunk.indexOf(NEWLINE, from);
    }
    if (from < chunk.length && !skipping) {
      // Copy: the read buffer is reused by the stream.
      pending.push(Buffer.from(chunk.subarray(from)));
      pendingBytes += chunk.length - from;
      if (!headChecked && pendingBytes >= LINE_HEAD_BYTES && h.skipLine) {
        headChecked = true;
        if (h.skipLine(headOf(pending))) {
          skipping = true;
          pending = [];
          pendingBytes = 0;
        }
      }
    }
    position += chunk.length;
  }
  return lineStart;
}
