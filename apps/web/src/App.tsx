import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, send } from "./api";
import { Button } from "./components/ui";
import { ago } from "./format";
import { type Lang, useI18n } from "./i18n";
import { LiveIndicator, LiveProvider, Toasts } from "./live";
import { HistoryPage } from "./pages/History";
import { HomePage } from "./pages/Home";
import { LoopsPage } from "./pages/Loops";
import { OutcomesPage } from "./pages/Outcomes";
import { SessionDetailPage } from "./pages/SessionDetail";
import { SettingsPage } from "./pages/Settings";
import { ThreadDetailPage } from "./pages/ThreadDetail";
import { Link, usePath } from "./router";
import type { Loop, Settings } from "./types";

export function App() {
  return (
    <LiveProvider>
      <Shell />
      <Toasts />
    </LiveProvider>
  );
}

function useNav() {
  const { t } = useI18n();
  return [
    { to: "/", label: t.nav.home, icon: "⌂", match: (p: string) => p === "/" },
    { to: "/loops", label: t.nav.todo, icon: "☐", match: (p: string) => p.startsWith("/loops") },
    {
      to: "/outcomes",
      label: t.nav.projects,
      icon: "▤",
      match: (p: string) => p.startsWith("/outcomes"),
    },
    {
      to: "/history",
      label: t.nav.history,
      icon: "↺",
      match: (p: string) => ["/history", "/threads", "/sessions"].some((x) => p.startsWith(x)),
    },
    {
      to: "/settings",
      label: t.nav.settings,
      icon: "⚙",
      match: (p: string) => p.startsWith("/settings"),
    },
  ];
}

function LangSwitch() {
  const { lang, setLang, t } = useI18n();
  const other: Lang = lang === "tr" ? "en" : "tr";
  return (
    <button
      type="button"
      onClick={() => setLang(other)}
      className="rounded-md border border-line px-2 py-1 text-xs text-ink-2 hover:bg-panel-2"
      title={t.header.language}
    >
      {lang === "tr" ? "EN" : "TR"}
    </button>
  );
}

function Shell() {
  const { t, lang } = useI18n();
  const path = usePath();
  const pathname = path.split("?")[0] ?? "/";
  const qc = useQueryClient();
  const nav = useNav();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => get<Settings>("/v1/settings"),
  });
  const loops = useQuery({
    queryKey: ["loops", "open"],
    queryFn: () => get<Loop[]>("/v1/loops?state=open"),
  });
  const scan = useMutation({
    mutationFn: () => send<unknown>("POST", "/v1/scan"),
    onSuccess: () => qc.invalidateQueries(),
  });
  const empty = settings.data && settings.data.sessions === 0;
  const todo = loops.data?.length ?? 0;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-line bg-panel px-3 py-4 md:flex">
        <Link to="/" className="mb-6 flex items-center gap-2 px-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-[13px] font-bold text-accent-ink">
            ✓
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Landed</span>
        </Link>
        <nav className="flex flex-col gap-0.5">
          {nav.map((n) => {
            const active = n.match(pathname);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex items-center gap-2.5 rounded-md px-2 py-2 text-sm ${active ? "bg-panel-2 font-medium text-ink" : "text-ink-2 hover:bg-panel-2"}`}
              >
                <span className="w-4 text-center text-muted" aria-hidden>
                  {n.icon}
                </span>
                <span className="flex-1">{n.label}</span>
                {n.to === "/loops" && todo > 0 && (
                  <span className="rounded-full bg-warn/15 px-1.5 text-xs font-medium text-warn">
                    {todo}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto px-2 text-[11px] leading-relaxed text-muted">{t.nav.footer}</div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-bg/90 px-4 py-2.5 backdrop-blur md:px-8">
          <nav className="flex gap-1 overflow-x-auto md:hidden">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={`whitespace-nowrap rounded px-2 py-1 text-xs ${n.match(pathname) ? "bg-panel-2 font-medium" : "text-ink-2"}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-4 md:flex">
            <LiveIndicator />
            <span className="text-xs text-muted">
              {settings.data?.lastScan
                ? t.header.lastScan(ago(settings.data.lastScan.at, lang))
                : t.header.notScanned}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {scan.isError && (
              <span className="text-xs text-danger">
                {t.header.scanFailed} {(scan.error as Error).message}
              </span>
            )}
            <LangSwitch />
            <Button
              kind="primary"
              onClick={() => scan.mutate()}
              disabled={scan.isPending}
              title={t.header.scanHelp}
            >
              {scan.isPending ? t.header.scanning : t.header.scan}
            </Button>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-8 md:px-8">
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
  if (pathname === "/") return <HomePage />;
  if (pathname === "/loops") return <LoopsPage />;
  if (pathname === "/outcomes") return <OutcomesPage path={path} />;
  if (pathname === "/history") return <HistoryPage path={path} />;
  if (pathname === "/threads") return <HistoryPage path={path} tab="work" />;
  if (pathname.startsWith("/threads/"))
    return <ThreadDetailPage id={pathname.slice("/threads/".length)} />;
  if (pathname === "/sessions") return <HistoryPage path={path} tab="sessions" />;
  if (pathname.startsWith("/sessions/"))
    return <SessionDetailPage id={pathname.slice("/sessions/".length)} />;
  if (pathname === "/settings") return <SettingsPage />;
  return <HomePage />;
}

function Welcome({ onScan, scanning }: { onScan: () => void; scanning: boolean }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{t.welcome.title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-2">{t.welcome.body}</p>
      <div className="mt-6">
        <Button kind="primary" onClick={onScan} disabled={scanning}>
          {scanning ? t.welcome.scanning : t.welcome.button}
        </Button>
      </div>
    </div>
  );
}
