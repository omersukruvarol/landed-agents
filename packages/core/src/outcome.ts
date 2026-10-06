import { z } from "zod";
import {
  OutcomeClassSchema,
  OutcomeScopeSchema,
  OutcomeUnknownReasonSchema,
  SurvivalSchema,
} from "./enums";
import {
  CountSchema,
  FractionSchema,
  IdSchema,
  NonEmptyStringSchema,
  RelPathSchema,
  TimestampSchema,
} from "./primitives";

export const CommitRefSchema = z.strictObject({
  sha: z.string().regex(/^[0-9a-f]{7,64}$/, "expected a git sha"),
  time: TimestampSchema,
  subject: z.string().optional(),
  /** For a commit not on the default branch: a branch that contains it (from git). */
  branch: z.string().min(1).optional(),
});
export type CommitRef = z.infer<typeof CommitRefSchema>;

/** What happened to an agent's edit (PRD §11.5, §12). Always a deterministic derivation. */
export const OutcomeSchema = z
  .strictObject({
    id: IdSchema,
    scope: OutcomeScopeSchema,
    patchId: IdSchema.optional(),
    sessionId: IdSchema,
    repoId: IdSchema.optional(),
    relPath: RelPathSchema.optional(),
    class: OutcomeClassSchema,
    unknownReason: OutcomeUnknownReasonSchema.optional(),
    survival: SurvivalSchema,
    fracCommitted: FractionSchema,
    fracOnDefaultBranch: FractionSchema,
    fracInWorkingTree: FractionSchema,
    firstCommit: CommitRefSchema.optional(),
    commitLagSeconds: z.number().optional(),
    lineCount: CountSchema,
    provenance: z.literal("derived"),
    computedAt: TimestampSchema,
    engineVersion: NonEmptyStringSchema,
  })
  .superRefine((o, ctx) => {
    if (o.scope === "patch" && o.patchId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["patchId"],
        message: "patch-scope outcome needs patchId",
      });
    }
    if ((o.unknownReason !== undefined) !== (o.class === "unknown")) {
      ctx.addIssue({
        code: "custom",
        path: ["unknownReason"],
        message: "unknownReason is required for, and only for, unknown outcomes",
      });
    }
    if (o.class === "landed" && o.firstCommit === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["firstCommit"],
        message: "a landed outcome must cite the commit it landed in",
      });
    }
    if (o.class !== "landed" && o.survival !== "unknown") {
      ctx.addIssue({
        code: "custom",
        path: ["survival"],
        message: "survival only applies to landed outcomes",
      });
    }
    if (o.commitLagSeconds !== undefined && o.firstCommit === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["commitLagSeconds"],
        message: "commitLagSeconds requires firstCommit",
      });
    }
    if (o.fracOnDefaultBranch > o.fracCommitted) {
      ctx.addIssue({
        code: "custom",
        path: ["fracOnDefaultBranch"],
        message: "cannot be on the default branch more than committed at all",
      });
    }
  });
export type Outcome = z.infer<typeof OutcomeSchema>;
