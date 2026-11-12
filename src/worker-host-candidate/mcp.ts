import {Server} from '@modelcontextprotocol/server';
import {ToolSchema} from '@modelcontextprotocol/core';
import {serveStdio,StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import {z} from 'zod';
import {workerToolInputSchemas,type WorkerChannel} from './channel.ts';

const commands={read_assigned:'read',claim_assigned:'claim',renew_assigned:'renew',progress_assigned:'progress'} as const;
/** Host-constructed, per-assignment channel only. No credential/config loader. */
export function createAssignedWorkerMcpServer(channel:WorkerChannel):Server{
 const server=new Server({name:'lifeos-assigned-worker',version:'0.1.0'},{capabilities:{tools:{}}});
 server.setRequestHandler('tools/list',async()=>({tools:Object.entries(workerToolInputSchemas).map(([name,schema])=>ToolSchema.parse({name,description:name==='read_assigned'?'Read the one assigned current requirement.':'Use the assigned current fenced workflow channel; independent receipt/readback remains required.',inputSchema:{...z.toJSONSchema(schema),type:'object'},annotations:{readOnlyHint:name==='read_assigned',openWorldHint:false}}))}));
 server.setRequestHandler('tools/call',async request=>{
  const name=request.params.name as keyof typeof commands,schema=Object.hasOwn(workerToolInputSchemas,name)?workerToolInputSchemas[name]:undefined;
  const parsed=schema?.safeParse(request.params.arguments??{});
  if(!parsed?.success)return{isError:true,content:[{type:'text' as const,text:'WORKER_COMMAND_REJECTED'}]};
  try{
   const result=await channel.handle({command:commands[name],...parsed.data});
   return{isError:!result.ok,structuredContent:result,content:[{type:'text' as const,text:result.ok?'Read structuredContent and independent verification.':'WORKER_COMMAND_FAILED'}]};
  }catch{return{isError:true,content:[{type:'text' as const,text:'WORKER_COMMAND_REJECTED'}]};}
 });
 server.onerror=()=>{};return server;
}
export function serveAssignedWorkerStdio(channel:WorkerChannel){
 const handle=serveStdio(()=>createAssignedWorkerMcpServer(channel),{transport:new StdioServerTransport(process.stdin,process.stdout,{maxBufferSize:65536}),onerror:()=>{}});
 process.stdin.once('end',()=>{void handle.close();});return handle;
}
