import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { get, send } from "../api";
import { day, daysSince } from "../format";
import { type Dict, useI18n } from "../i18n";
import { Link } from "../router";
import type { Loop } from "../types";
import { Button, CopyButton, Mono } from "./ui";

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** A read-only git command that shows exactly what the loop is about, when there is one. */
export function loopCommand(l: Loop): string | undefined {
  if (!l.repoRoot) return undefined;
  const cd = `cd ${sh(l.repoRoot)}`;
  const branch = typeof l.evidence.branch === "string" ? l.evidence.branch : undefined;
  const main = l.defaultBranch ?? "main";
  if (l.type === "uncommitted-output") return `${cd} && git status`;
  if (l.type === "unmerged-agent-branch")
    return branch
      ? `${cd} && git log --oneline ${sh(main)}..${sh(branch)}`
      : `${cd} && git branch -a --no-merged ${sh(main)}`;
  return undefined;
}

/** The plain-language sentence, reason and next step for a loop. */
export function loopCopy(t: Dict, l: Loop) {
  const repo = l.repo ?? t.common.unknownRepo;
  const days = Math.max(1, daysSince(l.since));
  const branch = typeof l.evidence.branch === "string" ? l.evidence.branch : undefined;
  switch (l.type) {
    case "uncommitted-output": {
      const c = t.loop["uncommitted-output"];
      return { title: c.title(repo, l.size.files ?? 0, days), why: c.why, todo: c.todo };
    }
    case "unmerged-agent-branch": {
      const c = t.loop["unmerged-agent-branch"];
      const main = (l.defaultBranch ?? "main").replace(/^origin\//, "");
      return { title: c.title(repo, branch, days), why: c.why(main), todo: c.todo };
    }
    case "lost-work": {
      const c = t.loop["lost-work"];
      return { title: c.title(repo, l.size.lines ?? 0), why: c.why, todo: c.todo };
    }
    case "failed-unresolved": {
      const c = t.loop["failed-unresolved"];
      return {
        title: c.title(l.repo ?? t.common.unknownRepo, l.evidence.status === "interrupted"),
        why: c.why,
        todo: c.todo,
      };
    }
    case "awaiting-user": {
      const c = t.loop["awaiting-user"];
      return { title: c.title(repo), why: c.why, todo: c.todo };
    }
    default: {
      const c = t.loop["orphan-worktree"];
      return { title: c.title(repo), why: c.why, todo: c.todo };
    }
  }
}

export function LoopCard({ loop: l }: { loop: Loop }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [showFiles, setShowFiles] = useState(false);
  const act = useMutation({
    mutationFn: ({ action, reason }: { action: string; reason?: string }) =>
      send("POST", `/v1/loops/${l.id}`, { action, ...(reason ? { reason } : {}) }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const c = loopCopy(t, l);
  const command = loopCommand(l);
  const files = Array.isArray(l.evidence.files) ? (l.evidence.files as string[]) : [];
  const size = [
    l.size.files ? t.common.files(l.size.files) : "",
    l.size.lines ? t.common.lines(l.size.lines) : "",
    l.size.commits ? t.common.commits(l.size.commits) : "",
  ].filter(Boolean);
  const tone =
    l.type === "lost-work" || l.type === "failed-unresolved"
      ? "border-l-danger"
      : l.type === "awaiting-user"
        ? "border-l-accent"
        : "border-l-warn";
  const target = l.threadId
    ? `/threads/${l.threadId}`
    : l.sessionIds[0]
      ? `/sessions/${l.sessionIds[0]}`
      : undefined;

  return (
    <article className={`rounded-xl border border-line border-l-4 bg-panel p-4 ${tone}`}>
      <h3 className="text-[15px] font-semibold leading-snug text-ink">{c.title}</h3>
      <div className="mt-0.5 text-xs text-muted">
        {[t.loop.since(day(l.since, lang)), ...size].join(" · ")}
      </div>
      <dl className="mt-3 space-y-1.5 text-sm">
        <div>
          <dt className="inline font-medium text-ink">{t.loop.why}: </dt>
          <dd className="inline text-ink-2">{c.why}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-ink">{t.loop.todo}: </dt>
          <dd className="inline text-ink-2">{c.todo}</dd>
        </div>
      </dl>
      {l.dismissReason !== undefined && l.state === "dismissed" && (
        <p className="mt-2 text-xs text-muted">{t.loop.dismissed(l.dismissReason ?? "")}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {l.state === "open" ? (
          <>
            {command && (
              <CopyButton text={() => command} title={`${t.loop.commandHelp}: ${command}`}>
                {t.loop.copyCommand}
              </CopyButton>
            )}
            {l.threadId && (
              <CopyButton
                text={() => get<string>(`/v1/threads/${l.threadId}/resume`)}
                title={t.loop.handoffHelp}
              >
                {t.loop.handoff}
              </CopyButton>
            )}
            <Button
              disabled={act.isPending}
              onClick={() => act.mutate({ action: "resolve" })}
              title={t.loop.resolveHelp}
            >
              {t.loop.resolve}
            </Button>
            <Button
              kind="ghost"
              disabled={act.isPending}
              onClick={() => {
                const reason = window.prompt(t.loop.dismissPrompt);
                if (reason === null) return;
                act.mutate({ action: "dismiss", ...(reason ? { reason } : {}) });
              }}
            >
              {t.loop.dismiss}
            </Button>
          </>
        ) : (
          <Button disabled={act.isPending} onClick={() => act.mutate({ action: "reopen" })}>
            {t.loop.reopen}
          </Button>
        )}
        <span className="ml-auto flex items-center gap-3 text-xs">
          {files.length > 0 && (
            <button
              type="button"
              className="text-ink-2 hover:underline"
              onClick={() => setShowFiles(!showFiles)}
            >
              {showFiles ? t.loop.hideFiles : t.loop.showFiles(l.size.files ?? files.length)}
            </button>
          )}
          {target && (
            <Link to={target} className="text-accent hover:underline">
              {t.loop.openWork} →
            </Link>
          )}
        </span>
      </div>
      {showFiles && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {files.map((f) => (
            <li key={f}>
              <Mono className="rounded bg-panel-2 px-1.5 py-0.5">{f}</Mono>
            </li>
          ))}
          {(l.size.files ?? 0) > files.length && (
            <li className="text-xs text-muted">
              {t.common.more((l.size.files ?? 0) - files.length)}
            </li>
          )}
        </ul>
      )}
    </article>
  );
}
