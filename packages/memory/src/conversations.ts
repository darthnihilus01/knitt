import { DatabaseSync } from "node:sqlite";
import {
  randomUUID,
  randomBytes,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import {
  sessionKeySchema,
  locationSchema,
} from "../../contracts/src/conversations.ts";
import type {
  SessionKey,
  SessionLocation,
  Conversation,
} from "../../contracts/src/conversations.ts";
export class ConversationStore {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }
  ensureSession(input: SessionKey, location: SessionLocation): Conversation {
    const key = sessionKeySchema.parse(input),
      loc = locationSchema.parse(location);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(
          "SELECT conversation FROM native_sessions WHERE repo=? AND client=? AND native_id=?",
        )
        .get(key.repoId, key.client, key.nativeSessionId);
      const id = row
        ? String(row.conversation)
        : "conversation:" + randomUUID();
      if (!row) {
        this.db
          .prepare("INSERT INTO conversations VALUES(?,?,?,?,?)")
          .run(
            key.repoId,
            id,
            key.client + " session " + key.nativeSessionId.slice(0, 24),
            key.client,
            new Date().toISOString(),
          );
        this.db
          .prepare(
            "INSERT INTO native_sessions(repo,client,native_id,conversation,workspace,branch,commit_id) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            key.repoId,
            key.client,
            key.nativeSessionId,
            id,
            loc.workspace,
            loc.branch ?? null,
            loc.commit ?? null,
          );
      } else
        this.db
          .prepare(
            "UPDATE native_sessions SET workspace=?,branch=?,commit_id=? WHERE repo=? AND client=? AND native_id=?",
          )
          .run(
            loc.workspace,
            loc.branch ?? null,
            loc.commit ?? null,
            key.repoId,
            key.client,
            key.nativeSessionId,
          );
      const conversation = this.get(key.repoId, id);
      this.db.exec("COMMIT");
      return conversation;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  session(input: SessionKey): Conversation {
    const key = sessionKeySchema.parse(input);
    const row = this.db
      .prepare(
        "SELECT conversation FROM native_sessions WHERE repo=? AND client=? AND native_id=?",
      )
      .get(key.repoId, key.client, key.nativeSessionId);
    if (!row) throw new Error("Unknown conversation session");
    return this.get(key.repoId, String(row.conversation));
  }
  get(repoId: string, id: string): Conversation {
    const row = this.db
      .prepare("SELECT * FROM conversations WHERE repo=? AND id=?")
      .get(repoId, id);
    if (!row) throw new Error("Unknown conversation in repository");
    return {
      repoId: String(row.repo),
      conversationId: String(row.id),
      title: String(row.title),
      client: String(row.client),
    };
  }
  list(repoId: string): Conversation[] {
    return this.db
      .prepare(
        "SELECT id FROM conversations WHERE repo=? ORDER BY created DESC,id",
      )
      .all(repoId)
      .map((r) => this.get(repoId, String(r.id)));
  }
  location(key: SessionKey) {
    this.session(key);
    const row = this.db
      .prepare(
        "SELECT workspace,branch,commit_id FROM native_sessions WHERE repo=? AND client=? AND native_id=?",
      )
      .get(key.repoId, key.client, key.nativeSessionId)!;
    return {
      workspace: String(row.workspace),
      branch: row.branch ? String(row.branch) : undefined,
      commit: row.commit_id ? String(row.commit_id) : undefined,
    };
  }

  issueSessionToken(key: SessionKey): string {
    this.session(key);
    const token = randomBytes(32).toString("base64url");
    this.db
      .prepare(
        "UPDATE native_sessions SET token_hash=? WHERE repo=? AND client=? AND native_id=?",
      )
      .run(
        createHash("sha256").update(token).digest("hex"),
        key.repoId,
        key.client,
        key.nativeSessionId,
      );
    return token;
  }
  assertSessionToken(key: SessionKey, token: string | undefined): void {
    this.session(key);
    const row = this.db
      .prepare(
        "SELECT token_hash FROM native_sessions WHERE repo=? AND client=? AND native_id=?",
      )
      .get(key.repoId, key.client, key.nativeSessionId);
    if (!token || token.length > 128 || !row?.token_hash)
      throw new Error(
        "Use the sessionToken from this native session's startup hook",
      );
    const expected = Buffer.from(String(row.token_hash), "hex"),
      actual = createHash("sha256").update(token).digest();
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new Error("Wrong session capability");
  }
  selectedSource(
    key: SessionKey,
  ): {
    sourceConversationId: string;
    throughSeq: number;
    checkpointSeq: number;
    location: SessionLocation | Record<string, never>;
  } | null {
    this.session(key);
    const row = this.db
      .prepare(
        "SELECT source,through_seq,checkpoint_seq,source_location FROM continuation_links WHERE repo=? AND client=? AND native_id=?",
      )
      .get(key.repoId, key.client, key.nativeSessionId);
    return row
      ? {
          sourceConversationId: String(row.source),
          throughSeq: Number(row.through_seq),
          checkpointSeq: Number(row.checkpoint_seq),
          location: JSON.parse(String(row.source_location)),
        }
      : null;
  }
  linkSource(key: SessionKey, sourceConversationId: string) {
    const own = this.session(key);
    this.get(key.repoId, sourceConversationId);
    if (own.conversationId === sourceConversationId)
      throw new Error("Cannot link a conversation to itself");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const seq = this.db
        .prepare(
          "SELECT COALESCE(MAX(e.seq),0) AS seq FROM events e JOIN conversation_evidence m ON e.repo=m.repo AND e.id=m.event_id WHERE m.repo=? AND m.conversation=?",
        )
        .get(key.repoId, sourceConversationId)!;
      const revision = this.db
        .prepare(
          "SELECT COALESCE(MAX(seq),0) AS seq FROM checkpoints WHERE repo=? AND conversation=?",
        )
        .get(key.repoId, sourceConversationId)!;
      const location = this.db
        .prepare(
          "SELECT workspace,branch,commit_id FROM native_sessions WHERE repo=? AND conversation=? LIMIT 1",
        )
        .get(key.repoId, sourceConversationId)!;
      const frozen = {
        workspace: String(location.workspace),
        ...(location.branch ? { branch: String(location.branch) } : {}),
        ...(location.commit_id ? { commit: String(location.commit_id) } : {}),
      };
      this.db
        .prepare(
          "INSERT INTO continuation_links(repo,client,native_id,source,through_seq,checkpoint_seq,source_location) VALUES(?,?,?,?,?,?,?) ON CONFLICT(repo,client,native_id) DO UPDATE SET source=excluded.source,through_seq=excluded.through_seq,checkpoint_seq=excluded.checkpoint_seq,source_location=excluded.source_location",
        )
        .run(
          key.repoId,
          key.client,
          key.nativeSessionId,
          sourceConversationId,
          Number(seq.seq),
          Number(revision.seq),
          JSON.stringify(frozen),
        );
      this.db.exec("COMMIT");
      return {
        sourceConversationId,
        throughSeq: Number(seq.seq),
        checkpointSeq: Number(revision.seq),
        location: frozen,
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
