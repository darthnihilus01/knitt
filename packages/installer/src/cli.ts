#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve, dirname, basename, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, accessSync, constants, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { planConnection, applyConnectionPlan, planUninstall, clients, atomicWrite, readConnectionState, rollbackConnectionPlan, type ConnectionPlan } from './connections.ts';
import { installRuntime, readInstallation, defaultHome, runtimePaths, withInstallLock, activateRuntime, packageName, type Project, type Runtime } from './runtime.ts';
import { planAntigravity, verifyAntigravity, defaultAntigravityConfig } from './antigravity.ts';
import { antigravityServerName } from '../../adapters/src/server-name.ts';
import { resolveRepository } from '../../adapters/src/repository.ts';
const appRoot = fileURLToPath(new URL('../../../', import.meta.url));
const packageRoot = existsSync(join(appRoot, 'package.json')) ? appRoot : dirname(appRoot);
const metadata = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const version = metadata.version as string;

function detectCodingAgents() {
  const home = homedir();
  const path = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const suffixes = process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
  const candidates = [
    { client: 'codex', executable: 'codex', directories: [process.env.CODEX_HOME ?? join(home, '.codex')] },
    { client: 'claude-code', executable: 'claude', directories: [process.env.CLAUDE_CONFIG_DIR ?? join(home, '.claude')] },
    { client: 'antigravity', executable: 'antigravity', directories: ['antigravity', 'antigravity-cli', 'antigravity-ide'].map(name => join(home, '.gemini', name)) },
  ];
  return candidates.filter(({ executable, directories }) => directories.some(existsSync) ||
    path.some(directory => suffixes.some(suffix => existsSync(join(directory, executable + suffix))))
  ).map(({ client }) => client);
}

async function confirm(text: string, yes = false) {
  if (yes) return true;
  if (!process.stdin.isTTY) throw new Error('Use --yes for noninteractive apply, or --preview to inspect without changes');
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try { return /^y(es)?$/i.test((await reader.question(text + ' [y/N] ')).trim()); }
  finally { reader.close(); }
}
async function ask(prompt: string) {
  if (!process.stdin.isTTY) throw new Error('Pass --workspace and --client for noninteractive setup');
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await reader.question(prompt)).trim(); } finally { reader.close(); }
}
function preview(plan: ConnectionPlan, contents = true) {
  for (const [path, content] of Object.entries(plan.changes)) {
    if (path.includes('npm-connection')) continue;
    console.log((content === null ? 'remove ' : 'merge ') + join(plan.workspace, path));
    if (contents && content !== null && content !== plan.expected[path]) console.log(content);
  }
}
async function applyAll(plans: ConnectionPlan[], commit: () => void, verify: () => Promise<void> = async () => {}) {
  const done: ConnectionPlan[] = [];
  try { for (const plan of plans) { applyConnectionPlan(plan); done.push(plan); } await verify(); commit(); }
  catch (error) {
    for (const plan of done.reverse()) rollbackConnectionPlan(plan);
    throw error;
  }
}
function plansFor(runtime: Runtime, projects: Project[], installationHome: string) { return projects.map(project => planConnection({ ...project, appRoot: runtime.appRoot, node: runtime.node, installationHome })); }

