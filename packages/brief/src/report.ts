import type {
  AgentProvider,
  AgentSession,
  Collision,
  OpenLoop,
  Outcome,
  OutcomeClass,
  WorkThread,
} from "@landed/core";

export interface ReportInputs {
  periodDays: number;
  nowMs: number;
  sessions: readonly AgentSession[];
  outcomes: readonly Outcome[];
  loops: readonly OpenLoop[];
  threads: readonly WorkThread[];
  collisions: readonly Collision[];
  repoNames: ReadonlyMap<string, string>;
  /** Off by default: repo names never appear unless the user opts in (PRD §19). */
  includeNames?: boolean;
}

export interface RetroReport {
  periodDays: number;
  from: string;
  to: string;
  sessions: number;
  subagentSessions: number;
  agents: { provider: AgentProvider; sessions: number }[];
  outcomes: Partial<Record<OutcomeClass, number>>;
  landedShare?: number;
  medianCommitLagHours?: number;
  churnedShare?: number;
  openLoopsCreated: number;
  openLoopsClosed: number;
  collisions: number;
  biggestThread?: { title?: string; sessions: number; agents: number; days: number };
  topAreas: { name: string; files: number }[];
  tokens: { input: number; output: number; cached: number };
}

export function buildRetroReport(r: ReportInputs): RetroReport {
  const to = r.nowMs;
  const from = to - r.periodDays * 86_400_000;
  const inPeriod = (iso: string) => Date.parse(iso) >= from && Date.parse(iso) < to;
  const sessions = r.sessions.filter((s) => inPeriod(s.startedAt));
  const ids = new Set(sessions.map((s) => s.id));
  const outcomes = r.outcomes.filter((o) => ids.has(o.sessionId) && o.class !== "unknown");
  const counts: Partial<Record<OutcomeClass, number>> = {};
  for (const o of outcomes) counts[o.class] = (counts[o.class] ?? 0) + 1;
  const landed = outcomes.filter((o) => o.class === "landed");
  const lags = landed
    .map((o) => o.commitLagSeconds)
    .filter((x): x is number => x !== undefined)
    .sort((a, b) => a - b);
  const byProvider = new Map<AgentProvider, number>();
  for (const s of sessions)
    if (!s.parentSessionId) byProvider.set(s.provider, (byProvider.get(s.provider) ?? 0) + 1);
  const threads = r.threads.filter((t) => inPeriod(t.startedAt));
  const biggest = [...threads].sort((a, b) => b.sessionIds.length - a.sessionIds.length)[0];
  const areas = new Map<string, number>();
  for (const o of outcomes) {
    const area = r.includeNames
      ? (r.repoNames.get(o.repoId ?? "") ?? "unknown")
      : categoryOf(o.relPath ?? "");
    areas.set(area, (areas.get(area) ?? 0) + 1);
  }
  return {
    periodDays: r.periodDays,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    sessions: sessions.filter((s) => !s.parentSessionId).length,
    subagentSessions: sessions.filter((s) => s.parentSessionId).length,
    agents: [...byProvider].map(([provider, n]) => ({ provider, sessions: n })),
    outcomes: counts,
    ...(outcomes.length ? { landedShare: landed.length / outcomes.length } : {}),
    ...(lags.length
      ? { medianCommitLagHours: (lags[Math.floor(lags.length / 2)] as number) / 3600 }
      : {}),
    ...(landed.length
      ? { churnedShare: landed.filter((o) => o.survival === "churned").length / landed.length }
      : {}),
    openLoopsCreated: r.loops.filter((l) => inPeriod(l.since)).length,
    openLoopsClosed: r.loops.filter((l) => l.state === "resolved" && inPeriod(l.since)).length,
    collisions: r.collisions.filter((c) => inPeriod(c.window.end)).length,
    ...(biggest
      ? {
          biggestThread: {
            ...(r.includeNames ? { title: biggest.title } : {}),
            sessions: biggest.sessionIds.length,
            agents: biggest.providers.length,
            days: Math.max(
              1,
              Math.round(
                (Date.parse(biggest.lastActivityAt) - Date.parse(biggest.startedAt)) / 86_400_000,
              ),
            ),
          },
        }
      : {}),
    topAreas: [...areas]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, files]) => ({ name, files })),
    tokens: {
      input: sessions.reduce((n, s) => n + (s.inputTokens ?? 0), 0),
      output: sessions.reduce((n, s) => n + (s.outputTokens ?? 0), 0),
      cached: sessions.reduce((n, s) => n + (s.cachedInputTokens ?? 0), 0),
    },
  };
}

