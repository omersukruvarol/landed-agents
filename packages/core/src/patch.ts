import { z } from "zod";
import { AgentProviderSchema, PatchOperationSchema } from "./enums";
import {
  CountSchema,
  ExternalIdSchema,
  IdSchema,
  LineFingerprintSchema,
  NonEmptyStringSchema,
  RelPathSchema,
  SourceRefSchema,
  TimestampSchema,
} from "./primitives";

/** One file edit recorded by an agent tool (PRD §11.3). Code is stored only as fingerprints. */
export const AgentPatchSchema = z
  .strictObject({
    id: IdSchema,
    sessionId: IdSchema,
    provider: AgentProviderSchema,
    /** Claude tool_use_id / Codex item id. */
    toolCallId: ExternalIdSchema.optional(),
    timestamp: TimestampSchema,
    repoId: IdSchema.optional(),
    /** Absolute path as recorded by the agent. */
    path: NonEmptyStringSchema.refine((p) => p.startsWith("/"), {
      message: "expected an absolute path",
    }),
    relPath: RelPathSchema.optional(),
    operation: PatchOperationSchema,
    addedLineFps: z.array(LineFingerprintSchema),
    removedLineFps: z.array(LineFingerprintSchema),
    addedLineCountRaw: CountSchema,
    removedLineCountRaw: CountSchema,
    sourceRef: SourceRefSchema,
  })
  .superRefine((p, ctx) => {
    if (p.relPath !== undefined && p.repoId === undefined) {
      ctx.addIssue({ code: "custom", path: ["relPath"], message: "relPath requires repoId" });
    }
    if (p.addedLineFps.length > p.addedLineCountRaw) {
      ctx.addIssue({
        code: "custom",
        path: ["addedLineFps"],
        message: "more significant added lines than raw added lines",
      });
    }
    if (p.removedLineFps.length > p.removedLineCountRaw) {
      ctx.addIssue({
        code: "custom",
        path: ["removedLineFps"],
        message: "more significant removed lines than raw removed lines",
      });
    }
  });
export type AgentPatch = z.infer<typeof AgentPatchSchema>;
