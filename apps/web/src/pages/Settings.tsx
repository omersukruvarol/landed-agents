import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { get, send } from "../api";
import { Button, Card, ErrorBox, Loading, Mono } from "../components/ui";
import { agentName, dateTime, pct } from "../format";
import type { Settings } from "../types";

export function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => get<Settings>("/v1/settings"),
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => send("PUT", "/v1/settings/summarizer", { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
  const notify = useMutation({
    mutationFn: (enabled: boolean) => send("PUT", "/v1/settings/notifications", { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
  const [ignoreDraft, setIgnoreDraft] = useState<string | undefined>(undefined);
  const saveIgnore = useMutation({
    mutationFn: (ignorePaths: string[]) =>
      send<{ ignorePaths: string[]; openLoops: { resolved: number } }>(
        "PUT",
        "/v1/settings/loops",
        { ignorePaths },
      ),
    onSuccess: () => {
      setIgnoreDraft(undefined);
      for (const key of [["settings"], ["loops"], ["today"]])
        qc.invalidateQueries({ queryKey: key });
    },
  });
  const [days, setDays] = useState(30);
  const [names, setNames] = useState(false);
  if (settings.isLoading) return <Loading />;
  if (settings.error) return <ErrorBox error={settings.error} />;
  const s = settings.data as Settings;
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      <Card
        title="Sources"
        aside={
          s.lastScan && (
            <span>
              Last scan {dateTime(s.lastScan.at)} · {(s.lastScan.durationMs / 1000).toFixed(1)}s
            </span>
          )
        }
      >
        <ul className="space-y-1.5 text-sm">
          {s.sources.map((src) => (
            <li key={src.provider} className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{agentName(src.provider)}</span>
              <Mono>{src.rootPath}</Mono>
              <span className={src.exists ? "text-xs text-landed" : "text-xs text-danger"}>
                {src.exists ? "found" : "missing"}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">
          {s.sessions} sessions read. Landed only reads these folders and your git repositories; it
          never changes agent configuration, session files or repositories.
        </p>
      </Card>

      <Card
        title="Live collection"
        aside={
          <span className={s.live ? "text-landed" : "text-muted"}>
            {s.live ? "watching" : "off"}
          </span>
        }
      >
        <div className="space-y-2 text-sm text-ink-2">
          <p>
            {s.live
              ? "Landed is watching your agents' session files and updates this dashboard within seconds."
              : "This dashboard shows the last scan. Start the background collector for live updates:"}
          </p>
          <ul className="space-y-1 text-xs">
            <li>
              <Mono>landed start</Mono>{" "}
              <span className="text-muted">— collect in the background (</span>
              <Mono>landed autostart on --yes</Mono>
              <span className="text-muted"> to start at login)</span>
            </li>
            <li>
              <Mono>landed plugin install claude --yes</Mono>{" "}
              <span className="text-muted">
                — adds permission-wait and session-end signals from Claude Code
              </span>
            </li>
            <li>
              <Mono>landed hooks install codex --yes</Mono>{" "}
              <span className="text-muted">
                — the same for Codex (your existing hooks are kept)
              </span>
            </li>
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-line pt-2">
            <span>
              Desktop notifications when an agent waits for you or two agents edit the same file
            </span>
            <Button
              onClick={() => notify.mutate(!s.notifications.enabled)}
              disabled={notify.isPending}
            >
              {s.notifications.enabled ? "Turn off" : "Turn on"}
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Open loop exclusions">
        <div className="space-y-2 text-sm text-ink-2">
          <p>
            Files under these repo folders never raise uncommitted, unmerged or lost-work loops. Use
            it for reports and plans agents write for you to read, not to commit. One folder per
            line, relative to the repo root.
          </p>
          <textarea
            aria-label="Folders excluded from open loops"
            className="h-24 w-full rounded-md border border-line bg-panel-2 p-2 font-mono text-xs"
            value={ignoreDraft ?? s.loopIgnorePaths.join("\n")}
            onChange={(e) => setIgnoreDraft(e.target.value)}
          />
          <div className="flex items-center gap-3">
            <Button
              onClick={() =>
                saveIgnore.mutate((ignoreDraft ?? "").split("\n").filter((l) => l.trim()))
              }
              disabled={ignoreDraft === undefined || saveIgnore.isPending}
            >
              {saveIgnore.isPending ? "Saving…" : "Save and re-check loops"}
            </Button>
            {saveIgnore.data && (
              <span className="text-xs text-muted">
                Saved. {saveIgnore.data.openLoops.resolved} loop(s) closed.
              </span>
            )}
            {saveIgnore.error && (
              <span className="text-xs text-danger">{String(saveIgnore.error)}</span>
            )}
          </div>
        </div>
      </Card>

      <Card title="Agent memory (MCP)">
        <div className="space-y-2 text-sm text-ink-2">
          <p>
            Let your agents ask Landed what other agents did in a repo before they start: who is
            editing which files right now, recent work and its outcome, open loops, earlier attempts
            that did not land, and a resume packet for continuing a thread. The tools only read, and
            they return metadata, never prompts or code.
          </p>
          <ul className="space-y-1 text-xs">
            <li>
              <Mono>landed mcp install claude --yes</Mono>{" "}
              <span className="text-muted">— registers it through Claude Code's own CLI</span>
            </li>
            <li>
              <Mono>landed mcp install codex --yes</Mono>{" "}
              <span className="text-muted">— the same for Codex</span>
            </li>
          </ul>
          <p className="text-xs text-muted">
            Undo with <Mono>landed mcp remove claude</Mono> or <Mono>landed mcp remove codex</Mono>.
          </p>
        </div>
      </Card>

      <Card title="Privacy">
        <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[180px_1fr]">
          {Object.entries(s.privacy).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{LABELS[k] ?? k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted">
          Redaction is defence in depth, not a guarantee: commands and file paths can still be
          sensitive.
        </p>
      </Card>

      <Card title="Generated summary (optional)">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm text-ink-2">
            When on, the Today page can ask your installed agent CLI (
            <Mono>{[s.summarizer.command, ...s.summarizer.args].join(" ")}</Mono>) to write a short
            narrative. It receives only structured facts — thread titles, counts, commit subjects —
            never prompts or code. Those facts go to that CLI's vendor.
          </p>
          <Button
            kind={s.summarizer.enabled ? "default" : "primary"}
            onClick={() => toggle.mutate(!s.summarizer.enabled)}
            disabled={toggle.isPending}
          >
            {s.summarizer.enabled ? "Turn off" : "Turn on"}
          </Button>
        </div>
      </Card>

      <Card title="Retro report">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <select
            className="rounded-md border border-line bg-panel px-2 py-1 text-xs"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="Period"
          >
            {[7, 30, 90].map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-ink-2">
            <input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} />{" "}
            Include repo names
          </label>
          <a
            className="text-xs font-medium text-accent hover:underline"
            href={`/v1/report?days=${days}${names ? "&names=1" : ""}`}
            target="_blank"
            rel="noreferrer"
          >
            Open shareable report →
          </a>
        </div>
        <p className="mt-2 text-xs text-muted">
          A self-contained page with aggregates only. By default it contains no repo names, paths,
          code or prompts.
        </p>
      </Card>

      <Card title="Diagnostics">
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[180px_1fr]">
          <dt className="text-muted">Data folder</dt>
          <dd>
            <Mono>{s.dataDir}</Mono>
          </dd>
          <dt className="text-muted">Database</dt>
          <dd>{(s.dbBytes / 2 ** 20).toFixed(1)} MB</dd>
          <dt className="text-muted">Unparseable lines</dt>
          <dd>{s.ingestionFailures}</dd>
        </dl>
        <table className="mt-3 w-full text-xs">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-1 font-medium">Repository</th>
              <th className="py-1 font-medium">Default branch</th>
              <th
                className="py-1 font-medium"
                title="Self-check: share of edits matching earlier commits / unrelated files"
              >
                Self-check A / B
              </th>
              <th className="py-1 font-medium">Confidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {s.repos.map((r) => (
              <tr key={r.rootPath}>
                <td className="max-w-0 truncate py-1 pr-2">
                  <Mono>{r.rootPath}</Mono>
                </td>
                <td className="py-1">{r.defaultBranch ?? "—"}</td>
                <td className="tabular py-1">
                  {r.controlA === undefined || r.controlA === null
                    ? "—"
                    : `${pct(r.controlA)} / ${pct(r.controlB ?? 0)}`}
                </td>
                <td
                  className={`py-1 ${r.missing ? "text-muted" : r.confidence === "low" ? "text-warn" : ""}`}
                >
                  {r.missing ? "missing" : (r.confidence ?? "—")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

const LABELS: Record<string, string> = {
  promptText: "Prompt text",
  codeLines: "Code",
  toolOutput: "Tool output",
  commands: "Commands",
  network: "Network",
};
