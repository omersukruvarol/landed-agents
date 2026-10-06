import { spawn } from "node:child_process";
import { getSetting, type LandedDb } from "@landed/db";
import type { Notice } from "@landed/ingest";

export interface NotificationSetting {
  enabled: boolean;
}

export const DEFAULT_NOTIFICATIONS: NotificationSetting = { enabled: true };

export type Language = "en" | "tr";
export const LANGUAGES: readonly Language[] = ["en", "tr"];
export const LANGUAGE_SETTING = "language";

/**
 * The language for text the server writes itself (desktop notifications). The dashboard sets it
 * to match its own; before that, the system locale decides.
 */
export function serverLanguage(db: LandedDb, env: NodeJS.ProcessEnv = process.env): Language {
  const saved = getSetting<string>(db, LANGUAGE_SETTING);
  if (saved === "en" || saved === "tr") return saved;
  const locale = env.LC_ALL || env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || "";
  return locale.toLowerCase().startsWith("tr") ? "tr" : "en";
}

/** A notice in the user's language. Built only from metadata: repo, file path, session title. */
export function noticeText(n: Notice, lang: Language): { title: string; message: string } {
  if (lang === "en") return { title: n.title, message: n.message };
  if (n.kind === "awaiting-user")
    return {
      title: "Bir ajan seni bekliyor",
      message: `${n.repo ? `${n.repo}: ` : ""}${n.sessionTitle ? `“${n.sessionTitle}” oturumu` : "Bir oturum"} cevabını ya da onayını bekliyor.`,
    };
  return {
    title: "İki ajan aynı dosyayı düzenliyor",
    message: `${n.repo ? `${n.repo}: ` : ""}${n.relPath ?? "Bir dosya"} son bir saat içinde iki ayrı oturum tarafından düzenlendi.`,
  };
}

/**
 * macOS notifications through osascript (no dependencies). Title and message are passed as argv,
 * never interpolated into the script. They carry metadata only: repo names, paths, titles.
 */
export function createNotifier(
  db: LandedDb,
  platform: NodeJS.Platform = process.platform,
  run: (args: string[]) => void = (args) =>
    spawn("osascript", args, { stdio: "ignore", detached: true }).unref(),
): (n: Notice) => void {
  return (n) => {
    const setting = getSetting<NotificationSetting>(db, "notifications") ?? DEFAULT_NOTIFICATIONS;
    if (!setting.enabled || platform !== "darwin") return;
    const text = noticeText(n, serverLanguage(db));
    try {
      run([
        "-e",
        "on run argv",
        "-e",
        'display notification (item 2 of argv) with title "Landed" subtitle (item 1 of argv)',
        "-e",
        "end run",
        text.title,
        text.message,
      ]);
    } catch {
      // Notifications are best effort.
    }
  };
}
