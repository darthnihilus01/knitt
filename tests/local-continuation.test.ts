import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { historyFixture } from './fixtures/history.ts';
import { discoverHistories } from '../packages/adapters/src/histories.ts';
import { MemoryStore } from '../packages/memory/src/store.ts';
import { LocalContinuations } from '../apps/server/src/local-continuation.ts';

test('large selection returns recent source immediately, indexes older evidence, and pins its boundary', async()=>{
 const f=historyFixture(),store=new MemoryStore(':memory:');
 const continuations=new LocalContinuations(store,join(f.root,'queue'),'repo');
 try{
  const c=discoverHistories({roots:f.roots,workspace:f.workspace,destination:'antigravity'})[0];
  const row=(text:string)=>JSON.stringify({type:'response_item',payload:{role:'assistant',content:[{type:'output_text',text}]}})+'\n';
  writeFileSync(c.transcript!,Array.from({length:3000},(_,i)=>row(i===0?'EARLY_SOURCE_DECISION':'historical detail '+i+' '+'.'.repeat(200))).join('')+row('LATEST_SOURCE_DECISION'));
  const start=performance.now();const selected=continuations.select(c);
  if(process.env.KNITT_PERFORMANCE_CHECK)assert.ok(performance.now()-start<1000,'bounded selection must not import full history');
  assert.match(JSON.stringify(selected.context),/LATEST_SOURCE_DECISION/);
  assert.equal(selected.context.checkpoint,null);
  assert.equal(selected.context.indexing.status,'indexing');
  appendFileSync(c.transcript!,row('AFTER_SELECTION_EXCLUDED'));
  const before=JSON.stringify(continuations.context(selected.featureId));
  await continuations.drain(selected.featureId);
  assert.equal(JSON.stringify(continuations.context(selected.featureId).events),JSON.stringify(selected.context.events));
  assert.match(JSON.stringify(store.search({repoId:'repo',featureId:selected.featureId,query:'EARLY_SOURCE_DECISION'})),/EARLY_SOURCE_DECISION/);
  assert.doesNotMatch(JSON.stringify(store.search({repoId:'repo',featureId:selected.featureId,query:'AFTER_SELECTION_EXCLUDED'})),/AFTER_SELECTION_EXCLUDED/);
  assert.doesNotMatch(before,/AFTER_SELECTION_EXCLUDED/);
  assert.equal(continuations.context(selected.featureId).indexing.status,'ready');
  const newer=continuations.select(c);assert.notEqual(newer.featureId,selected.featureId);assert.match(JSON.stringify(newer.context),/AFTER_SELECTION_EXCLUDED/);
 }finally{continuations.close();store.close();rmSync(f.root,{recursive:true,force:true});}
});
test('a rewritten transcript invalidates a displayed source rather than silently loading a replacement',()=>{
 const f=historyFixture(),store=new MemoryStore(':memory:'),continuations=new LocalContinuations(store,join(f.root,'queue'),'repo');
 try{const c=discoverHistories({roots:f.roots,workspace:f.workspace,destination:'antigravity'})[0];const ticket=continuations.ticket(c);writeFileSync(c.transcript!,'{}\n');assert.throws(()=>continuations.select(c,ticket),/changed|unavailable/i);}
 finally{continuations.close();store.close();rmSync(f.root,{recursive:true,force:true});}
});
test('middle rewrite plus append cannot contaminate a selected immutable source',async()=>{
 const f=historyFixture(),store=new MemoryStore(':memory:'),continuations=new LocalContinuations(store,join(f.root,'queue'),'repo');
 try{
  const c=discoverHistories({roots:f.roots,workspace:f.workspace,destination:'antigravity'})[0];
  const row=(text:string)=>JSON.stringify({type:'response_item',payload:{role:'assistant',content:[{type:'output_text',text}]}})+'\n';
  const content=Array.from({length:1000},(_,i)=>row(i===200?'ORIGINAL_MIDDLE_DECISION':'filler '+'.'.repeat(100))).join('');writeFileSync(c.transcript!,content);
  const selected=continuations.select(c);
  writeFileSync(c.transcript!,content.replace('ORIGINAL_MIDDLE_DECISION','REPLACED_MIDDLE_DECISION')+row('NEW_APPEND'));
  await continuations.drain(selected.featureId);
  assert.doesNotMatch(JSON.stringify(store.search({repoId:'repo',featureId:selected.featureId,query:'REPLACED_MIDDLE_DECISION'})),/REPLACED_MIDDLE_DECISION/);
  assert.match(JSON.stringify(store.search({repoId:'repo',featureId:selected.featureId,query:'ORIGINAL_MIDDLE_DECISION'})),/ORIGINAL_MIDDLE_DECISION/);
 }finally{continuations.close();store.close();rmSync(f.root,{recursive:true,force:true});}
});
test('an oversized unfinished tail does not hide preceding complete messages',()=>{
 const f=historyFixture(),store=new MemoryStore(':memory:'),continuations=new LocalContinuations(store,join(f.root,'queue'),'repo');
 try{
  const c=discoverHistories({roots:f.roots,workspace:f.workspace,destination:'antigravity'})[0];appendFileSync(c.transcript!,'x'.repeat(1200000));
  const selected=continuations.select(c);assert.match(JSON.stringify(selected.context),/Codex decision/);
 }finally{continuations.close();store.close();rmSync(f.root,{recursive:true,force:true});}
});
test('WAL-backed Antigravity evidence is frozen consistently before later index writes',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const f=historyFixture(),store=new MemoryStore(':memory:'),continuations=new LocalContinuations(store,join(f.root,'queue'),'repo');
 const db=new DatabaseSync(join(f.roots.antigravity[0],'conversation_summaries.db'));
 try{
  rmSync(join(f.roots.antigravity[0],'brain'),{recursive:true,force:true});
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE conversations_fts(conversation_id TEXT,chunk_index INTEGER,user_body TEXT,agent_body TEXT)');
  db.prepare('INSERT INTO conversations_fts VALUES(?,?,?,?)').run('same-id',0,'Original indexed goal','Original indexed decision');
  const c=discoverHistories({roots:f.roots,workspace:f.workspace,destination:'codex'}).find(c=>c.client==='antigravity')!;
  const selected=continuations.select(c);db.prepare('UPDATE conversations_fts SET agent_body=?').run('Changed after selection');
  await continuations.drain(selected.featureId);
  assert.equal(continuations.context(selected.featureId).indexing.status,'ready');
  assert.match(JSON.stringify(store.search({repoId:'repo',featureId:selected.featureId,query:'Original indexed decision'})),/Original indexed decision/);
  assert.doesNotMatch(JSON.stringify(store.search({repoId:'repo',featureId:selected.featureId,query:'Changed after selection'})),/Changed after selection/);
 }finally{continuations.close();db.close();store.close();rmSync(f.root,{recursive:true,force:true});}
});
test('background indexing resumes from disk after restart without reordering or adding later source messages',async()=>{
 const f=historyFixture(),path=join(f.root,'memory.sqlite'),queue=join(f.root,'queue');let store=new MemoryStore(path),continuations=new LocalContinuations(store,queue,'repo');
 try{
  const c=discoverHistories({roots:f.roots,workspace:f.workspace,destination:'antigravity'})[0];
  const row=(text:string)=>JSON.stringify({type:'response_item',payload:{role:'assistant',content:[{type:'output_text',text}]}})+'\n';
  writeFileSync(c.transcript!,row('First chronological decision')+row('Last chronological decision'));
  const selected=continuations.select(c),latestEvent=selected.context.events[0];
  assert.equal(continuations.evidence(selected.featureId,latestEvent.eventId)?.content,latestEvent.content);
  continuations.close();store.close();appendFileSync(c.transcript!,row('Newer than selected boundary'));
  store=new MemoryStore(path);continuations=new LocalContinuations(store,queue,'repo');
  continuations.context(selected.featureId);await continuations.drain(selected.featureId);
  assert.deepEqual(store.search({repoId:'repo',featureId:selected.featureId}).matches.map(e=>e.excerpt),['assistant: Last chronological decision','assistant: First chronological decision']);
  assert.doesNotMatch(JSON.stringify(continuations.context(selected.featureId)),/Newer than selected boundary/);
 }finally{continuations.close();store.close();rmSync(f.root,{recursive:true,force:true});}
});
