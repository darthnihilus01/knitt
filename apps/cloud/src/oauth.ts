import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { authenticate, cookie, FLOW_COOKIE, hash, HttpError, json, origin, requireBrowser, secret, SESSION_COOKIE, setCookie } from './identity.ts';
import type { Auth, CloudEnvironment } from './identity.ts';

export type Provider = 'google' | 'github';
interface Identity { subject: string; email: string; verified: boolean }
interface Flow {
  verifier: string;
  nonce: string;
  return_to: string;
  link_session: string | null;
}
export interface OAuthTransport { fetch?: typeof fetch; googleKey?: JWTVerifyGetKey }
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const TEN_MINUTES = 600;
const SESSION_SECONDS = 30 * 24 * 60 * 60;

function settings(env: CloudEnvironment, provider: Provider) {
  const id = provider === 'google' ? env.GOOGLE_CLIENT_ID : env.GITHUB_CLIENT_ID;
  const secret = provider === 'google' ? env.GOOGLE_CLIENT_SECRET : env.GITHUB_CLIENT_SECRET;
  if (!id || !secret) throw new HttpError(503, `Configure ${provider} sign-in to continue`);
  return { id, secret, callback: origin(env) + '/auth/' + provider + '/callback' };
}
function returnPath(request: Request, appOrigin: string) {
  const path = new URL(request.url).searchParams.get('returnTo');
  if (!path?.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u001f]/.test(path)) return '/';
  const url = new URL(path, appOrigin);
  // The app has a dashboard and a browser confirmation page. Never redirect into another API or OAuth action.
  if (url.origin !== appOrigin || !['/', '/pair'].includes(url.pathname)) return '/';
  return url.pathname + url.search;
}
export async function startOAuth(request: Request, env: CloudEnvironment, provider: Provider, link?: Auth) {
  if (link) requireBrowser(link);
  const config = settings(env, provider);
  const state = secret(), verifier = secret(), nonce = secret(), browser = secret();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_flows WHERE expires_at<=?').bind(now),
    env.DB.prepare('DELETE FROM browser_sessions WHERE expires_at<=?').bind(now),
    env.DB.prepare(`INSERT INTO oauth_flows
      (state_hash,provider,browser_hash,verifier,nonce,link_session,return_to,expires_at) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(await hash(state), provider, await hash(browser), verifier, nonce, link?.sessionHash ?? null,
        returnPath(request, origin(env)), now + TEN_MINUTES * 1000),
  ]);
  const dest = new URL(provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://github.com/login/oauth/authorize');
  dest.search = new URLSearchParams({
    client_id: config.id, redirect_uri: config.callback, response_type: 'code', state,
    scope: provider === 'google' ? 'openid email' : 'user:email',
    code_challenge: await hash(verifier), code_challenge_method: 'S256',
  }).toString();
  if (provider === 'google') { dest.searchParams.set('nonce', nonce); dest.searchParams.set('prompt', 'select_account'); }
  const response = link ? json({ url: dest.href }) : new Response(null, {status:302, headers:{Location:dest.href}});
  response.headers.append('Set-Cookie', setCookie(FLOW_COOKIE + '_' + state, browser, TEN_MINUTES));
  return response;
}

async function verifyIdentity(env: CloudEnvironment, provider: Provider, code: string, flow: Flow, transport: OAuthTransport): Promise<Identity> {
  const config = settings(env, provider);
  const send: typeof fetch = transport.fetch ?? ((input, init) => fetch(input, init));
  const invalid = () => new HttpError(401, 'The provider could not verify this sign-in and email address');
  const tokenUrl = provider === 'google' ? 'https://oauth2.googleapis.com/token' : 'https://github.com/login/oauth/access_token';
  const exchange = await send(tokenUrl, {
    method: 'POST', redirect: 'manual', headers: {Accept:'application/json'},
    body: new URLSearchParams({grant_type:'authorization_code', code, client_id:config.id, client_secret:config.secret,
      code_verifier:flow.verifier, redirect_uri:config.callback}),
  });
  if (!exchange.ok) throw invalid();
  const token = await exchange.json() as {id_token?:string; access_token?:string};
  if (provider === 'google') {
    if (typeof token.id_token !== 'string') throw invalid();
    const {payload} = await jwtVerify(token.id_token, transport.googleKey ?? googleKeys, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: config.id,
      algorithms: ['RS256'], requiredClaims: ['sub','iat','exp','nonce','email','email_verified'],
    }).catch(() => { throw invalid(); });
    if (!payload.sub || payload.nonce !== flow.nonce || payload.email_verified !== true ||
        (Array.isArray(payload.aud) && payload.aud.length > 1 && !payload.azp) ||
        (payload.azp !== undefined && payload.azp !== config.id)) throw invalid();
    const parsed = z.email().safeParse(payload.email);
    if (!parsed.success) throw invalid();
    return {subject:payload.sub, email:parsed.data.toLowerCase(), verified:parsed.data.toLowerCase().endsWith('@gmail.com') || (typeof payload.hd === 'string' && payload.hd.length > 0)};
  }
  if (typeof token.access_token !== 'string' || !token.access_token) throw invalid();
  const headers = {Authorization:'Bearer ' + token.access_token, 'User-Agent':'Knitt-Cloud', Accept:'application/vnd.github+json'};
  const [user, emails] = await Promise.all([
    send('https://api.github.com/user', {headers, redirect:'manual'}),
    send('https://api.github.com/user/emails?per_page=100', {headers, redirect:'manual'}),
  ]);
  if (!user.ok || !emails.ok) throw invalid();
  const profile = await user.json() as {id?: number};
  const addresses: unknown = await emails.json();
  if (!Number.isSafeInteger(profile.id) || Number(profile.id) < 1 || !Array.isArray(addresses)) throw invalid();
  const primary = addresses.find(entry => entry?.primary === true && entry?.verified === true);
  const parsed = z.email().safeParse(primary?.email);
  if (!parsed.success) throw invalid();
  return {subject:String(profile.id), email:parsed.data.toLowerCase(), verified:true};
}

export async function finishOAuth(request: Request, env: CloudEnvironment, provider: Provider, transport: OAuthTransport) {
  const query = new URL(request.url).searchParams;
  const state = query.get('state');
  if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new HttpError(400, 'Invalid sign-in state');
  const flowCookie = FLOW_COOKIE + '_' + state;
  const browser = cookie(request, flowCookie);
  const invalidState = () => new HttpError(400, 'Sign-in expired or did not start in this browser');
  if (!browser || !state) throw invalidState();
  const flow = await env.DB.prepare(`DELETE FROM oauth_flows WHERE state_hash=? AND browser_hash=?
    AND provider=? AND expires_at>? RETURNING verifier,nonce,link_session,return_to`)
    .bind(await hash(state), await hash(browser), provider, Date.now()).first<Flow>();
  if (!flow) throw invalidState();
  if (!query.get('code') || query.has('error')) throw new HttpError(400, 'Sign-in was not completed');
  let linkAuth: Auth | undefined;
  if (flow.link_session) {
    linkAuth = await authenticate(request, env);
    if (linkAuth.sessionHash !== flow.link_session) throw invalidState();
  }
  let identity: Identity;
  try { identity = await verifyIdentity(env, provider, query.get('code')!, flow, transport); }
  catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('OAuth provider validation failed', error instanceof Error ? error.name + ': ' + error.message.replace(/https?:\/\/[^\s]+/g, '[provider URL]').slice(0,160) : 'UnknownError');
    throw new HttpError(503, 'Sign-in provider validation temporarily unavailable');
  }
  const {email,subject,verified} = identity;
  const response = new Response(null, {status:303, headers:{Location:origin(env) + flow.return_to}});
  response.headers.append('Set-Cookie', setCookie(flowCookie, '', 0));
  if (linkAuth) {
    const result = await env.DB.prepare(`INSERT INTO provider_identities (provider,subject,account_id,email,email_verified)
      SELECT ?,?,account_id,?,? FROM browser_sessions WHERE token_hash=? AND expires_at>?
      ON CONFLICT(provider,subject) DO UPDATE SET email=excluded.email,email_verified=excluded.email_verified WHERE account_id=excluded.account_id
      ON CONFLICT(account_id,provider) DO NOTHING RETURNING account_id`)
      .bind(provider, subject, email,verified ? 1 : 0, flow.link_session, Date.now()).first<{account_id:string}>();
    if (!result) throw new HttpError(409, 'This provider is already linked to another identity');
    return response;
  }
  // The identity lookup, first account creation and session issuance all share one D1 transaction.
  // A separately signed-in identity with the same email is always a separate account.
  const now = Date.now(), token = secret(), tokenHash = await hash(token);
  const previous = cookie(request, SESSION_COOKIE);
  const statements = [
    env.DB.prepare(`INSERT INTO accounts (id,issuer,subject,email,email_verified)
      SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM provider_identities WHERE provider=? AND subject=?)
      ON CONFLICT(issuer,subject) DO NOTHING`)
      .bind(crypto.randomUUID(), provider, subject, email, verified ? 1 : 0, provider, subject),
    env.DB.prepare(`INSERT INTO provider_identities (provider,subject,account_id,email,email_verified)
      SELECT ?,?,id,?,? FROM accounts WHERE issuer=? AND subject=?
      ON CONFLICT(provider,subject) DO UPDATE SET email=excluded.email,email_verified=excluded.email_verified`).bind(provider, subject, email,verified ? 1 : 0, provider, subject),
    env.DB.prepare('UPDATE provider_identities SET email=?,email_verified=? WHERE provider=? AND subject=?').bind(email,verified ? 1 : 0,provider,subject),
    env.DB.prepare(`UPDATE accounts SET email=?, email_verified=? WHERE issuer=? AND subject=?`).bind(email,verified ? 1 : 0,provider,subject),
    env.DB.prepare(`INSERT INTO browser_sessions (token_hash,account_id,expires_at)
      SELECT ?,account_id,? FROM provider_identities WHERE provider=? AND subject=? RETURNING account_id`)
      .bind(tokenHash, now + SESSION_SECONDS * 1000, provider,subject),
  ];
  if (previous) statements.push(env.DB.prepare('DELETE FROM browser_sessions WHERE token_hash=?').bind(await hash(previous)));
  let results;
  try { results = await env.DB.batch(statements); }
  catch (error) {
    const detail = error instanceof Error && error.message.startsWith('D1_ERROR:') ? error.message.slice(0,200) : 'Database operation failed';
    console.error('OAuth account transaction failed', detail);
    throw new HttpError(503, 'Sign-in account storage temporarily unavailable');
  }
  if (!results[4]?.results.length) throw new HttpError(503, 'Account session unavailable');
  response.headers.append('Set-Cookie', setCookie(SESSION_COOKIE, token, SESSION_SECONDS));
  return response;
}
