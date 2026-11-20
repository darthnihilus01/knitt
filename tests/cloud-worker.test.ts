import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { cloudDatabase } from './fixtures/cloud-db.ts';
import { createCloudWorker } from '../apps/cloud/src/worker.ts';
import { hash, secret, type CloudEnvironment } from '../apps/cloud/src/identity.ts';

type Provider = 'google' | 'github';
type Login = {sid:string; csrf:string; id:string};
const app = 'https://knit.example.com';
const keys = await generateKeyPair('RS256');
const firstCookie = (r: Response, name: string) =>
  r.headers.getSetCookie().find(v => v.startsWith(name + '='))?.split(';')[0] ?? '';
async function setup(t: {after(fn:()=>void):void}) {
  const {db,binding} = cloudDatabase();
  t.after(() => db.close());
  const env: CloudEnvironment = {DB:binding, APP_ORIGIN:app, GOOGLE_CLIENT_ID:'google-id', GOOGLE_CLIENT_SECRET:'google-secret',
    GITHUB_CLIENT_ID:'github-id', GITHUB_CLIENT_SECRET:'github-secret'};
  type Profile = {sub?:string;email?:string;verified?:boolean;nonce?:string;aud?:string;iss?:string;exp?:string;azp?:string};
  const codes = new Map<string,{dest:URL; profile:Profile}>();
  const mockFetch: typeof fetch = async (input,init) => {
    const endpoint = String(input);
    assert.equal(init?.redirect,'manual', 'Workers supports manual or follow redirects');
    if (endpoint.startsWith('https://api.github.com/')) {
      const code = new Headers(init?.headers).get('Authorization')?.slice(7);
      const grant = codes.get(code ?? '');
      assert.ok(grant);
      if (endpoint.endsWith('/user')) return Response.json({id:Number(grant.profile.sub ?? '1'), email:'untrusted@example.com'});
      assert.equal(endpoint,'https://api.github.com/user/emails?per_page=100');
      return Response.json([{email:grant.profile.email ?? 'alice@example.com',primary:true,verified:grant.profile.verified ?? true}]);
    }
    const params = init?.body as URLSearchParams;
    const code = params.get('code')!;
    const grant = codes.get(code);
    assert.ok(grant);
    assert.equal(grant.dest.searchParams.get('code_challenge'),await hash(params.get('code_verifier')!));
    assert.equal(grant.dest.searchParams.get('code_challenge_method'),'S256');
    assert.equal(params.get('redirect_uri'),grant.dest.searchParams.get('redirect_uri'));
    if (endpoint === 'https://github.com/login/oauth/access_token') return Response.json({access_token:code});
    assert.equal(endpoint,'https://oauth2.googleapis.com/token');
    const profile = grant.profile;
    const token = await new SignJWT({nonce:profile.nonce ?? grant.dest.searchParams.get('nonce'), email:profile.email ?? 'Alice@example.com',
      email_verified:profile.verified ?? true, azp:profile.azp}).setProtectedHeader({alg:'RS256'}).setSubject(profile.sub ?? 'alice')
      .setIssuedAt().setExpirationTime(profile.exp ?? '5m').setIssuer(profile.iss ?? 'https://accounts.google.com')
      .setAudience(profile.aud ?? env.GOOGLE_CLIENT_ID!).sign(keys.privateKey);
    return Response.json({id_token:token});
  };
  const worker = createCloudWorker({fetch:mockFetch, googleKey:async()=>keys.publicKey});
  const req = (path:string, method='GET', body?:unknown, headers:Record<string,string>={}) => worker.fetch(new Request(app + path,{
    method, headers:{...headers,...(body === undefined ? {} : {'Content-Type':'application/json'})},
    body:body === undefined ? undefined : JSON.stringify(body),
  }),env);
  const signed = (login:Login) => ({Cookie:login.sid, Origin:app, 'X-CSRF-Token':login.csrf});
  const begin = async (provider:Provider, profile:Profile={}, link?:Login, next='/') => {
    const start = link ? await req('/api/me/link/' + provider,'POST',{},signed(link)) :
      await req('/auth/' + provider + '/start?returnTo=' + encodeURIComponent(next));
    assert.equal(start.status,link ? 200 : 302);
    const dest = new URL(link ? (await start.json()).url : start.headers.get('Location'));
    const cookie = firstCookie(start,'__Host-knitt_flow_' + dest.searchParams.get('state')) + (link ? '; ' + link.sid : '');
    const code = secret();
    codes.set(code,{dest,profile});
    const path = '/auth/' + provider + '/callback?code=' + code + '&state=' + dest.searchParams.get('state');
    return {path,cookie,callback:() => req(path,'GET',undefined,{Cookie:cookie})};
  };
  const finish = async (response:Response):Promise<Login> => {
    assert.equal(response.status,303);
    const sid = firstCookie(response,'__Host-knitt_session');
    const me = await req('/api/me','GET',undefined,{Cookie:sid});
    assert.equal(me.status,200);
    const info = await me.json();
    assert.equal(typeof info.account.emailVerified,'boolean');
    assert.equal(typeof info.account.createdAt,'string');
    return {sid,csrf:info.csrfToken,id:info.account.id};
  };
  const login = async (provider:Provider,profile:Profile={}) => finish(await (await begin(provider,profile)).callback());
  return {db,env,worker,req,begin,finish,login,signed};
}

