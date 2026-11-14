import {serveStdio} from '@modelcontextprotocol/server/stdio';
import type {McpRuntimeOptions} from './config.ts';
import {LifeOSApiClient} from './client.ts';
import {createLifeOSMcpServer} from './tools.ts';
import type {FileReceiver} from '../file-handoff/receiver.ts';
/** Only a separately reviewed trusted host wrapper injects configuration and credentials. */
export function serveLifeOSMcp(options:McpRuntimeOptions,fileReceiver?:FileReceiver){
 const client=new LifeOSApiClient(options);
 const handle=serveStdio(()=>createLifeOSMcpServer({client,fileReceiver}),{onerror:()=>{process.stderr.write('MCP_PROTOCOL_ERROR\n');}});
 process.stdin.once('end',()=>{void handle.close();});
 return handle;
}
