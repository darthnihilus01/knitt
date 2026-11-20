import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createPluginApp} from './plugin-bootstrap.ts';
const app=createPluginApp(process.env,new StdioServerTransport());
await app.connect();
let closed=false;
async function close(){if(closed)return;closed=true;await app.close();}
process.on('SIGINT',()=>{void close();});
process.on('SIGTERM',()=>{void close();});
process.stdin.on('end',()=>{void close();});
