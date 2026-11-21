import {z} from 'zod';
import {fields, HttpError, json, method, type Auth, type CloudEnvironment} from './identity.ts';
import {readConversation} from './private-sync.ts';
import {revocationNotice} from './sharing.ts';

type LiveInvitation = {id:string;kind:'live_conversation';conversationId:string;status:string;grantId:string|null;title:string;sourceAgent:string;updatedAt:string;senderUsername:string;recipient:string;eventCount:number};
export const friendship = `EXISTS(SELECT 1 FROM contacts f WHERE f.status='accepted' AND
 ((f.sender_id=i.owner_id AND f.recipient_id=i.recipient_id) OR (f.sender_id=i.recipient_id AND f.recipient_id=i.owner_id)))`;
const columns = `i.id,'live_conversation' AS kind,i.conversation_id AS conversationId,i.status,i.grant_id AS grantId,
 c.title,c.origin AS sourceAgent,c.updated_at AS updatedAt,o.username AS senderUsername,r.username AS recipient,
 (SELECT count(*) FROM private_events e WHERE e.account_id=i.owner_id AND e.conversation_id=i.conversation_id) AS eventCount`;
const tables = 'conversation_invitations i JOIN private_conversations c ON c.account_id=i.owner_id AND c.id=i.conversation_id JOIN accounts o ON o.id=i.owner_id JOIN accounts r ON r.id=i.recipient_id';
export async function liveInvitations(env:CloudEnvironment,user:string,incoming:boolean){
 const {results}=await env.DB.prepare(`SELECT ${columns} FROM ${tables} WHERE ${incoming?'i.recipient_id':'i.owner_id'}=?
 ${incoming?"AND i.status IN ('pending','accepted') AND "+friendship:''} ORDER BY i.created_at DESC,i.id`).bind(user).all<LiveInvitation>();
 return results;
}
export async function handleLiveSharing(request:Request,env:CloudEnvironment,auth:Auth):Promise<Response|null>{
 const url=new URL(request.url),user=auth.account.id,db=env.DB;
 const create=/^\/api\/private\/conversations\/([^/]+)\/invitations$/.exec(url.pathname);
 if(create){
  const conversationId=decodeURIComponent(create[1]);
  const owned=await db.prepare('SELECT 1 FROM private_conversations WHERE account_id=? AND id=?').bind(user,conversationId).first();
  if(!owned)throw new HttpError(404,'Not found');
  if(request.method==='GET')return json({invitations:(await liveInvitations(env,user,false)).filter(i=>i.conversationId===conversationId),notice:revocationNotice});
  method(request,'POST');
  const parsed=z.strictObject({recipientId:z.string().min(1).max(256),userApproved:z.literal(true)}).safeParse(await fields(request));
  if(!parsed.success)throw new HttpError(400,'Choose a friend and explicitly approve whole-conversation and future-message access');
  const recipient=parsed.data.recipientId;
  const row=await db.prepare(`INSERT INTO conversation_invitations(id,owner_id,conversation_id,recipient_id)
   SELECT ?,?,?,? WHERE ?<>? AND EXISTS(SELECT 1 FROM contacts f WHERE f.status='accepted' AND
   ((f.sender_id=? AND f.recipient_id=?) OR (f.sender_id=? AND f.recipient_id=?)))
   ON CONFLICT(owner_id,conversation_id,recipient_id) WHERE status IN ('pending','accepted') DO UPDATE SET id=conversation_invitations.id RETURNING id`)
   .bind(crypto.randomUUID(),user,conversationId,recipient,user,recipient,user,recipient,recipient,user).first<{id:string}>();
  if(!row)throw new HttpError(409,'Choose an accepted friend');
  return json({invitation:(await liveInvitations(env,user,false)).find(i=>i.id===row.id),notice:revocationNotice},201);
 }
 const transition=/^\/api\/conversation-invitations\/([^/]+)\/(accept|decline|withdraw|revoke|leave)$/.exec(url.pathname);
 if(transition){
  method(request,'POST');const [,id,action]=transition;
  const transitions:Record<string,[string,string,boolean]>={accept:['pending','accepted',false],decline:['pending','declined',false],withdraw:['pending','withdrawn',true],revoke:['accepted','revoked',true],leave:['accepted','left',false]};
  const [before,after,owner]=transitions[action];
  const changed=await db.prepare(`UPDATE conversation_invitations AS i SET status=?,grant_id=CASE WHEN ?='accepted' THEN coalesce(grant_id,?) ELSE grant_id END
   WHERE id=? AND ${owner?'owner_id':'recipient_id'}=? AND ${action==='accept'?"status IN ('pending','accepted')":"status=?"}
   ${action==='accept'?'AND '+friendship:''} RETURNING id,status,grant_id AS grantId`)
   .bind(after,after,crypto.randomUUID(),id,user,...(action==='accept'?[]:[before])).first();
  if(!changed)throw new HttpError(404,'Not found');
  return json({invitation:changed,notice:revocationNotice});
 }
 if(url.pathname==='/api/shared/conversations'){
  method(request,'GET');return json({conversations:(await liveInvitations(env,user,true)).filter(i=>i.status==='accepted')});
 }
 const read=/^\/api\/shared\/conversations\/([^/]+)\/(context|search|evidence)$/.exec(url.pathname);
 if(read){
  method(request,'GET');const id=decodeURIComponent(read[1]);
  const grant=await db.prepare(`SELECT i.owner_id AS owner,i.conversation_id AS conversation FROM conversation_invitations i WHERE i.id=? AND i.recipient_id=? AND i.status='accepted' AND ${friendship}`).bind(id,user).first<{owner:string;conversation:string}>();
  if(!grant)throw new HttpError(404,'Not found');
  const response=await readConversation(env,grant.owner,grant.conversation,read[2],url,{sql:`EXISTS(SELECT 1 FROM conversation_invitations i WHERE i.id=? AND i.recipient_id=? AND i.status='accepted' AND ${friendship})`,params:[id,user]});
  const data=await response.json();
  // A removal between metadata and event reads must be reported as access loss.
  const stillAuthorized=await db.prepare(`SELECT 1 FROM conversation_invitations i WHERE i.id=? AND i.recipient_id=? AND i.status='accepted' AND ${friendship}`).bind(id,user).first();
  if(!stillAuthorized)throw new HttpError(404,'Not found');
  if(data.conversation){const c=data.conversation;data.conversation={id,title:c.title,origin:c.origin,eventCount:c.eventCount,updatedAt:c.updatedAt};}
  return json({...data,shareId:id,kind:'live_conversation',contentTrust:'untrusted_reference'});
 }
 return null;
}
