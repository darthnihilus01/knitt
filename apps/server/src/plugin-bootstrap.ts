import {createHash} from 'node:crypto';
import {realpathSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {z} from 'zod';
import {defaultHome} from '../../../packages/installer/src/runtime.ts';
import {createMemoryServer} from './server.ts';
import {registerOnboarding} from './onboarding.ts';

// Portable hosts launch stdio servers in the installed plugin directory. Only
// host-supplied roots or an explicitly approved selection may bind a project.
export function createPluginApp(env:NodeJS.ProcessEnv, transport:Transport) {
 const home=env.KNITT_HOME??defaultHome();
 const server=new McpServer({name:'knitt',version:'0.1.0'},{capabilities:{tools:{listChanged:true}}});
 let app:ReturnType<typeof createMemoryServer>|undefined;
 let ready:()=>void=()=>{};
 const initialized=new Promise<void>(resolve=>{ready=resolve;});
 let selectionReason = 'Agent did not supply a project root';
 const handlers = new Map<string, (...args: unknown[]) => unknown>();
 const unselected = () => ({content:[{type:'text' as const,text:selectionReason}],structuredContent:{setupRequired:'select_project',setupState:'project_selection_required',statusMessage:'Project selection required',nextAction:'Show the actual current project directory and ask the user to confirm it before knitt_set_workspace. Never select the plugin installation directory.',reason:selectionReason}});
 // Reuse real registration schemas without exposing a placeholder workspace or touching histories.
 function registry(target: McpServer, expose: boolean): McpServer {
  return new Proxy(target, {get(object, property) {
   if(property === 'registerTool') return (name: string, config: unknown, handler: (...args: unknown[]) => unknown) => {
    if(expose) return Reflect.apply(server.registerTool, server, [name, config, async (...args: unknown[]) => {
      if(!app) return {...unselected(), ...(name === 'knitt_status' ? {} : {isError:true})};
      const callback = handlers.get(name);
      if(!callback) throw new Error('Tool unavailable for the selected workspace');
      return callback(...args);
    }]);
    handlers.set(name, handler);
    return Reflect.apply(object.registerTool, object, [name, config, handler]);
   };
   const value = Reflect.get(object, property);
   return typeof value === 'function' ? value.bind(object) : value;
  }});
 }
 const definitions = registry(new McpServer({name:'knitt-definitions',version:'0.1.0'}), true);
 const template = createMemoryServer({MEMORY_REPO:'unselected',MEMORY_DB:':memory:',MEMORY_CLIENT:'claude',SHARED_MEMORY_HOME:home}, {server:definitions,inChatPicker:true,preferChatPicker:true});
 registerOnboarding(definitions, home, env, '');
 template.close();
 function bind(path: string) {
  const workspace = realpathSync(path);
  if(!statSync(workspace).isDirectory()) throw new Error('Choose a project directory');
  if(app) throw new Error('Reconnect Knitt to change the active project');
  const backend = registry(new McpServer({name:'knitt-workspace',version:'0.1.0'}), false);
  app = createMemoryServer({...env,SHARED_MEMORY_HOME:home,MEMORY_WORKSPACE:workspace,
   MEMORY_REPO:'workspace:'+createHash('sha256').update(workspace).digest('hex'),
   MEMORY_CLIENT:env.MEMORY_CLIENT??env.KNITT_CLIENT??'claude',
   MEMORY_DB:join(home,'data','events.sqlite'),MEMORY_SESSION_SELECTION:'1'},
   {server:backend,inChatPicker:true,preferChatPicker:true});
  return workspace;
 }
 server.registerTool('knitt_set_workspace', {
  description:'Select the current project only after the user confirms its canonical location. Does not enable cloud sync.',
  inputSchema:{workspace:z.string().min(1),userApproved:z.literal(true)}
 },async ({workspace})=>{
  const selected=bind(workspace);
  return {content:[{type:'text',text:'Project selected. Continue Knitt setup.'}],structuredContent:{workspace:selected}};
 });
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
   selectionReason=error instanceof Error?error.message:String(error);
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
