import { type MouseEvent, type ReactNode, useEffect, useState } from "react";

/** Tiny history-API router: the app has a handful of routes and needs nothing more. */
export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname + window.location.search);
  useEffect(() => {
    const on = () => setPath(window.location.pathname + window.location.search);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return path;
}

export function navigate(to: string): void {
  if (to === window.location.pathname + window.location.search) return;
  window.history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export function Link({
  to,
  className,
  children,
  title,
}: {
  to: string;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  const onClick = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={onClick} className={className} title={title}>
      {children}
    </a>
  );
}

export function query(path: string): URLSearchParams {
  return new URLSearchParams(path.split("?")[1] ?? "");
}
