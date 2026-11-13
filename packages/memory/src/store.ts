import { getConversationContext } from "./context.ts";
import { saveCheckpoint, latestCheckpoint } from "./checkpoints.ts";
import type { CheckpointEntry } from "../../contracts/src/conversations.ts";
import { DatabaseSync } from "node:sqlite";
import {
  eventSchema,
  scopeSchema,
  searchSchema,
} from "../../contracts/src/events.ts";
import type { StoredEvent } from "../../contracts/src/events.ts";

import { assertSupportedSchema, migrate } from "./migrations.ts";
import { ConversationStore } from "./conversations.ts";
import type {
  SessionKey,
  SessionLocation,
} from "../../contracts/src/conversations.ts";
import type { MemoryEvent } from "../../contracts/src/events.ts";

export class MemoryStore {
  private db: DatabaseSync;
  private conversations?: ConversationStore;
  constructor(path: string, options: { conversationMode?: boolean } = {}) {
    this.db = new DatabaseSync(path);
    try {
      assertSupportedSchema(this.db);
      this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        repo TEXT NOT NULL, id TEXT NOT NULL, feature TEXT NOT NULL,
        branch TEXT, payload TEXT NOT NULL, received TEXT NOT NULL,
        UNIQUE(repo, id)
      );
      CREATE INDEX IF NOT EXISTS events_scope ON events(repo, feature, seq);
      CREATE TABLE IF NOT EXISTS chat_sessions (
        repo TEXT NOT NULL, session TEXT NOT NULL, owner TEXT NOT NULL,
        PRIMARY KEY(repo, session)
      );
      CREATE TABLE IF NOT EXISTS session_selections (
        repo TEXT NOT NULL, session TEXT NOT NULL, feature TEXT NOT NULL, title TEXT NOT NULL,
        PRIMARY KEY(repo, session)
      );
    `);
      if (options.conversationMode) {
        migrate(this.db);
        this.conversations = new ConversationStore(this.db);
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  private conversationStore() {
    if (!this.conversations) throw new Error("Enable conversation mode");
    return this.conversations;
  }
  ensureSession(key: SessionKey, location: SessionLocation) {
    return this.conversationStore().ensureSession(key, location);
  }
  listConversations(repoId: string) {
    return this.conversationStore().list(repoId);
  }
  appendEvidence(key: SessionKey, input: MemoryEvent): StoredEvent {
    const conversation = this.conversationStore().session(key),
      event = eventSchema.parse(input);
    if (
      event.repoId !== key.repoId ||
      event.featureId !== conversation.conversationId
    )
      throw new Error("Evidence belongs to another conversation");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const prior = this.db
        .prepare(
          "SELECT conversation FROM conversation_evidence WHERE repo=? AND event_id=?",
        )
        .get(key.repoId, event.eventId);
      if (prior && prior.conversation !== conversation.conversationId)
        throw new Error("Evidence belongs to another conversation");
      const existing = this.evidence(key.repoId, event.eventId);
      const withoutProvenance = (value: MemoryEvent) =>
        JSON.stringify({
          ...value,
          branch: undefined,
          commit: undefined,
          receivedAt: undefined,
        });
      const saved =
        existing && withoutProvenance(existing) === withoutProvenance(event)
          ? existing
          : this.save(event);
      this.db
        .prepare("INSERT OR IGNORE INTO conversation_evidence VALUES(?,?,?)")
        .run(key.repoId, event.eventId, conversation.conversationId);
      this.db.exec("COMMIT");
      return saved;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getConversationContext(key: SessionKey, options: { maxChars?: number }) {
    return getConversationContext(this, key, options);
  }
  conversationLocation(repoId: string, conversationId: string) {
    this.conversationStore().get(repoId, conversationId);
    const row = this.db
      .prepare(
        "SELECT workspace,branch,commit_id FROM native_sessions WHERE repo=? AND conversation=? LIMIT 1",
      )
      .get(repoId, conversationId);
    return row
      ? {
          workspace: String(row.workspace),
          branch: row.branch ? String(row.branch) : undefined,
          commit: row.commit_id ? String(row.commit_id) : undefined,
        }
      : {};
  }
  saveCheckpoint(key: SessionKey, entries: CheckpointEntry[]) {
    return saveCheckpoint(this.db, this, key, entries);
  }
  latestCheckpoint(
    repoId: string,
    conversationId: string,
    throughSeq?: number,
    checkpointSeq?: number,
  ) {
    this.conversationStore();
    return latestCheckpoint(
      this.db,
      repoId,
      conversationId,
      throughSeq,
      checkpointSeq,
    );
  }
  issueSessionToken(key: SessionKey) {
    return this.conversationStore().issueSessionToken(key);
  }
  assertSessionToken(key: SessionKey, token: string | undefined) {
    this.conversationStore().assertSessionToken(key, token);
  }
  sessionConversation(key: SessionKey) {
    return this.conversationStore().session(key);
  }
  sessionLocation(key: SessionKey) {
    return this.conversationStore().location(key);
  }
  linkSource(key: SessionKey, sourceConversationId: string) {
    return this.conversationStore().linkSource(key, sourceConversationId);
  }
  selectedSource(key: SessionKey) {
    return this.conversationStore().selectedSource(key);
  }
  conversationRows(key: SessionKey) {
    const own = this.sessionConversation(key),
      source = this.selectedSource(key);
    return this.db
      .prepare(
        `SELECT e.seq,e.payload,e.received,m.conversation FROM events e JOIN conversation_evidence m ON e.repo=m.repo AND e.id=m.event_id WHERE e.repo=? AND (m.conversation=? OR (m.conversation=? AND e.seq<=?)) ORDER BY e.seq DESC`,
      )
      .all(
        key.repoId,
        own.conversationId,
        source?.sourceConversationId ?? "",
        source?.throughSeq ?? 0,
      );
  }
  conversationEvidence(key: SessionKey): StoredEvent[] {
    return this.conversationRows(key).map((row) => ({
      ...JSON.parse(String(row.payload)),
      receivedAt: String(row.received),
    }));
  }
  importLegacyEvidence(key: SessionKey, featureId: string) {
    const own = this.sessionConversation(key);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const conflicts = this.db
        .prepare(
          "SELECT 1 FROM events e JOIN conversation_evidence m ON m.repo=e.repo AND m.event_id=e.id WHERE e.repo=? AND e.feature=? AND m.conversation<>? AND json_extract(e.payload,'$.sessionId')=? AND json_extract(e.payload,'$.source') LIKE ? LIMIT 1",
        )
        .get(
          key.repoId,
          featureId,
          own.conversationId,
          key.nativeSessionId,
          key.client + ":%",
        );
      if (conflicts)
        throw new Error("Imported evidence belongs to another conversation");
      this.db
        .prepare(
          "INSERT OR IGNORE INTO conversation_evidence SELECT repo,id,? FROM events WHERE repo=? AND feature=? AND json_extract(payload,'$.sessionId')=? AND json_extract(payload,'$.source') LIKE ?",
        )
        .run(
          own.conversationId,
          key.repoId,
          featureId,
          key.nativeSessionId,
          key.client + ":%",
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  save(input: unknown): StoredEvent {
    const event = eventSchema.parse(input);
    const payload = JSON.stringify(event);
    const received = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO events(repo,id,feature,branch,payload,received) VALUES(?,?,?,?,?,?) ON CONFLICT(repo,id) DO NOTHING",
      )
      .run(
        event.repoId,
        event.eventId,
        event.featureId,
        event.branch ?? null,
        payload,
        received,
      );
    const row = this.db
      .prepare("SELECT payload,received FROM events WHERE repo=? AND id=?")
      .get(event.repoId, event.eventId)!;
    if (row.payload !== payload) throw new Error("Event ID conflict");
    return { ...event, receivedAt: String(row.received) };
  }
  context(input: unknown) {
    const scope = scopeSchema.parse(input);
    const where =
      "repo=? AND feature=?" + (scope.branch ? " AND branch=?" : "");
    const params = scope.branch
      ? [scope.repoId, scope.featureId, scope.branch]
      : [scope.repoId, scope.featureId];
    const count = this.db
      .prepare("SELECT COUNT(*) AS total FROM events WHERE " + where)
      .get(...params)!;
    const rows = this.db
      .prepare(
        "SELECT payload,received FROM events WHERE " +
          where +
          " ORDER BY seq DESC LIMIT 1000",
      )
      .all(...params);
    const events: StoredEvent[] = [];
    let used = 2;
    for (const row of rows) {
      const event = {
        ...JSON.parse(String(row.payload)),
        receivedAt: String(row.received),
      } as StoredEvent;
      const size = JSON.stringify(event).length + (events.length ? 1 : 0);
      if (used + size > scope.maxChars) break;
      used += size;
      events.push(event);
    }
    return {
      events,
      total: Number(count.total),
      truncated: events.length < Number(count.total),
      order: "newest_first",
      contentTrust: "untrusted_reference",
    };
  }
  evidence(repoId: string, eventId: string): StoredEvent | null {
    const row = this.db
      .prepare("SELECT payload,received FROM events WHERE repo=? AND id=?")
      .get(repoId, eventId);
    return row
      ? { ...JSON.parse(String(row.payload)), receivedAt: String(row.received) }
      : null;
  }
  search(input: unknown) {
    const scope = searchSchema.parse(input);
    const rows = this.db
      .prepare(
        "SELECT seq,payload,received FROM events WHERE repo=? AND feature=? AND seq < ? " +
          "AND instr(lower(json_extract(payload,'$.content')),lower(?)) > 0 ORDER BY seq DESC LIMIT ?",
      )
      .all(
        scope.repoId,
        scope.featureId,
        scope.before ?? Number.MAX_SAFE_INTEGER,
        scope.query,
        scope.limit + 1,
      );
    const selected = rows.slice(0, scope.limit);
    const matches = selected.map((row) => {
      const event = JSON.parse(String(row.payload)) as StoredEvent;
      const { content, ...metadata } = event;
      const match = content.toLowerCase().indexOf(scope.query.toLowerCase());
      const start = Math.max(0, match - 100);
      return {
        ...metadata,
        receivedAt: String(row.received),
        excerpt: content.slice(start, start + 1000),
      };
    });
    return {
      matches,
      nextCursor:
        rows.length > scope.limit
          ? Number(selected[selected.length - 1].seq)
          : null,
    };
  }
  createChatSession(repoId: string, sessionId: string, owner: string) {
    this.db
      .prepare("INSERT INTO chat_sessions VALUES(?,?,?)")
      .run(repoId, sessionId, owner);
  }
  ownsChatSession(repoId: string, sessionId: string, owner: string) {
    return !!this.db
      .prepare(
        "SELECT 1 FROM chat_sessions WHERE repo=? AND session=? AND owner=?",
      )
      .get(repoId, sessionId, owner);
  }
  selectSession(
    repoId: string,
    sessionId: string,
    featureId: string,
    title: string,
  ) {
    if (!repoId || !sessionId || !featureId)
      throw new Error("Repository, session and selected feature are required");
    this.db
      .prepare(
        "INSERT INTO session_selections VALUES(?,?,?,?) ON CONFLICT(repo,session) DO UPDATE SET feature=excluded.feature,title=excluded.title",
      )
      .run(repoId, sessionId, featureId, title);
  }
  sessionSelection(repoId: string, sessionId: string) {
    const row = this.db
      .prepare(
        "SELECT feature,title FROM session_selections WHERE repo=? AND session=?",
      )
      .get(repoId, sessionId);
    return row
      ? { featureId: String(row.feature), title: String(row.title) }
      : null;
  }
  close() {
    this.db.close();
  }
}
