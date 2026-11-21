import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {historyFixture} from './fixtures/history.ts';
import {syncStatus,bindWorkspace,syncDatabase,dismissOnboarding} from '../packages/cloud/src/local-sync.ts';

test('Antigravity startup offers setup without side effects and preserves continuation requests',()=>{
 const f=historyFixture(),home=join(f.root,'home');
 const env={...process.env,KNITT_HOME:home,SHARED_MEMORY_HOME:home,MEMORY_DB:join(home,'data/events.sqlite'),MEMORY_REPO:'test',MEMORY_WORKSPACE:f.workspace,MEMORY_SESSION_SELECTION:'1',MEMORY_MCP_SERVER:'shared-memory-fixture'};
 const run=(text:string)=>JSON.parse(execFileSync(process.execPath,['packages/adapters/src/cli.ts','recall','antigravity'],{env,input:JSON.stringify({conversationId:'first-run',workspacePaths:[f.workspace],lastUserInput:text}),encoding:'utf8'}));
 try{
  const offered=JSON.stringify(run('Help with my project'));
  assert.match(offered,/Set up Knitt/);assert.match(offered,/Open a friend/);assert.match(offered,/Later/);assert.match(offered,/knitt_status/);
  assert.equal(syncStatus(home,f.workspace).onboarding.offer,true,'emitting the offer does not dismiss it');
  assert.doesNotMatch(JSON.stringify(run('/knit')),/Set up Knitt/);
  assert.doesNotMatch(JSON.stringify(run('/knitt')),/Set up Knitt/);
  assert.equal(syncStatus(home,f.workspace).connected,false);assert.equal(syncStatus(home,f.workspace).binding,null);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});


test('dismissal is scoped to account and canonical project, and approved or paused mappings suppress offers',()=>{
 const f=historyFixture(),home=join(f.root,'home'),other=join(f.root,'other');mkdirSync(other);
 try{
  assert.equal(dismissOnboarding(home,f.workspace).onboarding.offer,false);
  assert.equal(syncStatus(home,other).onboarding.offer,true);
  const device={origin:'https://cloud.example.test',token:'test',account:{id:'one',email:'one@example.test'},device:{id:'device',name:'test'}};
  writeFileSync(join(home,'cloud/device.json'),JSON.stringify(device));
  assert.equal(syncStatus(home,f.workspace).onboarding.offer,true);
  dismissOnboarding(home,f.workspace);assert.equal(syncStatus(home,f.workspace).onboarding.offer,false);
  writeFileSync(join(home,'cloud/device.json'),JSON.stringify({...device,account:{id:'two',email:'two@example.test'}}));
  assert.equal(syncStatus(home,f.workspace).onboarding.offer,true);
  const second={...device,account:{id:'two',email:'two@example.test'}};
  bindWorkspace(home,second,f.workspace,'project',f.roots);
  assert.equal(syncStatus(home,f.workspace).onboarding.offer,false);
  const db=syncDatabase(home);db.exec('UPDATE bindings SET enabled=0');db.close();
  assert.equal(syncStatus(home,f.workspace).onboarding.offer,false);
  assert.equal(syncStatus(home,f.workspace).setupState,'paused');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
