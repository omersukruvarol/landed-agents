import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLineFingerprinter, parseInstallSecret } from "@landed/core/fingerprint";
import { openDatabase, syncOpenLoops, upsertOutcomes, upsertRepo, upsertSession } from "@landed/db";
import { newUlid } from "@landed/shared";
import { afterAll, describe, expect, it } from "vitest";
import { createServer } from "./server";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function setup() {
  const { db } = openDatabase(":memory:");
  const repo = upsertRepo(db, { rootPath: "/Users/dev/secret-client-repo" });
  const now = new Date();
  const session = upsertSession(db, {
    provider: "codex",
    providerSessionId: "s1",
    startedAt: new Date(now.getTime() - 3600_000).toISOString(),
    lastEventAt: now.toISOString(),
    status: "completed",
    eventCount: 3,
    failureCount: 0,
    changedFileCount: 1,
    sourceFiles: ["/x"],
    repoId: repo.id,
    title: "Fix webhook retries",
    titleProvenance: "observed",
  });
  upsertOutcomes(db, [
    {
      id: newUlid(),
      scope: "session-file",
      sessionId: session.id,
      repoId: repo.id,
      relPath: "src/retry.ts",
      class: "landed",
      survival: "surviving",
      fracCommitted: 1,
      fracOnDefaultBranch: 1,
      fracInWorkingTree: 1,
      firstCommit: { sha: "abcdef12345", time: now.toISOString(), subject: "feat: retries" },
      commitLagSeconds: 600,
      lineCount: 12,
      provenance: "derived",
      computedAt: now.toISOString(),
      engineVersion: "outcomes@2",
    },
  ]);
  const loopId = newUlid();
  syncOpenLoops(
    db,
    [
      {
        key: "k1",
        id: loopId,
        type: "uncommitted-output",
        repoId: repo.id,
        sessionIds: [session.id],
        since: now.toISOString(),
        size: { files: 2, lines: 40 },
        evidence: {},
        provenance: "derived",
        state: "open",
      },
    ],
    Date.now(),
  );
  const web = mkdtempSync(join(tmpdir(), "landed-web-"));
  dirs.push(web);
  writeFileSync(
    join(web, "index.html"),
    "<html><head><title>Landed</title></head><body></body></html>",
  );
  const { app, token } = await createServer({
    db,
    dbPath: ":memory:",
    dataDir: web,
    fingerprinter: createLineFingerprinter(parseInstallSecret("q".repeat(43))),
    webRoot: web,
    port: 47999,
    token: "test-token",
  });
  return { app, token, session, loopId };
}

const host = { host: "127.0.0.1:47999" };

describe("local server", () => {
  it("serves the API to its own origin only", async () => {
    const { app } = await setup();
    expect((await app.inject({ url: "/v1/health", headers: host })).statusCode).toBe(200);
    expect(
      (await app.inject({ url: "/v1/health", headers: { host: "evil.example:47999" } })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: "/v1/health", headers: { ...host, origin: "http://evil.example" } }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: "/v1/health",
          headers: { ...host, origin: "http://127.0.0.1:47999" },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("requires the token for state changes", async () => {
    const { app, loopId } = await setup();
    const url = `/v1/loops/${loopId}`;
    expect(
      (await app.inject({ method: "POST", url, headers: host, payload: { action: "dismiss" } }))
        .statusCode,
    ).toBe(401);
    const ok = await app.inject({
      method: "POST",
      url,
      headers: { ...host, "x-landed-token": "test-token" },
      payload: { action: "dismiss", reason: "intentional" },
    });
    expect(ok.statusCode).toBe(200);
    const open = await app.inject({ url: "/v1/loops?state=open", headers: host });
    expect(open.json()).toEqual([]);
  });

  it("returns today's brief, sessions and session detail", async () => {
    const { app, session } = await setup();
    const today = (await app.inject({ url: "/v1/today", headers: host })).json();
    expect(today.brief.activity.sessions).toBe(1);
    expect(today.brief.landed[0]).toMatchObject({ repo: "secret-client-repo", files: 1 });
    const list = (await app.inject({ url: "/v1/sessions", headers: host })).json();
    expect(list.items[0]).toMatchObject({
      id: session.id,
      repo: "secret-client-repo",
      title: "Fix webhook retries",
    });
    const detail = (await app.inject({ url: `/v1/sessions/${session.id}`, headers: host })).json();
    expect(detail.session.id).toBe(session.id);
    expect(
      (await app.inject({ url: "/v1/sessions/01K6F00000000000000000NONE", headers: host }))
        .statusCode,
    ).toBe(404);
  });

  it("renders the brief as Markdown and the report without names by default", async () => {
    const { app } = await setup();
    const md = await app.inject({ url: "/v1/brief?format=md", headers: host });
    expect(md.headers["content-type"]).toContain("text/markdown");
    expect(md.body).toContain("Daily Brief");
    const report = await app.inject({ url: "/v1/report?days=30", headers: host });
    expect(report.body).toContain("Agent Wrapped");
    expect(report.body).not.toContain("secret-client-repo");
  });

  it("summarizes the week in plain counts for the home page", async () => {
    const { app } = await setup();
    const sum = (await app.inject({ url: "/v1/summary?days=7", headers: host })).json();
    expect(sum).toMatchObject({
      days: 7,
      sessions: 1,
      agents: ["codex"],
      repos: 1,
      files: { landed: 1, waiting: 0, lost: 0 },
      openLoops: 1,
    });
    const loops = (await app.inject({ url: "/v1/loops?state=open", headers: host })).json();
    expect(loops[0].repoRoot).toBe("/Users/dev/secret-client-repo");
  });

  it("saves loop exclusions with the token, normalized, and re-checks loops", async () => {
    const { app } = await setup();
    const url = "/v1/settings/loops";
    const payload = {
      ignorePaths: ["output", "./.planning/", "../escape", "/abs", "docs/reports/"],
    };
    expect((await app.inject({ method: "PUT", url, headers: host, payload })).statusCode).toBe(401);
    const auth = { ...host, "x-landed-token": "test-token" };
    const saved = await app.inject({ method: "PUT", url, headers: auth, payload });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().ignorePaths).toEqual(["output/", ".planning/", "docs/reports/"]);
    const settings = (await app.inject({ url: "/v1/settings", headers: host })).json();
    expect(settings.loopIgnorePaths).toEqual(["output/", ".planning/", "docs/reports/"]);
    const bad = await app.inject({
      method: "PUT",
      url,
      headers: auth,
      payload: { ignorePaths: "x" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("refuses the generated summary until enabled", async () => {
    const { app } = await setup();
    const r = await app.inject({
      method: "POST",
      url: "/v1/brief/generate",
      headers: { ...host, "x-landed-token": "test-token" },
    });
    expect(r.statusCode).toBe(409);
  });

  it("serves the UI with the token injected, and 404s unknown API routes", async () => {
    const { app } = await setup();
    const page = await app.inject({ url: "/loops", headers: host });
    expect(page.body).toContain('<meta name="landed-token" content="test-token">');
    expect((await app.inject({ url: "/v1/nope", headers: host })).statusCode).toBe(404);
  });
});
