import { AgentProviderSchema } from "@landed/core";
import { useQuery } from "@tanstack/react-query";
import { get } from "../api";
import {
  Button,
  Empty,
  ErrorBox,
  Loading,
  OutcomeBar,
  PageTitle,
  Segmented,
  Status,
} from "../components/ui";
import { agentList, agentName, ago, dateTime } from "../format";
import { useI18n } from "../i18n";
import { Link, navigate, query } from "../router";
import type { SessionItem, ThreadItem } from "../types";

const PAGE = 100;
const PROVIDERS = AgentProviderSchema.options.filter((p) => p !== "unknown");

/** History: pieces of work (threads) and individual sessions, without no-edit noise by default. */
export function HistoryPage({ path, tab: forced }: { path: string; tab?: "work" | "sessions" }) {
  const { t } = useI18n();
  const q = query(path);
  const tab = forced ?? (q.get("tab") === "sessions" ? "sessions" : "work");
  const showEmpty = q.get("all") === "1";
  const go = (next: URLSearchParams) => navigate(`/history?${next}`);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(q);
    next.set("tab", tab);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== "offset") next.delete("offset");
    go(next);
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle
          title={t.history.title}
          subtitle={tab === "work" ? t.history.workHelp : t.history.sessionsHelp}
        />
        <Segmented
          value={tab}
          options={[
            [t.history.tabs.work as string, "work"],
            [t.history.tabs.sessions as string, "sessions"],
          ]}
          onChange={(v) => go(new URLSearchParams({ tab: v, ...(showEmpty ? { all: "1" } : {}) }))}
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-ink-2">
        <input
          type="checkbox"
          checked={showEmpty}
          onChange={(e) => set("all", e.target.checked ? "1" : "")}
        />
        {t.history.showEmpty}
      </label>
      {tab === "work" ? (
        <WorkList showEmpty={showEmpty} />
      ) : (
        <SessionList q={q} set={set} showEmpty={showEmpty} />
      )}
    </div>
  );
}

