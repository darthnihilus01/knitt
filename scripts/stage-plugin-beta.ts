import {cpSync,existsSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {hostFiles,copyPluginDist,type Host} from './plugin-package-lib.ts';

const version=process.argv[2]??'0.1.0-beta.6-rc.1';
if(!/^\d+\.\d+\.\d+-[a-zA-Z0-9.-]+$/.test(version))throw Error('Use an explicit prerelease version');
const target=`${process.platform}-${process.arch}`;
const out=resolve('plugin-artifacts/release-candidate',version);mkdirSync(out,{recursive:true});
const assets=[];
for(const host of ['codex','claude-code'] as Host[]){
 const source=resolve('plugin-artifacts',target,'plugins',host,'knitt');
 if(!existsSync(join(source,'runtime-provenance.json')))throw Error('Build and verify the native artifacts first');
 const name=`knitt-${host}-${target}-${version}`;
 const root=join(out,name),plugin=join(root,'plugins','knitt');
 if(existsSync(root)){
  if(!process.argv.includes('--replace-draft'))throw Error('Candidate already exists: '+root);
  rmSync(root,{recursive:true});
 }
 cpSync(source,plugin,{recursive:true});
 rmSync(join(plugin,'dist'),{recursive:true});
 copyPluginDist(resolve('dist'),join(plugin,'dist'));
 for(const [path,contents] of Object.entries(hostFiles(host,target,version))){
  mkdirSync(dirname(join(plugin,path)),{recursive:true});writeFileSync(join(plugin,path),contents);
 }
 const entry={name:'knitt',source:{source:'local',path:'./plugins/knitt'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'};
 if(host==='codex'){
  mkdirSync(join(root,'.agents','plugins'),{recursive:true});
  writeFileSync(join(root,'.agents','plugins','marketplace.json'),JSON.stringify({name:'knitt-beta',interface:{displayName:'Knitt beta'},plugins:[entry]},null,2)+'\n');
 }else{
  mkdirSync(join(root,'.claude-plugin'),{recursive:true});
  writeFileSync(join(root,'.claude-plugin','marketplace.json'),JSON.stringify({name:'knitt-beta',owner:{name:'Knitt'},plugins:[{name:'knitt',source:'./plugins/knitt',description:'Continue coding conversations across agents'}]},null,2)+'\n');
 }
 cpSync('plugins/skills',join(plugin,'skills'),{recursive:true});
 const instructions=`# Knitt ${version}\n\nRelease candidate for ${host} on ${target}. Native capture and two-account handoff remain release gates; this is not a verified public release.\n\nFor Codex desktop: extract this folder, open it as a project in Codex, restart the app, and choose Knitt beta in the Plugins Directory source picker. Install Knitt and review its hooks. Then open your real project and run Knitt setup inside the agent. Account sign-in and project-history consent are separate approvals. No terminal command or configuration edit is required.\n\nFor Claude Code: select this extracted marketplace folder through the host's plugin interface where local sources are supported. Native host UI installation must be verified before release.\n\nRemoving or updating the plugin preserves Knitt account credentials and memory outside the plugin folder. A website account alone does not connect an agent installation.\n`;
 writeFileSync(join(root,'README.md'),instructions);
 const archive=join(out,name+'.zip');
 rmSync(archive,{force:true});
 execFileSync('zip',['-q','-r',archive,'.'],{cwd:root});
 const sha256=createHash('sha256').update(readFileSync(archive)).digest('hex');
 writeFileSync(archive+'.sha256',sha256+'  '+name+'.zip\n');
 assets.push({host,target,version,name:name+'.zip',sha256,status:'candidate'});
 console.log('Staged',name+'.zip');
}
writeFileSync(join(out,'candidate.json'),JSON.stringify({version,status:'draft',assets},null,2)+'\n');
