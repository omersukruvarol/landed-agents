/** Storage keeps instants as epoch ms (UTC); the domain uses ISO-8601 strings. */
export function toMs(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new TypeError(`invalid timestamp: ${iso}`);
  return ms;
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

export function toMsOpt(iso: string | undefined): number | null {
  return iso === undefined ? null : toMs(iso);
}

export function toIsoOpt(ms: number | null): string | undefined {
  return ms === null ? undefined : toIso(ms);
}

/** Drop keys whose value is null/undefined, so rows map onto optional domain fields. */
export function compact<T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]?: NonNullable<T[K]> } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== null && v !== undefined) out[k] = v;
  return out as { [K in keyof T]?: NonNullable<T[K]> };
}
