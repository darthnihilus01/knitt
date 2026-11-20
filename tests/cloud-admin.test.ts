import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudDatabase } from './fixtures/cloud-db.ts';
import { createCloudWorker } from '../apps/cloud/src/worker.ts';
import { hash, secret, type CloudEnvironment } from '../apps/cloud/src/identity.ts';

async function setup(t: {after(fn:()=>void):void}) {
  const {db,binding} = cloudDatabase();
  t.after(() => db.close());
  const env: CloudEnvironment = {DB:binding,APP_ORIGIN:'https://knitt.example',ADMIN_ACCOUNT_IDS:' owner, second-admin '};
  const tokens = {owner:secret(),member:secret()};
  for (const [id,token] of Object.entries(tokens)) {
    db.prepare('INSERT INTO accounts(id,issuer,subject,email,username,email_verified) VALUES (?,?,?,?,?,1)')
      .run(id,'google',id,id+'@example.com',id === 'owner' ? 'owner' : null);
    db.prepare('INSERT INTO provider_identities(provider,subject,account_id,email) VALUES (?,?,?,?)').run('google',id,id,id+'@example.com');
    db.prepare('INSERT INTO browser_sessions VALUES (?,?,?)').run(await hash(token),id,Date.now()+60000);
  }
  const deviceToken = 'knitt_' + secret();
  db.prepare('INSERT INTO devices VALUES (?,?,?,?,?,?,?)').run('device',await hash(deviceToken),'owner','Laptop',Date.now(),Date.now(),Date.now()+60000);
  const worker = createCloudWorker();
  const req = (path:string, user?:keyof typeof tokens, method='GET', headers:Record<string,string>={}) => worker.fetch(new Request(env.APP_ORIGIN+path,{
    method,headers:{...(user ? {Cookie:'__Host-knitt_session='+tokens[user]} : {}),...headers},
  }),env);
  return {db,env,req,deviceToken};
}

test('admin endpoints require an allowlisted browser account; device credentials and user-controlled identities cannot elevate access', async t => {
  const {req,env,db,deviceToken} = await setup(t);
  for (const path of ['/api/admin/overview','/api/admin/users','/api/admin/unknown']) {
    assert.equal((await req(path)).status,401);
    assert.equal((await req(path,'member')).status,403);
    assert.equal((await req(path,undefined,'GET',{Authorization:'Bearer '+deviceToken})).status,403);
  }
  assert.equal((await (await req('/api/me','owner')).json()).isAdmin,true);
  assert.equal((await (await req('/api/me','member')).json()).isAdmin,false);
  db.prepare('UPDATE accounts SET username=?,email=? WHERE id=?').run('second-admin','owner@example.com','member');
  assert.equal((await req('/api/admin/users','member')).status,403);
  assert.equal((await req('/api/admin/users','owner','DELETE')).status,403); // Browser mutations still require CSRF.
  assert.equal((await req('/api/admin/unknown','owner')).status,404);
  env.ADMIN_ACCOUNT_IDS = '';
  assert.equal((await req('/api/admin/users','owner')).status,403);
});

test('admin overview and filtered user list use real account metadata and omit credentials and conversation content', async t => {
  const {req,db} = await setup(t);
  db.prepare('UPDATE accounts SET created_at=? WHERE id=?').run('2020-01-01T00:00:00.000Z','member');
  const overview = await (await req('/api/admin/overview','owner')).json();
  assert.deepEqual(overview.overview,{totalUsers:2,signupsThisWeek:1,pendingOnboarding:1,connectedDevices:1,publishedContexts:0,syncedConversations:0});
  const response = await req('/api/admin/users','owner');
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  const data = await response.json();
  assert.equal(data.total,2);
  assert.deepEqual(data.users.map((u:{id:string})=>u.id),['owner','member']);
  assert.deepEqual(data.users[0].providers,['google']);
  assert.equal(data.users[0].emailVerified,true);
  assert.equal(data.users[0].connectedDevices,1);
  assert.equal(data.users[1].lastDeviceActivity,null);
  assert.deepEqual(Object.keys(data.users[0]).sort(),['id','email','emailVerified','username','createdAt','providers','connectedDevices','lastDeviceActivity','publishedContexts','syncedConversations'].sort());
  for (const [query, total] of [['q=OWNER%40example.com',1],['q=%25',0],['q=%27%20OR%201%3D1--',0],['provider=github',0],['provider=google&onboarding=pending',1],['onboarding=complete',1]] as const) {
    assert.equal((await (await req('/api/admin/users?'+query,'owner')).json()).total,total,String(query));
  }
  for (const query of ['page=0','page=-1','page=1.5','page=1000000','provider=other','onboarding=other','q='+'a'.repeat(201)]) {
    assert.equal((await req('/api/admin/users?'+query,'owner')).status,400,query);
  }
});

test('admin pagination is stable and bounded to 25 users', async t => {
  const {req,db} = await setup(t);
  for (let i=0;i<30;i++) db.prepare('INSERT INTO accounts(id,issuer,subject,email,created_at) VALUES (?,?,?,?,?)')
    .run('user'+String(i).padStart(2,'0'),'google','user'+i,'test@example.com','2020-01-01T00:00:00.000Z');
  const first = await (await req('/api/admin/users','owner')).json();
  const second = await (await req('/api/admin/users?page=2','owner')).json();
  assert.equal(first.total,32);
  assert.equal(first.users.length,25);
  assert.equal(second.users.length,7);
  assert.equal(new Set([...first.users,...second.users].map(u=>u.id)).size,32);
});
