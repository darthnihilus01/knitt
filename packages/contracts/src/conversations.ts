import { z } from "zod";
const id = z.string().trim().min(1).max(256);
export const sessionKeySchema = z
  .object({ repoId: id, client: id, nativeSessionId: id })
  .strict();
export type SessionKey = z.infer<typeof sessionKeySchema>;
export type Conversation = {
  repoId: string;
  conversationId: string;
  title: string;
  client: string;
};
export const locationSchema = z
  .object({
    workspace: z.string().min(1).max(4096),
    branch: id.optional(),
    commit: id.optional(),
  })
  .strict();
export type SessionLocation = z.infer<typeof locationSchema>;

export const checkpointEntrySchema = z
  .object({
    id,
    category: z.enum([
      "goal",
      "decision",
      "attempt",
      "progress",
      "test_result",
      "blocker",
      "next_step",
    ]),
    content: z.string().trim().min(1).max(32768),
    evidenceIds: z.array(id).min(1).max(100),
    status: z.enum(["reported", "verified"]),
    supersedes: id.optional(),
  })
  .strict();
export type CheckpointEntry = z.infer<typeof checkpointEntrySchema>;
export type Checkpoint = {
  checkpointId: string;
  conversationId: string;
  throughSeq: number;
  entries: CheckpointEntry[];
};
