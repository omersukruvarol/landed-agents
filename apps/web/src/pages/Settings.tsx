import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { get, send } from "../api";
import { Button, Card, ErrorBox, Loading, Mono, PageTitle, Segmented } from "../components/ui";
import { agentName, dateTime, pctFor } from "../format";
import { type Lang, useI18n } from "../i18n";
import type { Settings } from "../types";

export function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const st = t.settings;
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
      qc.invalidateQueries();
    },
  });
  const [days, setDays] = useState(30);
  const [names, setNames] = useState(false);
  if (settings.isLoading) return <Loading />;
  if (settings.error) return <ErrorBox error={settings.error} />;
  const s = settings.data as Settings;
  return (
    <div className="space-y-5">
      <PageTitle title={st.title} />

      <Card title={st.languageTitle}>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-2">
          <span>{st.languageBody}</span>
          <Segmented<Lang>
            value={lang}
            options={[
              ["Türkçe", "tr"],
              ["English", "en"],
            ]}
            onChange={setLang}
          />
        </div>
      </Card>

      <Card
        title={st.sourcesTitle}
        aside={
          s.lastScan && (
            <span>
              {st.lastScan(
                dateTime(s.lastScan.at, lang),
                (s.lastScan.durationMs / 1000).toLocaleString(lang, { maximumFractionDigits: 1 }),
              )}
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
                {src.exists ? st.found : st.missing}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">{st.sourcesNote(s.sessions)}</p>
      </Card>

      <Card
        title={st.liveTitle}
        aside={
          <span className={s.live ? "text-landed" : "text-muted"}>
            {s.live ? st.liveOn : st.liveOff}
          </span>
        }
      >
        <div className="space-y-2 text-sm text-ink-2">
          <p>{s.live ? st.liveBodyOn : st.liveBodyOff}</p>
          <ul className="space-y-1 text-xs">
            <li>
              <Mono>landed start</Mono> <span className="text-muted">— {st.liveStart}</span>
            </li>
            <li>
              <Mono>landed autostart on --yes</Mono>{" "}
              <span className="text-muted">— {st.liveAutostart}</span>
            </li>
            <li>
              <Mono>landed plugin install claude --yes</Mono>{" "}
              <span className="text-muted">— {st.livePlugin}</span>
            </li>
            <li>
              <Mono>landed hooks install codex --yes</Mono>{" "}
              <span className="text-muted">— {st.liveHooks}</span>
            </li>
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-line pt-2">
            <span>{st.notifications}</span>
            <Button
              onClick={() => notify.mutate(!s.notifications.enabled)}
              disabled={notify.isPending}
            >
              {s.notifications.enabled ? st.turnOff : st.turnOn}
            </Button>
          </div>
        </div>
      </Card>

      <Card title={st.excludeTitle}>
        <div className="space-y-2 text-sm text-ink-2">
          <p>{st.excludeBody}</p>
          <textarea
            aria-label={st.excludeTitle}
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
              {saveIgnore.isPending ? st.saving : st.excludeSave}
            </Button>
            {saveIgnore.data && (
              <span className="text-xs text-muted">
                {st.excludeSaved(saveIgnore.data.openLoops.resolved)}
              </span>
            )}
            {saveIgnore.error && (
              <span className="text-xs text-danger">{String(saveIgnore.error)}</span>
            )}
          </div>
        </div>
      </Card>

      <Card title={st.mcpTitle}>
        <div className="space-y-2 text-sm text-ink-2">
          <p>{st.mcpBody}</p>
          <ul className="space-y-1 text-xs">
            <li>
              <Mono>landed mcp install claude --yes</Mono>{" "}
              <span className="text-muted">— {st.mcpClaude}</span>
            </li>
            <li>
              <Mono>landed mcp install codex --yes</Mono>{" "}
              <span className="text-muted">— {st.mcpCodex}</span>
            </li>
          </ul>
          <p className="text-xs text-muted">
            {st.mcpUndo} <Mono>landed mcp remove claude</Mono> ·{" "}
            <Mono>landed mcp remove codex</Mono>
          </p>
        </div>
      </Card>

      <Card title={st.privacyTitle}>
        <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[180px_1fr]">
          {st.privacy.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted">{st.privacyNote}</p>
      </Card>

      <Card title={st.summaryTitle}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm text-ink-2">
            {st.summaryBody([s.summarizer.command, ...s.summarizer.args].join(" "))}
          </p>
          <Button
            kind={s.summarizer.enabled ? "default" : "primary"}
            onClick={() => toggle.mutate(!s.summarizer.enabled)}
            disabled={toggle.isPending}
          >
            {s.summarizer.enabled ? st.turnOff : st.turnOn}
          </Button>
        </div>
      </Card>

      <Card title={st.reportTitle}>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <select
            className="rounded-md border border-line bg-panel px-2 py-1 text-xs"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label={st.reportTitle}
          >
            {[7, 30, 90].map((d) => (
              <option key={d} value={d}>
                {st.reportLast(d)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-ink-2">
            <input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} />{" "}
            {st.reportNames}
          </label>
          <a
            className="text-xs font-medium text-accent hover:underline"
            href={`/v1/report?days=${days}${names ? "&names=1" : ""}`}
            target="_blank"
            rel="noreferrer"
          >
            {st.reportOpen}
          </a>
        </div>
        <p className="mt-2 text-xs text-muted">{st.reportNote}</p>
      </Card>

      <Card title={st.diagTitle}>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[180px_1fr]">
          <dt className="text-muted">{st.dataFolder}</dt>
          <dd>
            <Mono>{s.dataDir}</Mono>
          </dd>
          <dt className="text-muted">{st.database}</dt>
          <dd>{(s.dbBytes / 2 ** 20).toLocaleString(lang, { maximumFractionDigits: 1 })} MB</dd>
          <dt className="text-muted">{st.badLines}</dt>
          <dd>{s.ingestionFailures}</dd>
        </dl>
        <table className="mt-3 w-full text-xs">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-1 font-medium">{st.repo}</th>
              <th className="py-1 font-medium">{st.defaultBranch}</th>
              <th className="py-1 font-medium" title={st.selfCheckHelp}>
                {st.selfCheck}
              </th>
              <th className="py-1 font-medium">{st.confidence}</th>
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
                    : `${pctFor(r.controlA, lang)} / ${pctFor(r.controlB ?? 0, lang)}`}
                </td>
                <td
                  className={`py-1 ${r.missing ? "text-muted" : r.confidence === "low" ? "text-warn" : ""}`}
                >
                  {r.missing
                    ? st.missing
                    : r.confidence === "low"
                      ? st.approximate
                      : r.confidence
                        ? st.reliable
                        : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
