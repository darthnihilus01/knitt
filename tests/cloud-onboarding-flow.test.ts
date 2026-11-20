import test from 'node:test';
import assert from 'node:assert/strict';
import {appendFileSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {registerOnboarding} from '../apps/server/src/onboarding.ts';
import {credentials} from '../packages/cloud/src/client.ts';
import {cloudDatabase} from './fixtures/cloud-db.ts';
import {historyFixture} from './fixtures/history.ts';
import worker from '../apps/cloud/src/worker.ts';
import {hash} from '../apps/cloud/src/identity.ts';

// Run agent tools against the actual Worker and SQLite schema; only HTTP transport is local.
async function fixture() {
 const f=historyFixture(),home=join(f.root,'home'),cloud=cloudDatabase();
 const env={DB:cloud.binding,APP_ORIGIN:'https://cloud.example.test'};
 cloud.db.prepare('INSERT INTO accounts(id,issuer,subject,email) VALUES(?,?,?,?)').run('alice','test','alice','alice@example.test');
 const browserToken='a'.repeat(43);
 cloud.db.prepare('INSERT INTO browser_sessions VALUES(?,?,?)').run(await hash(browserToken),'alice',Date.now()+60000);
 const browser=async(path:string,body?:unknown)=>{
  const response=await worker.fetch(new Request(env.APP_ORIGIN+'/api/'+path,{method:body?'POST':'GET',headers:{Cookie:'__Host-knitt_session='+browserToken,Origin:env.APP_ORIGIN,'X-CSRF-Token':await hash('csrf:'+browserToken),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env);
  assert.ok(response.ok,await response.clone().text());return response.json();
 };
 const handlers=new Map<string,(input:unknown)=>Promise<{structuredContent:Record<string,any>}>>();
 const server={registerTool(name:string,options:any,handler:any){handlers.set(name,async input=>handler(z.object(options.inputSchema).parse(input)));}} as unknown as McpServer;
 registerOnboarding(server,home,{MEMORY_HISTORY_ROOTS:JSON.stringify(f.roots)},f.workspace);
 const call=async(name:string,input:unknown={})=>(await handlers.get(name)!(input)).structuredContent;
 const originalFetch=globalThis.fetch;
 let offline=false,hideCloud=false,failAfterBatches=Infinity,sentBatches=0;
 let duringRead:(()=>Promise<void>)|undefined;
 globalThis.fetch=async(input,init)=>{
  const request=new Request(input,init);
  if(request.url.endsWith('/api/private/sync') && (offline || sentBatches++ >= failAfterBatches)) throw new Error('fixture offline');
  if(duringRead && request.url.includes('/api/private/conversations')){const callback=duringRead;duringRead=undefined;await callback();}
  if(hideCloud && request.url.includes('/api/private/conversations'))return Response.json({conversations:[],nextCursor:null});
  return worker.fetch(request,env);
 };
 const pair=async()=>{
  const started=await call('knitt_connect',{action:'begin',server:env.APP_ORIGIN,openBrowser:false});
  await browser('device-pairings/approve',{userCode:started.userCode});
  return call('knitt_connect',{action:'poll'});
 };
 return {f,home,cloud,call,pair,browser,offlineAfter:(count:number)=>{failAfterBatches=count;sentBatches=0;},onRead:(callback:()=>Promise<void>)=>{duringRead=callback;},offline:(value:boolean)=>{offline=value;},hideCloud:(value:boolean)=>{hideCloud=value;},cleanup(){globalThis.fetch=originalFetch;cloud.db.close();rmSync(f.root,{recursive:true,force:true});}};
}

test('pair → preview → approve → verify real cloud titles and messages → incremental update',async()=>{
 const x=await fixture();
 try {
  assert.equal((await x.call('knitt_status')).setupState,'account_connection_required');
  assert.equal((await x.pair()).setupState,'sync_approval_required');
  const preview=await x.call('knitt_preview_sync');
  assert.equal(preview.suggestedProjectTitle,'project');
  assert.deepEqual(preview.historyCounts,{antigravity:1,codex:1,claude:1});
  assert.equal(x.cloud.db.prepare('SELECT count(*) AS n FROM private_events').get()!.n,0);
  await assert.rejects(x.call('knitt_enable_sync',{previewId:preview.previewId,createTitle:'Real project',userApproved:false}));
  assert.equal((await x.call('knitt_status')).binding,null);
  const enabled=await x.call('knitt_enable_sync',{previewId:preview.previewId,createTitle:'Real project',userApproved:true});
  assert.equal(enabled.cloudVerified,true);
  assert.equal(enabled.visibleConversations,3);
  assert.equal(enabled.setupState,'synced');
  assert.match(enabled.cloudUrl,/projectId=/);
  const list=await x.browser('private/conversations?projectId='+enabled.projectId);
  assert.deepEqual(list.conversations.map((c:any)=>c.title).sort(),['Antigravity chat','Claude chat','Codex chat']);
  const chat=list.conversations.find((c:any)=>c.origin==='claude');
  const detail=await x.browser('private/conversations/'+chat.id+'/context');
  assert.match(JSON.stringify(detail.events),/Claude question/);
  assert.doesNotMatch(JSON.stringify(list)+JSON.stringify(detail),/PRIVATE OTHER PROJECT|PRIVATE REASONING|PRIVATE TOOL OUTPUT|secret-value/);
  const count=x.cloud.db.prepare('SELECT count(*) AS n FROM private_events').get()!.n;
  const repeated=await x.call('knitt_sync');
  assert.equal(repeated.cloudVerified,true);
  assert.equal(x.cloud.db.prepare('SELECT count(*) AS n FROM private_events').get()!.n,count);
  appendFileSync(join(x.f.roots.claude[0],'projects/encoded-project/same-id.jsonl'),JSON.stringify({type:'assistant',sessionId:'same-id',cwd:x.f.workspace,message:{role:'assistant',content:'New progress after approval'}})+'\n');
  const updated=await x.call('knitt_sync');assert.equal(updated.cloudVerified,true);
  assert.match(JSON.stringify((await x.browser('private/conversations/'+chat.id+'/context')).events),/New progress after approval/);
  x.hideCloud(true);
  const hidden=await x.call('knitt_sync');assert.equal(hidden.cloudVerified,false);
  assert.doesNotMatch(hidden.statusMessage,/ready|verified|available/i);
  x.hideCloud(false);
  await x.call('knitt_sync_control',{action:'pause'});
  assert.equal((await x.call('knitt_status')).setupState,'paused');
  assert.equal((await x.call('knitt_sync')).cloudVerified,false);
  await x.call('knitt_sync_control',{action:'resume'});
  assert.equal((await x.call('knitt_sync')).cloudVerified,true);
  await x.call('knitt_sync_control',{action:'disconnect'});
  assert.equal((await x.call('knitt_status')).setupState,'sync_approval_required');
  assert.equal((await x.browser('private/conversations')).conversations.length,3);
 } finally{x.cleanup();}
});

test('approved setup reports offline uploads and later verifies retry without new approval',async()=>{
 const x=await fixture();
 try {
  await x.pair();const preview=await x.call('knitt_preview_sync');x.offline(true);
  const failed=await x.call('knitt_enable_sync',{previewId:preview.previewId,createTitle:'Retry project',userApproved:true});
  assert.equal(failed.enabled,true);assert.equal(failed.cloudVerified,false);assert.equal(failed.setupState,'sync_error');assert.ok(failed.pending>0);
  assert.equal(x.cloud.db.prepare('SELECT count(*) AS n FROM private_events').get()!.n,0);
  x.offline(false);assert.equal((await x.call('knitt_sync')).cloudVerified,true);
 }finally{x.cleanup();}
});

test('empty discovery never claims chats were uploaded',async()=>{
 const x=await fixture();
 try {
  for(const roots of Object.values(x.f.roots))for(const root of roots)rmSync(root,{recursive:true,force:true});
  await x.pair();const preview=await x.call('knitt_preview_sync');assert.equal(preview.histories.length,0);
  const result=await x.call('knitt_enable_sync',{previewId:preview.previewId,createTitle:'Empty project',userApproved:true});
  assert.equal(result.cloudVerified,false);assert.equal(result.setupState,'initial_sync_pending');assert.match(result.statusMessage,/No supported chats found/);
  assert.equal(result.imported,0);
 } finally{x.cleanup();}
});


test('expired previews and changed discovery or accounts cannot approve stale history',async()=>{
 const x=await fixture();
 try {
  await x.pair();
  const preview=await x.call('knitt_preview_sync');
  const now=Date.now;
  Date.now=()=>now()+11*60*1000;
  try {await assert.rejects(x.call('knitt_enable_sync',{previewId:preview.previewId,createTitle:'Expired',userApproved:true}),/Preview expired/);}
  finally{Date.now=now;}
  const file=join(x.home,'cloud/device.json'),original=readFileSync(file,'utf8');
  const device=JSON.parse(original);device.account.id='other';writeFileSync(file,JSON.stringify(device));
  await assert.rejects(x.call('knitt_enable_sync',{previewId:preview.previewId,createTitle:'Wrong account',userApproved:true}),/Preview expired/);
  writeFileSync(file,original);
  rmSync(x.f.roots.claude[0],{recursive:true,force:true});
  await assert.rejects(x.call('knitt_enable_sync',{previewId:preview.previewId,createTitle:'Changed',userApproved:true}),/discovery changed/);
  assert.equal(x.cloud.db.prepare('SELECT count(*) AS n FROM private_events').get()!.n,0);
 }finally{x.cleanup();}
});

test('one failed source leaves readable chats and retry guidance instead of claiming full success',async()=>{
 const x=await fixture();
 try {
  await x.pair();const preview=await x.call('knitt_preview_sync');
  const projectId='11111111-1111-4111-8111-111111111111';
  await x.browser('private/projects',{id:projectId,title:'Partial import'});
  const {digest}=await import('../packages/cloud/src/local-sync.ts');
  const blocked=join(x.home,'cloud/imports',digest([projectId,'claude','same-id']));
  mkdirSync(blocked,{recursive:true});writeFileSync(join(blocked,'events.sqlite'),'invalid sqlite database');
  const result=await x.call('knitt_enable_sync',{previewId:preview.previewId,projectId,userApproved:true});
  assert.equal(result.cloudVerified,false);assert.equal(result.importErrors,1);assert.equal(result.setupState,'sync_error');
  assert.equal((await x.browser('private/conversations')).conversations.length,2);
  rmSync(blocked,{recursive:true,force:true});
  assert.equal((await x.call('knitt_sync')).cloudVerified,true);
 }finally{x.cleanup();}
});

 test('revocation reports an error and cannot upload new history',async()=>{
 const x=await fixture();
 try {
  await x.pair();const preview=await x.call('knitt_preview_sync');
  const enabled=await x.call('knitt_enable_sync',{previewId:preview.previewId,createTitle:'Revoked project',userApproved:true});
  assert.equal(enabled.cloudVerified,true);
  x.cloud.db.exec('DELETE FROM devices');
  const failed=await x.call('knitt_sync');assert.equal(failed.cloudVerified,false);assert.equal(failed.setupState,'sync_error');
  assert.match(failed.nextAction,/reconnect/);
 }finally{x.cleanup();}
});


for (const action of ['pause','disconnect']) test('browser '+action+' cannot be mistaken for successful sync of retained history',async()=>{
 const x=await fixture();
 try {
  await x.pair();const preview=await x.call('knitt_preview_sync');
  const enabled=await x.call('knitt_enable_sync',{previewId:preview.previewId,createTitle:'Remote control',userApproved:true});
  const device=credentials(x.home)!;
  await x.browser('private/projects/'+enabled.projectId+'/control',{action,deviceId:device.device.id});
  const stopped=await x.call('knitt_sync');
  assert.equal(stopped.cloudVerified,false);
  assert.equal(stopped.setupState,action==='pause'?'paused':'sync_approval_required');
  assert.equal((await x.browser('private/conversations')).conversations.length,3);
 }finally{x.cleanup();}
});

for(const change of ['pause','disconnect','account','project'])test('cloud confirmation rechecks '+change+' changes made during its read',async()=>{
 const x=await fixture();
 try {
  await x.pair();const preview=await x.call('knitt_preview_sync');
  await x.call('knitt_enable_sync',{previewId:preview.previewId,createTitle:'Race check',userApproved:true});
  x.onRead(async()=>{
   if(change==='pause'||change==='disconnect')await x.call('knitt_sync_control',{action:change});
   else if(change==='account'){
    const file=join(x.home,'cloud/device.json'),device=JSON.parse(readFileSync(file,'utf8'));device.account.id='other';writeFileSync(file,JSON.stringify(device));
   } else {
    const {syncDatabase}=await import('../packages/cloud/src/local-sync.ts');const db=syncDatabase(x.home);
    try{db.prepare('UPDATE bindings SET project=?').run('22222222-2222-4222-8222-222222222222');}finally{db.close();}
   }
  });
  const result=await x.call('knitt_sync');assert.equal(result.cloudVerified,false);
  if(change==='account')assert.equal(result.account.id,'other');
  if(change==='pause')assert.equal(result.setupState,'paused');
  if(change==='disconnect')assert.equal(result.setupState,'sync_approval_required');
  if(change==='project')assert.equal(result.binding.projectId,'22222222-2222-4222-8222-222222222222');
 }finally{x.cleanup();}
});


test('background import preserves a known cloud confirmation failure',async()=>{
 const x=await fixture();
 try{
  await x.pair();const preview=await x.call('knitt_preview_sync');
  await x.call('knitt_enable_sync',{previewId:preview.previewId,createTitle:'Readback failure',userApproved:true});
  x.hideCloud(true);assert.equal((await x.call('knitt_sync')).cloudVerified,false);
  const {syncWorkspace}=await import('../packages/cloud/src/local-sync.ts');
  await syncWorkspace(x.home,{},x.f.workspace);
  assert.equal((await x.call('knitt_status')).setupState,'sync_error');
  const projects=await x.browser('private/projects');assert.equal(projects.projects[0].installations[0].runtimeStatus,'offline');
  x.hideCloud(false);assert.equal((await x.call('knitt_sync')).cloudVerified,true);
  assert.equal((await x.call('knitt_status')).setupState,'synced');
 }finally{x.cleanup();}
});

test('unfinished transcript is reported as pending until its final record completes',async()=>{
 const x=await fixture();
 try{
  const log=join(x.f.roots.claude[0],'projects/encoded-project/same-id.jsonl');
  const record=JSON.stringify({type:'assistant',sessionId:'same-id',cwd:x.f.workspace,message:{role:'assistant',content:'Final completed record'}});
  appendFileSync(log,record.slice(0,-1));
  await x.pair();const preview=await x.call('knitt_preview_sync');
  const result=await x.call('knitt_enable_sync',{previewId:preview.previewId,createTitle:'Partial transcript',userApproved:true});
  assert.equal(result.cloudVerified,false);assert.equal(result.incompleteSources,1);
  assert.notEqual(result.setupState,'synced');
  appendFileSync(log,'}\n');
  const complete=await x.call('knitt_sync');assert.equal(complete.cloudVerified,true);assert.equal(complete.incompleteSources,0);
 }finally{x.cleanup();}
});

test('a new empty project never inherits an old project success timestamp',async()=>{
 const x=await fixture();
 try{
  await x.pair();let preview=await x.call('knitt_preview_sync');
  await x.call('knitt_enable_sync',{previewId:preview.previewId,createTitle:'Old project',userApproved:true});
  assert.ok((await x.call('knitt_status')).lastSuccessfulSync);
  await x.call('knitt_sync_control',{action:'disconnect'});
  for(const roots of Object.values(x.f.roots))for(const root of roots)rmSync(root,{recursive:true,force:true});
  preview=await x.call('knitt_preview_sync');
  const result=await x.call('knitt_enable_sync',{previewId:preview.previewId,createTitle:'Empty replacement',userApproved:true});
  assert.equal(result.setupState,'initial_sync_pending');assert.equal(result.lastSuccessfulSync,null);assert.equal(result.error,null);
 }finally{x.cleanup();}
});


test('upload failure preserves observed import and delivery counts and the cloud link',async()=>{
 const x=await fixture();
 try{
  await x.pair();const preview=await x.call('knitt_preview_sync');x.offlineAfter(1);
  const result=await x.call('knitt_enable_sync',{previewId:preview.previewId,createTitle:'Interrupted upload',userApproved:true});
  assert.equal(result.cloudVerified,false);assert.equal(result.imported,3);assert.equal(result.delivered,1);assert.equal(result.pending,2);assert.equal(result.importErrors,0);assert.match(result.cloudUrl,/projectId=/);
 }finally{x.cleanup();}
});
