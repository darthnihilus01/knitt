import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFileSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {historyFixture} from '../tests/fixtures/history.ts';
import {cloudDatabase} from '../tests/fixtures/cloud-db.ts';
import worker from '../apps/cloud/src/worker.ts';
import {hash} from '../apps/cloud/src/identity.ts';
import {npmCommand} from '../packages/installer/src/platform.ts';
import {antigravityServerName} from '../packages/adapters/src/server-name.ts';

const archive=resolve(process.argv[2]??'');assert.ok(existsSync(archive),'Pass the tested npm archive');
const f=historyFixture();const homeA=join(f.root,'alice-home'),homeB=join(f.root,'bob-home');
const destination=join(f.root,'destination');mkdirSync(destination);
const globalConfig=join(f.root,'antigravity.json');
const baseEnv={...process.env,KNITT_ANTIGRAVITY_CONFIG:globalConfig,MEMORY_HISTORY_ROOTS:JSON.stringify(f.roots)};
// Installer setup precedes the fixture HTTP server; these calls may block.
const npm=npmCommand(['install','--prefix',join(f.root,'bootstrap'),'--ignore-scripts','--no-audit','--no-fund',archive]);
execFileSync(npm.command,npm.args,{stdio:'pipe',env:baseEnv});
const bootstrap=join(f.root,'bootstrap/node_modules/@tinchu0/knitt/dist/packages/installer/src/cli.js');
for(const workspace of [f.workspace,destination])execFileSync('git',['init','--initial-branch=main',workspace],{stdio:'pipe'});
for(const [workspace,home,clients] of [[f.workspace,homeA,['codex','claude-code']],[destination,homeB,['antigravity']]] as const){
 execFileSync(process.execPath,[bootstrap,'plugin','--workspace',workspace,'--home',home,'--package',archive,'--yes',...clients.flatMap(c=>['--client',c])],{stdio:'pipe',env:baseEnv});
}
rmSync(join(f.root,'bootstrap'),{recursive:true,force:true});
const state=(home:string)=>JSON.parse(readFileSync(join(home,'installation.json'),'utf8'));
const cli=(home:string)=>join(state(home).current.appRoot,'packages/installer/src/cli.js');
const {db,binding}=cloudDatabase();
let origin='',offline=false;
const sessions:Record<string,string>={alice:'a'.repeat(43),bob:'b'.repeat(43),carol:'c'.repeat(43)};
for(const user of Object.keys(sessions)){
 db.prepare('INSERT INTO accounts(id,issuer,subject,email,username,email_verified) VALUES(?,?,?,?,?,1)').run(user,'fixture',user,user+'@example.test',user);
 db.prepare('INSERT INTO browser_sessions VALUES(?,?,?)').run(await hash(sessions[user]!),user,Date.now()+3600000);
}
const server=createServer(async(req,res)=>{
 try{
  if(offline&&req.url==='/api/private/sync'){res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"offline fixture"}');return;}
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);
  const response=await worker.fetch(new Request(origin+req.url,{method:req.method,headers:req.headers as Record<string,string>,...(chunks.length?{body:Buffer.concat(chunks)}:{})}),{DB:binding,APP_ORIGIN:origin});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){res.writeHead(500);res.end(String(error));}
});
const browser=async(user:string,path:string,method='GET',body?:unknown)=>{
 const response=await fetch(origin+'/api/'+path,{method,headers:{Cookie:'__Host-knitt_session='+sessions[user],Origin:origin,'X-CSRF-Token':await hash('csrf:'+sessions[user]),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {status:response.status,data:await response.json() as any};
};
const ok=async(user:string,path:string,method='GET',body?:unknown)=>{const r=await browser(user,path,method,body);assert.ok(r.status<300,JSON.stringify(r));return r.data;};
async function run(home:string,args:string[],approveAs?:string){
 let out='',err='',approval:Promise<unknown>|undefined;
 const child=spawn(process.execPath,[cli(home),'cloud',...args,'--home',home],{env:baseEnv,stdio:['ignore','pipe','pipe']});
 const timer=setTimeout(()=>child.kill(),60000);
 child.stdout.on('data',chunk=>{
  out+=String(chunk);
  if(approveAs&&!approval){
   const url=out.match(/http:\/\/127\.0\.0\.1:\d+\/pair\?code=[A-Z0-9-]+/)?.[0];
   if(url)approval=ok(approveAs,'device-pairings/approve','POST',{userCode:new URL(url).searchParams.get('code')});
  }
 });
 child.stderr.on('data',chunk=>{err+=String(chunk);});
 try{const [code]=await once(child,'close');await approval;return {code,out,err};}finally{clearTimeout(timer);}
}
const credentials=(home:string)=>JSON.parse(readFileSync(join(home,'cloud/device.json'),'utf8'));
const deviceApi=async(home:string,path:string,method='GET',body?:unknown)=>{
 const response=await fetch(origin+'/api/'+path,{method,headers:{Authorization:'Bearer '+credentials(home).token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json() as any};
};
const clients:Client[]=[];
async function connect(config:any,env:Record<string,string>={}){
 const client=new Client({name:'packaged-cloud-acceptance',version:'1'});
 await client.connect(new StdioClientTransport({...config,env:{...baseEnv,...config.env,...env} as Record<string,string>,stderr:'pipe'}));clients.push(client);return client;
}
async function call(client:Client,name:string,args:Record<string,unknown>={}){const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent as any;}
async function choose(client:Client,workspace:string,sessionId:string,choiceId?:string){return call(client,'choose_conversation',{workspace,sessionId,...(choiceId?{choiceId}:{})});}
function option(page:any,text:string){const found=page.options.find((o:any)=>o.title.includes(text));assert.ok(found,'Missing '+text+' in '+JSON.stringify(page.options));return found.choiceId;}
try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');origin='http://127.0.0.1:'+address.port;
 for(const [home,user] of [[homeA,'alice'],[homeB,'bob']] as const){const login=await run(home,['login','--server',origin,'--no-browser'],user);assert.equal(login.code,0,login.err);assert.equal(credentials(home).account.id,user);}
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM private_events').get()!.n,0);
 const configA=JSON.parse(readFileSync(join(f.workspace,'.mcp.json'),'utf8')).mcpServers['shared-memory'];
 const configB=JSON.parse(readFileSync(globalConfig,'utf8')).mcpServers[antigravityServerName(destination)];
 assert.equal(configA.env.SHARED_MEMORY_HOME,homeA);assert.equal(configB.env.SHARED_MEMORY_HOME,homeB);
 const a=await connect(configA),b=await connect(configB);
 for(const name of ['knitt_status','knitt_connect','knitt_preview_sync','knitt_enable_sync','knitt_sync','knitt_invitations'])assert.ok((await a.listTools()).tools.some(t=>t.name===name),name);
 assert.equal((await call(a,'knitt_status')).binding,null);
 const preview=await call(a,'knitt_preview_sync');assert.equal(preview.histories.length,3);
 const denied=await a.callTool({name:'knitt_enable_sync',arguments:{previewId:preview.previewId,createTitle:'Fixture project',userApproved:false}});assert.equal(denied.isError,true);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM private_events').get()!.n,0);
 offline=true;
 const queued=await a.callTool({name:'knitt_enable_sync',arguments:{previewId:preview.previewId,createTitle:'Fixture project',userApproved:true}});assert.equal(queued.isError,undefined);assert.equal((queued.structuredContent as any).enabled,true);assert.equal((queued.structuredContent as any).cloudVerified,false);assert.equal((queued.structuredContent as any).setupState,'sync_error');
 assert.ok((await call(a,'knitt_status')).pending>0);
 offline=false;const retried=await call(a,'knitt_sync');assert.equal(retried.cloudVerified,true);assert.equal(retried.visibleConversations,3);const status=await call(a,'knitt_status');assert.equal(status.pending,0);assert.ok(status.lastSuccessfulSync);
 const conversations=(await deviceApi(homeA,'private/conversations')).data.conversations;assert.equal(conversations.length,3);
 const count=db.prepare('SELECT COUNT(*) AS n FROM private_events').get()!.n;await call(a,'knitt_sync');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM private_events').get()!.n,count);
 assert.equal((await browser('carol','private/conversations/'+conversations[0].id+'/context')).status,404);
 const personal=await call(a,'choose_conversation',{workspace:f.workspace,sessionId:'personal-session',source:'sources'});const histories=await choose(a,f.workspace,'personal-session',option(personal,'My synced conversations'));
 const personalLoaded=await choose(a,f.workspace,'personal-session',option(histories,'Codex chat'));assert.match(JSON.stringify(personalLoaded.context),/Codex decision/);
 const draft=join(f.root,'review.json');
 const prepared=await run(homeA,['publish','prepare','--workspace',f.workspace,'--source','codex:same-id','--checkpoint','Packaged reviewed checkpoint','--draft',draft]);assert.equal(prepared.code,0,prepared.err);
 assert.equal((await run(homeA,['publish','submit','--draft',draft])).code===0,false);
 assert.equal((await ok('alice','contexts')).contexts.length,0);
 for(let i=0;i<2;i++){const published=await run(homeA,['publish','submit','--draft',draft,'--yes']);assert.equal(published.code,0,published.err);}
 const contextId=JSON.parse(readFileSync(draft,'utf8')).contextId;
 const versions=(await ok('alice','contexts/'+contextId+'/versions')).versions;assert.equal(versions.length,1);const v1=versions[0];
 const invitation=(await ok('alice','contexts/'+contextId+'/invitations','POST',{recipient:'@bob',startVersionId:v1.id})).invitation;
 assert.equal((await browser('carol','versions/'+v1.id)).status,404);
 const inbox=await call(b,'knitt_invitations',{action:'list'});assert.equal(inbox.invitations[0].id,invitation.id);
 assert.equal((await b.callTool({name:'knitt_invitations',arguments:{action:'accept',invitationId:invitation.id}})).isError,true);
 await call(b,'knitt_invitations',{action:'accept',invitationId:invitation.id,userApproved:true});
 const menu=await call(b,'choose_conversation',{workspace:destination,sessionId:'recipient-session',source:'sources'});const shared=await choose(b,destination,'recipient-session',option(menu,'Shared with me'));
 const available=await choose(b,destination,'recipient-session',option(shared,'Codex chat'));
 const loaded=await choose(b,destination,'recipient-session',option(available,'v1'));assert.match(JSON.stringify(loaded.context),/Packaged reviewed checkpoint/);
 const next=await ok('alice','contexts/'+contextId+'/versions','POST',{publicationKey:'fixture-update',checkpoint:'New optional update',source:{agent:'codex'},excerpts:[]});
 assert.notEqual(next.version.id,v1.id);
 const current=await call(b,'get_context',{repoId:configB.env.MEMORY_REPO,sessionId:'recipient-session'});assert.match(JSON.stringify(current),/Packaged reviewed checkpoint/);assert.doesNotMatch(JSON.stringify(current),/New optional update/);
 await ok('alice','invitations/'+invitation.id+'/revoke','POST',{});
 const revoked=await b.callTool({name:'get_context',arguments:{repoId:configB.env.MEMORY_REPO,sessionId:'recipient-session'}});assert.equal(revoked.isError,true);assert.doesNotMatch(JSON.stringify(revoked),/Packaged reviewed checkpoint/);
 await ok('alice','devices/'+credentials(homeA).device.id,'DELETE');assert.equal((await deviceApi(homeA,'me')).status,401);
 const logout=await run(homeB,['logout']);assert.equal(logout.code,0,logout.err);assert.equal(existsSync(join(homeB,'cloud/device.json')),false);
 console.log('PASS packaged cloud: browser-bound pairing, explicit consent, offline retry/deduplication, private history, reviewed retry-safe publish, recipient acceptance, pinned version, third-account isolation, context/device revocation and logout');
}finally{
 await Promise.allSettled(clients.map(client=>client.close()));server.close();db.close();rmSync(f.root,{recursive:true,force:true});
}
