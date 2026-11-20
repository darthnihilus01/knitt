import { parseArgs } from 'node:util';
import { hostname, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { api, CloudError, credentials, credentialsPath, defaultServer, request, serverOrigin, type Credentials } from '../../cloud/src/client.ts';
import { defaultHome, runtimePaths, withInstallLock } from './runtime.ts';
import { atomicWrite } from './connections.ts';
import { defaultHistoryRoots, discoverHistories } from '../../adapters/src/histories.ts';
import { importConversation, type Conversation } from '../../adapters/src/handoff.ts';
import { MemoryStore } from '../../memory/src/store.ts';

const print = (value:unknown) => console.log(JSON.stringify(value, null, 2));
async function prompt(question:string) {
  if (!process.stdin.isTTY) throw new Error('Use the cloud publish subcommands and explicit flags for noninteractive review. See knitt cloud --help.');
  const reader = createInterface({input:process.stdin, output:process.stdout});
  try { return (await reader.question(question + ' ')).trim(); } finally {reader.close();}
}
async function login(home:string, origin:string, name:string, open:boolean) {
  if (credentials(home)) throw new Error('This installation is paired. Run knitt cloud logout before pairing again.');
  const pairing = await request<{pairingId:string; deviceCode:string; userCode:string; verificationUri:string; expiresAt:string; interval:number}>(origin, '/api/device-pairings', {body:{name}});
  const verification = new URL(pairing.verificationUri, origin);
  if (verification.origin !== origin) throw new Error('Pairing approval must use the selected Knitt Cloud origin');
  console.log(`Approve installation ${name} with code ${pairing.userCode} at ${verification.href}`);
  if (open) {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', verification.href] : [verification.href];
    const child = spawn(command, args, {stdio:'ignore', detached:true}); child.on('error', () => console.error('Open the approval link above in your browser.')); child.unref();
  }
  while (Date.now() < Date.parse(pairing.expiresAt)) {
    const result = await request<{status?:string} & Omit<Credentials,'origin'>>(origin, '/api/device-pairings/exchange', {body:{pairingId:pairing.pairingId,deviceCode:pairing.deviceCode}});
    if (result.status !== 'pending') {
      if (!result.token || !result.account?.id || !result.device?.id) throw new Error('Incomplete pairing response');
      atomicWrite(credentialsPath(home), JSON.stringify({origin,token:result.token,account:result.account,device:result.device}));
      console.log(`Paired ${result.device.name} with ${result.account.email}.`); return;
    }
    await sleep(Math.max(1,pairing.interval) * 1000);
  }
  throw new Error('Pairing expired. Run knitt cloud login again.');
}
const draftSchema = z.object({
  title:z.string().trim().min(1), creationKey:z.string().min(1), publicationKey:z.string().min(1), contextId:z.string().min(1).optional(),
  sourceVersionId:z.string().min(1).optional(), accountId:z.string().optional(), origin:z.string().optional(),
  checkpoint:z.string().trim().min(1), source:z.object({agent:z.enum(['codex','claude','antigravity']), conversationId:z.string().min(1), repository:z.string().optional(), branch:z.string().optional(), commit:z.string().optional()}).strict(),
  excerpts:z.array(z.object({text:z.string().min(1)}).strict()),
}).strict();
type Draft = z.infer<typeof draftSchema>;
function userPreview(draft:Draft) {
  const {title,contextId,sourceVersionId,checkpoint,source,excerpts} = draft;
  return {title,contextId,sourceVersionId,checkpoint,source,excerpts,...(sourceVersionId ? {originalWork:true}:{})};
}
function transcriptExcerpts(conversation:Conversation) {
  const scratch = mkdtempSync(join(tmpdir(), 'knitt-review-'));
  const store = new MemoryStore(':memory:');
  try {
    const repoId = 'review';
    const {featureId} = importConversation({conversation,repoId,directory:scratch,store});
    const excerpts:{id:string;text:string}[] = [];
    let before:number|undefined;
    do {
      const page = store.search({repoId,featureId,before,limit:20});
      for (const match of page.matches) excerpts.push({id:match.eventId,text:store.evidence(repoId, match.eventId)!.content});
      before = page.nextCursor ?? undefined;
    } while (before);
    return excerpts.reverse();
  } finally { store.close(); rmSync(scratch,{recursive:true,force:true}); }
}
async function submit(home:string, path:string, yes:boolean) {
  const draft = draftSchema.parse(JSON.parse(readFileSync(path,'utf8')));
  const device = credentials(home);
  if (!device) throw new Error('Pair this installation with knitt cloud login before submitting.');
  if ((draft.accountId && draft.accountId !== device.account.id) || (draft.origin && draft.origin !== device.origin)) throw new Error('This draft belongs to another account or server');
  print(userPreview(draft));
  if (draft.sourceVersionId) console.log('Only your original work may be published. Confirm that the checkpoint and excerpts contain your own material.');
  if (!yes && (await prompt('Publish this exact material to ' + device.account.email + '? Type publish to confirm.')) !== 'publish') {console.log('Cancelled.');return;}
  draft.accountId = device.account.id; draft.origin = device.origin;
  atomicWrite(path,JSON.stringify(draft,null,2));
  if (!draft.contextId) {
    const {context} = await api<{context:{id:string}}>(device,'/api/contexts',{title:draft.title,creationKey:draft.creationKey,sourceVersionId:draft.sourceVersionId});
    draft.contextId = context.id; atomicWrite(path,JSON.stringify(draft,null,2));
  }
  const {version} = await api<{version:{id:string;number:number}}>(device,`/api/contexts/${encodeURIComponent(draft.contextId)}/versions`,{publicationKey:draft.publicationKey,checkpoint:draft.checkpoint,source:draft.source,excerpts:draft.excerpts,...(draft.sourceVersionId ? {originalWork:true}:{})});
  console.log(`Published v${version.number} (${version.id}) in context ${draft.contextId}.`);
}
const help = `knitt cloud login [--server ORIGIN] [--name DEVICE] [--no-browser]\nknitt cloud logout\nknitt cloud publish [--workspace PATH]                 Interactive review\nknitt cloud publish list [--workspace PATH]            Available local conversations\nknitt cloud publish excerpts --source AGENT:ID         Local excerpt IDs and text\nknitt cloud publish prepare --source AGENT:ID --checkpoint TEXT --draft FILE [--excerpt ID ...]\nknitt cloud publish show --draft FILE                  Review edited JSON locally\nknitt cloud publish submit --draft FILE [--yes]        Publish exactly the reviewed material\nOptional publication flags: --title TITLE --context ID --repository REPO --branch BRANCH --commit HASH\nUse --home PATH to select the Knitt installation. --yes confirms publication of only your original work.`;
export async function runCloud(args:string[]) {
  const {positionals,values:v} = parseArgs({args, allowPositionals:true, options:{
    home:{type:'string'}, server:{type:'string'},name:{type:'string'},'no-browser':{type:'boolean'},workspace:{type:'string'},source:{type:'string'},checkpoint:{type:'string'},excerpt:{type:'string',multiple:true},draft:{type:'string'},title:{type:'string'},context:{type:'string'},repository:{type:'string'},branch:{type:'string'},commit:{type:'string'},yes:{type:'boolean'},help:{type:'boolean'},
  }});
  const [action,step] = positionals;
  const home = resolve(v.home ?? defaultHome());
  if (!action || v.help) {console.log(help);return;}
  if (action === 'login') return withInstallLock(home,() => login(home,serverOrigin(v.server ?? defaultServer),v.name ?? hostname(),!v['no-browser']));
  if (action === 'logout') return withInstallLock(home,async () => {
    const device = credentials(home); if (!device) {console.log('Signed out.');return;}
    try {await request(device.origin,'/api/devices/current',{method:'DELETE',token:device.token});}
    catch (err) {if (!(err instanceof CloudError && err.status === 401)) throw err;}
    rmSync(credentialsPath(home)); console.log('Signed out.');
  });
  if (action !== 'publish' || (step && !['list','excerpts','prepare','show','submit'].includes(step))) throw new Error(help);
  if (step === 'show' || step === 'submit') {
    if (!v.draft) throw new Error('Pass --draft FILE');
    if (step === 'show') return print(userPreview(draftSchema.parse(JSON.parse(readFileSync(v.draft,'utf8')))));
    return submit(home,resolve(v.draft),!!v.yes);
  }
  const workspace = resolve(v.workspace ?? process.cwd());
  const chats = discoverHistories({roots:defaultHistoryRoots(),workspace});
  const choices = chats.map(c => ({source:(c.client ?? 'antigravity')+':'+c.id,title:c.title,modified:c.modified}));
  if (step === 'list') return print(choices);
  if (!choices.length) throw new Error('No local conversations were found for this workspace.');
  if (!v.source) {
    if (step) throw new Error('Choose --source AGENT:ID from knitt cloud publish list');
    choices.forEach((c,i) => console.log(`${i+1}. ${c.title} (${c.source})`));
    v.source = choices[Number(await prompt('Choose a conversation number.'))-1]?.source;
  }
  const index = choices.findIndex(c => c.source === v.source);
  if (index < 0) throw new Error('Choose a conversation listed for this workspace.');
  const chat = chats[index];
  const db = process.env.MEMORY_DB ?? join(runtimePaths(home).data,'events.sqlite');
  const store = existsSync(db) ? new MemoryStore(db) : null;
  let provenance;
  try {provenance = store?.lastCloudSource(chat.id,chat.client ?? 'antigravity');} finally {store?.close();}
  // Recipient transcripts can contain previously loaded source text. Only
  // individually saved new-work events can be selected for an onward handoff.
  const excerpts = provenance ? provenance.work : transcriptExcerpts(chat);
  if (step === 'excerpts') return print(excerpts);
  if (!step && !v.excerpt) {
    excerpts.forEach((e,i) => console.log(`${i+1}. ${JSON.stringify(e.text)}`));
    const selected = await prompt('Include excerpts by number, separated by commas (Enter for none).');
    v.excerpt = selected ? selected.split(',').map(n => excerpts[Number(n.trim())-1]?.id ?? 'unknown') : [];
  }
  const selected = [...new Set(v.excerpt ?? [])].map(id => {const e=excerpts.find(e => e.id === id); if (!e) throw new Error('Unknown excerpt ID'); return {text:e.text};});
  const checkpoint = v.checkpoint ?? await prompt('Write your checkpoint (goal, decisions, progress, verification, blockers and next steps).');
  const draft = draftSchema.parse({title:v.title ?? chat.title,creationKey:randomUUID(),publicationKey:randomUUID(),contextId:v.context,
    checkpoint,source:{agent:chat.client ?? 'antigravity',conversationId:chat.id,repository:v.repository,branch:v.branch,commit:v.commit},excerpts:selected,
    ...(provenance ? {sourceVersionId:provenance.versionId,origin:provenance.origin,accountId:provenance.accountId}:{})});
  const path = resolve(v.draft ?? join(home,'cloud','drafts', draft.publicationKey+'.json'));
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  writeFileSync(path,JSON.stringify(draft,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log('Saved local draft ' + path + '. Edit it and use knitt cloud publish show or submit --draft FILE.');
  if (!step) await submit(home,path,!!v.yes);
}
