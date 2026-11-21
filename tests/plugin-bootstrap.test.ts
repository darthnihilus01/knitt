import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {ListRootsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {createPluginApp} from '../apps/server/src/plugin-bootstrap.ts';

test('plugin waits for host roots before exposing tools and never uses its install directory as the project', async () => {
 const home=mkdtempSync(join(tmpdir(),'knitt-bootstrap-'));
 const project=join(home,'project');mkdirSync(project);
 const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
 const app=createPluginApp({KNITT_HOME:home,MEMORY_CLIENT:'codex'},serverTransport);
 const client=new Client({name:'host-fixture',version:'1'},{capabilities:{roots:{listChanged:true}}});
 client.setRequestHandler(ListRootsRequestSchema,async()=>({roots:[{uri:pathToFileURL(project).href}]}));
 try {
  await app.connect();await client.connect(clientTransport);
  const tools=(await client.listTools()).tools.map(t=>t.name);
  assert.ok(tools.includes('knitt_preview_sync'));
  const result=await client.callTool({name:'knitt_status',arguments:{}});
  assert.equal((result.structuredContent as any).workspace,project);
  assert.equal((result.structuredContent as any).connected,false);
 }finally{await client.close();await app.close();rmSync(home,{recursive:true,force:true});}
});

test('missing host roots requires an explicit project selection without uploading',async()=>{
 const home=mkdtempSync(join(tmpdir(),'knitt-bootstrap-'));const project=join(home,'project');mkdirSync(project);
 const [a,b]=InMemoryTransport.createLinkedPair();
 const app=createPluginApp({KNITT_HOME:home,MEMORY_CLIENT:'codex'},b);
 const client=new Client({name:'host-without-roots',version:'1'});
 try{
  await app.connect();await client.connect(a);
  const status=await client.callTool({name:'knitt_status',arguments:{}});
  assert.equal((status.structuredContent as any).setupRequired,'select_project');
  assert.equal((status.structuredContent as any).setupState,'project_selection_required');
  assert.match((status.structuredContent as any).nextAction,/confirm/i);
  const chosen=await client.callTool({name:'knitt_set_workspace',arguments:{workspace:project,userApproved:true}});
  assert.equal(chosen.isError,undefined);
  const ready=await client.callTool({name:'knitt_status',arguments:{}});
  assert.equal((ready.structuredContent as any).workspace,project);
  assert.equal((ready.structuredContent as any).binding,null);
 }finally{await client.close();await app.close();rmSync(home,{recursive:true,force:true});}
});


test('multiple host roots require explicit project selection',async()=>{
 const home=mkdtempSync(join(tmpdir(),'knitt-bootstrap-')),first=join(home,'first'),second=join(home,'second');mkdirSync(first);mkdirSync(second);
 const [a,b]=InMemoryTransport.createLinkedPair(),app=createPluginApp({KNITT_HOME:home},b);
 const client=new Client({name:'multi-root-host',version:'1'},{capabilities:{roots:{listChanged:true}}});
 client.setRequestHandler(ListRootsRequestSchema,async()=>({roots:[{uri:pathToFileURL(first).href},{uri:pathToFileURL(second).href}]}));
 try{
  await app.connect();await client.connect(a);
  const status=await client.callTool({name:'knitt_status',arguments:{}});
  assert.equal((status.structuredContent as any).setupState,'project_selection_required');
  assert.equal((await client.listTools()).tools.some(t=>t.name==='knitt_preview_sync'),true);
 }finally{await client.close();await app.close();rmSync(home,{recursive:true,force:true});}
});


test('cached initial tool inventory works after workspace selection without rediscovery',async()=>{
 const home=mkdtempSync(join(tmpdir(),'knitt-stable-')),project=join(home,'project');mkdirSync(project);
 const [a,b]=InMemoryTransport.createLinkedPair(),app=createPluginApp({KNITT_HOME:home,MEMORY_CLIENT:'antigravity'},b);
 const client=new Client({name:'cached-host',version:'1'});
 try{
  await app.connect();await client.connect(a);
  const initial=(await client.listTools()).tools.map(t=>t.name).sort();
  for(const name of ['knitt_connect','knitt_preview_sync','knitt_enable_sync','knitt_sync','knitt_invitations','knitt_onboarding_control','choose_conversation'])assert.ok(initial.includes(name),name);
  const blocked=await client.callTool({name:'knitt_invitations',arguments:{action:'list'}});
  assert.equal(blocked.isError,true);
  await client.callTool({name:'knitt_set_workspace',arguments:{workspace:project,userApproved:true}});
  const status=await client.callTool({name:'knitt_status',arguments:{}});assert.equal((status.structuredContent as any).onboarding.offer,true);
  const denied=await client.callTool({name:'knitt_onboarding_control',arguments:{action:'dismiss',userApproved:false}});assert.equal(denied.isError,true);
  const later=await client.callTool({name:'knitt_onboarding_control',arguments:{action:'dismiss',userApproved:true}});assert.equal(later.isError,undefined);
  const dismissed=await client.callTool({name:'knitt_status',arguments:{}});assert.equal((dismissed.structuredContent as any).onboarding.offer,false);
  assert.deepEqual((await client.listTools()).tools.map(t=>t.name).sort(),initial);
 }finally{await client.close();await app.close();rmSync(home,{recursive:true,force:true});}
});
