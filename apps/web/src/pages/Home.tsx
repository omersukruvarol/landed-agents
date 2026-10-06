import { useQuery } from "@tanstack/react-query";
import { get } from "../api";
import { LoopCard } from "../components/LoopCard";
import { Card, Empty, ErrorBox, Loading, OutcomeBar, OutcomeTiles, Status } from "../components/ui";
import { agentList, agentName, ago } from "../format";
import { useI18n } from "../i18n";
import { Link } from "../router";
import type { Loop, Summary, ThreadItem } from "../types";

const DAYS = 7;
const TOP_LOOPS = 3;

/** Overview: what agents did this week, what is waiting for you, and what is running now. */
export function HomePage() {
  const { t, lang } = useI18n();
  const summary = useQuery({
    queryKey: ["summary", DAYS],
    queryFn: () => get<Summary>(`/v1/summary?days=${DAYS}`),
  });
  const loops = useQuery({
    queryKey: ["loops", "open"],
    queryFn: () => get<Loop[]>("/v1/loops?state=open"),
  });
  const threads = useQuery({
    queryKey: ["threads", "all"],
    queryFn: () => get<ThreadItem[]>("/v1/threads"),
  });

  if (summary.isLoading) return <Loading />;
  if (summary.error) return <ErrorBox error={summary.error} />;
  const s = summary.data as Summary;
  const changed = s.files.landed + s.files.waiting + s.files.lost;
  const open = loops.data ?? [];
  const recent = (threads.data ?? [])
    .filter((th) => Object.values(th.outcomeMix).some((n) => (n ?? 0) > 0))
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
    .slice(0, 6);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">{t.home.title(DAYS)}</h1>
        <p className="mt-1.5 max-w-3xl text-[15px] leading-relaxed text-ink-2">
          {s.sessions === 0
            ? t.home.noActivity
            : `${t.home.sentence(agentList(s.agents, t.common.and), s.repos, changed)} ${t.home.verdict(s.openLoops)}`}
        </p>
        {changed > 0 && (
          <div className="mt-4">
            <OutcomeTiles {...s.files} />
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            {t.home.waitingTitle}
            {open.length > 0 && <span className="ml-2 text-warn">{open.length}</span>}
          </h2>
          {open.length > TOP_LOOPS && (
            <Link to="/loops" className="text-sm text-accent hover:underline">
              {t.home.seeAll(open.length - TOP_LOOPS)} →
            </Link>
          )}
        </div>
        {loops.isLoading ? (
          <Loading />
        ) : open.length === 0 ? (
          <Empty title={t.home.noneWaiting} />
        ) : (
          <div className="space-y-3">
            {open.slice(0, TOP_LOOPS).map((l) => (
              <LoopCard key={l.id} loop={l} />
            ))}
          </div>
        )}
      </section>

      {s.running.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold tracking-tight">{t.home.runningTitle}</h2>
          <ul className="space-y-2">
            {s.running.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/sessions/${r.id}`}
                  className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-sm hover:bg-panel-2"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-landed"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 text-ink-2">
                    {t.home.running(
                      agentName(r.provider),
                      r.repo ?? t.common.noRepo,
                      r.changedFileCount,
                      ago(r.lastEventAt, lang),
                    )}
                  </span>
                  {r.status === "awaiting-user" && <Status value="awaiting-user" />}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight">{t.home.recentTitle}</h2>
          <Link to="/history" className="text-sm text-accent hover:underline">
            {t.nav.history} →
          </Link>
        </div>
        {recent.length === 0 ? (
          <Empty title={t.home.recentEmpty} />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
            {recent.map((th) => (
              <li key={th.id}>
                <Link
                  to={`/threads/${th.id}`}
                  className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-center gap-4 px-4 py-3 hover:bg-panel-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{th.title}</div>
                    <div className="truncate text-xs text-muted">
                      {th.repo} · {agentList(th.providers, t.common.and)} ·{" "}
                      {ago(th.lastActivityAt, lang)}
                    </div>
                  </div>
                  <OutcomeBar dist={th.outcomeMix} height="h-2" />
                  <Status value={th.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card title={t.home.glossaryTitle}>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[170px_1fr]">
          {t.home.glossary.map(([term, meaning]) => (
            <div key={term} className="contents">
              <dt className="font-medium text-ink">{term}</dt>
              <dd className="text-ink-2">{meaning}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
