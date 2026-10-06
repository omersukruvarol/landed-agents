import { describe, expect, it } from "vitest";
import { planRead } from "./checkpoint";

const prev = {
  sourceId: "s",
  path: "/f",
  inode: 7,
  size: 100,
  mtimeMs: 1,
  byteOffset: 100,
  parserVersion: "p@1",
};

describe("planRead", () => {
  it("reads a new file from the start", () => {
    expect(planRead(undefined, { inode: 7, size: 50, mtimeMs: 1 }, "p@1")).toEqual({
      action: "read",
      from: 0,
      reset: false,
    });
  });

  it("skips an unchanged file", () => {
    expect(planRead(prev, { inode: 7, size: 100, mtimeMs: 2 }, "p@1")).toEqual({ action: "skip" });
  });

  it("continues an appended file from the checkpoint", () => {
    expect(planRead(prev, { inode: 7, size: 180, mtimeMs: 2 }, "p@1")).toEqual({
      action: "read",
      from: 100,
      reset: false,
    });
  });

  it.each([
    ["truncated", { inode: 7, size: 40, mtimeMs: 2 }, "p@1"],
    ["replaced (new inode)", { inode: 8, size: 180, mtimeMs: 2 }, "p@1"],
    ["parser upgraded", { inode: 7, size: 100, mtimeMs: 1 }, "p@2"],
  ])("re-reads from scratch when %s", (_label, state, version) => {
    expect(planRead(prev, state, version)).toEqual({ action: "read", from: 0, reset: true });
  });
});
