import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { hookCommand, isManagedHook, npmCommand } from '../packages/installer/src/platform.ts';

// Catch npm.cmd execution or shell interpolation of package specifications.
test('Windows npm discovery runs the npm JS entry point with literal arguments', () => {
  const root = mkdtempSync(join(tmpdir(), "npm ' ü & "));
  try {
    const bin = join(root, 'node_modules/npm/bin');
    mkdirSync(bin, { recursive: true });
    const cli = join(bin, 'npm-cli.js');
    writeFileSync(cli, 'console.log(JSON.stringify(process.argv.slice(2)))');
    const invocation = npmCommand(['install', 'pkg & echo bad', '%APPDATA%', '$(whoami)'], {
      platform: 'win32', env: { npm_execpath: cli, PATH: root }, node: process.execPath,
    });
    assert.equal(invocation.command, process.execPath);
    assert.deepEqual(JSON.parse(execFileSync(invocation.command, invocation.args, { encoding: 'utf8' })),
      ['install', 'pkg & echo bad', '%APPDATA%', '$(whoami)']);
    const fromPath = npmCommand(['--version'], { platform: 'win32', node: join(root, 'missing/node.exe'), env: { Path: '"' + root + '"' } });
    assert.deepEqual(fromPath.args, [cli, '--version']);
    assert.throws(() => npmCommand([], { platform: 'win32', node: join(root, 'missing/node.exe'), env: {} }), /npm.*not found|locate npm/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('npm launched through npx resolves its sibling npm-cli entry point', () => {
  const root = mkdtempSync(join(tmpdir(), 'npx-entry-'));
  try {
    writeFileSync(join(root, 'npm-cli.js'), 'console.log(process.argv[2])');
    const invocation = npmCommand(['--version'], { platform: 'win32', node: process.execPath, env: { npm_execpath: join(root, 'npx-cli.js') } });
    assert.equal(execFileSync(invocation.command, invocation.args, { encoding: 'utf8' }).trim(), '--version');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const platform of ['linux', 'darwin', 'win32'] as const) {
  test(`${platform} hooks identify ownership without treating unrelated hooks as managed`, () => {
    const command = hookCommand({ MEMORY_MANAGED: 'shared-agent-memory', MEMORY_DB: "data ' ü & %PATH% $home" }, process.execPath, ['runner.js', 'recall', 'codex'], platform);
    assert.equal(isManagedHook(command), true);
    assert.equal(isManagedHook(command + ' user-change'), true);
    if (platform === 'win32') {
      assert.equal(isManagedHook(command.replace('-NoLogo', '-nologo -ExecutionPolicy Bypass')), true);
      assert.equal(isManagedHook(command.replace('-EncodedCommand', '-enc')), true);
    }
    assert.equal(isManagedHook('env MEMORY_QUEUE=other unrelated-tool'), false);
  });
}

// Run on the real host shell; CI repeats this test on all three OS runners.
test('native hooks preserve stdin, Unicode, literal environment values and exit status', () => {
  const root = mkdtempSync(join(tmpdir(), "hook ' ü & % literal "));
  try {
    const runner = join(root, 'runner.js');
    writeFileSync(runner, `const fs = require('node:fs'); console.log(JSON.stringify({ input: fs.readFileSync(0, 'utf8'), value: process.env.VALUE, args: process.argv.slice(2) })); process.exitCode = 7;`);
    const value = "literal ' ü & %PATH% $HOME `echo bad`";
    const command = hookCommand({ VALUE: value }, process.execPath, [runner, value]);
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command];
    const result = spawnSync(shell, args, { input: 'hello ü\n', encoding: 'utf8' });
    assert.equal(result.status, 7, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { input: 'hello ü\n', value, args: [value] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
