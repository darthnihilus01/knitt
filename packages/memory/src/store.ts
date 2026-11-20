import { randomUUID } from "node:crypto";
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
      CREATE TABLE IF NOT EXISTS chat_sessions (
        repo TEXT NOT NULL, session TEXT NOT NULL, owner TEXT NOT NULL,
        PRIMARY KEY(repo, session)
      );
      CREATE TABLE IF NOT EXISTS cloud_continuations (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, repo TEXT NOT NULL, session TEXT NOT NULL, client TEXT NOT NULL,
        feature TEXT NOT NULL UNIQUE, origin TEXT NOT NULL, account TEXT NOT NULL, context TEXT NOT NULL, version TEXT NOT NULL,
        last_selected INTEGER NOT NULL, UNIQUE(repo,session,client,origin,account,version)
      );
      CREATE TABLE IF NOT EXISTS local_source_pins (feature TEXT PRIMARY KEY, repo TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS session_selections (
        repo TEXT NOT NULL, session TEXT NOT NULL, feature TEXT NOT NULL, title TEXT NOT NULL,
        PRIMARY KEY(repo, session)
      );
    `);
  }
  countEvents(repoId: string, featureId: string) { return Number(this.db.prepare("SELECT COUNT(*) AS total FROM events WHERE repo=? AND feature=?").get(repoId,featureId)!.total); }
  saveLocalPin(repoId: string, featureId: string, payload: unknown) {
    this.db.prepare("INSERT INTO local_source_pins(feature,repo,payload) VALUES(?,?,?) ON CONFLICT(feature) DO UPDATE SET payload=excluded.payload WHERE repo=excluded.repo").run(featureId,repoId,JSON.stringify(payload));
  }
  localPin<T>(repoId: string, featureId: string): T | null {
    const row=this.db.prepare("SELECT payload FROM local_source_pins WHERE repo=? AND feature=?").get(repoId,featureId);
    return row ? JSON.parse(String(row.payload)) as T : null;
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
  createChatSession(repoId: string, sessionId: string, owner: string) {
    this.db.prepare("INSERT INTO chat_sessions VALUES(?,?,?)").run(repoId, sessionId, owner);
  }
  ownsChatSession(repoId: string, sessionId: string, owner: string) {
    return !!this.db.prepare("SELECT 1 FROM chat_sessions WHERE repo=? AND session=? AND owner=?").get(repoId, sessionId, owner);
  }
  selectSession(repoId: string, sessionId: string, featureId: string, title: string) {
    if (!repoId || !sessionId || !featureId) throw new Error("Repository, session and selected feature are required");
    this.db.prepare("INSERT INTO session_selections VALUES(?,?,?,?) ON CONFLICT(repo,session) DO UPDATE SET feature=excluded.feature,title=excluded.title")
      .run(repoId, sessionId, featureId, title);
  }
  sessionSelection(repoId: string, sessionId: string) {
    const row = this.db.prepare("SELECT feature,title FROM session_selections WHERE repo=? AND session=?").get(repoId, sessionId);
    return row ? { featureId: String(row.feature), title: String(row.title) } : null;
  }
  selectCloudSource(input: {repoId:string;sessionId:string;client:string;origin:string;accountId:string;contextId:string;versionId:string;title:string}) {
    const {repoId,sessionId,client,origin,accountId,contextId,versionId,title}=input;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row=this.db.prepare(`INSERT INTO cloud_continuations(repo,session,client,feature,origin,account,context,version,last_selected)
        VALUES(?,?,?,?,?,?,?,?,(SELECT COALESCE(MAX(last_selected),0)+1 FROM cloud_continuations))
        ON CONFLICT(repo,session,client,origin,account,version) DO UPDATE SET last_selected=excluded.last_selected RETURNING feature`)
        .get(repoId,sessionId,client,'cloud-work:'+randomUUID(),origin,accountId,contextId,versionId)!;
      const featureId=String(row.feature);
      this.selectSession(repoId,sessionId,featureId,title);
      this.db.exec('COMMIT'); return featureId;
    } catch (error) {this.db.exec('ROLLBACK');throw error;}
  }
  cloudSource(repoId:string, featureId:string) {
    const row=this.db.prepare('SELECT origin,account,context,version FROM cloud_continuations WHERE repo=? AND feature=?').get(repoId,featureId);
    return row ? {origin:String(row.origin), accountId:String(row.account), contextId:String(row.context),versionId:String(row.version)} : null;
  }
  lastCloudSource(sessionId:string,client:string) {
    const row=this.db.prepare('SELECT repo,feature,origin,account,version FROM cloud_continuations WHERE session=? AND client=? ORDER BY last_selected DESC LIMIT 1').get(sessionId,client);
    if (!row) return null;
    const work=this.db.prepare("SELECT id,json_extract(payload,'$.content') AS content FROM events WHERE repo=? AND feature=? ORDER BY seq").all(row.repo,row.feature)
      .map(event=>({id:String(event.id),text:String(event.content)}));
    return {origin:String(row.origin),accountId:String(row.account),versionId:String(row.version),work};
  }
  close() { this.db.close(); }
}
