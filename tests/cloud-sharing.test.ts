import assert from "node:assert/strict";
import test from "node:test";
import { cloudDatabase } from "./fixtures/cloud-db.ts";
import worker from "../apps/cloud/src/worker.ts";
import { hash } from "../apps/cloud/src/identity.ts";
import { revocationNotice } from "../apps/cloud/src/sharing.ts";

async function workspace() {
  const { db, binding } = cloudDatabase();
  const env = { APP_ORIGIN: "https://knitt.example", DB: binding };
  const tokens: Record<string,string> = {};
  for (const username of ["aditya","ramanand","charlie"]) {
    const token = "knitt_" + username.charAt(0).repeat(43);
    tokens[username] = token;
    db.prepare("INSERT INTO accounts(id,issuer,subject,email,username,email_verified) VALUES(?,?,?,?,?,?)")
      .run(username,"test",username,username+"@example.com",username,1);
    db.prepare("INSERT INTO devices(id,token_hash,account_id,name,created_at,last_used_at,expires_at) VALUES(?,?,?,?,?,?,?)")
      .run(username,await hash(token),username,"test",Date.now(),Date.now(),Date.now()+60_000);
  }
  const call = async (user: string, path: string, method = "GET", body?: unknown) => {
    const request = new Request(env.APP_ORIGIN+"/api/"+path, {
      method, headers: { Authorization: "Bearer "+tokens[user], "Content-Type": "application/json" },
      ...(body !== undefined ? {body:JSON.stringify(body)} : {}),
    });
    const result = await worker.fetch(request,env);
    return { status: result.status, data: await result.json() };
  };
  const ok = async (user: string, path: string, method = "GET", body?: unknown) => {
    const { status, data } = await call(user,path,method,body);
    assert.ok(status===200 || status===201,method+" "+path+" "+status+" "+JSON.stringify(data));
    return data;
  };
  return { db, call, ok };
}

const alice = "aditya", bob = "ramanand", carol = "charlie";
const checkpoint = (key:string,text:string,excerpts: string[] = []) => ({
  publicationKey: key, checkpoint: text, source: { agent: "codex", branch: "main", repository: "team/tool" },
  excerpts: excerpts.map(text => ({text})),
});

