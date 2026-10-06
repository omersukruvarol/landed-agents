/** Small terminal helpers. Colors only on a TTY, and never relied on to carry meaning. */
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: number) => (s: string) => (tty ? `\u001b[${code}m${s}\u001b[0m` : s);
export const bold = wrap(1);
export const dim = wrap(2);
export const green = wrap(32);
export const yellow = wrap(33);
export const red = wrap(31);
export const cyan = wrap(36);

export function bar(fraction: number, width = 28): string {
  const n = Math.round(Math.max(0, Math.min(1, fraction)) * width);
  return "█".repeat(n) + dim("░".repeat(width - n));
}

export const fmt = (n: number) =>
  n >= 1e9
    ? `${(n / 1e9).toFixed(1)}B`
    : n >= 1e6
      ? `${(n / 1e6).toFixed(1)}M`
      : n >= 1e3
        ? `${Math.round(n / 1e3)}k`
        : String(n);
export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const agentName = (p: string) =>
  p
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
