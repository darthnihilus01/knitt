import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { MemoryStore } from "../packages/memory/src/store.ts";
import { discoverConversations,importDiscovered } from "../packages/adapters/src/discovery.ts";
test("discovery filters repositories and imports Codex and Claude only after selection",()=>{
 const dir=mkdtempSync(join(tmpdir(),"knitt-discovery-"));const workspace=join(dir,"project");
 mkdirSync(workspace);execFileSync("git",["init",workspace],{stdio:"ignore"});
 const store=new MemoryStore(":memory:",{conversationMode:true});
 try {
  const roots={codex:join(dir,"codex"),claude:join(dir,"claude"),antigravity:[] as string[]};
  mkdirSync(roots.codex);mkdirSync(roots.claude);
  writeFileSync(join(roots.codex,"a.jsonl"),[JSON.stringify({type:"session_meta",payload:{id:"same",cwd:workspace}}),JSON.stringify({type:"response_item",payload:{role:"assistant",content:[{type:"output_text",text:"Codex decision"}]}})].join("\n")+"\n");
  writeFileSync(join(roots.codex,"other.jsonl"),JSON.stringify({type:"session_meta",payload:{id:"other",cwd:"/unrelated"}})+"\n");
  writeFileSync(join(roots.claude,"b.jsonl"),JSON.stringify({type:"user",sessionId:"same",cwd:workspace,message:{role:"user",content:"Claude request"}})+"\n");
  const found=discoverConversations(store,"r",workspace,roots);
  assert.equal(found.conversations.length,2);assert.equal(store.listConversations("r").length,0);
  assert.equal(new Set(found.conversations.map(c=>c.id)).size,2);
  for(const c of found.conversations)importDiscovered(store,"r",c,join(dir,"queue"));
  const imported=store.listConversations("r");assert.equal(imported.length,2);
  assert.ok(imported.some(c=>store.context({repoId:"r",featureId:c.conversationId}).events.some(e=>e.content.includes("Codex decision"))));
  assert.ok(imported.some(c=>store.context({repoId:"r",featureId:c.conversationId}).events.some(e=>e.content.includes("Claude request"))));
  assert.equal(discoverConversations(store,"r",workspace,{codex:"/missing",claude:"/missing",antigravity:[]}).conversations.length,2);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
