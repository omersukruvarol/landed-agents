import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical-json";

describe("canonicalJson", () => {
  it("is independent of key order, recursively", () => {
    const a = { b: 1, a: { d: [1, { y: 2, x: 1 }], c: "s" } };
    const b = { a: { c: "s", d: [1, { x: 1, y: 2 }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":{"c":"s","d":[1,{"x":1,"y":2}]},"b":1}');
  });

  it("omits undefined members but keeps null", () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
    expect(canonicalJson([undefined, 1])).toBe("[null,1]");
  });

  it("rejects values that cannot be represented deterministically", () => {
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalJson({ f: () => 1 })).toThrow(TypeError);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => canonicalJson(circular)).toThrow(/circular/);
  });

  it("allows the same object to appear twice without being circular", () => {
    const shared = { x: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });
});
