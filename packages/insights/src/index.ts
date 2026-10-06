import type { AgentSession, Insight, Outcome } from "@landed/core";
import { newUlid } from "@landed/shared";

export const INSIGHT_RULES = {
  repeatedFailureMin: 3,
  /** input + output tokens a session must use before "tokens on non-landed work" is worth saying. */
  nonLandedTokensMin: 200_000,
};

export type InsightDraft = Insight & { key: string };

export interface FailureGroupInput {
  sessionId: string;
  signature: string;
  count: number;
  firstAt: string;
  lastAt: string;
}

export interface InsightInputs {
  sessions: readonly AgentSession[];
  /** Session-file outcomes. */
  outcomes: readonly Outcome[];
  failureGroups: readonly FailureGroupInput[];
}

/** Deterministic insights (PRD §16). Never equates activity with productivity. */
export function detectInsights(input: InsightInputs): InsightDraft[] {
  const out: InsightDraft[] = [];
  const byId = new Map(input.sessions.map((s) => [s.id, s]));
  for (const g of input.failureGroups) {
    if (g.count < INSIGHT_RULES.repeatedFailureMin) continue;
    const s = byId.get(g.sessionId);
    out.push({
      key: `repeated-failure:${g.sessionId}:${hash(g.signature)}`,
      id: newUlid(Date.parse(g.lastAt)),
      type: "repeated-failure",
      severity: "warning",
      message: `\`${g.signature}\` failed ${g.count} times in one session`,
      evidence: { signature: g.signature, count: g.count, firstAt: g.firstAt, lastAt: g.lastAt },
      provenance: "derived",
      sessionId: g.sessionId,
      ...(s?.repoId ? { repoId: s.repoId } : {}),
      createdAt: g.lastAt,
    });
  }
  const outcomesBySession = new Map<string, Outcome[]>();
  for (const o of input.outcomes)
    outcomesBySession.set(o.sessionId, [...(outcomesBySession.get(o.sessionId) ?? []), o]);
  for (const s of input.sessions) {
    const repo = s.repoId ? { repoId: s.repoId } : {};
    if ((s.status === "failed" || s.status === "interrupted") && !s.parentSessionId) {
      out.push({
        key: `${s.status}-session:${s.id}`,
        id: newUlid(Date.parse(s.lastEventAt)),
        type: s.status === "failed" ? "failed-session" : "interrupted-session",
        severity: s.status === "failed" ? "warning" : "info",
        message: s.status === "failed" ? "Session ended with an error" : "Session was interrupted",
        evidence: { status: s.status, lastEventAt: s.lastEventAt },
        provenance: "observed",
        sessionId: s.id,
        ...repo,
        createdAt: s.lastEventAt,
      });
    }
    const outcomes = (outcomesBySession.get(s.id) ?? []).filter((o) => o.class !== "unknown");
    const tokens = (s.inputTokens ?? 0) + (s.outputTokens ?? 0);
    if (
      outcomes.length &&
      tokens >= INSIGHT_RULES.nonLandedTokensMin &&
      outcomes.every((o) => o.class === "lost" || o.class === "uncommitted")
    ) {
      out.push({
        key: `tokens-on-non-landed:${s.id}`,
        id: newUlid(Date.parse(s.lastEventAt)),
        type: "tokens-on-non-landed",
        severity: "info",
        message: `${formatTokens(tokens)} tokens went into work that has not landed (attributed by session)`,
        evidence: {
          tokens,
          outcomes: outcomes.length,
          classes: [...new Set(outcomes.map((o) => o.class))],
        },
        provenance: "derived",
        sessionId: s.id,
        ...repo,
        createdAt: s.lastEventAt,
      });
    }
  }
  return out;
}

export function formatTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
