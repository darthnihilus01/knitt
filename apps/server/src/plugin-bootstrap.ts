import {createHash} from 'node:crypto';
import {realpathSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {z} from 'zod';
import {defaultHome} from '../../../packages/installer/src/runtime.ts';
import {createMemoryServer} from './server.ts';

// Portable hosts launch stdio servers in the installed plugin directory. Only
// host-supplied roots or an explicitly approved selection may bind a project.
export function createPluginApp(env:NodeJS.ProcessEnv, transport:Transport) {
 const home=env.KNITT_HOME??defaultHome();
 const server=new McpServer({name:'knitt',version:'0.1.0'},{capabilities:{tools:{listChanged:true}}});
 let app:ReturnType<typeof createMemoryServer>|undefined;
 let ready:()=>void=()=>{};
 const initialized=new Promise<void>(resolve=>{ready=resolve;});
 let fallbackStatus:ReturnType<McpServer['registerTool']>|undefined;
 let fallbackSelect:ReturnType<McpServer['registerTool']>|undefined;
 function bind(path:string){
  const workspace=realpathSync(path);
  if(!statSync(workspace).isDirectory())throw new Error('Choose a project directory');
  if(app)throw new Error('Reconnect Knitt to change the active project');
  fallbackStatus?.remove();fallbackSelect?.remove();
  app=createMemoryServer({...env,SHARED_MEMORY_HOME:home,MEMORY_WORKSPACE:workspace,
   MEMORY_REPO:'workspace:'+createHash('sha256').update(workspace).digest('hex'),
   MEMORY_CLIENT:env.MEMORY_CLIENT??env.KNITT_CLIENT??'claude',
   MEMORY_DB:join(home,'data','events.sqlite'),MEMORY_SESSION_SELECTION:'1'},
   {server,inChatPicker:true,preferChatPicker:true});
  return workspace;
 }
 server.server.oninitialized=async()=>{
  try{
   if(env.MEMORY_WORKSPACE)bind(env.MEMORY_WORKSPACE);
   else{
    if(!server.server.getClientCapabilities()?.roots)throw new Error('Agent did not supply a project root');
    const response=await server.server.listRoots({}, {timeout:10_000});
    const paths=[...new Set(response.roots.filter(r=>r.uri.startsWith('file:')).map(r=>realpathSync(fileURLToPath(r.uri))))];
    if(paths.length!==1)throw new Error('Choose the current project explicitly');
    bind(paths[0]!);
   }
  }catch(error){
   const reason=error instanceof Error?error.message:String(error);
   fallbackStatus=server.registerTool('knitt_status',{
    description:'Check Knitt setup. The agent must supply or explicitly select the current project.',inputSchema:{}
   },async()=>({content:[{type:'text',text:reason}],structuredContent:{setupRequired:'select_project',setupState:'project_selection_required',statusMessage:'Project selection required',nextAction:'Show the actual current project directory and ask the user to confirm it before knitt_set_workspace. Never select the plugin installation directory.',reason}}));
   fallbackSelect=server.registerTool('knitt_set_workspace',{
    description:'Select the current project only after the user confirms its canonical location. Does not enable cloud sync.',
    inputSchema:{workspace:z.string().min(1),userApproved:z.literal(true)}
   },async({workspace})=>{
    const selected=bind(workspace);
    return {content:[{type:'text',text:'Project selected. Continue Knitt setup.'}],structuredContent:{workspace:selected}};
   });
  }finally{ready();}
 };
 // Delay tool discovery while roots are requested, but allow roots responses
 // through immediately so initialization cannot deadlock.
 const gated:Transport={
  async start(){
   transport.onmessage=(message,extra)=>{
    if('method' in message && ['tools/list','tools/call'].includes(message.method))
     void initialized.then(()=>gated.onmessage?.(message,extra));
    else gated.onmessage?.(message,extra);
   };
   transport.onclose=()=>gated.onclose?.();transport.onerror=error=>gated.onerror?.(error);
   await transport.start();
  },
  send:(message,options)=>transport.send(message,options),
  close:()=>transport.close()
 };
 return {server,connect:()=>server.connect(gated),async close(){await server.close();app?.close();}};
}
