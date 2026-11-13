import { existsSync, readdirSync, openSync, readSync, closeSync, statSync, realpathSync } from "node:fs";
import { join, relative, isAbsolute, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { DiscoveredConversation } from "../discovery.ts";
function repository(path:string){try{return execFileSync("git",["rev-parse","--path-format=absolute","--git-common-dir"],{cwd:path,encoding:"utf8",timeout:1000,stdio:["ignore","pipe","ignore"]}).trim();}catch{return null;}}
export function discoverJsonl(client:"codex"|"claude",root:string,workspace:string){
 const conversations:DiscoveredConversation[]=[],diagnostics:string[]=[];
 if(!existsSync(root))return {conversations,diagnostics:[client+" history directory unavailable"]};
 const expected=repository(workspace);let visited=0,unsupported=0;
 function walk(directory:string,depth:number){
  if(depth>8||visited>=10000)return;
  for(const entry of readdirSync(directory,{withFileTypes:true})){
   if(++visited>10000)break;
   const path=join(directory,entry.name);if(entry.isSymbolicLink())continue;
   if(entry.isDirectory()){walk(path,depth+1);continue;}if(!entry.isFile()||!entry.name.endsWith(".jsonl"))continue;
   const fd=openSync(path,"r");let text="";
   try{const buffer=Buffer.alloc(65536);const count=readSync(fd,buffer,0,buffer.length,0);text=buffer.subarray(0,count).toString("utf8");}finally{closeSync(fd);}
   let id:string|undefined,cwd:string|undefined;
   for(const line of text.split("\n").slice(0,-1)){
    let row;try{row=JSON.parse(line);}catch{continue;}
    const meta=client==="codex"?(row.type==="session_meta"?row.payload:null):row;
    const nativeId=client==="codex"?(meta?.id??meta?.session_id):meta?.sessionId;
    if(typeof nativeId==="string"&&typeof meta?.cwd==="string"){id=nativeId;cwd=meta.cwd;break;}
   }
   if(!id||!cwd||id.length>256){unsupported++;continue;}
   if(resolve(cwd)!==resolve(workspace)&&(!expected||repository(cwd)!==expected))continue;
   const inside=relative(realpathSync(root),realpathSync(path));if(inside.startsWith("..")||isAbsolute(inside))continue;
   conversations.push({id:client+":"+id,sourceId:id,client,title:client+" session "+id.slice(0,24),workspace:cwd,root,modified:statSync(path).mtime.toISOString(),transcript:path});
  }
 }
 try{walk(root,0);}catch{diagnostics.push(client+" history could not be fully read");}
 if(unsupported)diagnostics.push(client+" history files with unsupported metadata: "+unsupported);
 if(visited>=10000)diagnostics.push(client+" discovery limit reached");
 return {conversations,diagnostics};
}
