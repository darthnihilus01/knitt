import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../apps/cloud/src/worker.ts';
import {cloudDatabase} from './fixtures/cloud-db.ts';
import {hash} from '../apps/cloud/src/identity.ts';

async function fixture(){
 const {db,binding}=cloudDatabase(),tokens:Record<string,string>={};
 for(const user of ['alice','bob','carol']){
  const token='knitt_'+user[0].repeat(43);tokens[user]=token;
  db.prepare('INSERT INTO accounts(id,issuer,subject,email,username) VALUES(?,?,?,?,?)').run(user,'test',user,user+'@example.test',user);
  db.prepare('INSERT INTO devices VALUES(?,?,?,?,?,?,?)').run(user,await hash(token),user,'test',Date.now(),Date.now(),Date.now()+3600000);
 }
 db.prepare('INSERT INTO private_projects(id,account_id,title) VALUES(?,?,?)').run('project','alice','Private project');
 for(const id of ['chat','other']){
  db.prepare('INSERT INTO private_conversations(account_id,id,project_id,origin,session_id,title,provenance) VALUES(?,?,?,?,?,?,?)').run('alice',id,'project','codex',id,'Real '+id,JSON.stringify({workspace:'/private/path',sourceId:'local-id'}));
  db.prepare('INSERT INTO private_events(account_id,conversation_id,id,sequence,role,text) VALUES(?,?,?,?,?,?)').run('alice',id,'event-'+id,0,'user','Original '+id);
 }
 const call=async(user:string,path:string,method='GET',body?:unknown)=>{
  const response=await worker.fetch(new Request('https://knitt.test/api/'+path,{method,headers:{Authorization:'Bearer '+tokens[user],'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),{APP_ORIGIN:'https://knitt.test',DB:binding});
  return {status:response.status,data:await response.json()};
 };
 const ok=async(user:string,path:string,method='GET',body?:unknown)=>{const r=await call(user,path,method,body);assert.ok([200,201].includes(r.status),JSON.stringify(r));return r.data;};
 const friends=async(a='alice',b='bob')=>{const {contact}=await ok(a,'contacts','POST',{username:b});await ok(b,'contacts/'+contact.id+'/accept','POST');return contact.id;};
 const invite=async()=> (await ok('alice','private/conversations/chat/invitations','POST',{recipientId:'bob',userApproved:true})).invitation;
 return {db,binding,call,ok,friends,invite};
}

test('live invitation requires friend and explicit consent; acceptance exposes only one chat and future messages',async()=>{
 const x=await fixture();try{
  assert.equal((await x.call('alice','private/conversations/chat/invitations','POST',{recipientId:'bob',userApproved:true})).status,409);
  await x.friends();assert.equal((await x.call('alice','private/conversations/chat/invitations','POST',{recipientId:'bob'})).status,400);
  const invite=await x.invite();const again=await x.invite();assert.equal(invite.id,again.id);
  assert.equal((await x.ok('bob','inbox')).invitations[0].kind,'live_conversation');
  const root='shared/conversations/'+invite.id;
  for(const user of ['bob','carol'])for(const p of ['context','search?q=Original','evidence?eventId=event-chat'])assert.equal((await x.call(user,root+'/'+p)).status,404);
  assert.equal((await x.call('carol','conversation-invitations/'+invite.id+'/accept','POST')).status,404);
  await x.ok('bob','conversation-invitations/'+invite.id+'/accept','POST');
  assert.equal((await x.ok('bob','shared/conversations')).conversations.length,1);
  const first=await x.ok('bob',root+'/context');assert.equal(first.events[0].text,'Original chat');assert.equal(first.conversation.provenance,undefined);
  assert.equal((await x.call('bob','private/conversations/chat/context')).status,404);
  x.db.prepare('INSERT INTO private_events(account_id,conversation_id,id,sequence,role,text) VALUES(?,?,?,?,?,?)').run('alice','chat','future',1,'assistant','Future message');
  assert.equal((await x.ok('bob',root+'/context')).events.length,2);
  assert.equal((await x.ok('bob',root+'/context?cutoff='+first.cutoff)).events.length,1);
  assert.equal((await x.ok('bob',root+'/search?q=Future')).results[0].id,'future');
  assert.equal((await x.ok('bob',root+'/evidence?eventId=future')).evidence.text,'Future message');
  assert.equal((await x.call('bob',root+'/evidence?eventId=event-other')).status,404);
  assert.equal((await x.call('bob',root+'/context','POST',{})).status,405);
 }finally{x.db.close();}
});

test('friend removal atomically terminates both directions; reconnecting never restores grants',async()=>{
 const x=await fixture();try{
  const contact=await x.friends();const accepted=await x.invite();await x.ok('bob','conversation-invitations/'+accepted.id+'/accept','POST');
  x.db.prepare('INSERT INTO private_projects(id,account_id,title) VALUES(?,?,?)').run('bob-project','bob','Bob');
  x.db.prepare('INSERT INTO private_conversations VALUES(?,?,?,?,?,?,?,?,?)').run('bob','bob-chat','bob-project','claude','bob-chat','Bob chat','{}','now','now');
  const pending=(await x.ok('bob','private/conversations/bob-chat/invitations','POST',{recipientId:'alice',userApproved:true})).invitation;
  await x.ok('alice','contacts/'+contact+'/remove','POST');
  const states=x.db.prepare('SELECT id,status FROM conversation_invitations').all();assert.equal(states.find(i=>i.id===accepted.id)!.status,'revoked');assert.equal(states.find(i=>i.id===pending.id)!.status,'withdrawn');
  await x.friends();
  assert.equal((await x.call('bob','conversation-invitations/'+accepted.id+'/accept','POST')).status,404);
  for(const p of ['context','search?q=Original','evidence?eventId=event-chat'])assert.equal((await x.call('bob','shared/conversations/'+accepted.id+'/'+p)).status,404);
  assert.notEqual((await x.invite()).id,accepted.id);
 }finally{x.db.close();}
});

test('live invitation actor boundaries, terminal states, deletion and history pagination',async()=>{
 const x=await fixture();try{
  await x.friends();let i=await x.invite();
  assert.equal((await x.call('bob','conversation-invitations/'+i.id+'/withdraw','POST')).status,404);
  await x.ok('bob','conversation-invitations/'+i.id+'/decline','POST');
  assert.equal((await x.call('bob','conversation-invitations/'+i.id+'/accept','POST')).status,404);
  i=await x.invite();await x.ok('alice','conversation-invitations/'+i.id+'/withdraw','POST');
  i=await x.invite();await x.ok('bob','conversation-invitations/'+i.id+'/accept','POST');
  for(let n=1;n<40;n++)x.db.prepare('INSERT INTO private_events(account_id,conversation_id,id,sequence,role,text) VALUES(?,?,?,?,?,?)').run('alice','chat','e'+n,n,'user','message '+n);
  const page=await x.ok('bob','shared/conversations/'+i.id+'/context');assert.equal(page.events.length,30);assert.equal(page.nextBefore,10);
  const older=await x.ok('bob','shared/conversations/'+i.id+'/context?cutoff='+page.cutoff+'&before='+page.nextBefore);assert.equal(older.events.length,10);
  await x.ok('alice','conversation-invitations/'+i.id+'/revoke','POST');assert.equal((await x.call('bob','shared/conversations/'+i.id+'/context')).status,404);
  i=await x.invite();await x.ok('bob','conversation-invitations/'+i.id+'/accept','POST');await x.ok('bob','conversation-invitations/'+i.id+'/leave','POST');
  i=await x.invite();await x.ok('bob','conversation-invitations/'+i.id+'/accept','POST');
  x.db.prepare('DELETE FROM private_projects WHERE id=?').run('project');assert.equal(x.db.prepare('SELECT count(*) n FROM conversation_invitations').get()!.n,0);
  assert.equal((await x.call('bob','shared/conversations/'+i.id+'/context')).status,404);
 }finally{x.db.close();}
});

test('removal racing acceptance or event retrieval cannot return shared text',async()=>{
 const x=await fixture();try{
  let contact=await x.friends();let invitation=await x.invite();
  await Promise.all([x.call('bob','conversation-invitations/'+invitation.id+'/accept','POST'),x.ok('alice','contacts/'+contact+'/remove','POST')]);
  assert.equal((await x.call('bob','shared/conversations/'+invitation.id+'/context')).status,404);
  contact=await x.friends();invitation=await x.invite();await x.ok('bob','conversation-invitations/'+invitation.id+'/accept','POST');
  const prepare=x.binding.prepare.bind(x.binding);let intercepted=false;
  x.binding.prepare=(sql:string)=>{if(!intercepted && sql.startsWith('SELECT id,sequence,role,text,timestamp')){intercepted=true;x.db.prepare("UPDATE contacts SET status='removed' WHERE id=?").run(contact);}return prepare(sql);};
  const response=await x.call('bob','shared/conversations/'+invitation.id+'/context');
  assert.equal(intercepted,true);assert.equal(response.status,404);assert.doesNotMatch(JSON.stringify(response),/Original chat/);
 }finally{x.db.close();}
});
