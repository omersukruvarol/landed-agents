import type { Lang } from "./i18n";
import type { AgentProvider } from "./types";

/** Turns a provider id into a display name (kebab-case → Title Case), so the UI never branches on a vendor. */
export const agentName = (p: AgentProvider | string) =>
  p
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/** "Claude Code and Codex" / "Claude Code ve Codex". */
export const agentList = (providers: readonly string[], and: string) => {
  const names = providers.map(agentName);
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")}${and}${names.at(-1)}`;
};

export function tokens(n?: number): string {
  if (n === undefined) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

/** "3 minutes ago" / "3 dakika önce", "just now" / "şimdi". */
export function ago(iso: string, lang: Lang = "en", now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return rtf.format(0, "second");
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  const d = Math.round(s / 86400);
  return d < 60 ? rtf.format(-d, "day") : rtf.format(-Math.round(d / 30), "month");
}

/** Whole days since `iso` (at least 1 once a day has passed). */
export const daysSince = (iso: string, now = Date.now()) =>
  Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000));

export const time = (iso: string, lang: Lang = "en") =>
  new Date(iso).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
export const dateTime = (iso: string, lang: Lang = "en") =>
  new Date(iso).toLocaleString(lang, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export const day = (iso: string, lang: Lang = "en") =>
  new Date(iso).toLocaleDateString(lang, { day: "numeric", month: "long" });
export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const pctFor = (x: number, lang: Lang) =>
  lang === "tr" ? `%${Math.round(x * 100)}` : `${Math.round(x * 100)}%`;
export const short = (sha: string) => sha.slice(0, 7);

export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
