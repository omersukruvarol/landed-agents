import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { get, send } from "../api";
import { Button, Card, Empty, ErrorBox, Loading, Mono, ProvenanceChip } from "../components/ui";
import { age, day } from "../format";
import { Link } from "../router";
import type { Loop } from "../types";

const HELP: Record<string, string> = {
  "uncommitted-output": "Agent edits still sitting in the working tree for more than a day.",
  "unmerged-agent-branch":
    "Agent work that was committed, but on a branch that never reached the default branch, idle for a week.",
  "awaiting-user": "A session ended while asking you a question, and nothing continued it.",
  "failed-unresolved":
    "A session failed or was interrupted, and no later session in its thread landed work.",
  "lost-work":
    "Substantial agent output that was never committed and is gone from the working tree.",
  "orphan-worktree": "A worktree an agent created that still exists.",
};

export function LoopsPage() {
  const [state, setState] = useState<"open" | "dismissed" | "resolved">("open");
  const qc = useQueryClient();
  const loops = useQuery({
    queryKey: ["loops", state],
    queryFn: () => get<Loop[]>(`/v1/loops?state=${state}`),
  });
  const act = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: string; reason?: string }) =>
      send("POST", `/v1/loops/${id}`, { action, reason }),
    onSuccess: () => qc.invalidateQueries(),
  });

  const groups = new Map<string, Loop[]>();
  for (const l of loops.data ?? []) groups.set(l.type, [...(groups.get(l.type) ?? []), l]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Open loops</h1>
          <p className="text-sm text-muted">
            Agent work left dangling. Loops close on their own when a later scan sees them settled.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-line bg-panel p-0.5">
          {(["open", "dismissed", "resolved"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setState(s)}
              className={`rounded-md px-3 py-1 text-xs capitalize ${state === s ? "bg-panel-2 font-medium" : "text-muted"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      {loops.isLoading && <Loading />}
      {loops.error && <ErrorBox error={loops.error} />}
      {loops.data && loops.data.length === 0 && (
        <Empty title={state === "open" ? "No open loops" : `No ${state} loops`} />
      )}
      {[...groups].map(([type, items]) => (
        <Card
          key={type}
          title={`${items[0]?.label} · ${items.length}`}
          aside={<span className="hidden max-w-md truncate md:inline">{HELP[type]}</span>}
        >
          <ul className="divide-y divide-line">
            {items.map((l) => (
              <LoopRow
                key={l.id}
                loop={l}
                onAction={(action, reason) =>
                  act.mutate({ id: l.id, action, ...(reason ? { reason } : {}) })
                }
                busy={act.isPending}
              />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function LoopRow({
  loop: l,
  onAction,
  busy,
}: {
  loop: Loop;
  onAction: (action: string, reason?: string) => void;
  busy: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const files = Array.isArray(l.evidence.files) ? (l.evidence.files as string[]) : [];
  const commits = Array.isArray(l.evidence.commits) ? (l.evidence.commits as string[]) : [];
  const copyResume = async () => {
    if (!l.threadId) return;
    const text = await get<string>(`/v1/threads/${l.threadId}/resume`);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{l.repo ?? "Unknown repo"}</span>
            {typeof l.evidence.branch === "string" && <Mono>{l.evidence.branch}</Mono>}
            <ProvenanceChip value={l.provenance} />
          </div>
          <div className="mt-0.5 text-xs text-muted">
            Since {day(l.since)} ({age(l.since)}) ·{" "}
            {[
              l.size.files && `${l.size.files} files`,
              l.size.lines && `${l.size.lines} lines`,
              l.size.commits && `${l.size.commits} commits`,
            ]
              .filter(Boolean)
              .join(" · ") || "—"}
            {l.dismissReason && ` · dismissed: ${l.dismissReason}`}
          </div>
          {(files.length > 0 || commits.length > 0) && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {files.slice(0, 6).map((f) => (
                <Mono key={f} className="rounded bg-panel-2 px-1.5 py-0.5">
                  {f}
                </Mono>
              ))}
              {files.length > 6 && (
                <span className="text-xs text-muted">+{files.length - 6} more</span>
              )}
              {commits.slice(0, 4).map((c) => (
                <Mono key={c} className="rounded bg-panel-2 px-1.5 py-0.5">
                  {c.slice(0, 7)}
                </Mono>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {l.threadId && (
            <>
              <Link
                to={`/threads/${l.threadId}`}
                className="rounded-md px-2 py-1 text-xs text-ink-2 hover:bg-panel-2"
              >
                Thread
              </Link>
              <Button
                kind="ghost"
                onClick={copyResume}
                title="Copy a plain-text handoff you can paste into any agent"
              >
                {copied ? "Copied" : "Copy resume context"}
              </Button>
            </>
          )}
          {!l.threadId && l.sessionIds[0] && (
            <Link
              to={`/sessions/${l.sessionIds[0]}`}
              className="rounded-md px-2 py-1 text-xs text-ink-2 hover:bg-panel-2"
            >
              Session
            </Link>
          )}
          {l.state === "open" ? (
            <>
              <Button disabled={busy} onClick={() => onAction("resolve")}>
                Mark resolved
              </Button>
              <Button
                kind="ghost"
                disabled={busy}
                onClick={() =>
                  onAction(
                    "dismiss",
                    window.prompt("Why dismiss this loop? (optional)") ?? undefined,
                  )
                }
              >
                Dismiss
              </Button>
            </>
          ) : (
            <Button disabled={busy} onClick={() => onAction("reopen")}>
              Reopen
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