async function main() {
  if (process.argv[2] === 'cloud') {
    const { runCloud } = await import('./cloud-cli.ts');
    return runCloud(process.argv.slice(3));
  }
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    workspace: { type: 'string' }, client: { type: 'string', multiple: true }, home: { type: 'string' },
    package: { type: 'string' }, yes: { type: 'boolean' }, preview: { type: 'boolean' },
    'antigravity-config': { type: 'string' }, version: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.version) { console.log(version); return; }
  const plugin = positionals[0] === 'plugin';
  const action = plugin ? 'setup' : positionals[0];
  if (!action || values.help) {
    console.log('Knitt ' + version + '\nCommands: plugin, setup, doctor, update, rollback, uninstall, serve, cloud\nRun knitt plugin in a Git project to connect detected coding agents.\nUse knitt cloud --help for pairing and publication.\nOptions: --workspace PATH --client codex|claude-code|antigravity|claude-desktop (repeatable)\n         --preview --yes --home PATH --package TARBALL_OR_VERSION_SPEC\n         --antigravity-config PATH (optional global MCP config override)\nSetup configures a persistent local runtime; remote/team service is configured separately.'); return;
  }
  const home = resolve(values.home ?? defaultHome()), paths = runtimePaths(home);
  const initialState = readInstallation(home);
  const configPath = resolve(values['antigravity-config'] ?? initialState?.antigravityConfig ?? defaultAntigravityConfig());
  const globalOptions = (runtime: Runtime, projects: Project[]) => ({ configPath, installationHome: home, appRoot: runtime.appRoot, node: runtime.node, projects });
  if (initialState?.antigravityConfig && configPath !== resolve(initialState.antigravityConfig)) throw new Error('This installation already manages another Antigravity config. Use its existing path: ' + initialState.antigravityConfig);
  if (action === 'serve') {
    process.env.MEMORY_DB ??= join(paths.data, 'events.sqlite');
    await import('../../../apps/server/src/main.ts'); return;
  }
  if (action === 'doctor') {
    const state = readInstallation(home), problems: string[] = [];
    if (Number(process.versions.node.split('.')[0]) < 24) problems.push('Install Node.js 24+');
    try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { problems.push('Install Git and add it to PATH'); }
    if (!state) problems.push('No persistent runtime installed. Run setup.');
    else {
      for (const file of [state.current.node, join(state.current.appRoot, 'apps/server/src/main.js')]) if (!existsSync(file)) problems.push('Missing runtime path: ' + file + '. Run setup again.');
      try { accessSync(paths.data, constants.W_OK); } catch { problems.push('Data directory is not writable: ' + paths.data); }
      try {
        const globalPlan = planAntigravity(globalOptions(state.current, state.projects));
        const before = globalPlan.expected[basename(configPath)];
        const servers = before ? JSON.parse(before).mcpServers ?? {} : {};
        for (const project of state.projects.filter(p => p.clients.includes('antigravity'))) {
          if (!servers[antigravityServerName(project.workspace)]) problems.push('Missing Antigravity server: ' + project.workspace);
        }
      } catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
      for (const project of state.projects) {
        try {
          const managed = readConnectionState(project.workspace);
          if (!Object.keys(managed.files).length) problems.push('Missing connector state: ' + project.workspace);
          for (const [path, snapshot] of Object.entries(managed.files)) {
            const current = readFileSync(join(project.workspace, path), 'utf8');
            if (current !== snapshot.after) problems.push('Configuration changed; review before setup: ' + join(project.workspace, path));
          }
        } catch { problems.push('Missing or invalid project configuration: ' + project.workspace); }
      }
    }
    console.log(JSON.stringify({ status: problems.length ? 'attention_required' : 'configured', runtime: state?.current.version, problems, note: 'Configuration check only; agent login/trust and live handoff are not verified.' }, null, 2));
    if (problems.length) process.exitCode = 1; return;
  }
  if (!['setup', 'update', 'rollback', 'uninstall'].includes(action)) throw new Error('Unknown command: ' + action);
  let project: Project | undefined;
  if (action === 'setup') {
    const directory = values.workspace ?? (plugin ? process.cwd() : await ask('Project folder: '));
    const { workspace, repoId } = resolveRepository(resolve(directory));
    let selected = values.client;
    if (!selected && plugin) {
      selected = detectCodingAgents();
      if (!selected.length) throw new Error('No coding agents detected. Run knitt plugin with --client codex, --client claude-code, or --client antigravity to choose one explicitly.');
      if (process.stdin.isTTY && !values.yes && !values.preview) {
        const answer = await ask('Agents to connect [' + selected.join(', ') + '] (Enter to accept, or type a comma-separated list): ');
        if (answer) selected = answer.split(',').map(value => value.trim());
      }
      console.log('Connecting ' + selected.join(', ') + ' for ' + workspace);
    }
    selected ??= (await ask('Agents (comma separated: ' + clients.join(', ') + '): ')).split(',').map(v => v.trim());
    project = { workspace, repoId, clients: selected, database: join(paths.data, 'events.sqlite') };
    // Validate and show changes before installing dependencies or writing settings.
    const plan = planConnection({ ...project, appRoot, installationHome: home }); preview(plan);
    const projects = [...(initialState?.projects ?? []).filter(p => p.workspace !== project!.workspace), { ...project, clients: [...new Set([...(initialState?.projects.find(p => p.workspace === project!.workspace)?.clients ?? []), ...project.clients])] }];
    preview(planAntigravity(globalOptions({ version, appRoot, node: process.execPath }, projects)), false);
    if (values.preview) { console.log('Preview only. No runtime or configuration installed.'); return; }
  } else {
    const state = readInstallation(home); if (!state) throw new Error('No installation found. Run setup first.');
    if (action === 'uninstall') {
      const target = values.workspace ? resolveRepository(resolve(values.workspace)).workspace : null;
      if (!target) throw new Error('Pass --workspace to uninstall one project; memory data is always retained');
      if (!state.projects.some(p => p.workspace === target)) throw new Error('Project is not managed by this installation');
      preview(planUninstall(target));
      preview(planAntigravity({ ...globalOptions(state.current, state.projects.filter(p => p.workspace !== target)), removeOnly: true }), false);
    } else console.log(action + ' runtime for ' + state.projects.length + ' project(s); user memory is retained.');
    if (values.preview) return;
  }
  if (!await confirm('Apply ' + action + '?', values.yes || (plugin && !process.stdin.isTTY))) { console.log('Cancelled. No changes applied.'); return; }
  await withInstallLock(home, async () => {
    const state = readInstallation(home);
    if (action === 'uninstall') {
      const target = resolveRepository(resolve(values.workspace!)).workspace;
      const plan = planUninstall(target);
      const remaining = state!.projects.filter(p => p.workspace !== target);
      await applyAll([plan, planAntigravity({ ...globalOptions(state!.current, remaining), removeOnly: true })], () => atomicWrite(paths.state, JSON.stringify({ ...state!, projects: remaining }, null, 2)));
      console.log('Project connectors removed where unchanged. User-edited settings and all memory retained. Runtime retained for other projects.'); return;
    }
    if (project) {
      const existing = state?.projects.find(p => p.workspace === project!.workspace);
      if (existing) project.clients = [...new Set([...existing.clients, ...project.clients])];
    }
    const projects = project ? [...(state?.projects ?? []).filter(p => p.workspace !== project.workspace), project] : state!.projects;
    if (action !== 'rollback' && metadata.private && !values.package) throw new Error('This package is unpublished. Pass --package /absolute/path/to/the-built.tgz; registry installation is disabled until release.');
    const runtime = action === 'rollback' ? state?.previous : installRuntime(home, values.package ?? packageName + '@' + (action === 'update' ? (metadata.publishConfig?.tag ?? 'latest') : version));
    if (!runtime) throw new Error('No previous runtime available');
    const plans = plansFor(runtime, projects, home);
    plans.push(planAntigravity(globalOptions(runtime, projects)));
    await applyAll(plans, () => activateRuntime(home, runtime, projects, projects.some(p => p.clients.includes('antigravity')) ? configPath : state?.antigravityConfig), () => verifyAntigravity(globalOptions(runtime, projects)));
    console.log('Installed runtime ' + runtime.version + '. Data: ' + paths.data);
    console.log('Connectors installed. Cloud history is not ready until account connection, project-history approval and initial sync are verified.');
    console.log('Restart connected agents and review MCP/hook trust prompts. Then paste this into the agent:');
    console.log('Set up Knitt cloud sync for my current project. Show me the history preview before uploading.');
    console.log('Account pairing and project-history consent are separate approvals. After verified sync, use /knit to select your conversation.');
    if (projects.some(p => p.clients.includes('antigravity'))) console.log('Antigravity: project memory servers registered in ' + configPath + ' and tool connections verified. Restart Antigravity, open the project and use /knit in a new chat.');
    if (projects.some(p => p.clients.includes('claude-desktop'))) console.log('Claude Desktop: merge the generated project .memory/connectors/claude-desktop.json fragment into Desktop MCP settings, then restart.');
  });
}
try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
