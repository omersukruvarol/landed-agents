import { newUlid } from "@landed/shared";
import { describe, expect, it } from "vitest";
import { CollisionSchema, OpenLoopSchema } from "./loop";
import { OutcomeSchema } from "./outcome";
import { AgentPatchSchema } from "./patch";
import { AgentSessionSchema } from "./session";
import { T0, T1 } from "./test-helpers";
import { WorkThreadSchema } from "./thread";

const fp = (n: number) => n.toString(16).padStart(16, "0");

describe("AgentSessionSchema", () => {
  const base = () => ({
    id: newUlid(),
    provider: "claude-code" as const,
    providerSessionId: "5c3e7c1e-1111-2222-3333-444455556666",
    startedAt: T0,
    lastEventAt: T1,
    status: "unknown" as const,
    eventCount: 3,
    failureCount: 1,
    changedFileCount: 2,
    sourceFiles: ["/x/session.jsonl"],
  });

  it("accepts a minimal session", () => {
    expect(AgentSessionSchema.safeParse(base()).success).toBe(true);
  });

  it("rejects end before start and failures > events", () => {
    expect(
      AgentSessionSchema.safeParse({ ...base(), endedAt: "2026-09-30T00:00:00Z" }).success,
    ).toBe(false);
    expect(AgentSessionSchema.safeParse({ ...base(), failureCount: 9 }).success).toBe(false);
  });

  it("requires a provenance label on titles", () => {
    expect(AgentSessionSchema.safeParse({ ...base(), title: "Fix webhook" }).success).toBe(false);
    expect(
      AgentSessionSchema.safeParse({ ...base(), title: "Fix webhook", titleProvenance: "observed" })
        .success,
    ).toBe(true);
  });
});

describe("AgentPatchSchema", () => {
  const base = () => ({
    id: newUlid(),
    sessionId: newUlid(),
    provider: "codex" as const,
    timestamp: T0,
    path: "/Users/dev/repo/src/a.ts",
    operation: "modify" as const,
    addedLineFps: [fp(1), fp(2)],
    removedLineFps: [fp(3)],
    addedLineCountRaw: 4,
    removedLineCountRaw: 1,
    sourceRef: { file: "/x/r.jsonl", offset: 0, parserVersion: "codex@1" },
  });

  it("accepts a valid patch", () => {
    expect(AgentPatchSchema.safeParse(base()).success).toBe(true);
  });

  it("rejects relative paths, malformed fingerprints and impossible counts", () => {
    expect(AgentPatchSchema.safeParse({ ...base(), path: "src/a.ts" }).success).toBe(false);
    expect(AgentPatchSchema.safeParse({ ...base(), addedLineFps: ["not-a-fp"] }).success).toBe(
      false,
    );
    expect(AgentPatchSchema.safeParse({ ...base(), addedLineCountRaw: 1 }).success).toBe(false);
  });

  it("rejects escaping relPaths and relPath without a repo", () => {
    expect(
      AgentPatchSchema.safeParse({ ...base(), repoId: newUlid(), relPath: "../etc/passwd" })
        .success,
    ).toBe(false);
    expect(AgentPatchSchema.safeParse({ ...base(), relPath: "src/a.ts" }).success).toBe(false);
    expect(
      AgentPatchSchema.safeParse({ ...base(), repoId: newUlid(), relPath: "src/a.ts" }).success,
    ).toBe(true);
  });
});

