import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { z } from "zod";
import { checkpointEntrySchema } from "../../contracts/src/conversations.ts";
import type {
  SessionKey,
  CheckpointEntry,
  Checkpoint,
} from "../../contracts/src/conversations.ts";
import type { MemoryStore } from "./store.ts";
import { redact } from "../../adapters/src/hooks.ts";
export function latestCheckpoint(
  db: DatabaseSync,
  repoId: string,
  conversationId: string,
  throughSeq = Number.MAX_SAFE_INTEGER,
  checkpointSeq = Number.MAX_SAFE_INTEGER,
): Checkpoint | null {
  const row = db
    .prepare(
      "SELECT payload FROM checkpoints WHERE repo=? AND conversation=? AND through_seq<=? AND seq<=? ORDER BY seq DESC LIMIT 1",
    )
    .get(repoId, conversationId, throughSeq, checkpointSeq);
  return row ? JSON.parse(String(row.payload)) : null;
}
export function saveCheckpoint(
  db: DatabaseSync,
  store: MemoryStore,
  key: SessionKey,
  input: CheckpointEntry[],
): Checkpoint {
  const entries = z.array(checkpointEntrySchema).min(1).max(100).parse(input);
  const conversation = store.sessionConversation(key);
  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = store.conversationRows(key),
      permitted = new Set(
        rows.map((r) => String(JSON.parse(String(r.payload)).eventId)),
      );
    const ids = new Set<string>();
    const previous = latestCheckpoint(
      db,
      key.repoId,
      conversation.conversationId,
    );
    const active = new Map(
      (previous?.entries ?? [])
        .filter((e) => e.evidenceIds.every((id) => permitted.has(id)))
        .map((e) => [e.id, e]),
    );
    for (const original of entries) {
      const entry = { ...original, content: redact(original.content) };
      if (ids.has(entry.id)) throw new Error("Duplicate checkpoint entry ID");
      ids.add(entry.id);
      if (entry.status === "verified")
        throw new Error(
          "No trusted execution evidence supports verified status; use reported",
        );
      if (!entry.evidenceIds.every((id) => permitted.has(id)))
        throw new Error(
          "Checkpoint evidence is unavailable in this conversation",
        );
      if (
        db
          .prepare(
            "SELECT 1 FROM retired_checkpoint_entries WHERE repo=? AND conversation=? AND id=?",
          )
          .get(key.repoId, conversation.conversationId, entry.id)
      )
        throw new Error(
          "Checkpoint entry was retired by supersession; use a new ID",
        );
      const old = active.get(entry.id);
      if (old && JSON.stringify(old) !== JSON.stringify(entry))
        throw new Error(
          "Entry ID conflict; supersede the old entry explicitly",
        );
      if (old) continue;
      if (entry.supersedes) {
        if (entry.supersedes === entry.id || !active.has(entry.supersedes))
          throw new Error("Unknown superseded checkpoint entry");
        active.delete(entry.supersedes);
        db.prepare(
          "INSERT OR IGNORE INTO retired_checkpoint_entries VALUES(?,?,?)",
        ).run(key.repoId, conversation.conversationId, entry.supersedes);
      }
      active.set(entry.id, entry);
    }
    const throughSeq = rows
      .filter((r) => r.conversation === conversation.conversationId)
      .reduce((max, r) => Math.max(max, Number(r.seq)), 0);
    const body = {
      conversationId: conversation.conversationId,
      throughSeq,
      entries: [...active.values()],
    };
    const checkpointId = createHash("sha256")
      .update(JSON.stringify(body))
      .digest("hex");
    const checkpoint = { checkpointId, ...body };
    db.prepare(
      "INSERT OR IGNORE INTO checkpoints(repo,conversation,id,through_seq,payload) VALUES(?,?,?,?,?)",
    ).run(
      key.repoId,
      conversation.conversationId,
      checkpointId,
      throughSeq,
      JSON.stringify(checkpoint),
    );
    db.exec("COMMIT");
    return checkpoint;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
