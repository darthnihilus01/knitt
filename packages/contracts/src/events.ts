import { z } from "zod";

const identifier = z.string().trim().min(1).max(256);
export const eventSchema = z.object({
  eventId: identifier,
  repoId: identifier,
  featureId: identifier,
  branch: identifier.optional(),
  commit: identifier.optional(),
  author: identifier.optional(),
  sessionId: identifier.optional(),
  source: z.string().max(2048).optional(),
  kind: z.enum(["goal", "decision", "attempt", "progress", "test_result", "blocker", "next_step"]),
  content: z.string().min(1).refine(s => Buffer.byteLength(s, "utf8") <= 32768, "Content exceeds 32 KiB"),
}).strict();

export const scopeSchema = z.object({
  repoId: identifier,
  featureId: identifier,
  branch: identifier.optional(),
  maxChars: z.number().int().min(256).max(24000).default(12000),
});
export type MemoryEvent = z.infer<typeof eventSchema>;
export type StoredEvent = MemoryEvent & { receivedAt: string };
