import { HttpError, json, method, requireBrowser } from './identity.ts';
import type { Auth, CloudEnvironment, SqlValue } from './identity.ts';

// Stable account IDs avoid privilege changes when usernames or provider emails change.
export function isAdmin(env: CloudEnvironment, auth: Auth) {
  return !!auth.sessionHash && (env.ADMIN_ACCOUNT_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean).includes(auth.account.id);
}

export async function handleAdmin(request: Request, env: CloudEnvironment, auth: Auth) {
  requireBrowser(auth);
  if (!isAdmin(env,auth)) throw new HttpError(403,'Admin access required');
  method(request,'GET');
  const url = new URL(request.url);
  if (url.pathname === '/api/admin/overview') {
    const now = Date.now();
    const overview = await env.DB.prepare(`SELECT
      (SELECT count(*) FROM accounts) AS totalUsers,
      (SELECT count(*) FROM accounts WHERE created_at>=?) AS signupsThisWeek,
      (SELECT count(*) FROM accounts WHERE username IS NULL) AS pendingOnboarding,
      (SELECT count(*) FROM devices WHERE expires_at>?) AS connectedDevices,
      (SELECT count(*) FROM contexts) AS publishedContexts,
      (SELECT count(*) FROM private_conversations) AS syncedConversations`)
      .bind(new Date(now-7*86400000).toISOString(),now).first();
    return json({overview});
  }
  if (url.pathname !== '/api/admin/users') throw new HttpError(404,'Not found');
  const q = (url.searchParams.get('q') ?? '').trim();
  const provider = url.searchParams.get('provider') ?? '';
  const onboarding = url.searchParams.get('onboarding') ?? '';
  const pageText = url.searchParams.get('page') ?? '1';
  if (q.length>200 || !['','google','github'].includes(provider) || !['','complete','pending'].includes(onboarding) ||
      !/^[1-9]\d{0,5}$/.test(pageText)) throw new HttpError(400,'Invalid user filters');
  const page = Number(pageText), pageSize = 25;
  const conditions: string[] = [], values: SqlValue[] = [];
  if (q) {
    conditions.push("(a.id LIKE ? ESCAPE '\\' OR a.email LIKE ? ESCAPE '\\' OR a.username LIKE ? ESCAPE '\\')");
    const pattern = '%' + q.replace(/[\\%_]/g,'\\$&') + '%';
    values.push(pattern,pattern,pattern);
  }
  if (provider) {
    conditions.push('EXISTS (SELECT 1 FROM provider_identities p WHERE p.account_id=a.id AND p.provider=?)');
    values.push(provider);
  }
  if (onboarding) conditions.push(onboarding === 'pending' ? 'a.username IS NULL' : 'a.username IS NOT NULL');
  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  const results = await env.DB.batch([
    env.DB.prepare('SELECT count(*) AS total FROM accounts a' + where).bind(...values),
    env.DB.prepare(`SELECT a.id,a.email,a.email_verified AS emailVerified,a.username,a.created_at AS createdAt,
      (SELECT group_concat(provider,',') FROM (SELECT provider FROM provider_identities WHERE account_id=a.id ORDER BY provider)) AS providers,
      (SELECT count(*) FROM devices WHERE account_id=a.id AND expires_at>?) AS connectedDevices,
      (SELECT max(last_used_at) FROM devices WHERE account_id=a.id) AS lastDeviceActivity,
      (SELECT count(*) FROM contexts WHERE owner_id=a.id) AS publishedContexts,
      (SELECT count(*) FROM private_conversations WHERE account_id=a.id) AS syncedConversations
      FROM accounts a${where} ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`)
      .bind(Date.now(),...values,pageSize,(page-1)*pageSize),
  ]);
  const total = (results[0].results[0] as {total:number}).total;
  const users = (results[1].results as {emailVerified:number;providers:string|null}[]).map(user => ({
    ...user, emailVerified:user.emailVerified === 1, providers:user.providers?.split(',') ?? [],
  }));
  return json({users,total,page,pageSize});
}
