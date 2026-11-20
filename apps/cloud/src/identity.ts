export type SqlValue = string | number | null;
export interface DbStatement {
  bind(...values: SqlValue[]): DbStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{results: T[]}>;
  run(): Promise<unknown>;
}
export interface AccountDatabase {
  prepare(sql: string): DbStatement;
  batch(statements: DbStatement[]): Promise<{results: unknown[]}[]>;
}
export interface CloudEnvironment {
  DB: AccountDatabase;
  APP_ORIGIN: string;
  ADMIN_ACCOUNT_IDS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
}
export interface CloudAccount {
  id: string;
  email: string;
  emailVerified: boolean;
  username: string | null;
  createdAt: string;
}
export interface Auth {
  account: CloudAccount;
  sessionHash: string | null;
  csrfToken: string | null;
  deviceId: string | null;
}
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export const json = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
export function method(request: Request, expected: string) {
  if (request.method !== expected) throw new HttpError(405, 'Method not allowed');
}
export async function fields(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    throw new HttpError(415, 'Send application/json');
  }
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Expected a JSON object');
  return value as Record<string, unknown>;
}
function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function secret() { return base64url(crypto.getRandomValues(new Uint8Array(32))); }
export async function hash(value: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
export const SESSION_COOKIE = '__Host-knitt_session';
export const FLOW_COOKIE = '__Host-knitt_flow';
export function cookie(request: Request, name: string) {
  return (request.headers.get('cookie') ?? '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1);
}
export function setCookie(name: string, token: string, age: number) {
  return `${name}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
}
export function origin(env: CloudEnvironment) {
  let url: URL;
  try { url = new URL(env.APP_ORIGIN); } catch { throw new HttpError(503, 'Set APP_ORIGIN to the public Knitt origin'); }
  if (url.origin !== env.APP_ORIGIN || (url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new HttpError(503, 'Invalid APP_ORIGIN');
  }
  return url.origin;
}
export const accountColumns = 'a.id, a.email, a.email_verified AS emailVerified, a.username, a.created_at AS createdAt';
type AccountRow = Omit<CloudAccount, 'emailVerified'> & {emailVerified: number};
export function accountFromRow(row: AccountRow): CloudAccount {
  return { id: row.id, email: row.email, emailVerified: row.emailVerified === 1, username: row.username, createdAt: row.createdAt };
}
export async function authenticate(request: Request, env: CloudEnvironment): Promise<Auth> {
  const authorization = request.headers.get('Authorization');
  if (authorization !== null) {
    const token = /^Bearer (knitt_[A-Za-z0-9_-]{43})$/.exec(authorization)?.[1];
    if (token) {
      const tokenHash = await hash(token);
      const now = Date.now();
      const row = await env.DB.prepare(`SELECT ${accountColumns}, d.id AS deviceId FROM accounts a
        JOIN devices d ON d.account_id=a.id WHERE d.token_hash=? AND d.expires_at>?`)
        .bind(tokenHash, now).first<AccountRow & {deviceId:string}>();
      if (row) {
        await env.DB.prepare('UPDATE devices SET last_used_at=? WHERE id=? AND last_used_at<?')
          .bind(now, row.deviceId, now-60000).run();
        return { account: accountFromRow(row), sessionHash: null, csrfToken: null, deviceId: row.deviceId };
      }
    }
  } else {
    const token = cookie(request, SESSION_COOKIE);
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
      const sessionHash = await hash(token);
      const row = await env.DB.prepare(`SELECT ${accountColumns} FROM accounts a JOIN browser_sessions s ON s.account_id=a.id
        WHERE s.token_hash=? AND s.expires_at>?`).bind(sessionHash, Date.now()).first<AccountRow>();
      if (row) return { account: accountFromRow(row), sessionHash, csrfToken: await hash('csrf:' + token), deviceId: null };
    }
  }
  throw new HttpError(401, 'Authentication required');
}
export function requireBrowser(auth: Auth) {
  if (!auth.sessionHash) throw new HttpError(403, 'Sign in through the browser for this action');
}
export function csrf(request: Request, env: CloudEnvironment, auth: Auth) {
  if (auth.sessionHash && (request.headers.get('Origin') !== origin(env) || request.headers.get('X-CSRF-Token') !== auth.csrfToken)) {
    throw new HttpError(403, 'Invalid request origin or CSRF token');
  }
}
