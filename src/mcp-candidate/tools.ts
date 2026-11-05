import {Server,ProtocolError} from '@modelcontextprotocol/server';
import {ToolSchema} from '@modelcontextprotocol/core';
import {z} from 'zod';
import {LifeOSApiClient,type OperationResult} from './client.ts';
import {argumentSchema} from './schemas.ts';
const discoverSchema=z.strictObject({});
const callSchema=z.strictObject({operationId:z.string().min(1).max(100),arguments:z.record(z.string(),z.unknown())});
const retrySchema=z.strictObject({requestId:z.uuid()});
function result(value:OperationResult){return{content:[{type:'text' as const,text:value.ok?'Read structuredContent for the API result and independent readback.':(value.error??'API_ERROR')+(value.outcome==='unknown'?'; preserve the original command and use its recovery requestId.':'')}],structuredContent:value,isError:!value.ok};}
/** Reuses the inherited official low-level Server for a fresh, asynchronous current-grant list. */
export function createLifeOSMcpServer({client}:{client:LifeOSApiClient}):Server{
 const server=new Server({name:'lifeos-local-adapter',version:'0.1.0'},{capabilities:{tools:{}}});
 server.setRequestHandler('tools/list',async()=>{
  try{
   const catalog=await client.discover();
   const descriptors=[{name:'lifeos_discover',description:'Discover current authorized, ready LifeOS business operations and their exact argument schemas.',schema:discoverSchema,readOnly:true}];
   const tools=descriptors.map(d=>ToolSchema.parse({name:d.name,description:d.description,inputSchema:{...z.toJSONSchema(d.schema),type:'object'},annotations:{readOnlyHint:d.readOnly,openWorldHint:false}}));
   if(catalog.operations.length)tools.push(ToolSchema.parse({name:'lifeos_call',description:'Call one current LifeOS business operation. Discover its arguments first. The API rechecks the same credential; writes return separate readback.',inputSchema:{...z.toJSONSchema(callSchema),type:'object',properties:{...z.toJSONSchema(callSchema).properties,operationId:{type:'string',enum:catalog.operations.map(op=>op.id)}}},annotations:{readOnlyHint:catalog.operations.every(op=>op.method==='GET'||op.id==='previewTodoClassification'),openWorldHint:false}}));
   if(catalog.operations.some(op=>op.method!=='GET'&&op.id!=='previewTodoClassification'))tools.push(ToolSchema.parse({name:'lifeos_retry',description:'Explicitly retry one unknown write using its frozen original body and idempotency key. Current API authority is required again.',inputSchema:{...z.toJSONSchema(retrySchema),type:'object'},annotations:{readOnlyHint:false,openWorldHint:false}}));
   return{tools};
  }catch{throw new ProtocolError(-32603,'API_DISCOVERY_UNAVAILABLE');}
 });
 server.setRequestHandler('tools/call',async request=>{
  const args=request.params.arguments??{};
  if(request.params.name==='lifeos_discover'){
   if(!discoverSchema.safeParse(args).success)return result({ok:false,status:400,error:'INVALID_ARGUMENTS'});
   try{
    const catalog=await client.discover();
    const data={apiVersion:catalog.apiVersion,operations:catalog.operations.map(op=>({...op,inputSchema:z.toJSONSchema(argumentSchema(op))}))};
    return{content:[{type:'text' as const,text:'Current granted operations and argument schemas are in structuredContent.'}],structuredContent:data,isError:false};
   }catch{return result({ok:false,status:503,error:'API_DISCOVERY_UNAVAILABLE'});}
  }
  if(request.params.name==='lifeos_call'){
   const parsed=callSchema.safeParse(args);return parsed.success?result(await client.execute(parsed.data.operationId,parsed.data.arguments)):result({ok:false,status:400,error:'INVALID_ARGUMENTS'});
  }
  if(request.params.name==='lifeos_retry'){
   const parsed=retrySchema.safeParse(args);return parsed.success?result(await client.retry(parsed.data.requestId)):result({ok:false,status:400,error:'INVALID_ARGUMENTS'});
  }
  return result({ok:false,status:403,error:'OPERATION_UNAVAILABLE'});
 });
 server.onerror=()=>{};
 return server;
}
