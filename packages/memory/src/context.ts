import { z } from "zod";
import type { MemoryStore } from "./store.ts";
import type {
  SessionKey,
  CheckpointEntry,
} from "../../contracts/src/conversations.ts";
import type { StoredEvent } from "../../contracts/src/events.ts";
type ContextCheckpoint = {
  entries: (CheckpointEntry & { conversationId: string })[];
  revisions: {
    checkpointId: string;
    conversationId: string;
    throughSeq: number;
  }[];
};
export type ConversationContext = {
  checkpoint: ContextCheckpoint | null;
  events: StoredEvent[];
  provenance: Record<string, unknown>;
  stale: boolean;
  truncated: boolean;
  omitted: { entries: number; events: number };
  contentTrust: "untrusted_reference";
  checkpointStatus: "available" | "missing";
};
export function getConversationContext(
  store: MemoryStore,
  key: SessionKey,
  options: { maxChars?: number },
): ConversationContext {
  const maxChars = z
    .number()
    .int()
    .min(256)
    .max(24000)
    .default(12000)
    .parse(options.maxChars);
  const own = store.sessionConversation(key),
    source = store.selectedSource(key),
    rows = store.conversationRows(key),
    events: StoredEvent[] = rows.map((row) => ({
      ...JSON.parse(String(row.payload)),
      receivedAt: String(row.received),
    }));
  const allowed = new Set(events.map((e) => e.eventId));
  const ownCheckpoint = store.latestCheckpoint(key.repoId, own.conversationId),
    sourceCheckpoint = source
      ? store.latestCheckpoint(
          key.repoId,
          source.sourceConversationId,
          source.throughSeq,
          source.checkpointSeq,
        )
      : null;
  const revisions = [ownCheckpoint, sourceCheckpoint].filter(
    (cp) => cp !== null,
  );
  const entries = revisions.flatMap((cp) =>
    cp.entries
      .filter((e) => e.evidenceIds.every((id) => allowed.has(id)))
      .map((e) => ({ ...e, conversationId: cp.conversationId })),
  );
  const stale = revisions.some((cp) =>
    rows.some(
      (row) =>
        row.conversation === cp.conversationId &&
        Number(row.seq) > cp.throughSeq,
    ),
  );
  const provenance = {
    destination: { ...own, ...store.sessionLocation(key) },
    source: source
      ? {
          ...source,
          ...source.location,
        }
      : null,
    scope: "destination_and_direct_source_only",
  };
  let result: ConversationContext = {
    checkpoint: null,
    events: [],
    provenance,
    stale,
    truncated: events.length > 0 || entries.length > 0,
    omitted: { entries: entries.length, events: events.length },
    contentTrust: "untrusted_reference",
    checkpointStatus: revisions.length ? "available" : "missing",
  };
  if (JSON.stringify(result).length > maxChars) {
    result = { ...result, provenance: { omitted: true }, truncated: true };
    // The minimum budget can carry a compact, truthful envelope, not identifiers.
    if (JSON.stringify(result).length > maxChars) {
      delete result.provenance.omitted;
    }
  }
  const checkpoint: ContextCheckpoint = {
    entries: [],
    revisions: revisions.map(
      ({ checkpointId, conversationId, throughSeq }) => ({
        checkpointId,
        conversationId,
        throughSeq,
      }),
    ),
  };
  for (const entry of entries) {
    const candidateCheckpoint = {
      ...checkpoint,
      entries: [...checkpoint.entries, entry],
    };
    const candidate = {
      ...result,
      checkpoint: candidateCheckpoint,
      omitted: { ...result.omitted, entries: result.omitted.entries - 1 },
    };
    if (
      JSON.stringify(candidateCheckpoint).length <= Math.floor(maxChars / 2) &&
      JSON.stringify(candidate).length + 1 <= maxChars
    ) {
      checkpoint.entries.push(entry);
      result = candidate;
    }
  }
  for (const event of events) {
    const candidate = {
      ...result,
      events: [...result.events, event],
      omitted: { ...result.omitted, events: result.omitted.events - 1 },
    };
    if (JSON.stringify(candidate).length + 1 <= maxChars) result = candidate;
  }
  result.truncated =
    result.truncated &&
    (result.omitted.entries > 0 ||
      result.omitted.events > 0 ||
      result.provenance.omitted === true ||
      Object.keys(result.provenance).length === 0);
  return result;
}
