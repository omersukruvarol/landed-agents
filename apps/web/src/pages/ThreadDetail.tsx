import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { get } from "../api";
import {
  Button,
  Card,
  ErrorBox,
  Loading,
  Mono,
  OutcomeBadge,
  ProvenanceChip,
  Status,
} from "../components/ui";
import { agentName, dateTime, short } from "../format";
import { Link } from "../router";
import type { ThreadDetail } from "../types";

const LINK_TEXT: Record<string, string> = {
  continuation: "subagent of",
  "same-branch": "same branch as",
  "file-overlap": "edited the same files as",
  "line-overlap": "changed lines added by",
};

export function ThreadDetailPage({ id }: { id: string }) {
  const data = useQuery({
    queryKey: ["thread", id],
    queryFn: () => get<ThreadDetail>(`/v1/threads/${id}`),
  });
  const [copied, setCopied] = useState(false);
  if (data.isLoading) return <Loading />;
  if (data.error) return <ErrorBox error={data.error} />;
  const d = data.data as ThreadDetail;
  const t = d.thread;
  const names = new Map(d.sessions.map((s, i) => [s.id, `#${i + 1}`]));
  const copy = async () => {
    await navigator.clipboard.writeText(await get<string>(`/v1/threads/${id}/resume`));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-muted">
            <Link to="/threads" className="hover:underline">
              Threads
            </Link>{" "}
            / {t.repo}
          </div>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight">
            {t.title} <ProvenanceChip value={t.titleProvenance} />
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
            <Status value={t.status} />
            <span>{t.providers.map(agentName).join(" + ")}</span>
            {t.branch && <Mono>{t.branch}</Mono>}
            <span>
              {dateTime(t.startedAt)} → {dateTime(t.lastActivityAt)}
            </span>
          </div>
        </div>
        <Button onClick={copy} title="A plain-text handoff for continuing this work in any agent">
          {copied ? "Copied" : "Copy resume context"}
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card title={`Sessions · ${d.sessions.length}`} className="lg:col-span-3">
          <ol className="space-y-2">
            {d.sessions.map((s) => {
              const ev = t.linkEvidence.find((l) => l.toSessionId === s.id);
              return (
                <li key={s.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <Link to={`/sessions/${s.id}`} className="font-medium hover:underline">
                      {names.get(s.id)} {s.title ?? agentName(s.provider)}
                    </Link>
                    <div className="text-xs text-muted">
                      {agentName(s.provider)} · {dateTime(s.startedAt)} · {s.changedFileCount} files
                      {ev &&
                        ` · ${LINK_TEXT[ev.kind] ?? ev.kind} ${names.get(ev.fromSessionId) ?? "an earlier session"}`}
                    </div>
                  </div>
                  <Status value={s.status} />
                </li>
              );
            })}
          </ol>
        </Card>
        <Card title="Files" className="lg:col-span-2" aside={<ProvenanceChip value="derived" />}>
          <ul className="space-y-1.5">
            {d.outcomes
              .filter((o) => o.class !== "unknown")
              .map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2">
                  <Mono className="truncate">{o.relPath}</Mono>
                  <span className="flex shrink-0 items-center gap-2">
                    {o.firstCommit && (
                      <Mono className="text-muted">{short(o.firstCommit.sha)}</Mono>
                    )}
                    <OutcomeBadge cls={o.class} />
                  </span>
                </li>
              ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
