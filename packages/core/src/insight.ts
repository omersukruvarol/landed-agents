import { z } from "zod";
import { InsightTypeSchema, ProvenanceSchema, SeveritySchema } from "./enums";
import { EvidenceSchema, IdSchema, NonEmptyStringSchema, TimestampSchema } from "./primitives";

/** Deterministic insight (PRD §16). Every insight carries its evidence. */
export const InsightSchema = z
  .strictObject({
    id: IdSchema,
    type: InsightTypeSchema,
    severity: SeveritySchema,
    message: NonEmptyStringSchema,
    evidence: EvidenceSchema,
    provenance: ProvenanceSchema.exclude(["generated"]),
    sessionId: IdSchema.optional(),
    threadId: IdSchema.optional(),
    repoId: IdSchema.optional(),
    createdAt: TimestampSchema,
    dismissedAt: TimestampSchema.optional(),
  })
  .superRefine((i, ctx) => {
    if (i.dismissedAt !== undefined && Date.parse(i.dismissedAt) < Date.parse(i.createdAt)) {
      ctx.addIssue({ code: "custom", path: ["dismissedAt"], message: "dismissed before created" });
    }
  });
export type Insight = z.infer<typeof InsightSchema>;
