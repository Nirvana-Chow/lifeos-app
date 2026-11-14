import {Server,ProtocolError} from '@modelcontextprotocol/server';
import {ToolSchema} from '@modelcontextprotocol/core';
import {z} from 'zod';
import {LifeOSApiClient,type OperationResult} from './client.ts';
import {argumentSchema} from './schemas.ts';
import {fileReceiveInput,type FileReceiver} from '../file-handoff/receiver.ts';
const discoverSchema=z.strictObject({});
const callSchema=z.strictObject({operationId:z.string().min(1).max(100),arguments:z.record(z.string(),z.unknown())});
const retrySchema=z.strictObject({requestId:z.uuid()});
function result(value:OperationResult){return{content:[{type:'text' as const,text:value.ok?'Read structuredContent for the API result and independent readback.':(value.error??'API_ERROR')+(value.outcome==='unknown'?'; preserve the original command and use its recovery requestId.':'')}],structuredContent:value,isError:!value.ok};}
/** Reuses the inherited official low-level Server for a fresh, asynchronous current-grant list. */
export function createLifeOSMcpServer({client,fileReceiver}:{client:LifeOSApiClient;fileReceiver?:Pick<FileReceiver,'available'|'receive'|'ownsAcknowledgment'>}):Server{
 const server=new Server({name:'lifeos-local-adapter',version:'0.1.0'},{capabilities:{tools:{}}});
 server.setRequestHandler('tools/list',async()=>{
  try{
   const current=await client.discover(),catalog={...current,operations:current.operations.filter(op=>op.module!=='fileHandoff'||op.id==='getFileHandoff')};
   const descriptors=[{name:'lifeos_discover',description:'Discover current authorized, ready LifeOS business operations, complete argument structures and native validation constraints.',schema:discoverSchema,readOnly:true}];
   const tools=descriptors.map(d=>ToolSchema.parse({name:d.name,description:d.description,inputSchema:{...z.toJSONSchema(d.schema),type:'object'},annotations:{readOnlyHint:d.readOnly,openWorldHint:false}}));
   if(catalog.operations.length)tools.push(ToolSchema.parse({name:'lifeos_call',description:'Call one current LifeOS business operation. Use its complete discovered arguments. The API rechecks the same credential and canonical business rules; writes return separate readback.',inputSchema:{type:'object',oneOf:catalog.operations.map(op=>({type:'object',properties:{operationId:{type:'string',const:op.id},arguments:z.toJSONSchema(argumentSchema(op))},required:['operationId','arguments'],additionalProperties:false}))},annotations:{readOnlyHint:catalog.operations.every(op=>op.method==='GET'||op.id==='previewTodoClassification'),openWorldHint:false}}));
   if(catalog.operations.some(op=>op.method!=='GET'&&op.id!=='previewTodoClassification'))tools.push(ToolSchema.parse({name:'lifeos_retry',description:'Recover one retained write by requestId. Unconfirmed writes keep their exact original body and key; confirmed receipts only repeat independent GET. Current API authority is required again.',inputSchema:{...z.toJSONSchema(retrySchema),type:'object'},annotations:{readOnlyHint:false,openWorldHint:false}}));
   if(fileReceiver)try{if(await fileReceiver.available())tools.push(ToolSchema.parse({name:'lifeos_receive_file',description:'Use the explicitly adopted native receiver to download one saved LifeOS file into its fixed authorized directory, independently hash actual bytes, atomically save without overwrite and acknowledge. Keep the same file ID, filename and idempotencyKey for recovery; never import another host journal or expose credentials. acknowledgmentKey is only for a definitively rejected CAS confirmation.',inputSchema:z.toJSONSchema(fileReceiveInput),annotations:{readOnlyHint:false,openWorldHint:false,destructiveHint:false}}));}catch{/* Optional native adoption never closes independent business tools. */}
   return{tools};
  }catch{throw new ProtocolError(-32603,'API_DISCOVERY_UNAVAILABLE');}
 });
 server.setRequestHandler('tools/call',async request=>{
  const args=request.params.arguments??{};
  if(request.params.name==='lifeos_receive_file'){
   const parsed=fileReceiveInput.safeParse(args);if(!parsed.success)return result({ok:false,status:400,error:'INVALID_ARGUMENTS'});
   try{if(!fileReceiver||!await fileReceiver.available())return result({ok:false,status:403,error:'FILE_RECEIVER_NOT_ADOPTED'});
    const received=await fileReceiver.receive(parsed.data);return{content:[{type:'text' as const,text:received.acknowledgment.ok?'Actual bytes were saved and independently verified; the acknowledgment and readback are in structuredContent.':'Keep the original receive arguments and local verified original. Recover through this same receive tool, not another host or a new receive key.'}],structuredContent:received,isError:!received.acknowledgment.ok};
   }catch{return result({ok:false,status:503,error:'FILE_RECEIVE_OUTCOME_UNKNOWN',outcome:'unknown'});}
  }
  if(request.params.name==='lifeos_discover'){
   if(!discoverSchema.safeParse(args).success)return result({ok:false,status:400,error:'INVALID_ARGUMENTS'});
   try{
    const current=await client.discover(),catalog={...current,operations:current.operations.filter(op=>op.module!=='fileHandoff'||op.id==='getFileHandoff')};
    const data={apiVersion:catalog.apiVersion,operations:catalog.operations.map(op=>({...op,inputSchema:z.toJSONSchema(argumentSchema(op))}))};
    return{content:[{type:'text' as const,text:'Current granted operations and argument schemas are in structuredContent.'}],structuredContent:data,isError:false};
   }catch{return result({ok:false,status:503,error:'API_DISCOVERY_UNAVAILABLE'});}
  }
  if(request.params.name==='lifeos_call'){
   const parsed=callSchema.safeParse(args);if(parsed.success&&['stageFileHandoff','downloadFileHandoff','acknowledgeFileHandoff'].includes(parsed.data.operationId))return result({ok:false,status:403,error:'DEDICATED_FILE_TOOL_REQUIRED'});
   return parsed.success?result(await client.execute(parsed.data.operationId,parsed.data.arguments)):result({ok:false,status:400,error:'INVALID_ARGUMENTS'});
  }
  if(request.params.name==='lifeos_retry'){
   const parsed=retrySchema.safeParse(args);
   if(parsed.success&&fileReceiver?.ownsAcknowledgment(parsed.data.requestId))return result({ok:false,status:403,error:'DEDICATED_FILE_RECEIVER_REQUIRED'});
   return parsed.success?result(await client.retry(parsed.data.requestId)):result({ok:false,status:400,error:'INVALID_ARGUMENTS'});
  }
  return result({ok:false,status:403,error:'OPERATION_UNAVAILABLE'});
 });
 server.onerror=()=>{};
 return server;
}
