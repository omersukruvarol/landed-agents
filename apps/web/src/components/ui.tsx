import { type ReactNode, useState } from "react";
import { pctFor } from "../format";
import { type Dict, useI18n } from "../i18n";
import type { Distribution, OutcomeClass } from "../types";

/** Plain-language label and help for an outcome class. */
export function outcomeText(t: Dict, cls: OutcomeClass): { label: string; help: string } {
  const o = t.outcome;
  switch (cls) {
    case "landed":
      return { label: o.landed, help: o.landedHelp };
    case "uncommitted":
      return { label: o.waiting, help: o.waitingHelp };
    case "partial":
      return { label: o.partial, help: o.partialHelp };
    case "lost":
      return { label: o.lost, help: o.lostHelp };
    case "superseded":
      return { label: o.superseded, help: o.supersededHelp };
    default:
      return { label: o.unknown, help: o.unknownHelp };
  }
}

const COLOR: Record<OutcomeClass, string> = {
  landed: "bg-landed",
  uncommitted: "bg-uncommitted",
  partial: "bg-partial",
  lost: "bg-lost",
  superseded: "bg-unknown",
  unknown: "bg-unknown",
};
const ICON: Record<OutcomeClass, string> = {
  landed: "✓",
  uncommitted: "◐",
  partial: "◔",
  lost: "✕",
  superseded: "↺",
  unknown: "?",
};
const ORDER: OutcomeClass[] = ["landed", "uncommitted", "partial", "lost"];

/** Committed / waiting (uncommitted + partial) / lost: the three things a person needs to know. */
export function splitOutcomes(d: Distribution) {
  return {
    landed: d.landed ?? 0,
    waiting: (d.uncommitted ?? 0) + (d.partial ?? 0),
    lost: d.lost ?? 0,
  };
}

export function OutcomeTiles({
  landed,
  waiting,
  lost,
}: {
  landed: number;
  waiting: number;
  lost: number;
}) {
  const { t } = useI18n();
  const tiles = [
    { n: landed, label: t.outcome.landed, help: t.outcome.landedHelp, icon: "✓", tone: "landed" },
    { n: waiting, label: t.outcome.waiting, help: t.outcome.waitingHelp, icon: "◐", tone: "warn" },
    { n: lost, label: t.outcome.lost, help: t.outcome.lostHelp, icon: "✕", tone: "danger" },
  ];
  const tone: Record<string, string> = {
    landed: "border-landed/30 bg-landed/10 text-landed",
    warn: "border-warn/30 bg-warn/10 text-warn",
    danger: "border-danger/30 bg-danger/10 text-danger",
  };
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {tiles.map((x) => (
        <div key={x.label} className={`rounded-xl border px-4 py-3 ${tone[x.tone]}`}>
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <span aria-hidden>{x.icon}</span>
            {x.label}
          </div>
          <div className="tabular mt-1 text-3xl font-semibold tracking-tight">
            {t.home.tileFiles(x.n)}
          </div>
          <div className="mt-0.5 text-xs opacity-90">{x.help}</div>
        </div>
      ))}
    </div>
  );
}

