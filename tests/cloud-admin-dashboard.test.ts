import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

class Element {
  tag: string; textContent=''; value=''; disabled=false; children:Element[]=[];
  events:Record<string,()=>Promise<void>>={};
  onsubmit?: (event:{preventDefault():void})=>Promise<void>;
  constructor(tag:string) { this.tag=tag; }
  append(...items:Element[]) { this.children.push(...items); }
  replaceChildren(...items:Element[]) { this.children=items; }
  setAttribute() {} removeAttribute() {}
  addEventListener(name:string,callback:()=>Promise<void>) { this.events[name]=callback; }
}
const flatten=(e:Element):string=>e.textContent+' '+e.children.map(flatten).join(' ');
const find=(e:Element,match:(e:Element)=>boolean):Element|undefined => match(e)?e:e.children.map(c=>find(c,match)).find(Boolean);

test('admin dashboard renders real metadata, moves between pages and resets pagination when searching', async()=>{
  const main=new Element('main'), requests:string[]=[];
  const source=readFileSync('apps/cloud/public/app.js','utf8').replace(/\nboot\(\);\s*$/,'');
  const context=vm.createContext({
    document:{getElementById:()=>new Element('div'),createElement:(tag:string)=>new Element(tag)},
    window:{addEventListener(){}},location:{},URLSearchParams,setTimeout,clearTimeout,
    fetch:async(raw:string)=>{
      requests.push(raw);
      return {ok:true,json:async()=>raw.includes('/overview') ? {overview:{totalUsers:26,signupsThisWeek:2,pendingOnboarding:1,connectedDevices:4,publishedContexts:3,syncedConversations:10}} :
        {total:26,pageSize:25,users:[{id:'user-id',username:'alice',email:'alice@example.test',emailVerified:true,providers:['google'],createdAt:'2026-11-20T00:00:00Z',connectedDevices:2,publishedContexts:1,syncedConversations:10,lastDeviceActivity:null}]}};
    },
  });
  vm.runInContext(source+'\nidentity={account:{username:"owner"},isAdmin:true};globalThis.renderAdmin=admin;',context);
  await context.renderAdmin(main);
  const text=flatten(main).replace(/\s+/g,' ');
  assert.match(text,/Total users 26/);
  assert.match(text,/@alice alice@example.test Verified email Account ID user-id/);
  assert.match(text,/No installation activity/);
  assert.match(text,/Page 1 of 2/);
  assert.equal(find(main,e=>e.textContent==='Previous')?.disabled,true);
  await find(main,e=>e.textContent==='Next')!.events.click();
  assert.match(requests.at(-1)!,/page=2/);
  assert.match(flatten(main),/Page 2 of 2/);
  assert.equal(find(main,e=>e.textContent==='Next')?.disabled,true);
  find(main,e=>e.tag==='input')!.value='alice';
  await find(main,e=>e.tag==='form')!.onsubmit!({preventDefault(){}});
  assert.match(requests.at(-1)!,/q=alice/);
  assert.match(requests.at(-1)!,/page=1/);
  vm.runInContext('identity.isAdmin=false',context);
  const denied=new Element('main');
  const before=requests.length;
  await context.renderAdmin(denied);
  assert.match(flatten(denied),/doesn’t have admin access/);
  assert.match(flatten(denied),/Account settings/);
  assert.equal(requests.length,before);
});
