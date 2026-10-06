import type { HookSignal } from "@landed/core";
import { createLineFingerprinter, parseInstallSecret } from "@landed/core/fingerprint";
import { openDatabase } from "@landed/db";
import type { LiveCollector } from "@landed/ingest";
import { describe, expect, it } from "vitest";
import { createHub } from "./hub";
import { createServer } from "./server";

function stubLive(received: HookSignal[]): LiveCollector {
  return {
    start() {},
    stop() {},
    touch() {},
    flush: async () => {},
    runAnalysis: async () => {},
    recordHook: async (s) => {
      received.push(s);
    },
    exclusive: (fn) => fn(),
    lastActivityAt: "2026-10-06T10:00:00.000Z",
  };
}

async function setup(port: number) {
  const { db } = openDatabase(":memory:");
  const received: HookSignal[] = [];
  const hub = createHub();
  const { app } = await createServer({
    db,
    dbPath: ":memory:",
    dataDir: "/tmp",
    fingerprinter: createLineFingerprinter(parseInstallSecret("q".repeat(43))),
    port,
    token: "ui-token",
    ingestToken: "ingest-token",
    live: stubLive(received),
    hub,
  });
  return { app, received, hub };
}

describe("live server", () => {
  it("accepts hook payloads only with the ingest token and answers without a decision", async () => {
    const { app, received } = await setup(47997);
    const host = { host: "127.0.0.1:47997" };
    const payload = {
      session_id: "s1",
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: { command: "x" },
    };
    expect(
      (await app.inject({ method: "POST", url: "/v1/ingest/claude", headers: host, payload }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/ingest/claude",
          headers: { ...host, "x-landed-token": "ui-token" },
          payload,
        })
      ).statusCode,
    ).toBe(401);
    const ok = await app.inject({
      method: "POST",
      url: "/v1/ingest/claude",
      headers: { ...host, "x-landed-ingest": "ingest-token" },
      payload,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({});
    await new Promise((r) => setTimeout(r, 10));
    expect(received.map((s) => [s.providerSessionId, s.events[0]?.eventType])).toEqual([
      ["s1", "approval.requested"],
    ]);
    const codex = await app.inject({
      method: "POST",
      url: "/v1/ingest/codex",
      headers: { ...host, "x-landed-ingest": "ingest-token" },
      payload: { session_id: "t1", hook_event_name: "SessionEnd" },
    });
    expect(codex.statusCode).toBe(200);
  });

  it("reports live status", async () => {
    const { app } = await setup(47996);
    const live = (
      await app.inject({ url: "/v1/live", headers: { host: "127.0.0.1:47996" } })
    ).json();
    expect(live).toMatchObject({ live: true, lastActivityAt: "2026-10-06T10:00:00.000Z" });
  });

  it("streams published events to dashboards", async () => {
    const { app, hub } = await setup(47995);
    await app.listen({ host: "127.0.0.1", port: 47995 });
    try {
      const res = await fetch("http://127.0.0.1:47995/v1/stream");
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let text = decoder.decode((await reader.read()).value);
      expect(text).toContain("event: hello");
      hub.publish({ type: "import", at: "2026-10-06T10:00:00.000Z", detail: { files: 1 } });
      text = decoder.decode((await reader.read()).value);
      expect(text).toContain('"type":"import"');
      await reader.cancel();
    } finally {
      await app.close();
    }
  });
});
