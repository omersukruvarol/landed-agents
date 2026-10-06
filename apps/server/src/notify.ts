import { spawn } from "node:child_process";
import { getSetting, type LandedDb } from "@landed/db";
import type { Notice } from "@landed/ingest";

export interface NotificationSetting {
  enabled: boolean;
}

export const DEFAULT_NOTIFICATIONS: NotificationSetting = { enabled: true };

/**
 * macOS notifications through osascript (no dependencies). Title and message are passed as argv,
 * never interpolated into the script. They carry metadata only: repo names, paths, titles.
 */
export function createNotifier(
  db: LandedDb,
  platform: NodeJS.Platform = process.platform,
): (n: Notice) => void {
  return (n) => {
    const setting = getSetting<NotificationSetting>(db, "notifications") ?? DEFAULT_NOTIFICATIONS;
    if (!setting.enabled || platform !== "darwin") return;
    try {
      spawn(
        "osascript",
        [
          "-e",
          "on run argv",
          "-e",
          'display notification (item 2 of argv) with title "Landed" subtitle (item 1 of argv)',
          "-e",
          "end run",
          n.title,
          n.message,
        ],
        { stdio: "ignore", detached: true },
      ).unref();
    } catch {
      // Notifications are best effort.
    }
  };
}
