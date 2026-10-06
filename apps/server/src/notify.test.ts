import { openDatabase, setSetting } from "@landed/db";
import type { Notice } from "@landed/ingest";
import { describe, expect, it } from "vitest";
import { createNotifier, noticeText, serverLanguage } from "./notify";

const collision: Notice = {
  kind: "collision",
  key: "k",
  title: "Two agents are editing the same file",
  message: "src/a.ts in app was edited by two sessions within an hour.",
  repo: "app",
  relPath: "src/a.ts",
};
const awaiting: Notice = {
  kind: "awaiting-user",
  key: "k2",
  title: "An agent is waiting for you",
  message: "Fix login in app needs your answer or approval.",
  repo: "app",
  sessionTitle: "Fix login",
};

describe("notifications", () => {
  it("words notices in Turkish or English from metadata only", () => {
    expect(noticeText(collision, "tr")).toEqual({
      title: "İki ajan aynı dosyayı düzenliyor",
      message: "app: src/a.ts son bir saat içinde iki ayrı oturum tarafından düzenlendi.",
    });
    expect(noticeText(awaiting, "tr").message).toBe(
      "app: “Fix login” oturumu cevabını ya da onayını bekliyor.",
    );
    expect(noticeText(awaiting, "en")).toEqual({
      title: awaiting.title,
      message: awaiting.message,
    });
  });

  it("uses the saved language, else the system locale", () => {
    const { db } = openDatabase(":memory:");
    expect(serverLanguage(db, { LANG: "tr_TR.UTF-8" })).toBe("tr");
    expect(serverLanguage(db, { LANG: "en_US.UTF-8" })).toBe("en");
    setSetting(db, "language", "tr", Date.now());
    expect(serverLanguage(db, { LANG: "en_US.UTF-8" })).toBe("tr");
  });

  it("sends the localized text to osascript as arguments, and respects the off switch", () => {
    const { db } = openDatabase(":memory:");
    setSetting(db, "language", "tr", Date.now());
    const calls: string[][] = [];
    const notify = createNotifier(db, "darwin", (args) => calls.push(args));
    notify(collision);
    expect(calls[0]?.slice(-2)).toEqual([
      "İki ajan aynı dosyayı düzenliyor",
      "app: src/a.ts son bir saat içinde iki ayrı oturum tarafından düzenlendi.",
    ]);
    setSetting(db, "notifications", { enabled: false }, Date.now());
    notify(collision);
    expect(calls).toHaveLength(1);
  });
});
