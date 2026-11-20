import {cpSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {codexDirectoryFiles} from './plugin-package-lib.ts';

// This is a publisher's submission artifact. It does not register or publish
// anything in OpenAI's directory, and does not change the manual beta release.
const version='0.1.0-beta.6-directory.2';
const target='linux-x64';
const source=resolve('plugin-artifacts/release-candidate/0.1.0-beta.6-rc.1/knitt-codex-linux-x64-0.1.0-beta.6-rc.1/plugins/knitt');
if(!existsSync(join(source,'runtime-provenance.json')))throw Error('Build the verified runtime first');
const out=resolve('plugin-artifacts/openai-submission',version);
const plugin=join(out,'knitt');
if(existsSync(plugin))throw Error('Submission artifact already exists; preserve it or choose a new version');
mkdirSync(out,{recursive:true});cpSync(source,plugin,{recursive:true});
rmSync(join(plugin,'hooks'),{recursive:true,force:true});
rmSync(join(plugin,'dist/apps/server/src/plugin-hook.js'),{force:true});
for(const [path,contents] of Object.entries(codexDirectoryFiles(target,version))){
 mkdirSync(dirname(join(plugin,path)),{recursive:true});writeFileSync(join(plugin,path),contents);
}
const setupPath=join(plugin,'skills/knitt-setup/SKILL.md');
const setup=readFileSync(setupPath,'utf8').replace(" Ask the user to review and trust native plugin hooks in the host UI where required.","");
writeFileSync(setupPath,setup+'\nThis directory package has no lifecycle hooks. Automatic synchronization runs while the local MCP adapter is running, including periodic imports of approved histories. Do not promise uploads while it is stopped.\n');
const archive=join(out,`knitt-openai-desktop-${target}-${version}.zip`);
execFileSync('zip',['-q','-r',archive,'.'],{cwd:plugin});
const sha256=createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync(archive+'.sha256',sha256+'  '+archive.split('/').at(-1)+'\n');
console.log('Prepared publisher upload package:',archive);
console.log('Not submitted: organization allowlisting, verified publisher identity and OpenAI review are required.');
