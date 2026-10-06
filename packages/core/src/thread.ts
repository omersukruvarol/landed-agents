import { z } from "zod";
import {
  AgentProviderSchema,
  ProvenanceSchema,
  ThreadLinkKindSchema,
  ThreadStatusSchema,
} from "./enums";
import { EvidenceSchema, IdSchema, NonEmptyStringSchema, TimestampSchema } from "./primitives";

/** Why two sessions were grouped into the same thread (PRD §14). */
export const ThreadLinkEvidenceSchema = z.strictObject({
  kind: ThreadLinkKindSchema,
  fromSessionId: IdSchema,
  toSessionId: IdSchema,
  detail: EvidenceSchema.optional(),
});
export type ThreadLinkEvidence = z.infer<typeof ThreadLinkEvidenceSchema>;

export const WorkThreadSchema = z
  .strictObject({
    id: IdSchema,
    repoId: IdSchema,
    sessionIds: z.array(IdSchema).min(1),
    providers: z.array(AgentProviderSchema).min(1),
    startedAt: TimestampSchema,
    lastActivityAt: TimestampSchema,
    title: NonEmptyStringSchema,
    titleProvenance: ProvenanceSchema,
    branch: NonEmptyStringSchema.optional(),
    status: ThreadStatusSchema,
    linkEvidence: z.array(ThreadLinkEvidenceSchema),
  })
  .superRefine((t, ctx) => {
    if (Date.parse(t.lastActivityAt) < Date.parse(t.startedAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["lastActivityAt"],
        message: "lastActivityAt before startedAt",
      });
    }
    if (t.sessionIds.length > 1 && t.linkEvidence.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["linkEvidence"],
        message: "a multi-session thread must explain why its sessions were linked",
      });
    }
    const members = new Set(t.sessionIds);
    t.linkEvidence.forEach((l, i) => {
      if (!members.has(l.fromSessionId) || !members.has(l.toSessionId)) {
        ctx.addIssue({
          code: "custom",
          path: ["linkEvidence", i],
          message: "link evidence references a session outside the thread",
        });
      }
    });
  });
export type WorkThread = z.infer<typeof WorkThreadSchema>;
