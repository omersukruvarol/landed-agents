import { describe, expect, it } from "vitest";
import { outcome, session } from "../../threads/src/test-helpers";
import {
  buildDailyBrief,
  buildRetroReport,
  categoryOf,
  describeLoop,
  renderBriefMarkdown,
  renderReportHtml,
} from "./index";

const REPO = "01K6FREP00000000000000000A";
const names = new Map([[REPO, "secret-client-repo"]]);

describe("Daily Brief", () => {
  const a = session({
    startH: 1,
    status: "failed",
    title: "Fix webhook retries",
    titleProvenance: "observed",
    inputTokens: 1000,
    outputTokens: 200,
  });
  const b = session({ startH: 2, provider: "claude-code" });
  const brief = buildDailyBrief({
    date: "2026-09-01",
    from: "2026-09-01T00:00:00.000Z",
    to: "2026-09-02T00:00:00.000Z",
    sessions: [a, b],
    outcomes: [
      outcome(a, "src/a.ts", "landed", {
        firstCommit: {
          sha: "abcdef1234",
          time: "2026-09-01T05:00:00.000Z",
          subject: "feat: retries",
        },
      }),
      outcome(b, "src/b.ts", "uncommitted"),
    ],
    loops: [],
    threads: [],
    collisions: [],
    insights: [],
    repoNames: names,
  });

  it("summarizes activity, landed work, attention and usage coverage", () => {
    expect(brief.activity).toEqual({ sessions: 2, providers: ["codex", "claude-code"], repos: 1 });
    expect(brief.landed).toEqual([
      {
        repo: "secret-client-repo",
        files: 1,
        lines: 30,
        commits: [{ sha: "abcdef123", subject: "feat: retries" }],
      },
    ]);
    expect(brief.attention.map((x) => x.kind)).toEqual(["failure"]);
    expect(brief.usage.coverage).toBe("partial"); // b reported no usage
    expect(brief.outcomeMix).toEqual({ landed: 1, uncommitted: 1 });
  });

  it("renders Markdown that flags partial usage", () => {
    const md = renderBriefMarkdown(brief);
    expect(md).toContain("# Daily Brief — 2026-09-01");
    expect(md).toContain("coverage **partial**");
    expect(md).toContain("Codex, Claude Code");
    expect(md).toContain("`abcdef123` feat: retries");
  });
});

describe("Retro Report", () => {
  const s = session({ startH: 0 });
  const inputs = {
    periodDays: 30,
    nowMs: Date.parse("2026-09-10T00:00:00.000Z"),
    sessions: [s],
    outcomes: [
      outcome(s, "apps/web/src/Checkout.tsx", "landed", { commitLagSeconds: 7200 }),
      outcome(s, "docs/plan.md", "lost"),
    ],
    loops: [],
    threads: [],
    collisions: [],
    repoNames: names,
  };

  it("is privacy-safe by default: no repo names or paths", () => {
    const html = renderReportHtml(buildRetroReport(inputs));
    expect(html).not.toContain("secret-client-repo");
    expect(html).not.toContain("Checkout");
    expect(html).toContain("50%");
    expect(html).toContain("UI");
  });

  it("includes names only when asked", () => {
    expect(renderReportHtml(buildRetroReport({ ...inputs, includeNames: true }))).toContain(
      "secret-client-repo",
    );
  });

  it.each([
    ["src/a.test.ts", "Tests"],
    ["docs/x.md", "Docs"],
    ["package.json", "Config"],
    ["src/App.tsx", "UI"],
    ["db/migrations/001.sql", "Database"],
    ["src/server.ts", "Code"],
  ])("categorizes %s as %s", (p, c) => expect(categoryOf(p)).toBe(c));
});

describe("describeLoop", () => {
  const base = {
    id: "01K6FL0000000000000000000A",
    sessionIds: ["01K6FS0000000000000000000A"],
    since: "2026-10-01T10:00:00.000Z",
    provenance: "derived" as const,
    state: "open" as const,
  };
  it("names the branch, repo and size", () => {
    expect(
      describeLoop({
        ...base,
        type: "unmerged-agent-branch",
        repoId: REPO,
        repo: "acme",
        size: { files: 3, lines: 40, commits: 2 },
        evidence: { branch: "agent/x" },
      }),
    ).toBe("Unmerged agent branch on `agent/x` in acme (3 files, 40 lines, 2 commits)");
  });
  it("says when a failed session was outside any repository, and how it ended", () => {
    expect(
      describeLoop({
        ...base,
        type: "failed-unresolved",
        size: {},
        evidence: { status: "interrupted" },
      }),
    ).toBe("Failed, never resolved outside a git repository (session interrupted)");
  });
});
