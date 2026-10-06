import { useQuery } from "@tanstack/react-query";
import { get } from "../api";
import { LoopCard } from "../components/LoopCard";
import {
  Card,
  CopyButton,
  Empty,
  ErrorBox,
  Loading,
  Mono,
  OutcomeBadge,
  OutcomeTiles,
  Status,
  splitOutcomes,
} from "../components/ui";
import { agentList, agentName, dateTime, short } from "../format";
import { useI18n } from "../i18n";
import { Link } from "../router";
import type { Distribution, ThreadDetail } from "../types";

/** One piece of work: its sessions, what happened to each file, and anything still open. */
export function ThreadDetailPage({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const data = useQuery({
    queryKey: ["thread", id],
    queryFn: () => get<ThreadDetail>(`/v1/threads/${id}`),
  });
  if (data.isLoading) return <Loading />;
  if (data.error) return <ErrorBox error={data.error} />;
  const d = data.data as ThreadDetail;
  const th = d.thread;
  const names = new Map(d.sessions.map((s, i) => [s.id, `#${i + 1}`]));
  const files = d.outcomes.filter((o) => o.class !== "unknown");
  const mix: Distribution = {};
  for (const o of files) mix[o.class] = (mix[o.class] ?? 0) + 1;
  const open = d.loops.filter((l) => l.state === "open");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted">
            <Link to="/history" className="hover:underline">
              {t.thread.crumb}
            </Link>{" "}
            / {th.repo}
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{th.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted">
            <Status value={th.status} />
            <span>{agentList(th.providers, t.common.and)}</span>
            {th.branch && <Mono>{th.branch}</Mono>}
            <span>
              {dateTime(th.startedAt, lang)} → {dateTime(th.lastActivityAt, lang)}
            </span>
          </div>
        </div>
        <CopyButton
          kind="primary"
          text={() => get<string>(`/v1/threads/${id}/resume`)}
          title={t.loop.handoffHelp}
        >
          {t.thread.handoff}
        </CopyButton>
      </div>

      {files.length > 0 && <OutcomeTiles {...splitOutcomes(mix)} />}

      {open.length > 0 && (
        <div className="space-y-3">
          {open.map((l) => (
            <LoopCard key={l.id} loop={l} />
          ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-5">
        <Card title={t.thread.filesTitle} className="lg:col-span-3">
          {files.length === 0 ? (
            <Empty title={t.thread.noFiles} />
          ) : (
            <ul className="space-y-2">
              {files.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Mono className="block truncate">{o.relPath}</Mono>
                    {o.firstCommit && (
                      <div className="truncate text-[11px] text-muted">
                        {t.session.inCommit(short(o.firstCommit.sha), o.firstCommit.subject)}
                      </div>
                    )}
                  </div>
                  <OutcomeBadge cls={o.class} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`${t.thread.sessionsTitle} · ${d.sessions.length}`} className="lg:col-span-2">
          <ol className="space-y-2.5">
            {d.sessions.map((s) => {
              const ev = th.linkEvidence.find((l) => l.toSessionId === s.id);
              return (
                <li key={s.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <Link to={`/sessions/${s.id}`} className="font-medium hover:underline">
                      {names.get(s.id)} {s.title ?? agentName(s.provider)}
                    </Link>
                    <div className="text-xs text-muted">
                      {agentName(s.provider)} · {dateTime(s.startedAt, lang)} ·{" "}
                      {t.common.files(s.changedFileCount)}
                      {ev &&
                        ` · ${t.thread.linkWhy[ev.kind] ?? ev.kind} ${names.get(ev.fromSessionId) ?? t.thread.earlier}`}
                    </div>
                  </div>
                  <Status value={s.live ? "running" : s.status} />
                </li>
              );
            })}
          </ol>
        </Card>
      </div>
    </div>
  );
}
