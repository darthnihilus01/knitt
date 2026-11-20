import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
class Element {
 textContent='';value='';href='';open=false;className='';children:Element[]=[];listeners:Record<string,()=>unknown>={};
 tag:string;constructor(tag='div'){this.tag=tag;}
 showModal(){} close(){} remove(){} focus(){} select(){}
 append(...items:Element[]){this.children.push(...items);}
 replaceChildren(...items:Element[]){this.children=items;}
 setAttribute(){} removeAttribute(){} addEventListener(name:string,fn:()=>unknown){this.listeners[name]=fn;}
}
const flatten=(e:Element):string=>e.textContent+' '+e.children.map(flatten).join(' ');
test('My contexts renders actual account/project consent and queue status above recognizable private chats',async()=>{
 const main=new Element(),source=readFileSync('apps/cloud/public/app.js','utf8').replace(/\nboot\(\);\s*$/,'');
 const data:Record<string,unknown>={contexts:{contexts:[]},invitations:{invitations:[]},'private/projects':{projects:[{id:'p',title:'Working project',status:'active',lastSyncAt:'2026-11-20T00:00:00Z',installations:[{name:'Laptop',status:'active',pendingCount:2,runtimeStatus:'offline',lastSeenAt:new Date().toISOString()}]}]},'private/conversations':{conversations:[{id:'chat',title:'Recognizable native title',summary:'Fix the picker',titleSource:'fallback',origin:'codex',eventCount:3,updatedAt:'2026-11-20T00:00:00Z'}]}};
 const context=vm.createContext({document:{getElementById:()=>new Element(),createElement:()=>new Element()},window:{addEventListener(){}},location:{},URLSearchParams,setTimeout,clearTimeout,fetch:async(raw:string)=>({ok:true,json:async()=>data[raw.replace('/api/','')]})});
 vm.runInContext(source+'\nidentity={account:{username:"alice"}};globalThis.render=contexts;',context);
 await context.render(main,{view:'contexts'});const text=flatten(main);
 assert.match(text,/@alice/);assert.match(text,/Working project/);assert.match(text,/Project consent: Approved/);assert.match(text,/2 messages waiting to sync/);assert.match(text,/Fix the picker/);assert.match(text,/Fallback title/);assert.ok(text.indexOf('Working project')<text.indexOf('Recognizable native title'));
});


const descendants=(e:Element):Element[]=>[e,...e.children.flatMap(descendants)];
for(const state of ['empty','paused','waiting','syncing','error','up_to_date']) {
 test('cloud setup remains available with '+state+' history',async()=>{
  const main=new Element(),body=new Element('body');
  const projects=state==='empty'?[]:[{id:'p',title:'Knitt beta disposable capture check',status:state==='paused'?'paused':'active',installations:[{name:'Laptop',status:state==='paused'?'paused':'active',runtimeStatus:state,lastSeenAt:new Date().toISOString(),lastSyncAt:state==='waiting'?null:new Date().toISOString()}]}];
  const data:Record<string,unknown>={contexts:{contexts:[]},invitations:{invitations:[]},'private/projects':{projects},'private/conversations':{conversations:state==='empty'?[]:[{id:'test',title:'Disposable purple otter',origin:'codex',eventCount:3,updatedAt:new Date().toISOString()}]}};
  const source=readFileSync('apps/cloud/public/app.js','utf8').replace(/\nboot\(\);\s*$/,'');
  let clipboard='';
  const context=vm.createContext({document:{body,getElementById:()=>new Element(),createElement:(tag:string)=>new Element(tag)},navigator:{clipboard:{writeText:async(s:string)=>{clipboard=s;}}},window:{addEventListener(){}},location:{},URLSearchParams,setTimeout:()=>0,clearTimeout,fetch:async(raw:string)=>({ok:true,json:async()=>data[raw.replace('/api/','')]})});
  vm.runInContext(source+'\nidentity={account:{username:"alice"}};globalThis.render=contexts;',context);
  await context.render(main,{view:'contexts'});
  const button=descendants(main).find(e=>e.textContent==='Add or finish project sync');
  assert.ok(button,'setup action must not depend on the absence of old chats');
  assert.match(flatten(main),/Only approved projects/i);
  if(state==='empty') assert.match(flatten(main),/Your local chats haven’t synced yet/);
  else {
   assert.match(flatten(main),/Disposable purple otter/);
   const details=descendants(main).find(e=>e.tag==='details');
   if(['paused','waiting','error'].includes(state)) assert.equal(details?.open,true);
   if(state==='paused')assert.match(flatten(main),/Paused/);
   if(state==='error')assert.match(flatten(main),/Sync error/);
   if(state==='up_to_date')assert.match(flatten(main),/Up to date/);
  }
  await button.listeners.click();
  assert.equal(descendants(body).find(e=>e.tag==='textarea')?.value,'Set up Knitt cloud sync for my current project. Show me the history preview before uploading.');
  const copy=descendants(body).find(e=>e.textContent==='Copy setup prompt');
  assert.ok(copy);await copy.listeners.click();
  assert.equal(clipboard,'Set up Knitt cloud sync for my current project. Show me the history preview before uploading.');
 });
}


test('project link survives the sign-in redirect',()=>{
 const main=new Element(),source=readFileSync('apps/cloud/public/app.js','utf8').replace(/\nboot\(\);\s*$/,'');
 const context=vm.createContext({document:{getElementById:()=>main,createElement:(tag:string)=>new Element(tag)},window:{addEventListener(){}},location:{pathname:'/',search:'?projectId=chosen',hash:'#contexts'},URLSearchParams,setTimeout,clearTimeout});
 vm.runInContext(source+'\nsignIn();',context);
 const google=descendants(main).find(e=>e.href.startsWith('/auth/google/start'));
 assert.ok(google);assert.equal(new URL(google.href,'https://cloud.example.test').searchParams.get('returnTo'),'/?projectId=chosen#contexts');
});

test('project history link requests only that project and offers all projects',async()=>{
 const main=new Element(),source=readFileSync('apps/cloud/public/app.js','utf8').replace(/\nboot\(\);\s*$/,'');
 const paths:string[]=[];
 const context=vm.createContext({document:{getElementById:()=>new Element(),createElement:(tag:string)=>new Element(tag)},window:{addEventListener(){}},location:{search:'?projectId=chosen'},URLSearchParams,setTimeout,clearTimeout,fetch:async(raw:string)=>{paths.push(raw);return {ok:true,json:async()=>({conversations:[]})};}});
 vm.runInContext(source+'\nglobalThis.render=personalHistories;',context);
 await context.render(main);
 assert.equal(paths[0],'/api/private/conversations?projectId=chosen');
 assert.equal(descendants(main).find(e=>e.textContent==='Show all projects')?.href,'/#contexts');
});
