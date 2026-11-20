import { accountColumns, accountFromRow, fields, hash, HttpError, json, origin, requireBrowser, secret } from './identity.ts';
import type { Auth, CloudAccount, CloudEnvironment } from './identity.ts';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const deviceLifetime = 90 * 24 * 60 * 60 * 1000;
function userCode(value: unknown) {
  if (typeof value !== 'string') throw new HttpError(400, 'Enter a pairing code');
  const code = value.toUpperCase().replace(/[ -]/g, '');
  if (code.length !== 12 || ![...code].every(char => CODE_ALPHABET.includes(char))) {
    throw new HttpError(400, 'Enter a valid pairing code');
  }
  return code;
}
const unavailable = () => new HttpError(404, 'Pairing unavailable or expired');
export async function createPairing(request: Request, env: CloudEnvironment) {
  const {name} = await fields(request);
  if (typeof name !== 'string' || !name.trim() || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new HttpError(400, 'Enter a device name of 1–100 characters');
  }
  const code = Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => CODE_ALPHABET[byte % 32]).join('');
  const displayed = code.slice(0,4) + '-' + code.slice(4,8) + '-' + code.slice(8);
  const deviceCode = secret(), pairingId = crypto.randomUUID();
  const now = Date.now(), expiresAt = now + 10 * 60 * 1000;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM device_pairings WHERE expires_at<=?').bind(now),
    env.DB.prepare('INSERT INTO device_pairings (id,user_code_hash,device_code_hash,name,expires_at) VALUES (?,?,?,?,?)')
      .bind(pairingId, await hash(code), await hash(deviceCode), name.trim(), expiresAt),
  ]);
  return json({pairingId, deviceCode, userCode:displayed, verificationUri:origin(env) + '/pair?code=' + displayed,
    expiresAt:new Date(expiresAt).toISOString(), interval:5}, 201);
}
export async function previewPairing(request: Request, env: CloudEnvironment, auth: Auth) {
  requireBrowser(auth);
  const code = userCode(new URL(request.url).searchParams.get('code'));
  const row = await env.DB.prepare('SELECT name,expires_at FROM device_pairings WHERE user_code_hash=? AND account_id IS NULL AND expires_at>?')
    .bind(await hash(code), Date.now()).first<{name:string; expires_at:number}>();
  if (!row) throw unavailable();
  return json({name:row.name, expiresAt:new Date(row.expires_at).toISOString()});
}
export async function approvePairing(request: Request, env: CloudEnvironment, auth: Auth) {
  requireBrowser(auth);
  const code = userCode((await fields(request)).userCode);
  const paired = await env.DB.prepare(`UPDATE device_pairings SET account_id=? WHERE user_code_hash=?
    AND (account_id IS NULL OR account_id=?) AND expires_at>? RETURNING id`)
    .bind(auth.account.id, await hash(code), auth.account.id, Date.now()).first();
  if (!paired) throw unavailable();
  return json({approved:true});
}
export async function exchangePairing(request: Request, env: CloudEnvironment) {
  const {pairingId, deviceCode} = await fields(request);
  if (typeof pairingId !== 'string' || typeof deviceCode !== 'string' || deviceCode.length !== 43) throw unavailable();
  const now = Date.now(), token = 'knitt_' + secret(), id = crypto.randomUUID();
  const key = await hash(deviceCode);
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO devices (id,token_hash,account_id,name,created_at,last_used_at,expires_at)
      SELECT ?,?,account_id,name,?,?,? FROM device_pairings WHERE id=? AND device_code_hash=?
      AND account_id IS NOT NULL AND expires_at>? RETURNING id,name`)
      .bind(id, await hash(token), now,now,now + deviceLifetime, pairingId,key,now),
    env.DB.prepare(`SELECT ${accountColumns} FROM accounts a JOIN devices d ON d.account_id=a.id WHERE d.id=?`).bind(id),
    env.DB.prepare('DELETE FROM device_pairings WHERE id=? AND device_code_hash=? AND account_id IS NOT NULL').bind(pairingId,key),
    env.DB.prepare('SELECT id FROM device_pairings WHERE id=? AND device_code_hash=? AND account_id IS NULL AND expires_at>?')
      .bind(pairingId,key,now),
  ]);
  if (results[3].results.length) return json({status:'pending'}, 202);
  const device = results[0].results[0], row = results[1].results[0] as (Omit<CloudAccount,'emailVerified'> & {emailVerified:number}) | undefined;
  if (!device || !row) throw unavailable();
  return json({token, device, account:accountFromRow(row)});
}
export async function listDevices(env: CloudEnvironment, auth: Auth) {
  const rows = await env.DB.prepare(`SELECT id,name,created_at,last_used_at FROM devices
    WHERE account_id=? AND expires_at>? ORDER BY created_at DESC,id`).bind(auth.account.id, Date.now())
    .all<{id:string;name:string;created_at:number;last_used_at:number}>();
  return json({devices:rows.results.map(device => ({id:device.id, name:device.name, createdAt:new Date(device.created_at).toISOString(),
    lastUsedAt:new Date(device.last_used_at).toISOString()}))});
}
export async function revokeDevice(env: CloudEnvironment, auth: Auth, id: string) {
  if (id === 'current' && auth.deviceId) id = auth.deviceId;
  else requireBrowser(auth);
  const found = await env.DB.prepare('DELETE FROM devices WHERE id=? AND account_id=? RETURNING id')
    .bind(id, auth.account.id).first();
  if (!found) throw new HttpError(404, 'Device unavailable');
  return json({revoked:true});
}
