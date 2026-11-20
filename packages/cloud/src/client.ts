import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const defaultServer = 'https://knit.deeeznuts.me';
export function serverOrigin(input: string) {
  const url = new URL(input);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) || url.username || url.password || url.href !== url.origin + '/') throw new Error('Use an HTTPS origin, or HTTP on loopback for a local server');
  return url.origin;
}
export const credentialsPath = (home: string) => join(home, 'cloud', 'device.json');
const credentialsSchema = z.object({ origin: z.string(), token: z.string().min(1), device: z.object({id:z.string(),name:z.string()}), account: z.object({id:z.string(),email:z.string()}) });
export type Credentials = z.infer<typeof credentialsSchema>;
export function credentials(home: string) {
  const path = credentialsPath(home);
  if (!existsSync(path)) return null;
  const device = credentialsSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  device.origin = serverOrigin(device.origin);
  return device;
}
export class CloudError extends Error { status: number; constructor(status:number, message:string) { super(message); this.status=status; } }
export async function request<T>(origin: string, path: string, options: {method?:string; body?:unknown; token?:string} = {}): Promise<T> {
  if (!path.startsWith('/api/') || path.includes('\\')) throw new Error('Invalid cloud API path');
  const response = await fetch(serverOrigin(origin) + path, {
    method:options.method ?? (options.body === undefined ? 'GET':'POST'), redirect:'error', signal:AbortSignal.timeout(20_000),
    headers: { Accept:'application/json', ...(options.body === undefined ? {} : {'Content-Type':'application/json'}), ...(options.token ? {Authorization:'Bearer ' + options.token}:{}) },
    ...(options.body === undefined ? {} : {body:JSON.stringify(options.body)}),
  });
  if (!response.ok) {
    const info = await response.json().catch(() => ({})) as {error?:unknown};
    throw new CloudError(response.status, `Knitt Cloud returned ${response.status}` + (typeof info.error === 'string' ? ' (' + info.error + ')' : ''));
  }
  return await response.json() as T;
}
export function api<T>(device:Credentials, path:string, body?:unknown) { return request<T>(device.origin, path, {token:device.token, body}); }
export type CloudContext = {id:string;title:string;ownerUsername:string;owned:boolean;latestVersionId:string|null;sourceVersionId:string|null};
export type VersionSummary = {id:string;number:number;createdAt:string};
export type Version = VersionSummary & {contextId:string;title:string;checkpoint:string;source:Record<string,string>;excerpts:{id:string;text:string}[]};