describe("OutcomeSchema", () => {
  const base = () => ({
    id: newUlid(),
    scope: "session-file" as const,
    sessionId: newUlid(),
    class: "uncommitted" as const,
    survival: "unknown" as const,
    fracCommitted: 0,
    fracOnDefaultBranch: 0,
    fracInWorkingTree: 0.8,
    lineCount: 10,
    provenance: "derived" as const,
    computedAt: T1,
    engineVersion: "outcomes@1",
  });
  const commit = { sha: "5922c601a", time: T1, subject: "feat: x" };

  it("accepts a valid outcome", () => {
    expect(OutcomeSchema.safeParse(base()).success).toBe(true);
  });

  it("requires commit evidence for landed outcomes", () => {
    const landed = {
      ...base(),
      class: "landed" as const,
      fracCommitted: 1,
      fracOnDefaultBranch: 1,
    };
    expect(OutcomeSchema.safeParse(landed).success).toBe(false);
    expect(
      OutcomeSchema.safeParse({ ...landed, firstCommit: commit, survival: "surviving" }).success,
    ).toBe(true);
  });

  it("only allows survival on landed outcomes", () => {
    expect(OutcomeSchema.safeParse({ ...base(), survival: "churned" }).success).toBe(false);
  });

  it("is always derived, and patch scope needs a patchId", () => {
    expect(OutcomeSchema.safeParse({ ...base(), provenance: "generated" }).success).toBe(false);
    expect(OutcomeSchema.safeParse({ ...base(), scope: "patch" }).success).toBe(false);
  });

  it("rejects fractions out of range and default-branch > committed", () => {
    expect(OutcomeSchema.safeParse({ ...base(), fracInWorkingTree: 1.2 }).success).toBe(false);
    expect(OutcomeSchema.safeParse({ ...base(), fracOnDefaultBranch: 0.5 }).success).toBe(false);
  });
});

describe("WorkThreadSchema", () => {
  const [a, b] = [newUlid(), newUlid()];
  const base = () => ({
    id: newUlid(),
    repoId: newUlid(),
    sessionIds: [a, b],
    providers: ["claude-code" as const, "codex" as const],
    startedAt: T0,
    lastActivityAt: T1,
    title: "webhook retry fix",
    titleProvenance: "observed" as const,
    status: "dangling" as const,
    linkEvidence: [{ kind: "same-branch" as const, fromSessionId: a, toSessionId: b }],
  });

  it("accepts a linked multi-session thread", () => {
    expect(WorkThreadSchema.safeParse(base()).success).toBe(true);
  });

  it("requires link evidence for multi-session threads, referencing members only", () => {
    expect(WorkThreadSchema.safeParse({ ...base(), linkEvidence: [] }).success).toBe(false);
    const stranger = [{ kind: "file-overlap" as const, fromSessionId: a, toSessionId: newUlid() }];
    expect(WorkThreadSchema.safeParse({ ...base(), linkEvidence: stranger }).success).toBe(false);
  });
});

describe("OpenLoopSchema / CollisionSchema", () => {
  const loop = () => ({
    id: newUlid(),
    type: "uncommitted-output" as const,
    sessionIds: [newUlid()],
    since: T0,
    size: { files: 3, lines: 120 },
    evidence: { outcomes: 3 },
    provenance: "derived" as const,
    state: "open" as const,
  });

  it("accepts a derived open loop and rejects generated ones", () => {
    expect(OpenLoopSchema.safeParse(loop()).success).toBe(true);
    expect(OpenLoopSchema.safeParse({ ...loop(), provenance: "generated" }).success).toBe(false);
  });

  it("forces awaiting-user to be labeled inferred and resolvedBy to need resolution", () => {
    expect(OpenLoopSchema.safeParse({ ...loop(), type: "awaiting-user" }).success).toBe(false);
    expect(OpenLoopSchema.safeParse({ ...loop(), resolvedBy: "auto" }).success).toBe(false);
  });

  const collision = () => ({
    id: newUlid(),
    repoId: newUlid(),
    relPath: "src/auth/middleware.ts",
    sessionA: newUlid(),
    sessionB: newUlid(),
    kind: "overwrite" as const,
    window: { start: T0, end: T1 },
    evidence: { removedFps: 4 },
    provenance: "derived" as const,
  });

  it("never states duplicate work as fact", () => {
    expect(CollisionSchema.safeParse(collision()).success).toBe(true);
    expect(
      CollisionSchema.safeParse({ ...collision(), kind: "possible-duplicate" as const }).success,
    ).toBe(false);
    expect(
      CollisionSchema.safeParse({
        ...collision(),
        kind: "possible-duplicate" as const,
        provenance: "inferred" as const,
      }).success,
    ).toBe(true);
  });

  it("needs two distinct sessions and an ordered window", () => {
    const c = collision();
    expect(CollisionSchema.safeParse({ ...c, sessionB: c.sessionA }).success).toBe(false);
    expect(CollisionSchema.safeParse({ ...c, window: { start: T1, end: T0 } }).success).toBe(false);
  });
});
