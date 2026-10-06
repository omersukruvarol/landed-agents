import { describe, expect, it } from "vitest";
import { isUlid, newUlid, ulidTime } from "./ulid";

describe("ulid", () => {
  it("produces 26-char Crockford base32 ids that round-trip their timestamp", () => {
    const t = Date.UTC(2026, 9, 1, 12, 0, 0);
    const id = newUlid(t);
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
    expect(ulidTime(id)).toBe(t);
  });

  it("sorts lexicographically by time", () => {
    const a = newUlid(1_000);
    const b = newUlid(2_000);
    expect(a < b).toBe(true);
  });

  it("is unique across calls in the same millisecond", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newUlid(5)));
    expect(ids.size).toBe(1000);
  });

  it("rejects invalid input", () => {
    expect(() => newUlid(-1)).toThrow(RangeError);
    expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FAI")).toBe(false); // 'I' is not Crockford
    expect(() => ulidTime("nope")).toThrow(TypeError);
  });
});
