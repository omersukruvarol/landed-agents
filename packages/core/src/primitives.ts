import { ULID_PATTERN } from "@landed/shared";
import { z } from "zod";

/** Current version of the NormalizedEvent contract. Bump on breaking changes. */
export const EVENT_SCHEMA_VERSION = 1;

/** Hex length of a persisted line fingerprint (64 bits). See docs/architecture.md. */
export const LINE_FP_HEX_LENGTH = 16;

export const IdSchema = z.string().regex(ULID_PATTERN, "expected a ULID");

/** Vendor-provided identifiers are opaque; only require them to be non-empty. */
export const ExternalIdSchema = z.string().min(1);

/**
 * ISO-8601 instant with an explicit offset (`Z` or `±hh:mm`) that denotes a real calendar date.
 * Local times without an offset are rejected — they are ambiguous across machines.
 */
export const TimestampSchema = z.iso
  .datetime({ offset: true })
  .refine(isRealCalendarDate, { message: "not a real calendar date" });

function isRealCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m || Number.isNaN(Date.parse(value))) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export const LineFingerprintSchema = z
  .string()
  .regex(new RegExp(`^[0-9a-f]{${LINE_FP_HEX_LENGTH}}$`), "expected a line fingerprint");

export const FractionSchema = z.number().min(0).max(1);
export const CountSchema = z.number().int().nonnegative();
export const NonEmptyStringSchema = z.string().min(1);

/** A path relative to a repository root: no leading slash, no `..` segments. */
export const RelPathSchema = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !p.split("/").includes(".."), {
    message: "expected a repo-relative path without '..'",
  });

/** Where a normalized record came from, so any claim can be traced back to its source line. */
export const SourceRefSchema = z.strictObject({
  file: NonEmptyStringSchema,
  offset: CountSchema,
  parserVersion: NonEmptyStringSchema,
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

/** Free-form, JSON-serializable evidence explaining a derived/inferred claim. */
export const EvidenceSchema = z.record(z.string(), z.unknown());
export type Evidence = z.infer<typeof EvidenceSchema>;
