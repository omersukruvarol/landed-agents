import { useQuery } from "@tanstack/react-query";
import { get } from "../api";
import {
  Card,
  Empty,
  ErrorBox,
  Loading,
  Metric,
  OUTCOME,
  OutcomeBar,
  ProvenanceChip,
} from "../components/ui";
import { agentName, pct } from "../format";
import { navigate, query } from "../router";
import type { Distribution, OutcomesView } from "../types";

const PERIODS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "All time", days: 0 },
];

const total = (d: Distribution) =>
  (d.landed ?? 0) + (d.uncommitted ?? 0) + (d.partial ?? 0) + (d.lost ?? 0);

/** 90% Wilson interval for a proportion. */
function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.645;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export function OutcomesPage({ path }: { path: string }) {
  const days = Number(query(path).get("days") ?? 30);
  const data = useQuery({
    queryKey: ["outcomes", days],
    queryFn: () => get<OutcomesView>(`/v1/outcomes${days ? `?days=${days}` : ""}`),
  });
  if (data.isLoading) return <Loading />;
  if (data.error) return <ErrorBox error={data.error} />;
  const o = data.data as OutcomesView;
  const n = total(o.overall);
  const landed = o.survival.surviving ?? 0;
  const landedAll = Object.values(o.survival).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Outcomes</h1>
          <p className="text-sm text-muted">
            Each agent edit matched against git: did it land in a commit, stay uncommitted, or
            disappear?
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-line bg-panel p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => navigate(`/outcomes?days=${p.days}`)}
              className={`rounded-md px-3 py-1 text-xs ${days === p.days ? "bg-panel-2 font-medium" : "text-muted"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Session × file outcomes" value={n} />
        <Metric label="Landed" value={n ? pct((o.overall.landed ?? 0) / n) : "—"} />
        <Metric
          label="Still present after landing"
          value={landedAll ? pct(landed / landedAll) : "—"}
          hint="Landed work whose lines are still in HEAD"
        />
        <Metric
          label="Median edit → commit"
          value={o.commitLagHours ? `${o.commitLagHours.median.toFixed(1)}h` : "—"}
          hint={o.commitLagHours ? `p90 ${o.commitLagHours.p90.toFixed(0)}h` : ""}
        />
      </div>

      <Card title="All agent work" aside={<ProvenanceChip value="derived" />}>
        {n === 0 ? (
          <Empty title="No outcomes in this period" />
        ) : (
          <OutcomeBar dist={o.overall} height="h-3" legend />
        )}
        {landedAll > 0 && (
          <p className="mt-3 text-xs text-muted">
            Of landed work: {o.survival.surviving ?? 0} still present, {o.survival.churned ?? 0}{" "}
            later changed or removed, {o.survival.reverted ?? 0} reverted, {o.survival.unknown ?? 0}{" "}
            on branches that never reached the default branch.
          </p>
        )}
      </Card>

      <Card
        title="By repository"
        aside={
          <span>
            Agents are compared only within a repo, with ≥{o.minComparisonSample} outcomes each
          </span>
        }
      >
        {o.repos.length === 0 ? (
          <Empty title="No repositories with outcomes" />
        ) : (
          <ul className="divide-y divide-line">
            {o.repos.map((r) => (
              <li key={r.repoId} className="py-3 first:pt-0 last:pb-0">
                <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{r.repo}</span>
                    {r.confidence === "low" && (
                      <span
                        className="rounded border border-warn/50 px-1.5 text-[10px] uppercase tracking-wide text-warn"
                        title={`Self-check: ${pct(r.controlA ?? 0)} of edits match earlier commits, ${pct(r.controlB ?? 0)} match unrelated files. Numbers here are approximate.`}
                      >
                        Low confidence
                      </span>
                    )}
                    {r.missing && (
                      <span className="text-[11px] text-muted">(repo no longer on disk)</span>
                    )}
                  </div>
                  <span className="tabular text-xs text-muted">
                    {total(r.distribution)} outcomes · {r.agents.map(agentName).join(" + ")}
                  </span>
                </div>
                <OutcomeBar dist={r.distribution} />
                {r.comparison && (
                  <div className="mt-2.5 space-y-1.5 rounded-lg bg-panel-2 p-2.5">
                    {r.comparison.map((a) => {
                      const t = total(a.distribution);
                      const [lo, hi] = wilson(a.distribution.landed ?? 0, t);
                      return (
                        <div
                          key={a.provider}
                          className="grid grid-cols-[110px_1fr_150px] items-center gap-3 text-xs"
                        >
                          <span className="font-medium">{agentName(a.provider)}</span>
                          <OutcomeBar dist={a.distribution} height="h-2" />
                          <span
                            className="tabular text-muted"
                            title="90% interval for the landed share"
                          >
                            landed {pct((a.distribution.landed ?? 0) / t)} ({pct(lo)}–{pct(hi)}) ·
                            n={t}
                          </span>
                        </div>
                      );
                    })}
                    {r.fit.length > 0 && (
                      <div className="space-y-1 border-t border-line pt-2">
                        <div className="text-[11px] font-medium text-muted">
                          By kind of work (landed share, 90% interval, n)
                        </div>
                        {r.fit.map((f) => (
                          <div
                            key={f.category}
                            className="grid grid-cols-[110px_1fr] items-center gap-3 text-xs"
                          >
                            <span className="text-ink-2">{f.category}</span>
                            <span className="tabular flex flex-wrap gap-x-4 text-muted">
                              {f.agents.map((a) => {
                                const t = total(a.distribution);
                                const [lo, hi] = wilson(a.distribution.landed ?? 0, t);
                                return (
                                  <span key={a.provider}>
                                    {agentName(a.provider)} {pct((a.distribution.landed ?? 0) / t)}{" "}
                                    ({pct(lo)}–{pct(hi)}, n={t})
                                  </span>
                                );
                              })}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-1 text-[11px] text-muted">
                      <ProvenanceChip value="derived" /> {o.comparisonCaveat}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="What could not be judged">
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-2">
          {Object.entries(o.unknownReasons).map(([k, v]) => (
            <li key={k}>
              <span className="font-medium">{REASONS[k] ?? k}</span>{" "}
              <span className="tabular text-muted">{v} edits</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">
          Limits: shell-made changes (sed, codegen, formatters) are invisible to patch matching;
          reformatting after an edit can lower match rates. {OUTCOME.partial.help}
        </p>
      </Card>
    </div>
  );
}

const REASONS: Record<string, string> = {
  "outside-repo": "Outside any git repo",
  "no-signal": "No meaningful lines",
  "repo-missing": "Repo deleted",
  gitignored: "Ignored by git (e.g. .env, build output)",
  "git-error": "Git could not be read",
};
