import { useQuery } from "@tanstack/react-query";
import { get } from "../api";
import {
  Card,
  Empty,
  ErrorBox,
  Loading,
  OutcomeBar,
  OutcomeTiles,
  PageTitle,
  Segmented,
  splitOutcomes,
} from "../components/ui";
import { agentList, agentName, pctFor } from "../format";
import { useI18n } from "../i18n";
import { navigate, query } from "../router";
import type { Distribution, OutcomesView } from "../types";

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

/** Projects: how much of the agents' work was committed, per project. */
export function OutcomesPage({ path }: { path: string }) {
  const { t, lang } = useI18n();
  const days = Number(query(path).get("days") ?? 30);
  const data = useQuery({
    queryKey: ["outcomes", days],
    queryFn: () => get<OutcomesView>(`/v1/outcomes${days ? `?days=${days}` : ""}`),
  });
  const p = (x: number) => pctFor(x, lang);
  if (data.isLoading) return <Loading />;
  if (data.error) return <ErrorBox error={data.error} />;
  const o = data.data as OutcomesView;
  const n = total(o.overall);
  const landedAll = Object.values(o.survival).reduce((a, b) => a + b, 0);
  const unjudged = Object.entries(o.unknownReasons).filter(([, v]) => v > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle title={t.projects.title} subtitle={t.projects.subtitle} />
        <Segmented
          value={days}
          options={t.projects.periods}
          onChange={(d) => navigate(`/outcomes?days=${d}`)}
        />
      </div>

      {n === 0 ? (
        <Empty title={t.projects.noData} />
      ) : (
        <section className="space-y-3">
          <p className="text-[15px] text-ink-2">
            {t.projects.summary(n, p((o.overall.landed ?? 0) / n))}{" "}
            {landedAll > 0 && t.projects.stillThere(p((o.survival.surviving ?? 0) / landedAll))}{" "}
            {o.commitLagHours &&
              t.projects.speed(
                o.commitLagHours.median.toLocaleString(lang, { maximumFractionDigits: 1 }),
              )}
          </p>
          <OutcomeTiles {...splitOutcomes(o.overall)} />
        </section>
      )}

      {o.repos.length > 0 && (
        <ul className="space-y-3">
          {o.repos.map((r) => {
            const rn = total(r.distribution);
            return (
              <li key={r.repoId} className="rounded-xl border border-line bg-panel p-4">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold">{r.repo}</span>
                    {r.missing && (
                      <span className="text-xs text-muted">({t.projects.missing})</span>
                    )}
                    {r.confidence === "low" && (
                      <span
                        className="rounded-full border border-warn/50 px-2 text-[11px] text-warn"
                        title={t.projects.lowConfidenceHelp}
                      >
                        {t.projects.lowConfidence}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted">
                    {t.projects.repoLine(rn, p(rn ? (r.distribution.landed ?? 0) / rn : 0))} ·{" "}
                    {agentList(r.agents, t.common.and)}
                  </span>
                </div>
                <OutcomeBar dist={r.distribution} legend />
                {r.comparison && (
                  <div className="mt-3 space-y-2 rounded-lg bg-panel-2 p-3">
                    <div className="text-xs font-medium text-ink">{t.projects.compareTitle}</div>
                    {r.comparison.map((a) => {
                      const an = total(a.distribution);
                      const [lo, hi] = wilson(a.distribution.landed ?? 0, an);
                      return (
                        <div
                          key={a.provider}
                          className="grid grid-cols-[110px_1fr] items-center gap-3 text-xs sm:grid-cols-[110px_1fr_260px]"
                        >
                          <span className="font-medium">{agentName(a.provider)}</span>
                          <OutcomeBar dist={a.distribution} height="h-2" />
                          <span className="tabular text-muted">
                            {t.projects.committedShare(
                              p((a.distribution.landed ?? 0) / an),
                              p(lo),
                              p(hi),
                              an,
                            )}
                          </span>
                        </div>
                      );
                    })}
                    {r.fit.length > 0 && (
                      <div className="space-y-1 border-t border-line pt-2 text-xs">
                        <div className="font-medium text-muted">{t.projects.byKind}</div>
                        {r.fit.map((f) => (
                          <div key={f.category} className="flex flex-wrap gap-x-4">
                            <span className="w-24 text-ink-2">{f.category}</span>
                            {f.agents.map((a) => {
                              const an = total(a.distribution);
                              return (
                                <span key={a.provider} className="tabular text-muted">
                                  {agentName(a.provider)} {p((a.distribution.landed ?? 0) / an)}
                                </span>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-[11px] text-muted">{t.projects.compareCaveat}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {unjudged.length > 0 && (
        <Card title={t.projects.notJudgedTitle}>
          <ul className="space-y-1 text-sm text-ink-2">
            {unjudged.map(([k, v]) => (
              <li key={k} className="flex justify-between gap-4">
                <span>{t.projects.reasons[k] ?? k}</span>
                <span className="tabular text-muted">{t.projects.notJudged(v)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">{t.projects.limits}</p>
        </Card>
      )}
    </div>
  );
}
