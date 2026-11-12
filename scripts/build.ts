import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, rmSync } from 'node:fs';
rmSync('dist', { recursive: true, force: true });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
mkdirSync('dist/skills/continue-chat', { recursive: true });
copyFileSync('skills/continue-chat/SKILL.md', 'dist/skills/continue-chat/SKILL.md');