export function OutcomeBar({
  dist,
  height = "h-2.5",
  legend = false,
}: {
  dist: Distribution;
  height?: string;
  legend?: boolean;
}) {
  const { t, lang } = useI18n();
  const total = ORDER.reduce((n, k) => n + (dist[k] ?? 0), 0);
  return (
    <div>
      <div
        className={`flex ${height} w-full overflow-hidden rounded-full bg-panel-2`}
        role="img"
        aria-label={ORDER.map((k) => `${outcomeText(t, k).label} ${dist[k] ?? 0}`).join(", ")}
      >
        {total > 0 &&
          ORDER.map((k) =>
            dist[k] ? (
              <span
                key={k}
                className={COLOR[k]}
                style={{ width: `${((dist[k] ?? 0) / total) * 100}%` }}
                title={`${outcomeText(t, k).label}: ${dist[k]}`}
              />
            ) : null,
          )}
      </div>
      {legend && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          {ORDER.filter((k) => dist[k]).map((k) => (
            <li key={k} className="flex items-center gap-1.5" title={outcomeText(t, k).help}>
              <span className={`inline-block h-2 w-2 rounded-sm ${COLOR[k]}`} />
              {outcomeText(t, k).label}
              <span className="tabular text-muted">
                {dist[k] ?? 0}
                {total ? ` · ${pctFor((dist[k] ?? 0) / total, lang)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OutcomeBadge({ cls }: { cls: OutcomeClass }) {
  const { t } = useI18n();
  const o = outcomeText(t, cls);
  return (
    <span
      title={o.help}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs text-ink-2"
    >
      <span
        className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] text-white ${COLOR[cls]}`}
      >
        {ICON[cls]}
      </span>
      {o.label}
    </span>
  );
}

const STATUS_STYLE: Record<string, string> = {
  completed: "text-landed",
  landed: "text-landed",
  active: "text-accent",
  running: "text-accent",
  failed: "text-danger",
  interrupted: "text-warn",
  "awaiting-user": "text-warn",
  dangling: "text-warn",
  abandoned: "text-muted",
  unknown: "text-muted",
};
const STATUS_ICON: Record<string, string> = {
  completed: "●",
  landed: "✓",
  active: "◉",
  running: "◉",
  failed: "✕",
  interrupted: "‖",
  "awaiting-user": "?",
  dangling: "◐",
  abandoned: "○",
  unknown: "",
};

export function Status({ value }: { value: string }) {
  const { t } = useI18n();
  const label = t.status[value] ?? value;
  if (label === "—") return <span className="text-xs text-muted">—</span>;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium ${STATUS_STYLE[value] ?? "text-muted"}`}
    >
      <span aria-hidden>{STATUS_ICON[value] ?? "○"}</span>
      {label}
    </span>
  );
}

export function Card({
  title,
  aside,
  children,
  className = "",
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-panel ${className}`}>
      {(title || aside) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {aside && <div className="flex items-center gap-2 text-xs text-muted">{aside}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1 max-w-2xl text-sm text-ink-2">{subtitle}</p>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center">
      <div className="text-sm font-medium text-ink-2">{title}</div>
      {children && <div className="mt-1 text-xs text-muted">{children}</div>}
    </div>
  );
}

export function Loading() {
  const { t } = useI18n();
  return (
    <div className="animate-pulse py-10 text-center text-sm text-muted">{t.common.loading}</div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">
      {error instanceof Error ? error.message : t.common.error}
    </div>
  );
}

export function Button({
  children,
  onClick,
  kind = "default",
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "default" | "primary" | "ghost";
  disabled?: boolean;
  title?: string;
}) {
  const styles = {
    default: "border border-line bg-panel text-ink hover:bg-panel-2",
    primary: "bg-accent text-accent-ink hover:opacity-90",
    ghost: "text-ink-2 hover:bg-panel-2",
  }[kind];
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

/** A button that copies text (or what `text()` resolves to) and says so for a moment. */
export function CopyButton({
  text,
  children,
  title,
  kind = "default",
}: {
  text: () => string | Promise<string>;
  children: ReactNode;
  title?: string;
  kind?: "default" | "primary" | "ghost";
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      kind={kind}
      {...(title ? { title } : {})}
      onClick={async () => {
        await navigator.clipboard.writeText(await text());
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? `✓ ${t.common.copied}` : children}
    </Button>
  );
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <code className={`font-mono text-[12px] text-ink-2 ${className}`}>{children}</code>;
}

/** Segmented control used for tabs and periods. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly (readonly [string, T])[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-line bg-panel p-0.5">
      {options.map(([label, v]) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1 text-xs ${value === v ? "bg-panel-2 font-medium text-ink" : "text-muted hover:text-ink-2"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
