import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {historyFixture} from './fixtures/history.ts';
import {createMemoryServer} from '../apps/server/src/server.ts';

test('paired but offline /knit opens local choices without cloud/setup calls and returns source boundary',async()=>{
 const f=historyFixture(),home=join(f.root,'home');mkdirSync(join(home,'cloud'),{recursive:true});
 writeFileSync(join(home,'cloud/device.json'),JSON.stringify({origin:'https://offline.example.test',token:'revoked',device:{id:'device',name:'test'},account:{id:'alice',email:'alice@example.test'}}));
 const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw new Error('offline');};
 const app=createMemoryServer({SHARED_MEMORY_HOME:home,MEMORY_DB:join(f.root,'events.sqlite'),MEMORY_REPO:'repo',MEMORY_CLIENT:'antigravity',MEMORY_WORKSPACE:f.workspace,MEMORY_SESSION_SELECTION:'1',MEMORY_HISTORY_ROOTS:JSON.stringify(f.roots)},{inChatPicker:true,preferChatPicker:true});
 const client=new Client({name:'continuation',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
 try{
  await Promise.all([app.server.connect(a),client.connect(b)]);
  const call=async(extra={})=>{const r=await client.callTool({name:'choose_conversation',arguments:{sessionId:'destination',workspace:f.workspace,...extra}});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent as any;};
  const list=await call();assert.equal(network,0);assert.equal(list.options[0].client,'codex');assert.ok(list.options[0].sourceId);assert.match(list.options[0].summary,/Codex/);assert.ok(Number.isFinite(list.timings.totalMs));if(process.env.KNITT_PERFORMANCE_CHECK)assert.ok(list.timings.totalMs<500);
  const selected=await call({choiceId:list.options[0].choiceId});assert.ok(selected.context.boundary);assert.match(JSON.stringify(selected.context),/Codex decision/);assert.equal(network,0);
  const unavailable=await call({source:'chatgpt'});assert.equal(unavailable.message,'ChatGPT history access unavailable through this connection.');assert.equal(network,0);
  const missingProject=await call({source:'personal'});assert.equal(missingProject.projectNotConnected,true);assert.equal(network,0);
 }finally{await client.close();await app.server.close();app.close();globalThis.fetch=originalFetch;rmSync(f.root,{recursive:true,force:true});}
});
