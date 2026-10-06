import { useQuery } from "@tanstack/react-query";
import { get } from "../api";
import { Empty, ErrorBox, Loading, OutcomeBar, Status } from "../components/ui";
import { agentName, ago } from "../format";
import { Link, navigate, query } from "../router";
import type { ThreadItem } from "../types";

const FILTERS = ["all", "dangling", "active", "landed", "abandoned", "unknown"];

export function ThreadsPage({ path }: { path: string }) {
  const status = query(path).get("status") ?? "all";
  const threads = useQuery({
    queryKey: ["threads", status],
    queryFn: () => get<ThreadItem[]>(`/v1/threads${status === "all" ? "" : `?status=${status}`}`),
  });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Threads</h1>
          <p className="text-sm text-muted">
            Units of work reconstructed across sessions, days and agents.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-line bg-panel p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => navigate(f === "all" ? "/threads" : `/threads?status=${f}`)}
              className={`rounded-md px-2.5 py-1 text-xs capitalize ${status === f ? "bg-panel-2 font-medium" : "text-muted"}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      {threads.isLoading && <Loading />}
      {threads.error && <ErrorBox error={threads.error} />}
      {threads.data && threads.data.length === 0 && <Empty title="No threads" />}
      {threads.data && threads.data.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-line bg-panel">
          <table className="w-full table-fixed text-sm">
            <thead className="border-b border-line text-left text-xs text-muted">
              <tr>
                <th className="w-[44%] px-4 py-2 font-medium">Thread</th>
                <th className="w-[17%] px-2 py-2 font-medium">Agents</th>
                <th className="hidden w-[8%] px-2 py-2 font-medium md:table-cell">Sessions</th>
                <th className="hidden w-[14%] px-2 py-2 font-medium lg:table-cell">Outcomes</th>
                <th className="w-[11%] px-2 py-2 font-medium">Status</th>
                <th className="w-[11%] px-4 py-2 text-right font-medium">Last active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {threads.data.slice(0, 300).map((t) => (
                <tr key={t.id} className="hover:bg-panel-2/60">
                  <td className="max-w-0 px-4 py-2.5">
                    <Link
                      to={`/threads/${t.id}`}
                      className="block truncate font-medium hover:underline"
                    >
                      {t.title}
                    </Link>
                    <div className="truncate text-xs text-muted">{t.repo}</div>
                  </td>
                  <td className="whitespace-nowrap px-2 text-xs text-ink-2">
                    {t.providers.map(agentName).join(" + ")}
                  </td>
                  <td className="tabular hidden px-2 text-xs text-ink-2 md:table-cell">
                    {t.sessionIds.length}
                  </td>
                  <td className="hidden px-2 lg:table-cell">
                    <OutcomeBar dist={t.outcomeMix} height="h-1.5" />
                  </td>
                  <td className="px-2">
                    <Status value={t.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 text-right text-xs text-muted">
                    {ago(t.lastActivityAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
