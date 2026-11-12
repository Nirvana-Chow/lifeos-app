import {Server,ProtocolError} from '@modelcontextprotocol/server';
import {ToolSchema} from '@modelcontextprotocol/core';
import {z} from 'zod';
import {DurableMcpClient,type DurableMcpResult} from './client.ts';
import {intersectDefinitions,localDefinitions} from './contracts.ts';

const discoverSchema=z.union([z.strictObject({}),z.strictObject({view:z.literal('index')}),z.strictObject({operationId:z.string().min(1).max(100)})]);
const callSchema=z.strictObject({operationId:z.string().min(1).max(100),arguments:z.record(z.string(),z.unknown())});
function result(value:DurableMcpResult){
 return{content:[{type:'text' as const,text:value.outcome==='unknown'?'Outcome unknown. Preserve the complete original arguments and idempotency key. Recover only with the identical lifeos_call; a different key is a new command, not recovery.':value.ok?'The confirmed API receipt, server readback and separate local readback are in structuredContent.':value.error??'API_ERROR'}],structuredContent:value,isError:!value.ok};
}
/** Official SDK adapter only. A separately reviewed host must inject the durable client. */
export function createDurableServer({client}:{client:DurableMcpClient}):Server{
 const server=new Server({name:'lifeos-durable-server-candidate',version:'0.1.0'},{capabilities:{tools:{}}});
 server.setRequestHandler('tools/list',async()=>{
  try{
   const operations=intersectDefinitions(localDefinitions,await client.discover({}));
   const tools=[ToolSchema.parse({name:'lifeos_discover',description:'Discover fresh authorized LifeOS operations, an index, or one complete operation schema.',inputSchema:{...z.toJSONSchema(discoverSchema),type:'object'},annotations:{readOnlyHint:true,openWorldHint:false}})];
   if(operations.length)tools.push(ToolSchema.parse({name:'lifeos_call',description:'Call a currently authorized reviewed operation. Preserve complete original arguments and key for unknown recovery. Confirmed receipts and server/local GET evidence remain separate; no retry tool is available.',inputSchema:{type:'object',oneOf:operations.map(operation=>({type:'object',properties:{operationId:{type:'string',const:operation.id},arguments:operation.inputSchema},required:['operationId','arguments'],additionalProperties:false}))},annotations:{readOnlyHint:operations.every(operation=>operation.method==='GET'),openWorldHint:false}}));
   return{tools};
  }catch{throw new ProtocolError(-32603,'API_DISCOVERY_UNAVAILABLE');}
 });
 server.setRequestHandler('tools/call',async request=>{
  const input=request.params.arguments??{};
  if(request.params.name==='lifeos_discover'){
   const parsed=discoverSchema.safeParse(input);
   if(!parsed.success)return result({ok:false,status:400,error:'INVALID_ARGUMENTS'});
   try{return{content:[{type:'text' as const,text:'Current authorized operations and exact argument structures are in structuredContent.'}],structuredContent:await client.discover(parsed.data),isError:false};}
   catch(error){
    const unavailable=error instanceof Error&&error.message==='OPERATION_UNAVAILABLE';
    return result({ok:false,status:unavailable?403:503,error:unavailable?'OPERATION_UNAVAILABLE':'API_DISCOVERY_UNAVAILABLE'});
   }
  }
  if(request.params.name!=='lifeos_call')return result({ok:false,status:403,error:'OPERATION_UNAVAILABLE'});
  const parsed=callSchema.safeParse(input);
  return parsed.success?result(await client.execute(parsed.data.operationId,parsed.data.arguments)):result({ok:false,status:400,error:'INVALID_ARGUMENTS'});
 });
 server.onerror=()=>{};
 return server;
}
