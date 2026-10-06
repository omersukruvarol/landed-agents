import { useQuery } from "@tanstack/react-query";
import { get } from "../api";
import {
  Card,
  Empty,
  ErrorBox,
  Loading,
  Mono,
  OutcomeBadge,
  ProvenanceChip,
  Status,
} from "../components/ui";
import { agentName, dateTime, short, time, tokens } from "../format";
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

export function SessionDetailPage({ id }: { id: string }) {
  const data = useQuery({
    queryKey: ["session", id],
    queryFn: () => get<SessionDetail>(`/v1/sessions/${id}`),
  });
  if (data.isLoading) return <Loading />;
  if (data.error) return <ErrorBox error={data.error} />;
  const d = data.data as SessionDetail;
  const s = d.session;
  const m = d.meta;
  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs text-muted">
          <Link to="/sessions" className="hover:underline">
            Sessions
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
        <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight">
          {s.title ?? "Untitled session"}{" "}
          {m.titleProvenance && <ProvenanceChip value={m.titleProvenance as never} />}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
          <Status value={s.status} />
          <span>{agentName(s.provider)}</span>
          {m.model && <span>{String(m.model)}</span>}
          <span>{s.repo ?? "no repo"}</span>
          {m.gitBranchEnd && <Mono>{String(m.gitBranchEnd)}</Mono>}
          <span>
            {dateTime(s.startedAt)} → {time(s.lastEventAt)}
          </span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-2">
          <Card title={`Files · ${d.files.length}`} aside={<ProvenanceChip value="derived" />}>
            {d.files.length === 0 ? (
              <Empty title="No file edits in this session" />
            ) : (
              <ul className="space-y-2">
                {d.files.map((f) => (
                  <li key={f.relPath}>
                    <div className="flex items-center justify-between gap-2">
                      <Mono className="truncate">{f.relPath}</Mono>
                      {f.outcome && <OutcomeBadge cls={f.outcome.class} />}
                    </div>
                    <div className="text-[11px] text-muted">
                      {f.edits} edits · +{f.added} −{f.removed}
                      {f.outcome?.firstCommit &&
                        ` · in ${short(f.outcome.firstCommit.sha)}${f.outcome.firstCommit.subject ? ` “${f.outcome.firstCommit.subject}”` : ""}`}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Usage" aside={<span>coverage: {String(m.usageCoverage ?? "none")}</span>}>
            <dl className="grid grid-cols-3 gap-2 text-center">
              {[
                ["Input", m.inputTokens],
                ["Cached", m.cachedInputTokens],
                ["Output", m.outputTokens],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="tabular font-semibold">{tokens(v as number | undefined)}</dd>
                </div>
              ))}
            </dl>
          </Card>
          {d.insights.length > 0 && (
            <Card title="Insights">
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
            <Card title={`Subagents · ${d.subagents.length}`}>
              <ul className="space-y-1 text-sm">
                {d.subagents.map((x) => (
                  <li key={x.id} className="flex justify-between gap-2">
                    <Link to={`/sessions/${x.id}`} className="truncate hover:underline">
                      {x.title ?? `${agentName(x.provider)} subagent`}
                    </Link>
                    <Status value={x.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card
          title="Timeline"
          className="lg:col-span-3"
          aside={<ProvenanceChip value="observed" />}
        >
          {d.timeline.length === 0 ? (
            <Empty title="No events" />
          ) : (
            <ol className="relative space-y-1.5 border-l border-line pl-4">
              {d.timeline.map((e) => (
                <li key={`${e.at}-${e.type}-${e.label}-${e.detail ?? ""}`} className="text-sm">
                  <span
                    className="absolute -left-[3px] mt-2 h-1.5 w-1.5 rounded-full bg-line"
                    aria-hidden
                  />
                  <div className="flex items-baseline gap-2">
                    <span className="tabular w-16 shrink-0 whitespace-nowrap text-[11px] text-muted">
                      {time(e.at)}
                    </span>
                    <span className={`font-medium ${TYPE_COLOR[e.type] ?? "text-ink-2"}`}>
                      {e.label}
                      {e.count > 1 && <span className="font-normal text-muted"> ×{e.count}</span>}
                      {e.status === "failure" && (
                        <span className="ml-1 text-xs font-normal text-danger">failed</span>
                      )}
                    </span>
                  </div>
                  {e.detail && (
                    <Mono className="ml-[4.5rem] block truncate text-muted">{e.detail}</Mono>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
