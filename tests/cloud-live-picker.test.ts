import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cloudPicker} from '../apps/server/src/cloud-picker.ts';
import {MemoryStore} from '../packages/memory/src/store.ts';

test('live picker explicitly pins latest cutoff, reloads on reselection and rechecks access for all recall',async()=>{
 const home=mkdtempSync(join(tmpdir(),'live-picker-'));mkdirSync(join(home,'cloud'));
 writeFileSync(join(home,'cloud/device.json'),JSON.stringify({origin:'https://knitt.test',token:'test',device:{id:'d',name:'d'},account:{id:'bob',email:'bob@example.test'}}));
 const store=new MemoryStore(join(home,'memory.sqlite'));const original=globalThis.fetch;let cutoff=1,allowed=true,shareId="share";
 globalThis.fetch=async(raw)=>{const u=new URL(String(raw));let data:unknown={};let status=200;
  if(u.pathname==='/api/contexts')data={contexts:[]};
  else if(u.pathname==='/api/shared/conversations')data={conversations:allowed?[{id:shareId,title:'Live chat',senderUsername:'alice',updatedAt:'2026-11-21',sourceAgent:'codex'}]:[]};
  else if(u.pathname.startsWith('/api/shared/conversations/')){
   if(!allowed || u.pathname.split("/")[4]!==shareId){status=404;data={error:'Not found'};}else {const pinned=Number(u.searchParams.get('cutoff')??cutoff);data=u.pathname.endsWith('/context')?{cutoff:pinned,events:[{id:'e',text:'messages through '+pinned}],nextBefore:null}:u.pathname.endsWith('/search')?{results:[{text:'match'}]}:{evidence:{text:'evidence'}};}
  }else {status=404;data={error:'Not found'};}return new Response(JSON.stringify(data),{status});
 };
 try{
  const picker=cloudPicker(home,'repo',store);
  type Result={options:{title:string;choiceId:string}[];selected?:boolean;context?:unknown;featureId?:string};
  const choose=async(choiceId?:string,source?:'shared')=>await picker.choose('antigravity',home,'s','',choiceId,source) as Result;
  const list=await choose(undefined,'shared');
  assert.ok(list);const item=list.options.find(o=>o.title.includes('Live chat'));assert.ok(item);
  const loaded=await choose(item.choiceId);assert.ok(loaded?.selected);assert.match(JSON.stringify(loaded.context),/messages through 1/);
  cutoff=2;assert.match(JSON.stringify(await picker.recall(loaded.featureId!,'get_context')),/messages through 1/);
  const again=await choose(undefined,'shared');assert.ok(again);const selected=await choose(again.options[0].choiceId);assert.ok(selected?.selected);assert.match(JSON.stringify(selected.context),/messages through 2/);
  shareId='replacement';
  const reinvited=await choose(undefined,'shared');const renewed=await choose(reinvited.options[0].choiceId);
  assert.ok(renewed.selected);assert.match(JSON.stringify(await picker.recall(renewed.featureId!,'get_context')),/messages through 2/);
  allowed=false;
  for(const operation of ['get_context','search_memory','get_evidence'] as const)await assert.rejects(picker.recall(renewed.featureId!,operation,'e'));
 }finally{globalThis.fetch=original;store.close();rmSync(home,{recursive:true,force:true});}
});