/** A content-free category for a path, used when names are not shared. */
export function categoryOf(relPath: string): string {
  const p = relPath.toLowerCase();
  if (/(^|\/)(test|tests|__tests__|e2e|spec)(\/|$)|\.(test|spec)\./.test(p)) return "Tests";
  if (/\.(md|mdx|txt|rst|adoc)$/.test(p) || p.startsWith("docs/")) return "Docs";
  if (/\.(json|ya?ml|toml|ini|env|lock)$|(^|\/)\.?config/.test(p)) return "Config";
  if (/\.(css|scss|sass|less|tsx|jsx|vue|svelte|html)$/.test(p)) return "UI";
  if (/\.(sql|prisma)$|migrations?\//.test(p)) return "Database";
  if (/\.(sh|ya?ml)$|\.github\/|dockerfile/.test(p)) return "Infra";
  return "Code";
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
const pct = (x?: number) => (x === undefined ? "—" : `${Math.round(x * 100)}%`);
const fmt = (n: number) =>
  n >= 1e9
    ? `${(n / 1e9).toFixed(1)}B`
    : n >= 1e6
      ? `${(n / 1e6).toFixed(1)}M`
      : n >= 1e3
        ? `${Math.round(n / 1e3)}k`
        : String(n);

/** A self-contained, shareable HTML card. Contains no paths, code, prompts or (by default) names. */
export function renderReportHtml(rep: RetroReport): string {
  const order: OutcomeClass[] = ["landed", "uncommitted", "partial", "lost"];
  const total = order.reduce((n, k) => n + (rep.outcomes[k] ?? 0), 0) || 1;
  const colors: Record<string, string> = {
    landed: "#3f8f5f",
    uncommitted: "#c8932f",
    partial: "#8a7fb8",
    lost: "#b8574d",
  };
  const bar = order
    .map(
      (k) =>
        `<span style="width:${((rep.outcomes[k] ?? 0) / total) * 100}%;background:${colors[k]}" title="${k}"></span>`,
    )
    .join("");
  const legend = order
    .map(
      (k) => `<li><i style="background:${colors[k]}"></i>${k} <b>${rep.outcomes[k] ?? 0}</b></li>`,
    )
    .join("");
  const areas = rep.topAreas.map((a) => `<li>${esc(a.name)} <b>${a.files}</b></li>`).join("");
  const agents = rep.agents.map((a) => `<li>${esc(a.provider)} <b>${a.sessions}</b></li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Wrapped — last ${rep.periodDays} days</title>
<style>
:root{--bg:#f6f4ef;--card:#fffdf8;--ink:#1d1b17;--muted:#6d675c;--line:#e4dfd4}
@media (prefers-color-scheme:dark){:root{--bg:#14130f;--card:#1c1b16;--ink:#f1ede4;--muted:#a39c8e;--line:#2e2c25}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:32px 16px}
main{max-width:720px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:32px}
h1{font-size:26px;margin:0 0 4px;letter-spacing:-.01em}.sub{color:var(--muted);margin:0 0 24px}
.big{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:24px 0}
.big div{border:1px solid var(--line);border-radius:12px;padding:14px}.big b{display:block;font-size:28px;font-variant-numeric:tabular-nums}.big span{color:var(--muted);font-size:13px}
.bar{display:flex;height:14px;border-radius:7px;overflow:hidden;background:var(--line);margin:8px 0}
ul{list-style:none;padding:0;margin:8px 0;display:flex;flex-wrap:wrap;gap:6px 18px}li i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}
h2{font-size:15px;margin:24px 0 4px}footer{color:var(--muted);font-size:12px;margin-top:28px;border-top:1px solid var(--line);padding-top:12px}
@media (max-width:520px){.big{grid-template-columns:1fr 1fr}}
</style></head><body><main>
<h1>Agent Wrapped</h1><p class="sub">Last ${rep.periodDays} days · ${rep.from.slice(0, 10)} → ${rep.to.slice(0, 10)}</p>
<div class="big">
<div><b>${rep.sessions}</b><span>agent sessions (+${rep.subagentSessions} subagents)</span></div>
<div><b>${pct(rep.landedShare)}</b><span>of agent edits landed in a commit</span></div>
<div><b>${rep.medianCommitLagHours === undefined ? "—" : `${rep.medianCommitLagHours.toFixed(1)}h`}</b><span>median edit → commit</span></div>
<div><b>${rep.openLoopsCreated}</b><span>open loops found (${rep.openLoopsClosed} closed)</span></div>
<div><b>${rep.collisions}</b><span>agent collisions</span></div>
<div><b>${pct(rep.churnedShare)}</b><span>of landed work later churned</span></div>
</div>
<h2>What agent work became</h2><div class="bar">${bar}</div><ul>${legend}</ul>
<h2>Agents</h2><ul>${agents}</ul>
<h2>Where the work went</h2><ul>${areas}</ul>
${rep.biggestThread ? `<h2>Biggest thread</h2><p>${rep.biggestThread.title ? `${esc(rep.biggestThread.title)} — ` : ""}${rep.biggestThread.sessions} sessions, ${rep.biggestThread.agents} agent${rep.biggestThread.agents === 1 ? "" : "s"}, ${rep.biggestThread.days} day${rep.biggestThread.days === 1 ? "" : "s"}</p>` : ""}
<h2>Tokens</h2><p>${fmt(rep.tokens.input)} input · ${fmt(rep.tokens.cached)} cached · ${fmt(rep.tokens.output)} output</p>
<footer>Made with Landed — computed locally from agent session history and git. Outcome numbers are derived by matching agent edits to commits; they describe what happened to the work, not how good an agent is.</footer>
</main></body></html>
`;
}
