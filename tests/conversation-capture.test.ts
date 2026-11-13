import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { MemoryStore } from "../packages/memory/src/store.ts";
import { planConnection } from "../packages/installer/src/connections.ts";
test("opted-in hook records new sessions separately, redacts and deduplicates after restart",()=>{
 const dir=mkdtempSync(join(tmpdir(),"knitt-capture-"));const database=join(dir,"events.sqlite");
 const env={...process.env,MEMORY_DB:database,MEMORY_QUEUE:join(dir,"queue"),MEMORY_REPO:"r",MEMORY_SESSION_SELECTION:"1",MEMORY_CONVERSATION_MODE:"1",MEMORY_CAPTURE_NEW_SESSIONS:"1"};
 delete (env as Record<string,string|undefined>).NODE_TEST_CONTEXT;
 const capture=(id:string)=>spawnSync(process.execPath,[resolve("packages/adapters/src/cli.ts"),"capture","codex"],{env,input:JSON.stringify({session_id:id,last_assistant_message:"Decision keep IDs token=private",cwd:process.cwd()}),encoding:"utf8"});
 try {
  assert.equal(capture("a").status,0);assert.equal(capture("a").status,0);assert.equal(capture("b").status,0);
  const store=new MemoryStore(database,{conversationMode:true});
  try {const conversations=store.listConversations("r");assert.equal(conversations.length,2);
   for(const c of conversations){const data=store.context({repoId:"r",featureId:c.conversationId});assert.equal(data.total,1);assert.ok(!JSON.stringify(data).includes("private"));assert.ok(data.events[0].commit);}
  } finally {store.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("new-session capture requires explicit setup preference",()=>{
 const base={workspace:process.cwd(),appRoot:process.cwd(),database:"/tmp/example.sqlite",repoId:"r",clients:["codex"]};
 const legacy=planConnection(base);assert.ok(!legacy.changes[".codex/config.toml"]?.includes("MEMORY_CAPTURE_NEW_SESSIONS"));
 const opted=planConnection({...base,captureNewSessions:true});assert.ok(opted.changes[".codex/config.toml"]?.includes("MEMORY_CAPTURE_NEW_SESSIONS"));
});
