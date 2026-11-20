import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, rmSync } from 'node:fs';
rmSync('dist', { recursive: true, force: true });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
mkdirSync('dist/skills/knit', { recursive: true });
copyFileSync('skills/knit/SKILL.md', 'dist/skills/knit/SKILL.md');
