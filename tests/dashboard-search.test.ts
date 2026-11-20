import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
class Element {
 tag:string; textContent='';value='';children:Element[]=[];oninput?:()=>void;
 events:Record<string,()=>Promise<void>>={};
 constructor(tag:string){this.tag=tag;}
 append(...items:Element[]){this.children.push(...items);}
 replaceChildren(...items:Element[]){this.children=items;}
 setAttribute(){} removeAttribute(){} focus(){}
 addEventListener(name:string,fn:()=>Promise<void>){this.events[name]=fn;}
}
const flatten=(e:Element):string=>e.textContent+' '+e.children.map(flatten).join(' ');
const find=(e:Element,match:(e:Element)=>boolean):Element|undefined=>match(e)?e:e.children.map(child=>find(child,match)).find(Boolean);
test('conversation search announces filtered counts, offers recovery from no results, and treats search text as text',async()=>{
 const source=readFileSync('apps/cloud/public/app.js','utf8').replace(/\nboot\(\);\s*$/,'');
 const context=vm.createContext({document:{getElementById:()=>new Element('div'),createElement:(tag:string)=>new Element(tag)},window:{addEventListener(){}},setTimeout,clearTimeout});
 vm.runInContext(source+'\nglobalThis.searchable=searchable;globalThis.el=el;',context);
 const view=context.searchable([{label:'Fix login'},{label:'Improve sync'}],(row:{label:string})=>context.el('a',row.label),'Search conversations');
 const input=find(view,e=>e.tag==='input')!;
 assert.match(flatten(view),/2 available/);
 input.value='sync';input.oninput!();
 assert.match(flatten(view),/1 of 2 results/);
 assert.doesNotMatch(flatten(view),/Fix login/);
 input.value='<img src=x onerror=alert(1)>';input.oninput!();
 assert.match(flatten(view),/No results for “<img src=x onerror=alert\(1\)>”/);
 assert.equal(find(view,e=>e.tag==='img'),undefined);
 await find(view,e=>e.textContent==='Clear search')!.events.click();
 assert.equal(input.value,'');
 assert.match(flatten(view),/2 available/);
 assert.match(flatten(view),/Fix login/);
});
