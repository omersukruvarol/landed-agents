import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";
import type { LiveMessage } from "./types";

interface LiveState {
  connected: boolean;
  /** The collector is watching agent history (daemon / `landed open`). */
  live: boolean;
  lastEventAt?: string;
  notices: (LiveMessage & { id: number })[];
  dismiss: (id: number) => void;
}

const Ctx = createContext<LiveState>({
  connected: false,
  live: false,
  notices: [],
  dismiss: () => {},
});
export const useLive = () => useContext(Ctx);

/** Subscribes to /v1/stream and refreshes data when the collector reports changes. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [live, setLive] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<string>();
  const [notices, setNotices] = useState<(LiveMessage & { id: number })[]>([]);
  const seq = useRef(0);
  const refresh = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      source = new EventSource("/v1/stream");
      source.addEventListener("hello", (e) => {
        setConnected(true);
        try {
          setLive(Boolean(JSON.parse((e as MessageEvent).data).live));
        } catch {}
      });
      source.onmessage = (e) => {
        const msg = JSON.parse(e.data) as LiveMessage;
        setLastEventAt(msg.at);
        if (msg.type === "notice") {
          const id = ++seq.current;
          setNotices((n) => [...n.slice(-3), { ...msg, id }]);
          setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 12_000);
        }
        // Coalesce bursts of imports into one refresh.
        if (refresh.current) clearTimeout(refresh.current);
        refresh.current = setTimeout(() => qc.invalidateQueries(), 400);
      };
      source.onerror = () => {
        setConnected(false);
        source?.close();
        retry = setTimeout(connect, 5000);
      };
    };
    connect();
    return () => {
      source?.close();
      if (retry) clearTimeout(retry);
    };
  }, [qc]);

  return (
    <Ctx.Provider
      value={{
        connected,
        live,
        ...(lastEventAt ? { lastEventAt } : {}),
        notices,
        dismiss: (id) => setNotices((n) => n.filter((x) => x.id !== id)),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function LiveIndicator() {
  const { connected, live } = useLive();
  const { t } = useI18n();
  const h = t.header;
  const label = !connected ? h.offline : live ? h.live : h.connected;
  const help = !connected ? h.offlineHelp : live ? h.liveHelp : h.connectedHelp;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={help}>
      <span
        className={`h-2 w-2 rounded-full ${!connected ? "bg-danger" : live ? "animate-pulse bg-landed" : "bg-unknown"}`}
        aria-hidden
      />
      {label}
    </span>
  );
}

export function Toasts() {
  const { notices, dismiss } = useLive();
  const { t } = useI18n();
  if (!notices.length) return null;
  return (
    <div
      className="fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {notices.map((n) => {
        const d = n.detail ?? {};
        const awaiting = d.kind === "awaiting-user";
        const collision = d.kind === "collision";
        const title = awaiting
          ? t.notice.awaitingTitle
          : collision
            ? t.notice.collisionTitle
            : d.title;
        const message = awaiting
          ? t.notice.awaiting(d.repo, d.sessionTitle)
          : collision
            ? t.notice.collision(d.repo, d.relPath)
            : d.message;
        return (
          <div key={n.id} className="rounded-lg border border-line bg-panel p-3 text-sm shadow-lg">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium">{title}</span>
              <button
                type="button"
                onClick={() => dismiss(n.id)}
                className="text-muted hover:text-ink"
                aria-label={t.toast.dismiss}
              >
                ×
              </button>
            </div>
            <p className="mt-0.5 text-xs text-ink-2">{message}</p>
            {n.detail?.sessionId && (
              <a
                href={`/sessions/${n.detail.sessionId}`}
                className="mt-1 inline-block text-xs text-accent hover:underline"
              >
                {t.toast.open}
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
