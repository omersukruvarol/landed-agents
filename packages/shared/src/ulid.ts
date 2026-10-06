/** ULID: 48-bit ms timestamp + 80 bits of randomness, Crockford base32 (26 chars). */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const MAX_TIME = 2 ** 48 - 1;

export const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export function newUlid(timeMs: number = Date.now()): string {
  if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > MAX_TIME) {
    throw new RangeError(`newUlid: invalid time ${timeMs}`);
  }
  let time = "";
  let t = timeMs;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET.charAt(t % 32) + time;
    t = Math.floor(t / 32);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let random = "";
  for (const b of bytes) random += ALPHABET.charAt(b % 32);
  return time + random;
}

export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value);
}

/** Milliseconds encoded in a ULID's time component. */
export function ulidTime(id: string): number {
  if (!isUlid(id)) throw new TypeError(`ulidTime: not a ULID: ${id}`);
  let t = 0;
  for (const ch of id.slice(0, 10)) t = t * 32 + ALPHABET.indexOf(ch);
  return t;
}
