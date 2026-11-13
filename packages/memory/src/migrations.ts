import { DatabaseSync } from "node:sqlite";
import { chmodSync } from "node:fs";
import { randomUUID } from "node:crypto";
export const schemaVersion=2;
export function assertSupportedSchema(db:DatabaseSync) {
 const version=Number(db.prepare("PRAGMA user_version").get()!.user_version);
 if(version>schemaVersion) throw new Error("Unsupported memory schema; use a compatible Knitt runtime");
 return version;
}
export function migrate(db:DatabaseSync):void {
 const version=assertSupportedSchema(db);if(version===schemaVersion)return;
 const file=String(db.prepare("PRAGMA database_list").get()!.file);
 if(file){const backup=file+".backup-v"+version+"-"+randomUUID();db.exec("VACUUM INTO '"+backup.replaceAll("'","''")+"'");chmodSync(backup,0o600);}
 db.exec("BEGIN IMMEDIATE");
 try {
  // Recheck under the write lock: another process may already have upgraded.
  if(assertSupportedSchema(db)===schemaVersion){db.exec("COMMIT");return;}
  if(version<1)db.exec(`CREATE TABLE conversations(repo TEXT NOT NULL,id TEXT NOT NULL,title TEXT NOT NULL,client TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(repo,id));
   CREATE TABLE native_sessions(repo TEXT NOT NULL,client TEXT NOT NULL,native_id TEXT NOT NULL,conversation TEXT NOT NULL,workspace TEXT NOT NULL,branch TEXT,commit_id TEXT,PRIMARY KEY(repo,client,native_id));
   CREATE TABLE conversation_evidence(repo TEXT NOT NULL,event_id TEXT NOT NULL,conversation TEXT NOT NULL,PRIMARY KEY(repo,event_id));
   CREATE INDEX conversation_evidence_scope ON conversation_evidence(repo,conversation);
   PRAGMA user_version=1;`);
  if(version<2)db.exec(`CREATE TABLE continuation_links(repo TEXT NOT NULL,client TEXT NOT NULL,native_id TEXT NOT NULL,source TEXT NOT NULL,through_seq INTEGER NOT NULL,PRIMARY KEY(repo,client,native_id)); PRAGMA user_version=2;`);
  db.exec("COMMIT");
 }catch(error){db.exec("ROLLBACK");throw error;}
}
