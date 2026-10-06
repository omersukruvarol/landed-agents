import { z } from "zod";
import {
  CollisionKindSchema,
  OpenLoopStateSchema,
  OpenLoopTypeSchema,
  ProvenanceSchema,
} from "./enums";
import {
  CountSchema,
  EvidenceSchema,
  IdSchema,
  RelPathSchema,
  TimestampSchema,
} from "./primitives";

/** Open loops come from deterministic detectors — never from an LLM. */
const DetectorProvenanceSchema = ProvenanceSchema.exclude(["generated"]);

export const OpenLoopSchema = z
  .strictObject({
    id: IdSchema,
    type: OpenLoopTypeSchema,
    repoId: IdSchema.optional(),
    threadId: IdSchema.optional(),
    sessionIds: z.array(IdSchema),
    since: TimestampSchema,
    size: z.strictObject({
      files: CountSchema.optional(),
      lines: CountSchema.optional(),
      commits: CountSchema.optional(),
    }),
    evidence: EvidenceSchema,
    provenance: DetectorProvenanceSchema,
    state: OpenLoopStateSchema,
    resolvedBy: z.enum(["auto", "user"]).optional(),
  })
  .superRefine((l, ctx) => {
    if (l.resolvedBy !== undefined && l.state !== "resolved") {
      ctx.addIssue({
        code: "custom",
        path: ["resolvedBy"],
        message: "resolvedBy requires state=resolved",
      });
    }
    if (l.type === "awaiting-user" && l.provenance !== "inferred") {
      ctx.addIssue({
        code: "custom",
        path: ["provenance"],
        message: "awaiting-user is a heuristic and must be labeled inferred",
      });
    }
  });
export type OpenLoop = z.infer<typeof OpenLoopSchema>;

export const CollisionSchema = z
  .strictObject({
    id: IdSchema,
    repoId: IdSchema,
    relPath: RelPathSchema,
    sessionA: IdSchema,
    sessionB: IdSchema,
    kind: CollisionKindSchema,
    window: z.strictObject({ start: TimestampSchema, end: TimestampSchema }),
    evidence: EvidenceSchema,
    provenance: DetectorProvenanceSchema,
  })
  .superRefine((c, ctx) => {
    if (c.sessionA === c.sessionB) {
      ctx.addIssue({
        code: "custom",
        path: ["sessionB"],
        message: "a collision needs two sessions",
      });
    }
    if (Date.parse(c.window.end) < Date.parse(c.window.start)) {
      ctx.addIssue({
        code: "custom",
        path: ["window", "end"],
        message: "window ends before it starts",
      });
    }
    // Duplicate work is never stated as fact unless provable (PRD §15).
    if (c.kind === "possible-duplicate" && c.provenance !== "inferred") {
      ctx.addIssue({
        code: "custom",
        path: ["provenance"],
        message: "possible-duplicate must be labeled inferred",
      });
    }
  });
export type Collision = z.infer<typeof CollisionSchema>;
