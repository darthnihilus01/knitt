import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
class Element{
 textContent='';value='';href='';children:Element[]=[];listeners:Record<string,()=>Promise<void>>={};tag:string;disabled=false;
 constructor(tag='div'){this.tag=tag;} append(...items:Element[]){this.children.push(...items);}replaceChildren(...items:Element[]){this.children=items;}
 setAttribute(){}removeAttribute(){}addEventListener(k:string,v:()=>Promise<void>){this.listeners[k]=v;}showModal(){}close(){}remove(){}
}
const all=(e:Element):Element[]=>[e,...e.children.flatMap(all)];const text=(e:Element):string=>all(e).map(i=>i.textContent).join(' ');
function fixture(){
 const body=new Element(),main=new Element(),timers:(()=>Promise<void>)[]=[],calls:{path:string;method:string;body:Record<string,unknown>|undefined}[]=[];let denied=false,offline=false,latest=1;
 const data:Record<string,unknown>={
  '/api/private/conversations/chat/context?':{conversation:{title:'Source chat',origin:'codex',eventCount:1,updatedAt:'today'},cutoff:1,events:[{id:'e1',sequence:0,role:'user',text:'Private review text'}],nextBefore:null},
  '/api/private/conversations/chat/invitations':{invitations:[]},'/api/contacts':{contacts:[{accountId:'bob',username:'bob',status:'accepted'}]},
 };
 const source=readFileSync('apps/cloud/public/app.js','utf8').replace(/\nboot\(\);\s*$/,'');
 const context=vm.createContext({document:{body,hidden:false,getElementById:()=>new Element(),createElement:(t:string)=>new Element(t),addEventListener(){},removeEventListener(){}},window:{addEventListener(){}},location:{hash:'#live/share',search:''},URLSearchParams,Date,setTimeout:(fn:()=>Promise<void>)=>{timers.push(fn);return timers.length;},clearTimeout(){},fetch:async(path:string,options:{method?:string;body?:string})=>{
  calls.push({path,method:options.method??'GET',body:options.body?JSON.parse(options.body):undefined});
  if(path.startsWith('/api/shared/conversations/share/context')){if(offline)throw new Error('offline');return {ok:!denied,status:denied?404:200,json:async()=>denied?{error:'Not found'}:{conversation:{title:'Live chat',eventCount:latest},cutoff:latest,events:Array.from({length:latest},(_,n)=>({id:'e'+n,sequence:n,role:'user',text:'Live message '+n})),nextBefore:null}};}
  return {ok:true,status:200,json:async()=>data[path]??data[path+'?']??{invitation:{id:'new'}}};
 }});
 vm.runInContext(source+'\nglobalThis.ui={history,reviewConversationShare,liveHistory};',context);
 return {context,body,main,calls,timers,data,setDenied:()=>{denied=true;},setOffline:(v:boolean)=>{offline=v;},setLatest:(n:number)=>{latest=n;}};
}
test('share dialog reviews text and future scope, selects a friend and sends only after final confirmation',async()=>{
 const x=fixture();await x.context.ui.history(x.main,{id:'chat'});
 const share=all(x.main).find(e=>e.textContent==='Share conversation');assert.ok(share);await share.listeners.click();
 assert.match(text(x.body),/Private review text/);assert.match(text(x.body),/future synced messages/);
 assert.equal(x.calls.filter(c=>c.method==='POST').length,0);
 const choose=all(x.body).find(e=>e.textContent==='Choose friend');assert.ok(choose);await choose.listeners.click();
 const friend=all(x.body).find(e=>e.textContent==='@bob');assert.ok(friend);await friend.listeners.click();
 assert.match(text(x.body),/Share with @bob/);assert.equal(x.calls.filter(c=>c.method==='POST').length,0);
 await all(x.body).find(e=>e.textContent==='Send invitation')!.listeners.click();
 const sent=x.calls.find(c=>c.method==='POST');assert.equal(sent?.path,'/api/private/conversations/chat/invitations');assert.equal(sent?.body?.recipientId,'bob');assert.equal(sent?.body?.userApproved,true);
});
test('live polling preserves displayed text offline, announces updates and clears content on revocation',async()=>{
 const x=fixture();await x.context.ui.liveHistory(x.main,{id:'share'});assert.match(text(x.main),/Live message 0/);
 x.setLatest(2);await x.timers.at(-1)!();assert.match(text(x.main),/New messages available/);assert.doesNotMatch(text(x.main),/Live message 1/);
 await all(x.main).find(e=>e.textContent==='Refresh now')!.listeners.click();assert.match(text(x.main),/Live message 1/);
 x.setOffline(true);await x.timers.at(-1)!();assert.match(text(x.main),/Offline/);assert.match(text(x.main),/Live message 0/);
 x.setOffline(false);x.setDenied();await x.timers.at(-1)!();assert.match(text(x.main),/Access ended/);assert.doesNotMatch(text(x.main),/Live message/);
});

test('sharing preserves return destination when no friends exist and reviews older pages chronologically',async()=>{
 const x=fixture();x.data['/api/contacts']={contacts:[]};
 x.data['/api/private/conversations/chat/context?']={conversation:{title:'Long chat',origin:'codex',eventCount:2},cutoff:2,events:[{id:'new',sequence:1,role:'assistant',text:'Newer review text'}],nextBefore:1};
 x.data['/api/private/conversations/chat/context?cutoff=2&before=1']={events:[{id:'old',sequence:0,role:'user',text:'Earlier review text'}],nextBefore:null};
 await x.context.ui.reviewConversationShare('chat');
 await all(x.body).find(e=>e.textContent==='Review older messages')!.listeners.click();
 const preview=text(x.body);assert.ok(preview.indexOf('Earlier review text')<preview.indexOf('Newer review text'));
 await all(x.body).find(e=>e.textContent==='Choose friend')!.listeners.click();
 assert.equal(all(x.body).find(e=>e.textContent==='Open People')!.href,'#people/chat');
});
