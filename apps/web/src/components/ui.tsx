import type { ReactNode } from "react";
import type { Distribution, OutcomeClass, Provenance } from "../types";

const PROVENANCE: Record<Provenance, { label: string; help: string; cls: string }> = {
  observed: {
    label: "Observed",
    help: "Read directly from agent session files or git.",
    cls: "text-ink-2 border-line",
  },
  derived: {
    label: "Derived",
    help: "Computed deterministically from observed data.",
    cls: "text-accent border-accent/40",
  },
  inferred: {
    label: "Inferred",
    help: "A heuristic that may be wrong.",
    cls: "text-warn border-warn/50",
  },
  generated: {
    label: "Generated",
    help: "Written by an LLM from structured facts.",
    cls: "text-partial border-partial/50",
  },
};

export function ProvenanceChip({ value }: { value: Provenance }) {
  const p = PROVENANCE[value];
  return (
    <span
      title={p.help}
      className={`inline-flex items-center rounded border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide ${p.cls}`}
    >
      {p.label}
    </span>
  );
}

export const OUTCOME: Record<
  OutcomeClass,
  { label: string; color: string; icon: string; help: string }
> = {
  landed: {
    label: "Landed",
    color: "bg-landed",
    icon: "✓",
    help: "The agent's lines appear in a commit made after the edit.",
  },
  uncommitted: {
    label: "Uncommitted",
    color: "bg-uncommitted",
    icon: "◐",
    help: "Still in the working tree, never committed.",
  },
  partial: {
    label: "Partial",
    color: "bg-partial",
    icon: "◔",
    help: "Some lines matched, below the thresholds.",
  },
  lost: {
    label: "Lost",
    color: "bg-lost",
    icon: "✕",
    help: "Neither committed nor in the working tree.",
  },
  superseded: {
    label: "Superseded",
    color: "bg-unknown",
    icon: "↺",
    help: "Replaced later by the same session.",
  },
  unknown: {
    label: "Unknown",
    color: "bg-unknown",
    icon: "?",
    help: "Could not be judged (no repo, git error, or no signal).",
  },
};

const ORDER: OutcomeClass[] = ["landed", "uncommitted", "partial", "lost"];

export function OutcomeBar({
  dist,
  height = "h-2.5",
  legend = false,
}: {
  dist: Distribution;
  height?: string;
  legend?: boolean;
}) {
  const total = ORDER.reduce((n, k) => n + (dist[k] ?? 0), 0);
  return (
    <div>
      <div
        className={`flex ${height} w-full overflow-hidden rounded-full bg-panel-2`}
        role="img"
        aria-label={ORDER.map((k) => `${OUTCOME[k].label} ${dist[k] ?? 0}`).join(", ")}
      >
        {total > 0 &&
          ORDER.map((k) =>
            dist[k] ? (
              <span
                key={k}
                className={OUTCOME[k].color}
                style={{ width: `${((dist[k] ?? 0) / total) * 100}%` }}
                title={`${OUTCOME[k].label}: ${dist[k]}`}
              />
            ) : null,
          )}
      </div>
      {legend && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          {ORDER.map((k) => (
            <li key={k} className="flex items-center gap-1.5" title={OUTCOME[k].help}>
              <span className={`inline-block h-2 w-2 rounded-sm ${OUTCOME[k].color}`} />
              {OUTCOME[k].label}
              <span className="tabular text-muted">
                {dist[k] ?? 0}
                {total ? ` · ${Math.round(((dist[k] ?? 0) / total) * 100)}%` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OutcomeBadge({ cls }: { cls: OutcomeClass }) {
  const o = OUTCOME[cls];
  return (
    <span
      title={o.help}
      className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs text-ink-2"
    >
      <span
        className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] text-white ${o.color}`}
      >
        {o.icon}
      </span>
      {o.label}
    </span>
  );
}

const STATUS_STYLE: Record<string, string> = {
  completed: "text-landed",
  landed: "text-landed",
  active: "text-accent",
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
  failed: "✕",
  interrupted: "‖",
  "awaiting-user": "?",
  dangling: "◐",
  abandoned: "○",
  unknown: "○",
};

export function Status({ value }: { value: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${STATUS_STYLE[value] ?? "text-muted"}`}
    >
      <span aria-hidden>{STATUS_ICON[value] ?? "○"}</span>
      {value.replace("-", " ")}
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
          <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
          {aside && <div className="flex items-center gap-2 text-xs text-muted">{aside}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Metric({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3" title={hint}>
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular mt-0.5 text-2xl font-semibold tracking-tight text-ink">{value}</div>
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
  return <div className="animate-pulse py-10 text-center text-sm text-muted">Loading…</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">
      {error instanceof Error ? error.message : "Something went wrong."}
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
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <code className={`font-mono text-[12px] text-ink-2 ${className}`}>{children}</code>;
}
