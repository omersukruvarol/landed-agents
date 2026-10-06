import { AgentProviderSchema } from "@landed/core";
import { useQuery } from "@tanstack/react-query";
import { get } from "../api";
import { Button, Empty, ErrorBox, Loading, Status } from "../components/ui";
import { agentName, dateTime, tokens } from "../format";
import { Link, navigate, query } from "../router";
import type { SessionItem } from "../types";

const PAGE = 100;
const PROVIDERS = AgentProviderSchema.options.filter((p) => p !== "unknown");

export function SessionsPage({ path }: { path: string }) {
  const q = query(path);
  const offset = Number(q.get("offset") ?? 0);
  const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  for (const k of ["provider", "status", "date"]) if (q.get(k)) params.set(k, q.get(k) as string);
  const sessions = useQuery({
    queryKey: ["sessions", params.toString()],
    queryFn: () => get<{ total: number; items: SessionItem[] }>(`/v1/sessions?${params}`),
  });
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(q);
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete("offset");
    navigate(`/sessions?${next}`);
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Sessions</h1>
          <p className="text-sm text-muted">
            Every top-level agent session Landed has read. Subagents appear inside their parent.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <select
            className="rounded-md border border-line bg-panel px-2 py-1"
            value={q.get("provider") ?? ""}
            onChange={(e) => set("provider", e.target.value)}
            aria-label="Agent"
          >
            <option value="">All agents</option>
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
            aria-label="Status"
          >
            <option value="">Any status</option>
            {["completed", "failed", "interrupted", "awaiting-user", "unknown"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            type="date"
            className="rounded-md border border-line bg-panel px-2 py-1"
            value={q.get("date") ?? ""}
            onChange={(e) => set("date", e.target.value)}
            aria-label="Day"
          />
        </div>
      </div>
      {sessions.isLoading && <Loading />}
      {sessions.error && <ErrorBox error={sessions.error} />}
      {sessions.data && sessions.data.items.length === 0 && <Empty title="No sessions match" />}
      {sessions.data && sessions.data.items.length > 0 && (
        <>
          <div className="overflow-hidden rounded-xl border border-line bg-panel">
            <table className="w-full table-fixed text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="w-[46%] px-4 py-2 font-medium">Session</th>
                  <th className="w-[14%] px-2 py-2 font-medium">Agent</th>
                  <th className="hidden w-[14%] px-2 py-2 font-medium md:table-cell">Started</th>
                  <th className="hidden w-[7%] px-2 py-2 text-right font-medium md:table-cell">
                    Files
                  </th>
                  <th className="hidden w-[8%] px-2 py-2 text-right font-medium lg:table-cell">
                    Tokens
                  </th>
                  <th className="w-[11%] px-4 py-2 font-medium">Status</th>
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
                            title="Running now"
                          />
                        )}
                        {s.title ?? "Untitled session"}
                      </Link>
                      <div className="truncate text-xs text-muted">
                        {s.repo ?? "no repo"}
                        {s.subagents > 0 && ` · ${s.subagents} subagents`}
                        {s.failureCount > 0 && ` · ${s.failureCount} failures`}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 text-xs text-ink-2">
                      {agentName(s.provider)}
                    </td>
                    <td className="hidden whitespace-nowrap px-2 text-xs text-muted md:table-cell">
                      {dateTime(s.startedAt)}
                    </td>
                    <td className="tabular hidden px-2 text-right text-xs md:table-cell">
                      {s.changedFileCount}
                    </td>
                    <td className="tabular hidden px-2 text-right text-xs text-muted lg:table-cell">
                      {tokens(s.tokens)}
                    </td>
                    <td className="px-4">
                      <Status value={s.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-xs text-muted">
            <span>
              {offset + 1}–{Math.min(offset + PAGE, sessions.data.total)} of {sessions.data.total}
            </span>
            <div className="flex gap-1">
              <Button
                kind="ghost"
                disabled={offset === 0}
                onClick={() => set("offset", String(Math.max(0, offset - PAGE)))}
              >
                ← Newer
              </Button>
              <Button
                kind="ghost"
                disabled={offset + PAGE >= sessions.data.total}
                onClick={() => {
                  const next = new URLSearchParams(q);
                  next.set("offset", String(offset + PAGE));
                  navigate(`/sessions?${next}`);
                }}
              >
                Older →
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
