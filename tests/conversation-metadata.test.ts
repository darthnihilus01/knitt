import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { historyFixture } from './fixtures/history.ts';
import { discoverHistories } from '../packages/adapters/src/histories.ts';
import { describeConversation } from '../packages/adapters/src/conversation.ts';
import { nativeQuestion } from '../packages/adapters/src/question-ui.ts';

test('Codex native index names override prompt titles, including rename, without changing identity', () => {
  const f = historyFixture();
  try {
    const db = new DatabaseSync(join(f.roots.codex[0], 'state_5.sqlite'));
    db.prepare('UPDATE threads SET title=? WHERE id=?').run('Here is my enormous opening prompt', 'same-id'); db.close();
    const index = join(f.roots.codex[0], 'session_index.jsonl');
    writeFileSync(index, JSON.stringify({id:'same-id',thread_name:'Validate plugin submission'})+'\n');
    const first = describeConversation(discoverHistories({roots:f.roots,workspace:f.workspace,destination:'antigravity'})[0]);
    assert.equal(first.title,'Validate plugin submission');
    assert.equal(first.titleSource,'native');
    assert.ok(first.summary.includes('Codex decision'));
    assert.ok(first.summary.length <= 50);
    assert.equal(first.availability,'available');
    appendFileSync(index,JSON.stringify({id:'same-id',thread_name:'Renamed submission'})+'\n');
    const renamed = describeConversation(discoverHistories({roots:f.roots,workspace:f.workspace,destination:'antigravity'})[0]);
    assert.equal(renamed.title,'Renamed submission'); assert.equal(renamed.sourceId,first.sourceId);
  } finally {rmSync(f.root,{recursive:true,force:true});}
});
test('uncorroborated Codex title is marked fallback and summaries redact secrets', () => {
  const f=historyFixture();
  try {
    const c=describeConversation(discoverHistories({roots:f.roots,workspace:f.workspace,destination:'antigravity'})[0]);
    assert.equal(c.titleSource,'fallback'); assert.doesNotMatch(c.summary,/secret-value/);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('native selection labels include short summaries, relative times and unique mappings after truncation', () => {
  const choices=Array.from({length:2},(_,i)=>({choiceId:'c'+i,client:'codex' as const,title:'x'.repeat(300),summary:'Different task '+i,modified:new Date().toISOString(),titleSource:'fallback' as const}));
  for(const host of ['codex','claude','antigravity'] as const){
    const ui=nativeQuestion(host,'/project',choices,0,1);
    assert.equal(Object.keys(ui.choiceMap).length,2);
    assert.match(JSON.stringify(ui.arguments),/Different task 0/);
    assert.match(JSON.stringify(ui.arguments),/just now/);
  }
});

test('same native ID in different history roots remains independently selectable',()=>{
 const f=historyFixture(),g=historyFixture();
 try{
  const db=new DatabaseSync(join(g.roots.codex[0],'state_5.sqlite'));db.prepare('UPDATE threads SET cwd=? WHERE id=?').run(f.workspace,'same-id');db.close();
  const matches=discoverHistories({roots:{...f.roots,codex:[...f.roots.codex,...g.roots.codex]},workspace:f.workspace,destination:'antigravity'}).filter(c=>c.client==='codex');
  assert.equal(matches.length,2);assert.notEqual(describeConversation(matches[0]).sourceId,describeConversation(matches[1]).sourceId);
 }finally{rmSync(f.root,{recursive:true,force:true});rmSync(g.root,{recursive:true,force:true});}
});
test('native titles in the middle of a large session index are read rather than replaced with a fallback',()=>{
 const f=historyFixture();
 try{
  const filler=JSON.stringify({id:'unrelated',thread_name:'x'.repeat(1000)})+'\n';
  writeFileSync(join(f.roots.codex[0],'session_index.jsonl'),filler.repeat(400)+JSON.stringify({id:'same-id',thread_name:'Exact middle native title'})+'\n'+filler.repeat(400));
  assert.equal(discoverHistories({roots:f.roots,workspace:f.workspace,destination:'antigravity'})[0].title,'Exact middle native title');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('a Claude summary supplies a preview without replacing its native title',()=>{
 const f=historyFixture();
 try{
  appendFileSync(join(f.roots.claude[0],'projects/encoded-project/same-id.jsonl'),JSON.stringify({type:'summary',summary:'Investigate context mismatches and loading latency'})+'\n');
  const c=describeConversation(discoverHistories({roots:f.roots,workspace:f.workspace,destination:'antigravity'}).find(c=>c.client==='claude')!);
  assert.equal(c.title,'Claude chat');assert.match(c.summary,/Investigate context/);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
