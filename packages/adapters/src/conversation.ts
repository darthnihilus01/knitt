import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { Conversation } from './handoff.ts';
import { messageText } from './transcript.ts';
import { redact } from './hooks.ts';

export type ConversationDescriptor = {
  sourceId: string; sourceApplication: string; title: string; titleSource: 'native' | 'fallback';
  summary: string; modified: string; availability: 'available' | 'unavailable';
};
export const chatgptAvailability = { sourceApplication: 'chatgpt', availability: 'unavailable', reason: 'ChatGPT history access unavailable through this connection.' } as const;
export const cleanText = (text: string) => text.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
export function shortSummary(text: string) { const value = cleanText(redact(text).replace(/^(user|assistant|model):\s*/, '')); return [...value].length > 50 ? [...value].slice(0, 49).join('') + '…' : value; }
export function relativeActivity(value: string, now = Date.now()) {
  const date=Date.parse(value); if(!Number.isFinite(date)) return 'Activity unknown';
  const minutes=Math.max(0,Math.floor((now-date)/60000));
  return minutes<1?'just now':minutes<60?minutes+'m ago':minutes<1440?Math.floor(minutes/60)+'h ago':Math.floor(minutes/1440)+'d ago';
}
export const transcriptPath = (c: Conversation) => c.transcript ?? join(c.root,'brain',c.id,'.system_generated/logs/transcript.jsonl');
export function sourceIdentity(c: Conversation) { return createHash('sha256').update(JSON.stringify([c.client??'antigravity',realpathSync(c.root),c.id])).digest('hex'); }
export function boundedRecords(path: string, end?: number, window = 256*1024) {
  const fd=openSync(path,'r');
  try {
    const boundary=Math.min(end??statSync(path).size,statSync(path).size), start=Math.max(0,boundary-window);
    const buffer=Buffer.alloc(boundary-start),count=readSync(fd,buffer,0,buffer.length,start);
    const last=buffer.lastIndexOf(10,count-1); if(last<0)return [];
    const first=start?buffer.indexOf(10)+1:0;
    const records:{row:Record<string,unknown>;byte:number}[]=[];
    let offset=first;
    for(const line of buffer.subarray(first,last+1).toString('utf8').split('\n')){
      try { const row=JSON.parse(line); if(row && typeof row==='object'&&!Array.isArray(row))records.push({row,byte:start+offset}); }catch{/* Partial metadata is not evidence. */}
      offset+=Buffer.byteLength(line)+1;
    }
    return records;
  }finally{closeSync(fd);}
}
const summaries=new Map<string,{signature:string;summary:string}>();
export function describeConversation(c: Conversation): ConversationDescriptor {
  const path=transcriptPath(c);
  let available=existsSync(path);
  let summary=c.summary??'';
  if(!summary&&existsSync(path)){
    const stat=statSync(path),signature=[stat.ino,stat.size,stat.mtimeMs].join(':');
    const cached=summaries.get(path);
    if(cached?.signature===signature) summary=cached.summary;
    else {
      for(const {row} of boundedRecords(path).reverse()){
        try { const text=messageText(row); if(text){summary=shortSummary(text);break;} }catch{/* Unsupported shapes aren't summarized. */}
      }
      if(summaries.size>=512)summaries.delete(summaries.keys().next().value!);
      summaries.set(path,{signature,summary});
    }
  }
  if(!available && (c.client??'antigravity')==='antigravity'){
    const index=join(c.root,'conversation_summaries.db');
    if(existsSync(index)){
      const db=new DatabaseSync(index,{readOnly:true});
      try{
        const row=db.prepare('SELECT user_body,agent_body FROM conversations_fts WHERE conversation_id=? ORDER BY CAST(chunk_index AS INTEGER) DESC LIMIT 1').get(c.id);
        if(row){available=true;if(!summary)summary=typeof row.agent_body==='string'&&row.agent_body?row.agent_body:String(row.user_body??'');}
      }catch{/* An index without selected conversation text is not retrievable. */}finally{db.close();}
    }
  }
  return {sourceId:sourceIdentity(c),sourceApplication:c.client??'antigravity',title:c.title,titleSource:c.titleSource??'native',summary:shortSummary(summary)||'No supported message preview available',modified:c.modified,availability:available?'available':'unavailable'};
}
