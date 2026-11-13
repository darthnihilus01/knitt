import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
const root = mkdtempSync(join(tmpdir(), "memory package ' ü "));
const run = (command: string, args: string[], cwd = root) => execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 180_000 });
try {
  const report = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], process.cwd()));
  const packed = Array.isArray(report) ? report[0] : Object.values(report)[0] as any;
  const files = packed.files.map((f: any) => f.path) as string[];
  assert.ok(files.includes('dist/packages/installer/src/cli.js'));
  assert.ok(files.includes('LICENSE'), 'Apache license missing from npm archive');
  assert.ok(files.includes('dist/skills/continue-chat/SKILL.md'));
  assert.ok(!files.some(p => /(^|\/)(\.memory|tests|node_modules)(\/|$)/.test(p) || /\.(sqlite|py|ts)$/.test(p)));
  for (const file of files) {
    const source = resolve(file);
    if (existsSync(source)) assert.ok(!/(?:\/home\/[^/\s]+\/|\/Users\/[^/\s]+\/)/.test(readFileSync(source, 'utf8')), 'Personal path in package: ' + file);
  }
  const archive = join(root, packed.filename), bootstrap = join(root, 'temporary bootstrap');
  const npxCache = join(root, 'temporary npx cache');
  assert.equal(run('npm', ['exec', '--yes', '--cache', npxCache, '--package', archive, '--', 'knitt', '--version']).trim(), packageVersion);
  rmSync(npxCache, { recursive: true, force: true });
  run('npm', ['install', '--prefix', bootstrap, '--ignore-scripts', '--no-audit', '--no-fund', archive]);
  const cli = join(bootstrap, 'node_modules/@tinchu0/knitt/dist/packages/installer/src/cli.js');
  assert.equal(run(process.execPath, [cli, '--version']).trim(), packageVersion);
  const workspace = join(root, 'consumer project'), home = join(root, 'permanent home');
  run('git', ['init', '--initial-branch=main', workspace]);
  mkdirSync(join(workspace, '.claude'));
  writeFileSync(join(workspace, '.mcp.json'), '{"mcpServers":{"existing":{"command":"keep"}}}');
  const base = ['setup', '--workspace', workspace, '--client', 'claude-code', '--client', 'codex', '--home', home, '--package', archive];
  run(process.execPath, [cli, ...base, '--preview']);
  assert.equal(existsSync(home), false, 'Preview wrote installation files');
  run(process.execPath, [cli, ...base, '--yes']);
  const state = () => JSON.parse(readFileSync(join(home, 'installation.json'), 'utf8'));
  const durableCli = join(state().current.appRoot, 'packages/installer/src/cli.js');
  rmSync(bootstrap, { recursive: true, force: true });
  const config = JSON.parse(readFileSync(join(workspace, '.mcp.json'), 'utf8'));
  assert.ok(config.mcpServers['shared-memory'].args[0].startsWith(home));
  assert.ok(run(process.execPath, [durableCli, 'doctor', '--home', home]).includes('configured'));
  const client = new Client({ name: 'tarball-smoke', version: '1' });
  await client.connect(new StdioClientTransport({ command: config.mcpServers['shared-memory'].command, args: config.mcpServers['shared-memory'].args, env: { ...process.env as Record<string,string>, ...config.mcpServers['shared-memory'].env }, stderr: 'pipe' }));
  try { assert.ok((await client.listTools()).tools.some(t => t.name === 'choose_conversation')); }
  finally { await client.close(); }
  // The packaged capture/recall hook must execute from the durable installation.
  const hooks = JSON.parse(readFileSync(join(workspace, '.claude/settings.local.json'), 'utf8'));
  const hook = spawnSync('/bin/sh', ['-c', hooks.hooks.SessionStart[0].hooks[0].command], { cwd: workspace, input: JSON.stringify({ session_id: 'fresh-package-session', cwd: workspace }), encoding: 'utf8' });
  assert.equal(hook.status, 0, hook.stderr); assert.ok(hook.stdout.includes('choose_conversation'));
  const memory = join(home, 'data/preserved.txt'); writeFileSync(memory, 'keep across lifecycle');
  const first = state().current.appRoot;
  run(process.execPath, [durableCli, 'update', '--home', home, '--package', archive, '--yes']);
  assert.notEqual(state().current.appRoot, first);
  const updated = join(state().current.appRoot, 'packages/installer/src/cli.js');
  run(process.execPath, [updated, 'rollback', '--home', home, '--yes']);
  assert.equal(state().current.appRoot, first);
  const beforeFailure = readFileSync(join(home, 'installation.json'), 'utf8');
  const failed = spawnSync(process.execPath, [durableCli, 'update', '--home', home, '--package', join(root, 'missing.tgz'), '--yes'], { encoding: 'utf8' });
  assert.notEqual(failed.status, 0); assert.equal(readFileSync(join(home, 'installation.json'), 'utf8'), beforeFailure);
  const changed = JSON.parse(readFileSync(join(workspace, '.mcp.json'), 'utf8'));
  changed.mcpServers.later = { command: 'keep too' }; writeFileSync(join(workspace, '.mcp.json'), JSON.stringify(changed));
  run(process.execPath, [durableCli, 'uninstall', '--workspace', workspace, '--home', home, '--yes']);
  const remaining = JSON.parse(readFileSync(join(workspace, '.mcp.json'), 'utf8'));
  assert.deepEqual(Object.keys(remaining.mcpServers).sort(), ['existing', 'later']);
  assert.equal(readFileSync(memory, 'utf8'), 'keep across lifecycle');
  console.log('PASS: clean tarball installation, bootstrap removal, MCP, hook recall, doctor, update, rollback, failure preservation and uninstall');
} finally { rmSync(root, { recursive: true, force: true }); }
