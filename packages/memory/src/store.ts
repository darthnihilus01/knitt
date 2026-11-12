import { DatabaseSync } from "node:sqlite";
import { eventSchema, scopeSchema, searchSchema } from "../../contracts/src/events.ts";
import type { StoredEvent } from "../../contracts/src/events.ts";

export class MemoryStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
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
    `);
  }
  save(input: unknown): StoredEvent {
    const event = eventSchema.parse(input);
    const payload = JSON.stringify(event);
    const received = new Date().toISOString();
    this.db.prepare("INSERT INTO events(repo,id,feature,branch,payload,received) VALUES(?,?,?,?,?,?) ON CONFLICT(repo,id) DO NOTHING")
      .run(event.repoId, event.eventId, event.featureId, event.branch ?? null, payload, received);
    const row = this.db.prepare("SELECT payload,received FROM events WHERE repo=? AND id=?").get(event.repoId, event.eventId)!;
    if (row.payload !== payload) throw new Error("Event ID conflict");
    return { ...event, receivedAt: String(row.received) };
  }
  context(input: unknown) {
    const scope = scopeSchema.parse(input);
    const where = "repo=? AND feature=?" + (scope.branch ? " AND branch=?" : "");
    const params = scope.branch ? [scope.repoId, scope.featureId, scope.branch] : [scope.repoId, scope.featureId];
    const count = this.db.prepare("SELECT COUNT(*) AS total FROM events WHERE " + where).get(...params)!;
    const rows = this.db.prepare("SELECT payload,received FROM events WHERE " + where + " ORDER BY seq DESC LIMIT 1000").all(...params);
    const events: StoredEvent[] = [];
    let used = 2;
    for (const row of rows) {
      const event = { ...JSON.parse(String(row.payload)), receivedAt: String(row.received) } as StoredEvent;
      const size = JSON.stringify(event).length + (events.length ? 1 : 0);
      if (used + size > scope.maxChars) break;
      used += size;
      events.push(event);
    }
    return { events, total: Number(count.total), truncated: events.length < Number(count.total), order: "newest_first", contentTrust: "untrusted_reference" };
  }
  evidence(repoId: string, eventId: string): StoredEvent | null {
    const row = this.db.prepare("SELECT payload,received FROM events WHERE repo=? AND id=?").get(repoId, eventId);
    return row ? { ...JSON.parse(String(row.payload)), receivedAt: String(row.received) } : null;
  }
  search(input: unknown) {
    const scope = searchSchema.parse(input);
    const rows = this.db.prepare(
      "SELECT seq,payload,received FROM events WHERE repo=? AND feature=? AND seq < ? " +
      "AND instr(lower(json_extract(payload,'$.content')),lower(?)) > 0 ORDER BY seq DESC LIMIT ?"
    ).all(scope.repoId, scope.featureId, scope.before ?? Number.MAX_SAFE_INTEGER, scope.query, scope.limit + 1);
    const selected = rows.slice(0, scope.limit);
    const matches = selected.map(row => {
      const event = JSON.parse(String(row.payload)) as StoredEvent;
      const { content, ...metadata } = event;
      const match = content.toLowerCase().indexOf(scope.query.toLowerCase());
      const start = Math.max(0, match - 100);
      return { ...metadata, receivedAt: String(row.received), excerpt: content.slice(start, start + 1000) };
    });
    return { matches, nextCursor: rows.length > scope.limit ? Number(selected[selected.length - 1].seq) : null };
  }
  close() { this.db.close(); }
}
