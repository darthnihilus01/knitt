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
  const chosen=await client.callTool({name:'knitt_set_workspace',arguments:{workspace:project,userApproved:true}});
  assert.equal(chosen.isError,undefined);
  const ready=await client.callTool({name:'knitt_status',arguments:{}});
  assert.equal((ready.structuredContent as any).workspace,project);
  assert.equal((ready.structuredContent as any).binding,null);
 }finally{await client.close();await app.close();rmSync(home,{recursive:true,force:true});}
});
