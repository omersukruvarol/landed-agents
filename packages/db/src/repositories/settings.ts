import { eq } from "drizzle-orm";
import type { LandedDb } from "../connection";
import { appSettings } from "../schema";

export function getSetting<T>(db: LandedDb, key: string): T | undefined {
  const row = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
  return row?.value as T | undefined;
}

export function setSetting(
  db: LandedDb,
  key: string,
  value: unknown,
  now: number = Date.now(),
): void {
  db.insert(appSettings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } })
    .run();
}
