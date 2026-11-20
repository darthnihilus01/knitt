import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Resolve npm's JavaScript entry point on Windows: execFile cannot run npm.cmd.
 * All package arguments stay in an argv array, never a command shell. */
export function npmCommand(args: string[], options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; node?: string } = {}) {
  const platform = options.platform ?? process.platform, env = options.env ?? process.env, node = options.node ?? process.execPath;
  if (platform !== 'win32') return { command: 'npm', args };
  const path = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  const candidates = [
    ...(env.npm_execpath ? [join(dirname(env.npm_execpath), 'npm-cli.js')] : []),
    join(dirname(node), 'node_modules/npm/bin/npm-cli.js'),
    ...path.split(';').filter(Boolean).map(directory => join(directory.replace(/^"|"$/g, ''), 'node_modules/npm/bin/npm-cli.js')),
  ];
  const cli = candidates.find(candidate => existsSync(candidate));
  if (!cli) throw new Error('Cannot locate npm. Install Node.js 24+ with npm and add it to PATH.');
  return { command: node, args: [cli, ...args] };
}

const marker = 'MEMORY_MANAGED=shared-agent-memory';
const powershell = 'powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ';

/** Serialize a hook for the host shell without interpolating data as code. */
export function hookCommand(env: Record<string, string>, node: string, args: string[], platform: NodeJS.Platform = process.platform) {
  if (platform !== 'win32') {
    const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
    return ['env', ...Object.entries(env).map(([key, value]) => key + '=' + value), node, ...args].map(quote).join(' ');
  }
  const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
  // EncodedCommand avoids cmd.exe expanding %, &, or Unicode paths. PowerShell
  // invokes Node directly with inherited stdin; no pipeline re-encodes hook JSON.
  const assignments = Object.entries(env).map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error('Invalid hook environment key');
    return '$env:' + key + '=' + quote(value) + ';';
  }).join('');
  const script = '[Console]::InputEncoding=[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding;' +
    assignments + '& ' + [node, ...args].map(quote).join(' ') + ';exit $LASTEXITCODE';
  return powershell + Buffer.from(script, 'utf16le').toString('base64');
}

export function isManagedHook(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  if (command.includes(marker)) return true; // Existing POSIX installations.
  // PowerShell switches are case-insensitive and can be abbreviated/reordered.
  // Recognize the payload even after a launcher edit so setup rejects conflicts.
  for (const match of command.matchAll(/(?:^|\s)-([a-z]+)\s+(['"]?)([a-z0-9+/=]+)\2(?=\s|$)/gi)) {
    if (!'encodedcommand'.startsWith(match[1].toLowerCase())) continue;
    const script = Buffer.from(match[3], 'base64').toString('utf16le');
    if (/\$env:MEMORY_MANAGED\s*=\s*(['"])shared-agent-memory\1\s*;/i.test(script)) return true;
  }
  return false;
}
