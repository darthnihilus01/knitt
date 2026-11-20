import { authenticate, csrf, fields, HttpError, json, method, origin, requireBrowser, SESSION_COOKIE, setCookie } from './identity.ts';
import type { CloudEnvironment } from './identity.ts';
import { finishOAuth, startOAuth, type OAuthTransport, type Provider } from './oauth.ts';
import { approvePairing, createPairing, exchangePairing, listDevices, previewPairing, revokeDevice } from './devices.ts';
import { handleSharing } from './sharing.ts';
import { handlePrivateSync } from './private-sync.ts';
import { handleAdmin, isAdmin } from './admin.ts';
export type { CloudEnvironment, AccountDatabase } from './identity.ts';

async function route(request: Request, env: CloudEnvironment, transport: OAuthTransport) {
  const url = new URL(request.url), path = url.pathname;
  if (path === '/health') { method(request, 'GET'); return json({status:'ok'}); }
  if (url.hostname.endsWith('.workers.dev') && url.origin !== origin(env) && request.method === 'GET' &&
      !path.startsWith('/api/') && !path.endsWith('/callback')) {
    return new Response(null, {status:302, headers:{Location:origin(env) + url.pathname + url.search, 'Cache-Control':'no-store'}});
  }
  if (!path.startsWith('/api/') && !path.startsWith('/auth/')) {
    if (!env.ASSETS) throw new HttpError(404, 'Not found');
    return env.ASSETS.fetch(request);
  }
  if (url.origin !== origin(env)) throw new HttpError(400, 'Use the configured Knitt origin');
  const oauth = /^\/auth\/(google|github)\/(start|callback)$/.exec(path);
  if (oauth) {
    method(request, 'GET');
    const provider = oauth[1] as Provider;
    return oauth[2] === 'start' ? startOAuth(request, env, provider) : finishOAuth(request, env, provider, transport);
  }
  if (!path.startsWith('/api/')) throw new HttpError(404, 'Not found');
  if (path === '/api/device-pairings') { method(request,'POST'); return createPairing(request,env); }
  if (path === '/api/device-pairings/exchange') { method(request,'POST'); return exchangePairing(request,env); }
  if (path === '/api/me') method(request,'GET');
  const auth = await authenticate(request,env);
  if (!['GET','HEAD','OPTIONS'].includes(request.method)) csrf(request,env,auth);
  if (path === '/api/me') {
    const providers = await env.DB.prepare('SELECT provider FROM provider_identities WHERE account_id=? ORDER BY provider')
      .bind(auth.account.id).all<{provider:string}>();
    return json({account:auth.account, providers:providers.results.map(row => row.provider), csrfToken:auth.csrfToken, isAdmin:isAdmin(env,auth)});
  }
  if (path === '/api/admin' || path.startsWith('/api/admin/')) return handleAdmin(request,env,auth);
  if (path === '/api/me/username') {
    method(request,'PUT'); requireBrowser(auth);
    const {username} = await fields(request);
    if (typeof username !== 'string' || !/^[a-z0-9][a-z0-9_]{2,31}$/.test(username)) {
      throw new HttpError(400, 'Choose 3–32 lowercase letters, numbers or underscores, starting with a letter or number');
    }
    const updated = await env.DB.prepare('UPDATE OR IGNORE accounts SET username=? WHERE id=? RETURNING id')
      .bind(username,auth.account.id).first();
    if (!updated) throw new HttpError(409, 'Username unavailable');
    return json({account:{...auth.account,username}});
  }
  const link = /^\/api\/me\/link\/(google|github)$/.exec(path);
  if (link) { method(request,'POST'); return startOAuth(request,env,link[1] as Provider,auth); }
  if (path === '/api/logout') {
    method(request,'POST'); requireBrowser(auth);
    await env.DB.prepare('DELETE FROM browser_sessions WHERE token_hash=?').bind(auth.sessionHash).run();
    const response = json({signedOut:true});
    response.headers.append('Set-Cookie',setCookie(SESSION_COOKIE,'',0));
    return response;
  }
  if (path === '/api/devices') { method(request,'GET'); return listDevices(env,auth); }
  const device = /^\/api\/devices\/([^/]+)$/.exec(path);
  if (device) { method(request,'DELETE'); return revokeDevice(env,auth,device[1]); }
  if (path === '/api/device-pairings/approve') { method(request,'POST'); return approvePairing(request,env,auth); }
  if (path === '/api/device-pairings/preview') { method(request,'GET'); return previewPairing(request,env,auth); }
  return (await handlePrivateSync(request,env,auth)) ?? (await handleSharing(request,env,auth.account)) ?? json({error:'Not found'},404);
}

export function createCloudWorker(transport: OAuthTransport = {}) {
  return {
    async fetch(request: Request, env: CloudEnvironment) {
      let response: Response;
      try { response = await route(request,env,transport); }
      catch (error) {
        response = error instanceof HttpError ? json({error:error.message},error.status) : json({error:'Knitt Cloud temporarily unavailable'},503);
      }
      // Static asset bindings may return immutable response headers.
      const secured = new Response(response.body, response);
      const path = new URL(request.url).pathname;
      if (path.startsWith('/api/') || path.startsWith('/auth/')) secured.headers.set('Cache-Control','no-store');
      secured.headers.set('X-Content-Type-Options','nosniff');
      secured.headers.set('Referrer-Policy','no-referrer');
      secured.headers.set('X-Frame-Options','DENY');
      secured.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'");
      return secured;
    },
  };
}
export default createCloudWorker();
