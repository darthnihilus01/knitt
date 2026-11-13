import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { sessionKeySchema, locationSchema } from "../../contracts/src/conversations.ts";
import type { SessionKey, SessionLocation, Conversation } from "../../contracts/src/conversations.ts";
export class ConversationStore {
 private db:DatabaseSync;
 constructor(db:DatabaseSync){this.db=db;}
 ensureSession(input:SessionKey,location:SessionLocation):Conversation {
  const key=sessionKeySchema.parse(input),loc=locationSchema.parse(location);
  this.db.exec("BEGIN IMMEDIATE");
  try {
   const row=this.db.prepare("SELECT conversation FROM native_sessions WHERE repo=? AND client=? AND native_id=?").get(key.repoId,key.client,key.nativeSessionId);
   const id=row?String(row.conversation):"conversation:"+randomUUID();
   if(!row){
    this.db.prepare("INSERT INTO conversations VALUES(?,?,?,?,?)").run(key.repoId,id,key.client+" session "+key.nativeSessionId.slice(0,24),key.client,new Date().toISOString());
    this.db.prepare("INSERT INTO native_sessions VALUES(?,?,?,?,?,?,?)").run(key.repoId,key.client,key.nativeSessionId,id,loc.workspace,loc.branch??null,loc.commit??null);
   }else this.db.prepare("UPDATE native_sessions SET workspace=?,branch=?,commit_id=? WHERE repo=? AND client=? AND native_id=?").run(loc.workspace,loc.branch??null,loc.commit??null,key.repoId,key.client,key.nativeSessionId);
   const conversation=this.get(key.repoId,id);this.db.exec("COMMIT");return conversation;
  }catch(error){this.db.exec("ROLLBACK");throw error;}
 }
 session(input:SessionKey):Conversation {
  const key=sessionKeySchema.parse(input);
  const row=this.db.prepare("SELECT conversation FROM native_sessions WHERE repo=? AND client=? AND native_id=?").get(key.repoId,key.client,key.nativeSessionId);
  if(!row)throw new Error("Unknown conversation session");return this.get(key.repoId,String(row.conversation));
 }
 get(repoId:string,id:string):Conversation {
  const row=this.db.prepare("SELECT * FROM conversations WHERE repo=? AND id=?").get(repoId,id);
  if(!row)throw new Error("Unknown conversation in repository");
  return {repoId:String(row.repo),conversationId:String(row.id),title:String(row.title),client:String(row.client)};
 }
 list(repoId:string):Conversation[]{return this.db.prepare("SELECT id FROM conversations WHERE repo=? ORDER BY created DESC,id").all(repoId).map(r=>this.get(repoId,String(r.id)));}
}