test("three accounts share reviewed versions, pin retrieval, revoke and share back only new work", async () => {
  const { db, call, ok } = await workspace();
  try {
    const contact = (await ok(carol,"contacts","POST",{username:alice})).contact;
    assert.equal((await ok(alice,"contacts")).contacts[0].direction,"incoming");
    assert.equal((await call(bob,"contacts/"+contact.id+"/accept","POST")).status,404);
    await ok(alice,"contacts/"+contact.id+"/accept","POST");

    const {context} = await ok(alice,"contexts","POST",{title:"parser"});
    const path = "contexts/"+context.id;
    const v1 = (await ok(alice,path+"/versions","POST",checkpoint("1","restricted origin"))).version;
    const reviewed = checkpoint("2","Edited checkpoint",["Selected evidence"]);
    const [one,two] = await Promise.all([ok(alice,path+"/versions","POST",reviewed),ok(alice,path+"/versions","POST",reviewed)]);
    const v2 = one.version;
    assert.equal(v2.id,two.version.id);
    assert.equal(v2.number,2);
    assert.equal((await call(alice,path+"/versions","POST",{...reviewed,checkpoint:"changed text"})).status,409);
    const ev = v2.excerpts[0].id;
    const invite = await ok(alice,path+"/invitations","POST",{recipient:"@RAMANAND",startVersionId:v2.id});
    assert.equal(invite.notice,revocationNotice);
    const invitePath = "invitations/"+invite.invitation.id;
    assert.equal((await ok(bob,"inbox")).invitations[0].startVersionNumber,2);
    for (const actor of [bob,carol]) {
      for (const p of [path,path+"/versions","versions/"+v2.id,"evidence/"+ev]) assert.equal((await call(actor,p)).status,404);
      assert.deepEqual((await ok(actor,"search?q=Selected")).results,[]);
      assert.deepEqual((await ok(actor,"contexts")).contexts,[]);
    }
    assert.equal((await call(carol,invitePath+"/accept","POST")).status,404);
    const accepted = await Promise.all([ok(bob,invitePath+"/accept","POST"),ok(bob,invitePath+"/accept","POST")]);
    assert.ok(accepted[0].invitation.grantId);
    assert.equal(accepted[0].invitation.grantId,accepted[1].invitation.grantId);
    assert.deepEqual((await ok(bob,"versions/"+v2.id)).version,v2);
    assert.equal(v2.checkpoint,"Edited checkpoint");
    assert.deepEqual(v2.source,reviewed.source);
    assert.deepEqual(v2.excerpts,[{id:ev,text:"Selected evidence"}]);
    for (const query of ["unpublished","removed","restricted"]) assert.deepEqual((await ok(bob,"search?q="+query)).results,[]);
    assert.equal((await call(bob,"versions/"+v1.id)).status,404);
    const v3 = (await ok(alice,path+"/versions","POST",checkpoint("3","New progress"))).version;
    assert.deepEqual((await ok(bob,path+"/versions")).versions.map((v:{id:string})=>v.id),[v3.id,v2.id]);
    assert.equal((await ok(bob,"versions/"+v2.id)).version.checkpoint,"Edited checkpoint");
    assert.equal((await ok(bob,"search?q=Selected&versionId="+v2.id)).results[0].versionId,v2.id);
    assert.deepEqual((await ok(bob,"search?q=Selected&versionId="+v3.id)).results,[]);
    assert.equal((await call(bob,"evidence/"+ev+"?versionId="+v3.id)).status,404);
    assert.equal((await ok(bob,"evidence/"+ev+"?versionId="+v2.id)).evidence.text,"Selected evidence");
    for (const method of ["PATCH","DELETE"]) assert.equal((await call(bob,path,method,method==="PATCH"?{title:"other"}:undefined)).status,404);
    assert.equal((await call(bob,path+"/invitations","POST",{recipient:carol,startVersionId:v2.id})).status,404);
    assert.equal((await call(carol,"contexts","POST",{title:"guessed",sourceVersionId:v2.id})).status,404);
    const continuation = (await ok(bob,"contexts","POST",{title:"my fixes",sourceVersionId:v2.id})).context;
    const onward = "contexts/"+continuation.id;
    assert.equal(continuation.sourceVersionId,v2.id);
    assert.equal((await call(bob,onward+"/versions","POST",checkpoint("4","new work"))).status,400);
    assert.equal((await call(bob,onward+"/versions","POST",{...checkpoint("4","copied: Selected evidence"),originalWork:true})).status,409);
    assert.equal((await call(bob,onward+"/versions","POST",{...checkpoint("4","new",["Selected evidence"]),originalWork:true})).status,409);
    const own = (await ok(bob,onward+"/versions","POST",{...checkpoint("4","Fixed decoder",["My measurement"]),originalWork:true})).version;
    for (const person of [alice,carol]) {
      const share = (await ok(bob,onward+"/invitations","POST",{recipient:person,startVersionId:own.id})).invitation;
      await ok(person,"invitations/"+share.id+"/accept","POST");
      assert.equal((await ok(person,"versions/"+own.id)).version.sourceVersionId,v2.id);
    }
    assert.equal((await call(carol,"evidence/"+ev)).status,404);
    assert.equal((await call(carol,"versions/"+v2.id)).status,404);
    assert.equal((await ok(alice,invitePath+"/revoke","POST")).notice,revocationNotice);
    assert.equal((await call(bob,invitePath+"/accept","POST")).status,404);
    for (const p of [path,path+"/versions","versions/"+v2.id,"versions/"+v3.id,"evidence/"+ev]) assert.equal((await call(bob,p)).status,404);
    assert.deepEqual((await ok(bob,"search?q=Selected")).results,[]);
    assert.deepEqual((await ok(bob,"inbox")).invitations,[]);
    assert.deepEqual((await ok(bob,"contexts")).contexts.map((c:{id:string})=>c.id),[continuation.id]);
    assert.equal((await ok(carol,"versions/"+own.id)).version.checkpoint,"Fixed decoder");
    assert.equal((await ok(alice,path,"PATCH",{title:"Renamed"})).context.title,"Renamed");
    await ok(alice,path,"DELETE");
    assert.equal((await call(alice,"evidence/"+ev)).status,404);
    assert.equal((await ok(bob,"versions/"+own.id)).version.sourceVersionId,v2.id);
  } finally { db.close(); }
});

