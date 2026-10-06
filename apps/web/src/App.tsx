import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, send } from "./api";
import { Button } from "./components/ui";
import { ago } from "./format";
import { LiveIndicator, LiveProvider, Toasts } from "./live";
import { LoopsPage } from "./pages/Loops";
import { OutcomesPage } from "./pages/Outcomes";
import { SessionDetailPage } from "./pages/SessionDetail";
import { SessionsPage } from "./pages/Sessions";
import { SettingsPage } from "./pages/Settings";
import { ThreadDetailPage } from "./pages/ThreadDetail";
import { ThreadsPage } from "./pages/Threads";
import { TodayPage } from "./pages/Today";
import { Link, usePath } from "./router";
import type { Settings } from "./types";

const NAV = [
  { to: "/", label: "Today", icon: "◷" },
  { to: "/loops", label: "Open loops", icon: "◐" },
  { to: "/outcomes", label: "Outcomes", icon: "▤" },
  { to: "/threads", label: "Threads", icon: "≋" },
  { to: "/sessions", label: "Sessions", icon: "☰" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

export function App() {
  return (
    <LiveProvider>
      <Shell />
      <Toasts />
    </LiveProvider>
  );
}

function Shell() {
  const path = usePath();
  const pathname = path.split("?")[0] ?? "/";
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => get<Settings>("/v1/settings"),
  });
  const scan = useMutation({
    mutationFn: () => send<unknown>("POST", "/v1/scan"),
    onSuccess: () => qc.invalidateQueries(),
  });
  const empty = settings.data && settings.data.sessions === 0;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-52 shrink-0 flex-col border-r border-line bg-panel px-3 py-4 md:flex">
        <Link to="/" className="mb-6 flex items-center gap-2 px-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-[13px] font-bold text-accent-ink">
            ✓
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Landed</span>
        </Link>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((n) => {
            const active = n.to === "/" ? pathname === "/" : pathname.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] ${active ? "bg-panel-2 font-medium text-ink" : "text-ink-2 hover:bg-panel-2"}`}
              >
                <span className="w-4 text-center text-muted" aria-hidden>
                  {n.icon}
                </span>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto px-2 text-[11px] leading-relaxed text-muted">
          Local only. Prompts and code never leave this machine or reach the database.
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-bg/90 px-4 py-2.5 backdrop-blur md:px-8">
          <nav className="flex gap-1 overflow-x-auto md:hidden">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="whitespace-nowrap rounded px-2 py-1 text-xs text-ink-2"
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-4 md:flex">
            <LiveIndicator />
            <span className="text-xs text-muted">
              {settings.data?.lastScan
                ? `Last full scan ${ago(settings.data.lastScan.at)}`
                : "Not scanned yet"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {scan.isError && (
              <span className="text-xs text-danger">
                Scan failed: {(scan.error as Error).message}
              </span>
            )}
            <Button
              kind="primary"
              onClick={() => scan.mutate()}
              disabled={scan.isPending}
              title="Read new agent history and re-check git"
            >
              {scan.isPending ? "Scanning…" : "Scan now"}
            </Button>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6 md:px-8">
          {empty ? (
            <Welcome onScan={() => scan.mutate()} scanning={scan.isPending} />
          ) : (
            <Route pathname={pathname} path={path} />
          )}
        </main>
      </div>
    </div>
  );
}

function Route({ pathname, path }: { pathname: string; path: string }) {
  if (pathname === "/") return <TodayPage path={path} />;
  if (pathname === "/loops") return <LoopsPage />;
  if (pathname === "/outcomes") return <OutcomesPage path={path} />;
  if (pathname === "/threads") return <ThreadsPage path={path} />;
  if (pathname.startsWith("/threads/"))
    return <ThreadDetailPage id={pathname.slice("/threads/".length)} />;
  if (pathname === "/sessions") return <SessionsPage path={path} />;
  if (pathname.startsWith("/sessions/"))
    return <SessionDetailPage id={pathname.slice("/sessions/".length)} />;
  if (pathname === "/settings") return <SettingsPage />;
  return <div className="text-sm text-muted">Page not found.</div>;
}

function Welcome({ onScan, scanning }: { onScan: () => void; scanning: boolean }) {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">No agent history yet</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-2">
        Landed reads the session files Claude Code and Codex already keep, then checks your git
        history to see what that work became. Nothing is configured, nothing is uploaded.
      </p>
      <div className="mt-6">
        <Button kind="primary" onClick={onScan} disabled={scanning}>
          {scanning ? "Reading history… this can take a minute" : "Scan my agent history"}
        </Button>
      </div>
    </div>
  );
}
