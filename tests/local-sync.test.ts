import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { historyFixture } from "./fixtures/history.ts";
import {
  bindWorkspace,
  controlSync,
  syncDatabase,
  syncStatus,
  syncWorkspace,
} from "../packages/cloud/src/local-sync.ts";
import type { Credentials } from "../packages/cloud/src/client.ts";

test("private full history capture is durable, incremental, independent of selection, account isolated and explicitly controlled", async () => {
  const fixture = historyFixture();
  const home = join(fixture.root, "home");
  const device: Credentials = {
    origin: "https://cloud.example.test",
    token: "secret",
    account: { id: "account-a", email: "a@example.test" },
    device: { id: "installation-device", name: "fixture" },
  };
  const projectId = "11111111-1111-4111-8111-111111111111";
  const credentialFile = join(home, "cloud", "device.json");
  mkdirSync(join(home, "cloud"), { recursive: true });
  writeFileSync(credentialFile, JSON.stringify(device));
  const originalFetch = globalThis.fetch;
  let online = true;
  const accepted: any[] = [];
  globalThis.fetch = async (url, init) => {
    if (!online) throw new Error("offline");
    if (String(url).endsWith("/api/private/sync"))
      accepted.push(JSON.parse(String(init!.body)));
    return Response.json({ accepted: true });
  };
  try {
    assert.deepEqual(await syncWorkspace(home, {}, fixture.workspace), {
      skipped: "consent_required_or_paused",
    });
    bindWorkspace(home, device, fixture.workspace, projectId, fixture.roots);
    online = false;
    await assert.rejects(syncWorkspace(home, {}, fixture.workspace), /offline/);
    assert.equal(syncStatus(home, fixture.workspace).pending, 3);
    online = true;
    await syncWorkspace(home, {}, fixture.workspace);
    assert.equal(accepted.length, 3);
    const initial = JSON.stringify(accepted);
    assert.match(initial, /Claude question/);
    assert.match(initial, /Codex decision/);
    assert.match(initial, /Antigravity decision/);
    assert.doesNotMatch(
      initial,
      /secret-value|PRIVATE OTHER PROJECT|PRIVATE REASONING|PRIVATE TOOL OUTPUT/,
    );
    assert.doesNotMatch(initial, new RegExp(fixture.root));
    const claude = accepted
      .flatMap((batch) => batch.conversations)
      .find((chat) => chat.origin === "claude");
    assert.deepEqual(
      claude.events.map((event: any) => event.role),
      ["user", "assistant"],
    );
    await syncWorkspace(home, {}, fixture.workspace);
    assert.equal(
      accepted.length,
      3,
      "repeated scans do not resubmit delivered batches",
    );
    const metadataDb = new DatabaseSync(
      join(fixture.roots.codex[0], "state_5.sqlite"),
    );
    metadataDb
      .prepare("UPDATE threads SET git_branch=? WHERE id=?")
      .run("feature/switched", "same-id");
    metadataDb.close();
    await syncWorkspace(home, {}, fixture.workspace);
    assert.equal(
      accepted.length,
      3,
      "changing a native session branch does not duplicate captured history",
    );
    const log = join(
      fixture.roots.claude[0],
      "projects/encoded-project/same-id.jsonl",
    );
    appendFileSync(
      log,
      JSON.stringify({
        type: "assistant",
        sessionId: "same-id",
        cwd: fixture.workspace,
        message: { role: "assistant", content: "New session progress" },
      }) + "\n",
    );
    await syncWorkspace(home, {}, fixture.workspace);
    assert.equal(accepted.length, 4);
    assert.match(JSON.stringify(accepted[3]), /New session progress/);
    await controlSync(home, fixture.workspace, "pause");
    const restarted = syncDatabase(home);
    restarted.close();
    assert.equal(syncStatus(home, fixture.workspace).binding?.enabled, false);
    await syncWorkspace(home, {}, fixture.workspace);
    assert.equal(accepted.length, 4);
    await controlSync(home, fixture.workspace, "resume");
    writeFileSync(
      credentialFile,
      JSON.stringify({
        ...device,
        account: { id: "account-b", email: "b@example.test" },
      }),
    );
    assert.deepEqual(await syncWorkspace(home, {}, fixture.workspace), {
      skipped: "consent_required_or_paused",
    });
    assert.equal(syncStatus(home, fixture.workspace).binding, null);
    writeFileSync(credentialFile, JSON.stringify(device));
    await controlSync(home, fixture.workspace, "disconnect");
    assert.equal(syncStatus(home, fixture.workspace).binding, null);
    await syncWorkspace(home, {}, fixture.workspace);
    assert.equal(accepted.length, 4);
    assert.match(
      readFileSync(log, "utf8"),
      /New session progress/,
      "disconnect preserves native history",
    );
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('unfinished transcript does not stall later sources, and duplicate native IDs in two roots never mix',async()=>{
 const first=historyFixture(),second=historyFixture(),home=join(first.root,'home');
 const device:Credentials={origin:'https://cloud.example.test',token:'test-secret',account:{id:'a',email:'a@test.example'},device:{id:'d',name:'fixture'}};
 mkdirSync(join(home,'cloud'),{recursive:true});writeFileSync(join(home,'cloud/device.json'),JSON.stringify(device));
 const originalFetch=globalThis.fetch,accepted:any[]=[];
 globalThis.fetch=async(raw,init)=>{if(String(raw).endsWith('/api/private/sync'))accepted.push(JSON.parse(String(init?.body)));return Response.json({accepted:true});};
 try{
  const db=new DatabaseSync(join(second.roots.codex[0],'state_5.sqlite'));db.prepare('UPDATE threads SET cwd=? WHERE id=?').run(first.workspace,'same-id');db.close();
  writeFileSync(join(second.roots.codex[0],'sessions/rollout.jsonl'),JSON.stringify({type:'response_item',payload:{role:'assistant',content:[{type:'output_text',text:'Distinct second-root decision'}]}})+'\n');
  appendFileSync(join(first.roots.codex[0],'sessions/rollout.jsonl'),'{"unfinished":');
  bindWorkspace(home,device,first.workspace,'11111111-1111-4111-8111-111111111111',{...first.roots,codex:[...first.roots.codex,...second.roots.codex]});
  await syncWorkspace(home,{},first.workspace);
  const codex=accepted.flatMap(b=>b.conversations).filter(c=>c.origin==='codex');
  assert.equal(codex.length,2);assert.notEqual(codex[0].id,codex[1].id);assert.notEqual(codex[0].sessionId,codex[1].sessionId);
  assert.ok(codex.some(c=>JSON.stringify(c.events).includes('Distinct second-root decision')));
  assert.ok(codex.some(c=>JSON.stringify(c.events).includes('Codex decision')&&!JSON.stringify(c.events).includes('Distinct second-root decision')));
  assert.ok(accepted.some(b=>b.conversations.some((c:any)=>c.origin==='claude')));
  const count=accepted.length;await syncWorkspace(home,{},first.workspace);assert.equal(accepted.length,count);
 }finally{globalThis.fetch=originalFetch;rmSync(first.root,{recursive:true,force:true});rmSync(second.root,{recursive:true,force:true});}
});