test("verified email claims, terminal invitation states, atomic rollback and idempotent creation", async () => {
  const { db, call, ok } = await workspace();
  try {
    const body = { title:"First", creationKey:"submission" };
    const [one,two] = await Promise.all([ok(alice,"contexts","POST",body),ok(alice,"contexts","POST",body)]);
    assert.equal(one.context.id,two.context.id);
    assert.equal((await call(alice,"contexts","POST",{...body,title:"different"})).status,409);
    const path = "contexts/"+one.context.id;
    db.exec("CREATE TRIGGER interrupt_evidence BEFORE INSERT ON evidence WHEN new.text='interrupt' BEGIN SELECT RAISE(ABORT,'injected failure'); END");
    const payload = checkpoint("retry","Reviewed",["first","interrupt"]);
    assert.equal((await call(alice,path+"/versions","POST",payload)).status,503);
    assert.deepEqual((await ok(alice,path+"/versions")).versions,[]);
    assert.equal(db.prepare("SELECT count(*) n FROM evidence").get()?.n,0);
    db.exec("DROP TRIGGER interrupt_evidence");
    const version = (await ok(alice,path+"/versions","POST",payload)).version;
    assert.equal(version.number,1);
    const createInvite = async () => "invitations/"+(await ok(alice,path+"/invitations","POST",{
      recipient:"RAMANAND@EXAMPLE.COM",startVersionId:version.id,
    })).invitation.id;
    db.prepare("UPDATE accounts SET email_verified=0 WHERE id=?").run(bob);
    const first = await createInvite();
    assert.deepEqual((await ok(bob,"inbox")).invitations,[]);
    assert.equal((await call(bob,first+"/accept","POST")).status,404);
    db.prepare("UPDATE accounts SET email_verified=1 WHERE id=?").run(bob);
    db.prepare("UPDATE accounts SET email=? WHERE id=?").run(bob+"@example.com",carol);
    for (const id of [bob,carol]) {
      assert.deepEqual((await ok(id,"inbox")).invitations,[]);
      assert.equal((await call(id,first+"/accept","POST")).status,404);
    }
    db.prepare("UPDATE accounts SET email=? WHERE id=?").run(carol+"@example.com",carol);
    await ok(bob,first+"/decline","POST");
    assert.equal((await call(bob,first+"/accept","POST")).status,404);
    const second = await createInvite();
    await ok(alice,second+"/withdraw","POST");
    assert.equal((await call(bob,second+"/accept","POST")).status,404);
    const third = await createInvite();
    await ok(bob,third+"/accept","POST");
    assert.equal((await ok(bob,"versions/"+version.id)).version.id,version.id);
    await ok(bob,third+"/leave","POST");
    assert.equal((await call(bob,third+"/accept","POST")).status,404);
    assert.equal((await call(bob,"versions/"+version.id)).status,404);
    const fresh = await createInvite();
    await ok(bob,fresh+"/accept","POST");
    assert.equal((await ok(bob,"versions/"+version.id)).version.id,version.id);
  } finally { db.close(); }
});

