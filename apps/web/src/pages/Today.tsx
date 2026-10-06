import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, send } from "../api";
import {
  Button,
  Card,
  Empty,
  ErrorBox,
  Loading,
  Metric,
  Mono,
  OutcomeBar,
  ProvenanceChip,
  Status,
} from "../components/ui";
import { age, agentName, ago, day, localDate, pct, shiftDate, tokens } from "../format";
import { Link, navigate, query } from "../router";
import type { Settings, Today } from "../types";

export function TodayPage({ path }: { path: string }) {
  const date = query(path).get("date") ?? localDate();
  const qc = useQueryClient();
  const today = useQuery({
    queryKey: ["today", date],
    queryFn: () => get<Today>(`/v1/today?date=${date}`),
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => get<Settings>("/v1/settings"),
  });
  const generate = useMutation({
    mutationFn: () => send("POST", `/v1/brief/generate?date=${date}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["today", date] }),
  });
  const isToday = date === localDate();

  if (today.isLoading) return <Loading />;
  if (today.error) return <ErrorBox error={today.error} />;
  const t = today.data as Today;
  const b = t.brief;
  const mix = b.outcomeMix;
  const known = (mix.landed ?? 0) + (mix.uncommitted ?? 0) + (mix.partial ?? 0) + (mix.lost ?? 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {isToday ? "Today" : day(`${date}T12:00:00`)}
          </h1>
          <p className="text-sm text-muted">
            What your agents' work became, and what needs you next.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button kind="ghost" onClick={() => navigate(`/?date=${shiftDate(date, -1)}`)}>
            ← Previous day
          </Button>
          {!isToday && (
            <Button kind="ghost" onClick={() => navigate("/")}>
              Today
            </Button>
          )}
          {!isToday && (
            <Button kind="ghost" onClick={() => navigate(`/?date=${shiftDate(date, 1)}`)}>
              Next day →
            </Button>
          )}
          <a
            className="ml-2 text-xs text-accent hover:underline"
            href={`/v1/brief?date=${date}&format=md`}
            target="_blank"
            rel="noreferrer"
          >
            Markdown
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric
          label="Agent sessions"
          value={b.activity.sessions}
          hint="Top-level sessions active this day (subagents excluded)"
        />
        <Metric
          label="Agents"
          value={
            <span className="text-base font-medium">
              {b.activity.providers.map(agentName).join(" · ") || "—"}
            </span>
          }
        />
        <Metric label="Repos touched" value={b.activity.repos} />
        <Metric
          label="Edits that landed"
          value={known ? pct((mix.landed ?? 0) / known) : "—"}
          hint="Share of session × file outcomes classified as landed"
        />
        <Metric
          label="Open loops"
          value={b.openLoops.open}
          hint={`${b.openLoops.newToday} new this day`}
        />
      </div>

      {t.running.length > 0 && (
        <Card
          title={`Running now · ${t.running.length}`}
          aside={<ProvenanceChip value="derived" />}
        >
          <ul className="divide-y divide-line">
            {t.running.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <Link
                    to={`/sessions/${s.id}`}
                    className="flex items-center gap-2 truncate text-sm font-medium hover:underline"
                  >
                    <span
                      className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-landed"
                      aria-hidden
                    />
                    {s.title ?? `${agentName(s.provider)} session`}
                  </Link>
                  <div className="text-xs text-muted">
                    {agentName(s.provider)} · {s.repo ?? "no repo"} · {s.changedFileCount} files ·
                    last activity {ago(s.lastEventAt)}
                  </div>
                </div>
                {s.status === "awaiting-user" ? (
                  <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">
                    Waiting for you
                  </span>
                ) : (
                  <Status value="active" />
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(t.generated || settings.data?.summarizer.enabled) && (
        <Card title="Summary" aside={<ProvenanceChip value="generated" />}>
          {t.generated ? (
            <div className="space-y-2 text-sm leading-relaxed text-ink-2">
              <p>{t.generated.summary}</p>
              {t.generated.attention.length > 0 && (
                <ul className="list-disc pl-5">
                  {t.generated.attention.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 text-sm text-muted">
              <span>
                Ask your agent CLI to write a short narrative from this day's structured facts.
              </span>
              <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
                {generate.isPending ? "Writing…" : "Generate"}
              </Button>
            </div>
          )}
          {generate.isError && (
            <div className="mt-2 text-xs text-danger">{(generate.error as Error).message}</div>
          )}
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <Card title="Where you left off" aside={<ProvenanceChip value="derived" />}>
            {b.whereYouLeftOff.length === 0 ? (
              <Empty title="Nothing unfinished in the last two days" />
            ) : (
              <ul className="divide-y divide-line">
                {b.whereYouLeftOff.map((th) => (
                  <li
                    key={th.id}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <Link
                        to={`/threads/${th.id}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {th.title}
                      </Link>
                      <div className="text-xs text-muted">
                        {th.repo} · {th.providers.map(agentName).join(" + ")}
                      </div>
                    </div>
                    <Status value={th.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="What landed" aside={<ProvenanceChip value="derived" />}>
            {b.landed.length === 0 ? (
              <Empty title="No agent work reached a commit this day" />
            ) : (
              <ul className="space-y-3">
                {b.landed.map((r) => (
                  <li key={r.repo}>
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm font-medium">{r.repo}</span>
                      <span className="tabular text-xs text-muted">
                        {r.files} files · {r.lines} lines
                      </span>
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {r.commits.slice(0, 4).map((c) => (
                        <li key={c.sha} className="flex gap-2 text-xs text-ink-2">
                          <Mono>{c.sha.slice(0, 7)}</Mono>
                          <span className="truncate">{c.subject}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {known > 0 && (
            <Card
              title="Outcome mix of this day's sessions"
              aside={<ProvenanceChip value="derived" />}
            >
              <OutcomeBar dist={mix} legend />
            </Card>
          )}
        </div>

        <div className="space-y-5 lg:col-span-2">
          <Card
            title="Open loops"
            aside={
              <Link to="/loops" className="text-accent hover:underline">
                All {b.openLoops.open} →
              </Link>
            }
          >
            {b.openLoops.top.length === 0 ? (
              <Empty title="No open loops">Everything your agents started is settled.</Empty>
            ) : (
              <ul className="space-y-2.5">
                {b.openLoops.top.map((l) => (
                  <li key={l.id} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{loopTitle(l.type)}</span>
                      <span className="text-xs text-muted">{age(l.since)}</span>
                    </div>
                    <div className="text-xs text-muted">
                      {l.repo}
                      {typeof l.evidence.branch === "string" && (
                        <>
                          {" · "}
                          <Mono>{l.evidence.branch}</Mono>
                        </>
                      )}
                      {l.size.lines ? ` · ${l.size.lines} lines` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Needs attention">
            {b.attention.length === 0 ? (
              <Empty title="Nothing flagged" />
            ) : (
              <ul className="space-y-2">
                {b.attention.map((a) => (
                  <li key={`${a.kind}${a.message}`} className="flex gap-2 text-sm">
                    <span
                      className={
                        a.kind === "failure" || a.kind === "collision" ? "text-danger" : "text-warn"
                      }
                      aria-hidden
                    >
                      ●
                    </span>
                    {a.sessionId ? (
                      <Link to={`/sessions/${a.sessionId}`} className="hover:underline">
                        {a.message}
                      </Link>
                    ) : (
                      <span>{a.message}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Usage"
            aside={
              <span title="Whether every active session reported usage">
                coverage: {b.usage.coverage}
              </span>
            }
          >
            <dl className="grid grid-cols-3 gap-2 text-center">
              {[
                ["Input", b.usage.inputTokens],
                ["Cached", b.usage.cachedInputTokens],
                ["Output", b.usage.outputTokens],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="tabular text-lg font-semibold">{tokens(v as number)}</dd>
                </div>
              ))}
            </dl>
            {b.usage.coverage !== "complete" && (
              <p className="mt-2 text-xs text-muted">
                Some sessions reported no usage, so these totals are a lower bound.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

const TITLES: Record<string, string> = {
  "uncommitted-output": "Uncommitted agent output",
  "unmerged-agent-branch": "Unmerged agent branch",
  "orphan-worktree": "Orphaned worktree",
  "awaiting-user": "Waiting for your answer",
  "failed-unresolved": "Failed, never resolved",
  "lost-work": "Lost agent work",
};
export const loopTitle = (type: string) => TITLES[type] ?? type;