function WorkList({ showEmpty }: { showEmpty: boolean }) {
  const { t, lang } = useI18n();
  const threads = useQuery({
    queryKey: ["threads", "all"],
    queryFn: () => get<ThreadItem[]>("/v1/threads"),
  });
  if (threads.isLoading) return <Loading />;
  if (threads.error) return <ErrorBox error={threads.error} />;
  const rows = (threads.data ?? []).filter(
    (th) => showEmpty || Object.values(th.outcomeMix).some((n) => (n ?? 0) > 0),
  );
  if (rows.length === 0) return <Empty title={t.history.empty} />;
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      <table className="w-full table-fixed text-sm">
        <thead className="border-b border-line text-left text-xs text-muted">
          <tr>
            <th className="w-[46%] px-4 py-2 font-medium">{t.history.cols.work}</th>
            <th className="hidden w-[16%] px-2 py-2 font-medium md:table-cell">
              {t.history.cols.agents}
            </th>
            <th className="hidden w-[14%] px-2 py-2 font-medium lg:table-cell">
              {t.history.cols.result}
            </th>
            <th className="w-[12%] px-2 py-2 font-medium">{t.history.cols.status}</th>
            <th className="w-[12%] px-4 py-2 text-right font-medium">{t.history.cols.last}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.slice(0, 300).map((th) => (
            <tr key={th.id} className="hover:bg-panel-2/60">
              <td className="max-w-0 px-4 py-2.5">
                <Link
                  to={`/threads/${th.id}`}
                  className="block truncate font-medium hover:underline"
                >
                  {th.title}
                </Link>
                <div className="truncate text-xs text-muted">
                  {th.repo} · {t.common.sessions(th.sessionIds.length)}
                </div>
              </td>
              <td className="hidden truncate px-2 text-xs text-ink-2 md:table-cell">
                {agentList(th.providers, t.common.and)}
              </td>
              <td className="hidden px-2 lg:table-cell">
                <OutcomeBar dist={th.outcomeMix} height="h-1.5" />
              </td>
              <td className="px-2">
                <Status value={th.status} />
              </td>
              <td className="whitespace-nowrap px-4 text-right text-xs text-muted">
                {ago(th.lastActivityAt, lang)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SessionList({
  q,
  set,
  showEmpty,
}: {
  q: URLSearchParams;
  set: (k: string, v: string) => void;
  showEmpty: boolean;
}) {
  const { t, lang } = useI18n();
  const offset = Number(q.get("offset") ?? 0);
  const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  for (const k of ["provider", "status", "date"]) if (q.get(k)) params.set(k, q.get(k) as string);
  if (!showEmpty) params.set("withFiles", "1");
  const sessions = useQuery({
    queryKey: ["sessions", params.toString()],
    queryFn: () => get<{ total: number; items: SessionItem[] }>(`/v1/sessions?${params}`),
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <select
          className="rounded-md border border-line bg-panel px-2 py-1"
          value={q.get("provider") ?? ""}
          onChange={(e) => set("provider", e.target.value)}
          aria-label={t.history.cols.agent}
        >
          <option value="">{t.history.allAgents}</option>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {agentName(p)}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border border-line bg-panel px-2 py-1"
          value={q.get("status") ?? ""}
          onChange={(e) => set("status", e.target.value)}
          aria-label={t.history.cols.status}
        >
          <option value="">{t.history.anyStatus}</option>
          {["completed", "failed", "interrupted", "awaiting-user"].map((s) => (
            <option key={s} value={s}>
              {t.status[s]}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="rounded-md border border-line bg-panel px-2 py-1"
          value={q.get("date") ?? ""}
          onChange={(e) => set("date", e.target.value)}
          aria-label={t.history.cols.started}
        />
      </div>
      {sessions.isLoading && <Loading />}
      {sessions.error && <ErrorBox error={sessions.error} />}
      {sessions.data && sessions.data.items.length === 0 && <Empty title={t.history.empty} />}
      {sessions.data && sessions.data.items.length > 0 && (
        <>
          <div className="overflow-hidden rounded-xl border border-line bg-panel">
            <table className="w-full table-fixed text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="w-[48%] px-4 py-2 font-medium">{t.history.cols.session}</th>
                  <th className="w-[14%] px-2 py-2 font-medium">{t.history.cols.agent}</th>
                  <th className="hidden w-[16%] px-2 py-2 font-medium md:table-cell">
                    {t.history.cols.started}
                  </th>
                  <th className="hidden w-[8%] px-2 py-2 text-right font-medium md:table-cell">
                    {t.history.cols.files}
                  </th>
                  <th className="w-[14%] px-4 py-2 font-medium">{t.history.cols.status}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sessions.data.items.map((s) => (
                  <tr key={s.id} className="hover:bg-panel-2/60">
                    <td className="max-w-0 px-4 py-2.5">
                      <Link
                        to={`/sessions/${s.id}`}
                        className="flex items-center gap-1.5 truncate font-medium hover:underline"
                      >
                        {s.live && (
                          <span
                            className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-landed"
                            title={t.status.running}
                          />
                        )}
                        {s.title ?? t.history.untitled}
                      </Link>
                      <div className="truncate text-xs text-muted">
                        {s.repo ?? t.common.noRepo}
                        {s.subagents > 0 && ` · ${t.history.subagents(s.subagents)}`}
                        {s.failureCount > 0 && ` · ${t.history.failures(s.failureCount)}`}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 text-xs text-ink-2">
                      {agentName(s.provider)}
                    </td>
                    <td className="hidden whitespace-nowrap px-2 text-xs text-muted md:table-cell">
                      {dateTime(s.startedAt, lang)}
                    </td>
                    <td className="tabular hidden px-2 text-right text-xs md:table-cell">
                      {s.changedFileCount}
                    </td>
                    <td className="px-4">
                      <Status value={s.live ? "running" : s.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-xs text-muted">
            <span>
              {t.history.range(
                offset + 1,
                Math.min(offset + PAGE, sessions.data.total),
                sessions.data.total,
              )}
            </span>
            <div className="flex gap-1">
              <Button
                kind="ghost"
                disabled={offset === 0}
                onClick={() => set("offset", String(Math.max(0, offset - PAGE)))}
              >
                {t.history.newer}
              </Button>
              <Button
                kind="ghost"
                disabled={offset + PAGE >= sessions.data.total}
                onClick={() => {
                  const next = new URLSearchParams(q);
                  next.set("tab", "sessions");
                  next.set("offset", String(offset + PAGE));
                  navigate(`/history?${next}`);
                }}
              >
                {t.history.older}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
