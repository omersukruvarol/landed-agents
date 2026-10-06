import { useQuery } from "@tanstack/react-query";
import { get } from "../api";
import { Card, Empty, ErrorBox, Loading, Mono, OutcomeBadge, Status } from "../components/ui";
import { agentName, dateTime, short, time, tokens } from "../format";
import { useI18n } from "../i18n";
import { Link } from "../router";
import type { SessionDetail } from "../types";

const TYPE_COLOR: Record<string, string> = {
  "command.failed": "text-danger",
  "tool.failed": "text-danger",
  error: "text-danger",
  "agent.interrupted": "text-warn",
  "approval.resolved": "text-warn",
  "edit.applied": "text-accent",
  "prompt.submitted": "text-ink",
};

/** Event types whose label is a name worth keeping (the command or tool that ran). */
const NAMED = new Set(["command.completed", "command.failed", "tool.completed", "tool.failed"]);

/** One conversation with an agent: the files it changed and what it did, in order. */
export function SessionDetailPage({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const data = useQuery({
    queryKey: ["session", id],
    queryFn: () => get<SessionDetail>(`/v1/sessions/${id}`),
  });
  if (data.isLoading) return <Loading />;
  if (data.error) return <ErrorBox error={data.error} />;
  const d = data.data as SessionDetail;
  const s = d.session;
  const m = d.meta;
  const eventLabel = (type: string, label: string) => {
    const base = t.session.events[type];
    if (!base) return label;
    return NAMED.has(type) ? `${base}: ${label}` : base;
  };
  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-muted">
          <Link to="/history?tab=sessions" className="hover:underline">
            {t.thread.crumb}
          </Link>
          {d.thread && (
            <>
              {" / "}
              <Link to={`/threads/${d.thread.id}`} className="hover:underline">
                {d.thread.title}
              </Link>
            </>
          )}
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {s.title ?? t.history.untitled}
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted">
          <Status value={s.live ? "running" : s.status} />
          <span>{agentName(s.provider)}</span>
          {m.model && <span>{String(m.model)}</span>}
          <span>{s.repo ?? t.common.noRepo}</span>
          {m.gitBranchEnd && <Mono>{String(m.gitBranchEnd)}</Mono>}
          <span>
            {dateTime(s.startedAt, lang)} → {time(s.lastEventAt, lang)}
          </span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-2">
          <Card title={`${t.session.filesTitle} · ${d.files.length}`}>
            {d.files.length === 0 ? (
              <Empty title={t.session.noFiles} />
            ) : (
              <ul className="space-y-2">
                {d.files.map((f) => (
                  <li key={f.relPath}>
                    <div className="flex items-center justify-between gap-2">
                      <Mono className="truncate">{f.relPath}</Mono>
                      {f.outcome && <OutcomeBadge cls={f.outcome.class} />}
                    </div>
                    <div className="text-[11px] text-muted">
                      {t.session.edits(f.edits, f.added, f.removed)}
                      {f.outcome?.firstCommit &&
                        ` · ${t.session.inCommit(short(f.outcome.firstCommit.sha), f.outcome.firstCommit.subject)}`}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {d.insights.length > 0 && (
            <Card title={t.session.insightsTitle}>
              <ul className="space-y-1.5 text-sm">
                {d.insights.map((i) => (
                  <li key={i.id} className="flex items-start gap-2">
                    <span className={i.severity === "warning" ? "text-warn" : "text-muted"}>●</span>
                    <span>{i.message}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {d.subagents.length > 0 && (
            <Card title={t.session.subagentsTitle(d.subagents.length)}>
              <ul className="space-y-1 text-sm">
                {d.subagents.map((x) => (
                  <li key={x.id} className="flex justify-between gap-2">
                    <Link to={`/sessions/${x.id}`} className="truncate hover:underline">
                      {x.title ?? t.session.helper(agentName(x.provider))}
                    </Link>
                    <Status value={x.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card
            title={t.session.usageTitle}
            aside={<span>{t.session.coverage(String(m.usageCoverage ?? "none"))}</span>}
          >
            <dl className="grid grid-cols-3 gap-2 text-center">
              {(
                [
                  [t.session.usage.input, m.inputTokens],
                  [t.session.usage.cached, m.cachedInputTokens],
                  [t.session.usage.output, m.outputTokens],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="tabular font-semibold">{tokens(v as number | undefined)}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>

        <Card title={t.session.timelineTitle} className="lg:col-span-3">
          {d.timeline.length === 0 ? (
            <Empty title={t.session.noEvents} />
          ) : (
            <ol className="relative space-y-1.5 border-l border-line pl-4">
              {d.timeline.map((e) => (
                <li key={`${e.at}-${e.type}-${e.label}-${e.detail ?? ""}`} className="text-sm">
                  <span
                    className="absolute -left-[3px] mt-2 h-1.5 w-1.5 rounded-full bg-line"
                    aria-hidden
                  />
                  <div className="flex items-baseline gap-2">
                    <span className="tabular w-12 shrink-0 whitespace-nowrap text-[11px] text-muted">
                      {time(e.at, lang)}
                    </span>
                    <span className={`font-medium ${TYPE_COLOR[e.type] ?? "text-ink-2"}`}>
                      {eventLabel(e.type, e.label)}
                      {e.count > 1 && <span className="font-normal text-muted"> ×{e.count}</span>}
                      {e.status === "failure" && (
                        <span className="ml-1 text-xs font-normal text-danger">
                          {t.session.failed}
                        </span>
                      )}
                    </span>
                  </div>
                  {e.detail && <Mono className="ml-14 block truncate text-muted">{e.detail}</Mono>}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
