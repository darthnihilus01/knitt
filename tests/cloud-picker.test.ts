import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { historyFixture } from './fixtures/history.ts';

for (const [source,destination] of [['claude','codex'],['codex','antigravity'],['antigravity','claude']]) test(`${source} shared version stays pinned in ${destination} and revocation blocks future retrieval`,async () => {
  const f = historyFixture(); let allowed = true, latest = 2;
  const server = createServer((req,res) => {
    res.setHeader('Content-Type','application/json');
    if (!allowed || req.headers.authorization !== 'Bearer device-secret') {res.statusCode=403;res.end('{}');return;}
    const url = new URL(req.url!,'http://localhost');
    const data:Record<string,unknown> = {
      '/api/contexts': {contexts:[{id:'ctx',title:'Shared handoff',ownerUsername:'owner',owned:false,latestVersionId:'v'+latest}]},
      '/api/contexts/ctx/versions': {versions:Array.from({length:latest-1},(_,i)=>({id:'v'+(i+2),number:i+2,createdAt:'2026-11-19'}))},
      '/api/versions/v2': {version:{id:'v2',contextId:'ctx',title:'Shared handoff',number:2,source:{agent:source},checkpoint:'Reviewed source',excerpts:[{id:'ev2',text:'Second version excerpt'}]}},
      '/api/search':url.searchParams.get('versionId')==='v2'?{results:[{versionId:'v2',checkpoint:'Reviewed source'}]}:undefined,
      '/api/evidence/ev2':url.searchParams.get('versionId')==='v2'?{evidence:{id:'ev2',text:'Second version excerpt',versionId:'v2'}}:undefined,
    };
    if (!data[url.pathname]) res.statusCode=404;
    res.end(JSON.stringify(data[url.pathname] ?? {}));
  });
  const client = new Client({name:'shared-picker',version:'1'});
  try {
    server.listen(0,'127.0.0.1'); await once(server,'listening');
    const address=server.address();assert.ok(address && typeof address==='object');
    const home=join(f.root,'home');mkdirSync(join(home,'cloud'),{recursive:true});
    writeFileSync(join(home,'cloud/device.json'),JSON.stringify({origin:'http://127.0.0.1:'+address.port,token:'device-secret',device:{id:'dev',name:'test'},account:{id:'receiver',email:'receiver@example.test'}}));
    await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve(process.env.KNITT_TEST_SERVER ?? 'apps/server/src/main.ts')],env:{...process.env as Record<string,string>,SHARED_MEMORY_HOME:home,MEMORY_DB:join(f.root,'memory.sqlite'),MEMORY_REPO:'project',MEMORY_WORKSPACE:f.workspace,MEMORY_SESSION_SELECTION:'1',MEMORY_CLIENT:destination,MEMORY_HISTORY_ROOTS:JSON.stringify(f.roots)}}));
    const sessionId='same-id', repoId='project';
    const pick=async(choiceId?:string)=>{ const r=await client.callTool({name:'choose_conversation',arguments:{sessionId,workspace:f.workspace,choiceId}});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent as {options:{title:string;choiceId:string}[];context?:unknown;featureId?:string};};
    const byTitle=(p:Awaited<ReturnType<typeof pick>>,title:string)=>{const option=p.options.find(o=>o.title.includes(title));assert.ok(option,`Missing ${title} in ${JSON.stringify(p.options)}`);return option.choiceId;};
    const root=await client.callTool({name:"choose_conversation",arguments:{sessionId,workspace:f.workspace,source:"shared"}});
    const shared=root.structuredContent as Awaited<ReturnType<typeof pick>>;
    const versions=await pick(byTitle(shared,'Shared handoff'));
    const loaded=await pick(byTitle(versions,'v2'));assert.match(JSON.stringify(loaded.context),/Reviewed source/);
    latest=3;
    for(const [name,extra,expected] of [['get_context',{},'Reviewed source'],['get_evidence',{eventId:'ev2'},'Second version excerpt'],['search_memory',{query:'Reviewed'},'Reviewed source']] as const){
      const r=await client.callTool({name,arguments:{repoId,sessionId,...extra}});assert.ok(!r.isError);assert.match(JSON.stringify(r.structuredContent),new RegExp(expected));
    }
    const saved=await client.callTool({name:'save_memory',arguments:{sessionId,repoId,featureId:loaded.featureId,eventId:'own',kind:'progress',content:'Recipient implementation'}});assert.ok(!saved.isError);
    allowed=false;
    for(const [name,extra] of [['get_context',{}],['get_evidence',{eventId:'ev2'}],['search_memory',{query:'Reviewed'}]] as const){const r=await client.callTool({name,arguments:{repoId,sessionId,...extra}});assert.equal(r.isError,true);assert.doesNotMatch(JSON.stringify(r),/Reviewed source|Second version excerpt/);}
  } finally {await client.close();server.close();rmSync(f.root,{recursive:true,force:true});}
});