test('OAuth state is expiring, provider- and browser-bound, and single-use; the browser session uses an opaque token', async t => {
  const {req,begin,finish,db} = await setup(t);
  const flow = await begin('google',{},undefined,'/pair?code=ABCDEFG');
  assert.equal((await req(flow.path)).status,400);
  assert.equal((await req(flow.path.replace('/google/','/github/'),'GET',undefined,{Cookie:flow.cookie})).status,400);
  const response = await flow.callback();
  assert.equal(response.headers.get('Location'),app + '/pair?code=ABCDEFG');
  assert.match(response.headers.getSetCookie().at(-1)!,/Path=\/; Secure; HttpOnly; SameSite=Lax/);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  const user = await finish(response);
  const stored = db.prepare('SELECT token_hash FROM browser_sessions').get()!;
  assert.equal(stored.token_hash,await hash(user.sid.split('=')[1]));
  assert.equal((await flow.callback()).status,400);
  const expired = await begin('github');
  db.exec('UPDATE oauth_flows SET expires_at=0');
  assert.equal((await expired.callback()).status,400);
  const external = await begin('google',{},undefined,'//attacker.example');
  assert.equal((await external.callback()).headers.get('Location'),app + '/');
  assert.equal((await req('/api/me','GET',undefined,{'Cf-Access-Jwt-Assertion':'legacy'})).status,401);
  assert.equal((await req('/api/me','POST')).status,405);
});

test('Google requires signed claims, verified email and the matching audience, nonce, issuer and expiry; GitHub requires verified primary email', async t => {
  const {begin,db} = await setup(t);
  for (const bad of [{nonce:'wrong'}, {aud:'other'}, {azp:'other'},{iss:'https://another.example'}, {exp:'-1m'}, {verified:false}, {email:'bad'}]) {
    assert.equal((await (await begin('google',bad)).callback()).status,401);
  }
  assert.equal((await (await begin('github',{verified:false})).callback()).status,401);
  assert.equal(db.prepare('SELECT count(*) AS n FROM accounts').get()?.n,0);
});

test('sign-ins keep account IDs across address changes and never merge by email; only the signed-in browser can link an unused provider', async t => {
  const {req,login,begin,signed,db} = await setup(t);
  const [alice,other] = await Promise.all([login('google'),login('google')]);
  assert.equal(alice.id,other.id);
  assert.equal((await login('google',{email:'updated@example.com'})).id,alice.id);
  const github = await login('github',{sub:'1',email:'updated@example.com'});
  assert.notEqual(alice.id,github.id);
  assert.equal((await (await begin('github',{sub:'1'},alice)).callback()).status,409);
  const swapped = await begin('github',{sub:'2'},alice);
  assert.equal((await req(swapped.path,'GET',undefined,{Cookie:swapped.cookie.replace(alice.sid,github.sid)})).status,400);
  const link = await begin('github',{sub:'2'},alice);
  assert.equal((await link.callback()).status,303);
  assert.equal((await login('github',{sub:'2'})).id,alice.id);
  assert.deepEqual((await (await req('/api/me','GET',undefined,signed(alice))).json()).providers,['github','google']);
  assert.equal(db.prepare('SELECT count(*) AS n FROM accounts').get()?.n,2);
});

test('browser mutations require CSRF and exact origin; usernames are unique, logout invalidates the session', async t => {
  const {req,login,signed} = await setup(t);
  const alice = await login('google'), bob = await login('google',{sub:'bob'});
  const target = '/api/me/username';
  for (const headers of [{Cookie:alice.sid},{...signed(alice),Origin:'https://other.example'},{...signed(alice),'X-CSRF-Token':bob.csrf}]) {
    assert.equal((await req(target,'PUT',{username:'alice'},headers)).status,403);
  }
  assert.equal((await req(target,'PUT',{username:'Alice @'},signed(alice))).status,400);
  assert.equal((await req(target,'PUT',{username:'alice'},signed(alice))).status,200);
  assert.equal((await req(target,'PUT',{username:'alice'},signed(bob))).status,409);
  assert.equal((await req('/api/logout','POST',{},signed(alice))).status,200);
  assert.equal((await req('/api/me','GET',undefined,signed(alice))).status,401);
});

