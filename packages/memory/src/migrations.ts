import { DatabaseSync } from "node:sqlite";
import { chmodSync } from "node:fs";
import { randomUUID } from "node:crypto";
export const schemaVersion = 4;
export function assertSupportedSchema(db: DatabaseSync) {
  const version = Number(db.prepare("PRAGMA user_version").get()!.user_version);
  if (version > schemaVersion)
    throw new Error(
      "Unsupported memory schema; use a compatible Knitt runtime",
    );
  return version;
}
export function migrate(db: DatabaseSync): void {
  const version = assertSupportedSchema(db);
  if (version === schemaVersion) return;
  const file = String(db.prepare("PRAGMA database_list").get()!.file);
  if (file) {
    const backup = file + ".backup-v" + version + "-" + randomUUID();
    db.exec("VACUUM INTO '" + backup.replaceAll("'", "''") + "'");
    chmodSync(backup, 0o600);
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    // Recheck under the write lock: another process may already have upgraded.
    if (assertSupportedSchema(db) === schemaVersion) {
      db.exec("COMMIT");
      return;
    }
    if (version < 1)
      db.exec(`CREATE TABLE conversations(repo TEXT NOT NULL,id TEXT NOT NULL,title TEXT NOT NULL,client TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(repo,id));
   CREATE TABLE native_sessions(repo TEXT NOT NULL,client TEXT NOT NULL,native_id TEXT NOT NULL,conversation TEXT NOT NULL,workspace TEXT NOT NULL,branch TEXT,commit_id TEXT,PRIMARY KEY(repo,client,native_id));
   CREATE TABLE conversation_evidence(repo TEXT NOT NULL,event_id TEXT NOT NULL,conversation TEXT NOT NULL,PRIMARY KEY(repo,event_id));
   CREATE INDEX conversation_evidence_scope ON conversation_evidence(repo,conversation);
   PRAGMA user_version=1;`);
    if (version < 2)
      db.exec(
        `CREATE TABLE continuation_links(repo TEXT NOT NULL,client TEXT NOT NULL,native_id TEXT NOT NULL,source TEXT NOT NULL,through_seq INTEGER NOT NULL,PRIMARY KEY(repo,client,native_id)); PRAGMA user_version=2;`,
      );
    if (version < 3)
      db.exec(
        `CREATE TABLE checkpoints(seq INTEGER PRIMARY KEY AUTOINCREMENT,repo TEXT NOT NULL,conversation TEXT NOT NULL,id TEXT NOT NULL,through_seq INTEGER NOT NULL,payload TEXT NOT NULL,UNIQUE(repo,id)); CREATE INDEX checkpoints_scope ON checkpoints(repo,conversation,seq); PRAGMA user_version=3;`,
      );
    if (version < 4)
      db.exec(`
      ALTER TABLE native_sessions ADD COLUMN token_hash TEXT;
      ALTER TABLE continuation_links ADD COLUMN checkpoint_seq INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE continuation_links ADD COLUMN source_location TEXT NOT NULL DEFAULT '{}';
      CREATE TABLE retired_checkpoint_entries(repo TEXT NOT NULL,conversation TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(repo,conversation,id));
      INSERT OR IGNORE INTO retired_checkpoint_entries
        SELECT checkpoints.repo,checkpoints.conversation,json_extract(entry.value,'$.supersedes')
        FROM checkpoints,json_each(checkpoints.payload,'$.entries') entry
        WHERE json_type(entry.value,'$.supersedes')='text';
      PRAGMA user_version=4;
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
