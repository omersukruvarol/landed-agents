/**
 * Deterministic JSON serialization: object keys sorted recursively, `undefined` members omitted.
 * Used wherever a hash must not depend on property order (event fingerprints, evidence keys).
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, new Set());
}

function serialize(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number ${value}`);
      return JSON.stringify(value);
    case "object": {
      if (seen.has(value)) throw new TypeError("canonicalJson: circular structure");
      seen.add(value);
      let out: string;
      if (Array.isArray(value)) {
        out = `[${value.map((v) => (v === undefined ? "null" : serialize(v, seen))).join(",")}]`;
      } else {
        const entries = Object.entries(value as Record<string, unknown>)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        out = `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${serialize(v, seen)}`).join(",")}}`;
      }
      seen.delete(value);
      return out;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
  }
}