test('only a confirmed browser and the originating CLI secret can pair; exchange is one-use and revocation is immediate', async t => {
  const {req,login,signed,db} = await setup(t);
  const alice = await login('google'), bob = await login('google',{sub:'bob'});
  const response = await req('/api/device-pairings','POST',{name:'Laptop'});
  assert.equal(response.status,201);
  const {deviceCode,userCode,pairingId,verificationUri} = await response.json();
  assert.equal(verificationUri,app + '/pair?code=' + userCode);
  assert.equal(Object.values(db.prepare('SELECT * FROM device_pairings').get()!).includes(deviceCode),false);
  const preview = '/api/device-pairings/preview?code=' + userCode;
  assert.equal((await req(preview)).status,401);
  assert.equal((await (await req(preview,'GET',undefined,signed(alice))).json()).name,'Laptop');
  const exchange = (code=deviceCode) => req('/api/device-pairings/exchange','POST',{pairingId,deviceCode:code});
  assert.equal((await exchange()).status,202);
  assert.equal((await exchange(secret())).status,404);
  assert.equal((await req('/api/device-pairings/approve','POST',{userCode},{Cookie:alice.sid})).status,403);
  assert.equal((await req('/api/device-pairings/approve','POST',{userCode},signed(alice))).status,200);
  assert.equal((await req('/api/device-pairings/approve','POST',{userCode},signed(bob))).status,404);
  const attempts = await Promise.all([exchange(),exchange()]);
  assert.deepEqual(attempts.map(r => r.status).sort(),[200,404]);
  const {token,device,account} = await attempts.find(r => r.status===200)!.json();
  assert.equal(account.id,alice.id);
  assert.equal((await exchange()).status,404);
  assert.equal(db.prepare('SELECT token_hash FROM devices').get()?.token_hash,await hash(token));
  assert.equal((await (await req('/api/devices','GET',undefined,signed(alice))).json()).devices[0].id,device.id);
  assert.equal((await req('/api/devices/' + device.id,'DELETE',undefined,signed(bob))).status,404);
  const bearer = {Authorization:'Bearer ' + token};
  assert.equal((await (await req('/api/me','GET',undefined,bearer)).json()).account.id,alice.id);
  assert.equal((await req('/api/me/link/google','POST',{},bearer)).status,403);
  assert.equal((await req('/api/devices/current','DELETE',undefined,bearer)).status,200);
  assert.equal((await req('/api/me','GET',undefined,bearer)).status,401);
  const expired = await (await req('/api/device-pairings','POST',{name:'Laptop'})).json();
  db.exec('UPDATE device_pairings SET expires_at=0');
  assert.equal((await req('/api/device-pairings/approve','POST',{userCode:expired.userCode},signed(alice))).status,404);
  assert.equal((await req('/api/device-pairings/exchange','POST',expired)).status,404);
});

test('interactive workers.dev visits land on the configured site, health remains public, missing provider settings fail clearly', async t => {
  const {env,worker,req} = await setup(t);
  for (const path of ['/','/pair?code=ABCD','/auth/github/start']) {
    const alias = await worker.fetch(new Request('https://knit.account.workers.dev' + path),env);
    assert.equal(alias.status,302);
    assert.equal(alias.headers.get('location'),app + path);
  }
  assert.equal((await worker.fetch(new Request('https://knit.account.workers.dev/health'),env)).status,200);
  assert.equal((await worker.fetch(new Request('https://knit.account.workers.dev/api/me'),env)).status,400);
  delete env.GOOGLE_CLIENT_SECRET;
  const response = await req('/auth/google/start');
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/Configure google/);
});

test('third-party Google mailboxes cannot claim email invitations through linked identities', async t => {
  const {login,db} = await setup(t);
  const google = await login('google',{email:'untrusted@example.com'});
  assert.equal(db.prepare('SELECT email_verified FROM accounts WHERE id=?').get(google.id)?.email_verified,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM account_verified_emails WHERE account_id=?').get(google.id)?.n,0);
  const github = await login('github',{email:'verified@example.com'});
  assert.equal(db.prepare('SELECT count(*) AS n FROM account_verified_emails WHERE account_id=?').get(github.id)?.n,1);
});

test('parallel sign-in tabs keep independent browser-bound cookies', async t => {
  const {begin,req} = await setup(t);
  const first = await begin('google');
  const second = await begin('github');
  const jar = new Map<string,string>();
  for (const flow of [first,second]) {
    const [name,...value] = flow.cookie.split('=');
    jar.set(name,value.join('='));
  }
  const cookies = [...jar].map(([name,value]) => name+'='+value).join('; ');
  assert.equal((await req(first.path,'GET',undefined,{Cookie:cookies})).status,303);
  assert.equal((await req(second.path,'GET',undefined,{Cookie:cookies})).status,303);
  assert.equal((await req(first.path,'GET',undefined,{Cookie:cookies})).status,400);
});
