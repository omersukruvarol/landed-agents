import { z } from "zod";
import {
  AgentProviderSchema,
  OutcomeClassSchema,
  ProvenanceSchema,
  SessionStatusSchema,
  UsageCoverageSchema,
} from "./enums";
import {
  CountSchema,
  ExternalIdSchema,
  IdSchema,
  NonEmptyStringSchema,
  TimestampSchema,
} from "./primitives";

export const AgentSessionSchema = z
  .strictObject({
    id: IdSchema,
    provider: AgentProviderSchema,
    providerSessionId: ExternalIdSchema,
    parentSessionId: IdSchema.optional(),

    startedAt: TimestampSchema,
    endedAt: TimestampSchema.optional(),
    lastEventAt: TimestampSchema,
    status: SessionStatusSchema,

    cwd: NonEmptyStringSchema.optional(),
    repoId: IdSchema.optional(),
    repoRoot: NonEmptyStringSchema.optional(),
    projectName: NonEmptyStringSchema.optional(),
    gitBranchStart: NonEmptyStringSchema.optional(),
    gitBranchEnd: NonEmptyStringSchema.optional(),
    gitHeadStart: NonEmptyStringSchema.optional(),
    gitHeadEnd: NonEmptyStringSchema.optional(),

    model: NonEmptyStringSchema.optional(),
    title: NonEmptyStringSchema.optional(),
    titleProvenance: ProvenanceSchema.optional(),
    observedOutcome: z.string().optional(),
    generatedSummary: z.string().optional(),

    eventCount: CountSchema,
    failureCount: CountSchema,
    changedFileCount: CountSchema,

    inputTokens: CountSchema.optional(),
    outputTokens: CountSchema.optional(),
    cachedInputTokens: CountSchema.optional(),
    reasoningTokens: CountSchema.optional(),
    usageCoverage: UsageCoverageSchema.optional(),
    estimatedCostUsd: z.number().nonnegative().optional(),

    sourceFiles: z.array(NonEmptyStringSchema),
    outcomeSummary: z.partialRecord(OutcomeClassSchema, CountSchema).optional(),
    threadId: IdSchema.optional(),
  })
  .superRefine((s, ctx) => {
    const start = Date.parse(s.startedAt);
    if (s.endedAt !== undefined && Date.parse(s.endedAt) < start) {
      ctx.addIssue({ code: "custom", path: ["endedAt"], message: "endedAt before startedAt" });
    }
    if (Date.parse(s.lastEventAt) < start) {
      ctx.addIssue({
        code: "custom",
        path: ["lastEventAt"],
        message: "lastEventAt before startedAt",
      });
    }
    if (s.title !== undefined && s.titleProvenance === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["titleProvenance"],
        message: "a title must declare its provenance",
      });
    }
    if (s.failureCount > s.eventCount) {
      ctx.addIssue({
        code: "custom",
        path: ["failureCount"],
        message: "failureCount > eventCount",
      });
    }
  });
export type AgentSession = z.infer<typeof AgentSessionSchema>;
