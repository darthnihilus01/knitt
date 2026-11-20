import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { historyFixture } from './fixtures/history.ts';

// Set this path to the installed executable when checking the packed distribution.
const cli = resolve(process.env.KNITT_TEST_CLI ?? 'packages/installer/src/cli.ts');
for (const agent of ['codex', 'claude', 'antigravity']) test(agent + ' can prepare and narrow a publication entirely offline', () => {
  const f = historyFixture();
  const env = { ...process.env, SHARED_MEMORY_HOME: join(f.root, 'account'), MEMORY_HISTORY_ROOTS: JSON.stringify(f.roots) };
  const run = (...args: string[]) => execFileSync(process.execPath, [cli, 'cloud', 'publish', ...args], { encoding: 'utf8', env });
  try {
    const base = ['--workspace', f.workspace, '--source', agent + ':same-id'];
    const choices = JSON.parse(run('list', '--workspace', f.workspace));
    assert.deepEqual(choices.map((choice: {source:string}) => choice.source).sort(), ['antigravity:same-id', 'claude:same-id', 'codex:same-id']);
    const evidence = JSON.parse(run('excerpts', ...base)) as {id:string;text:string}[];
    assert.ok(evidence.length > 0);
    const draft = join(f.root, 'review.json');
    run('prepare', ...base, '--checkpoint', 'Edited checkpoint', '--excerpt', evidence[0].id, '--draft', draft);
    const preview = JSON.parse(run('show', '--draft', draft));
    assert.equal(preview.checkpoint, 'Edited checkpoint');
    assert.equal(preview.source.agent, agent);
    assert.deepEqual(preview.excerpts, [{text:evidence[0].text}]);
    for (const denied of [f.workspace, 'PRIVATE TOOL OUTPUT', 'PRIVATE REASONING', 'PRIVATE OTHER PROJECT', 'secret-value']) assert.ok(!JSON.stringify(preview).includes(denied));
    assert.ok(JSON.parse(readFileSync(draft, 'utf8')).publicationKey);
    assert.notEqual(spawnSync(process.execPath, [cli, 'cloud', 'publish', 'submit', '--draft', draft], {env}).status, 0);
  } finally { rmSync(f.root, {recursive:true, force:true}); }
});
