import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
class Element {
 textContent='';value='';children:Element[]=[];
 append(...items:Element[]){this.children.push(...items);}
 replaceChildren(...items:Element[]){this.children=items;}
 setAttribute(){} removeAttribute(){} addEventListener(){}
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
