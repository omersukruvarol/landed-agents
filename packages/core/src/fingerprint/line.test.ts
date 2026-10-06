import { describe, expect, it } from "vitest";
import { createLineFingerprinter, isSignificantLine, normalizeLine } from "./line";
import { generateInstallSecret, parseInstallSecret } from "./secret";

const secret = parseInstallSecret(generateInstallSecret());
const fpr = createLineFingerprinter(secret);

describe("normalizeLine", () => {
  it.each([
    ["  const x = 1;  ", "const x = 1;"],
    ["\tconst\t\tx =  1;\r", "const x = 1;"],
    ["a  b", "a b"], // non-breaking spaces
    ["", ""],
  ])("normalizes %j", (input, expected) => {
    expect(normalizeLine(input)).toBe(expected);
  });

  it("applies Unicode NFC so composed and decomposed forms match", () => {
    expect(normalizeLine("şehir")).toBe(normalizeLine("şehir"));
  });
});

describe("isSignificantLine", () => {
  it.each([
    ["const total = a + b;", true],
    ["return x;", true], // 9 chars
    ["  }  ", false],
    ["});", false],
    ["// -----", false], // punctuation only
    ["x = 1", false], // too short
    ["şehir = ğüç", true], // non-ASCII letters count
    ["1234567890", true],
    ["😀😀😀😀😀😀😀😀", false], // long but no letters or digits
  ])("%j -> %s", (line, expected) => {
    expect(isSignificantLine(line)).toBe(expected);
  });

  it("counts code points, not UTF-16 units", () => {
    // 7 astral code points + 1 letter = 8 code points (15 UTF-16 units)
    expect(isSignificantLine("😀😀😀😀😀😀😀a")).toBe(true);
    expect(isSignificantLine("😀😀😀a")).toBe(false);
  });
});

describe("createLineFingerprinter", () => {
  it("returns 16-hex fingerprints, null for insignificant lines", () => {
    expect(fpr.fingerprint("const total = a + b;")).toMatch(/^[0-9a-f]{16}$/);
    expect(fpr.fingerprint("}")).toBeNull();
  });

  it("is insensitive to whitespace differences", () => {
    expect(fpr.fingerprint("const total = a + b;")).toBe(
      fpr.fingerprint("\t const  total = a + b;  "),
    );
  });

  it("depends on the install secret", () => {
    const other = createLineFingerprinter(parseInstallSecret(generateInstallSecret()));
    expect(fpr.fingerprint("const total = a + b;")).not.toBe(
      other.fingerprint("const total = a + b;"),
    );
  });

  it("is deterministic for a given secret", () => {
    const encoded = "q".repeat(43); // 32 bytes base64url
    const a = createLineFingerprinter(parseInstallSecret(encoded));
    const b = createLineFingerprinter(parseInstallSecret(encoded));
    expect(a.fingerprint("import { x } from './y';")).toBe(
      b.fingerprint("import { x } from './y';"),
    );
  });

  it("fingerprintAll dedupes and drops insignificant lines, keeping first-occurrence order", () => {
    const fps = fpr.fingerprintAll([
      "const a = 1000;",
      "}",
      "const b = 2000;",
      "  const a = 1000;",
    ]);
    expect(fps).toEqual([fpr.fingerprint("const a = 1000;"), fpr.fingerprint("const b = 2000;")]);
  });

  it("fingerprintDiff does not count moved or re-indented lines as added", () => {
    const { added, removed } = fpr.fingerprintDiff(
      ["    return computeTotal(items);", "const fresh = newThing();"],
      ["  return computeTotal(items);"],
    );
    expect(added).toEqual([fpr.fingerprint("const fresh = newThing();")]);
    expect(removed).toEqual([fpr.fingerprint("return computeTotal(items);")]);
  });
});

describe("install secret", () => {
  it("rejects short or malformed secrets", () => {
    expect(() => parseInstallSecret("abc")).toThrow(RangeError);
    expect(() => parseInstallSecret("not base64url!")).toThrow(TypeError);
  });

  it("generates 32-byte base64url secrets", () => {
    const s = generateInstallSecret();
    expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(parseInstallSecret(s).bytes).toHaveLength(32);
  });
});
