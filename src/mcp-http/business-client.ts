import {isRequirementEventOperation} from '../requirement-events/operations.ts';
import {LifeOSApiClient,type CapabilityCatalog,type OperationResult,validateLocalArguments} from '../mcp-candidate/client.ts';
import {parseArguments,type Operation} from '../mcp-candidate/schemas.ts';
import {responseEntry,verifyReceipt,verifyCurrent,verifyExecutionCurrent} from '../mcp-candidate/semantic.mjs';
import {PlatformError} from '../platform/domain.ts';

export type BusinessDispatcher=(request:Request)=>Promise<Response>;
export type HttpOperationResult=OperationResult&{retry?:{operationId:string;idempotencyKey:string;requireSameArguments:true}};
const apiMount='/api/platform/agent',responseLimit=8*1024*1024;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const projectable=(operation:Operation)=>operation.id!=='commitTodoClassification';

/** In-process transport to the existing Agent boundary; no socket or alternate writer. */
export function inProcessApiFetch(origin:string,token:string,dispatch:BusinessDispatcher,signal:AbortSignal):typeof fetch{
 return async(input,init)=>{
  const original=new Request(input,init),url=new URL(original.url);
  const combined=AbortSignal.any([signal,original.signal]);
  if(url.origin!==origin||url.search||url.hash||!url.pathname.startsWith(apiMount+'/')||
     !['GET','POST','PATCH'].includes(original.method)||original.headers.get('authorization')!=='Bearer '+token||combined.aborted)throw Error('API_TARGET_REJECTED');
  const headers=new Headers({host:new URL(origin).host,authorization:'Bearer '+token,accept:'application/json'});
  for(const name of ['content-type','idempotency-key']){const value=original.headers.get(name);if(value!==null)headers.set(name,value);}
  const request=new Request(original.url,{method:original.method,headers,signal:combined,
   ...(original.method==='GET'?{}:{body:await original.text()})});
  if(combined.aborted)throw Error('API_REQUEST_CANCELLED');
  return new Promise<Response>((resolve,reject)=>{
   const cleanup=()=>combined.removeEventListener('abort',cancel);
   const cancel=()=>{cleanup();reject(Error('API_REQUEST_CANCELLED'));};
   combined.addEventListener('abort',cancel,{once:true});
   if(combined.aborted){cancel();return;}
   // Cancellation ends this wait, not a database transaction that may already
   // have committed. The writer's original command remains recoverable.
   Promise.resolve().then(()=>{if(combined.aborted)throw Error();return dispatch(request);}).then(
    response=>{cleanup();resolve(response);},()=>{cleanup();reject(Error('API_DISPATCH_FAILED'));});
  });
 };
}

async function readResult(response:Response,token:string):Promise<{status:number;data:Record<string,unknown>}>{
 if(response.redirected||response.status>=300&&response.status<400){await response.body?.cancel();throw Error('API_REDIRECT_REJECTED');}
 const reader=response.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
 try{if(reader)for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>responseLimit)throw Error();chunks.push(part.value);}}
 catch{await reader?.cancel().catch(()=>{});throw Error('API_RESPONSE_INVALID');}finally{reader?.releaseLock();}
 try{const data:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  if(!object(data)||JSON.stringify(data).includes(token))throw Error();return{status:response.status,data};
 }catch{throw Error('API_RESPONSE_INVALID');}
}

/** Stateless execution relies on the API's durable command receipts, never an in-memory retry ID. */
export class HttpBusinessClient{
 private readonly api:LifeOSApiClient;
 private readonly transport:typeof fetch;
 private readonly origin:string;
 private readonly token:string;
 constructor(origin:string,token:string,dispatch:BusinessDispatcher,signal:AbortSignal){
  this.origin=origin;this.token=token;
  this.transport=inProcessApiFetch(origin,token,dispatch,signal);
  this.api=new LifeOSApiClient({origin,credentialProvider:async()=>token},this.transport);
 }
 async discover():Promise<CapabilityCatalog>{const catalog=await this.api.discover();return{...catalog,operations:catalog.operations.filter(projectable)};}
 private async readback(operation:Operation,args:Record<string,unknown>,data:Record<string,unknown>){
  try{const entry=responseEntry(data),id=isRequirementEventOperation(operation.id)?operation.id==='claimRequirementExecution'?args.requirementId:(args.lease as any)?.requirementId:typeof args.id==='string'?args.id:entry?.id;
   const catalog=await this.discover(),read=catalog.operations.find(candidate=>candidate.module===operation.module&&candidate.method==='GET'&&candidate.path.endsWith('{id}'));
   if(!read||typeof id!=='string')return{ok:false,status:403,error:'READBACK_UNAVAILABLE'};
   return await this.api.execute(read.id,{id,...(read.path.includes('{type}')?{type:args.type}:{})});
  }catch{return{ok:false,status:503,error:'READBACK_UNAVAILABLE'};}
 }
 async execute(operationId:string,input:unknown):Promise<HttpOperationResult>{
  let operation:Operation,args:Record<string,unknown>,parsed:ReturnType<typeof parseArguments>;
  try{
   const validated=validateLocalArguments(operationId,input);operation=validated.operation;parsed=validated.parsed;
   if(!projectable(operation))return{ok:false,status:403,error:'OPERATION_UNAVAILABLE'};
   args=structuredClone(input) as Record<string,unknown>;
  }catch(error){
   if(error instanceof PlatformError)return{ok:false,status:error.status,error:error.code};
   if(error&&typeof error==='object'&&'status'in error&&error.status===403)return{ok:false,status:403,error:'OPERATION_UNAVAILABLE'};
   return{ok:false,status:400,error:'INVALID_ARGUMENTS'};
  }
  try{const catalog=await this.discover();if(!catalog.operations.some(candidate=>candidate.id===operation.id))return{ok:false,status:403,error:'OPERATION_UNAVAILABLE'};}
  catch{return{ok:false,status:403,error:'API_DISCOVERY_UNAVAILABLE'};}
  if(operation.method==='GET'||operation.id==='previewTodoClassification')return this.api.execute(operationId,args);
  const key=parsed.key!;
  const unknown=(error:string,status=0):HttpOperationResult=>({ok:false,status,error,outcome:'unknown',retry:{operationId,idempotencyKey:key,requireSameArguments:true}});
  // Observe a current preimage when available, but never let a stale preimage
  // prevent the authoritative API from replaying an exact durable command.
  const before=operation.method==='PATCH'?await this.readback(operation,args,{}):undefined;
  let result:{status:number;data:Record<string,unknown>};
  try{result=await readResult(await this.transport(this.origin+apiMount+parsed.path,{method:operation.method,signal:AbortSignal.timeout(30000),headers:{authorization:'Bearer '+this.token,'content-type':'application/json','idempotency-key':key},body:JSON.stringify(parsed.body)}),this.token);}
  catch{return unknown('API_WRITE_OUTCOME_UNKNOWN');}
  if(result.status<200||result.status>=300){
   const error=typeof result.data.error==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(result.data.error)?result.data.error:'API_ERROR';
   return result.status>=500?unknown(error,result.status):{ok:false,status:result.status,error};
  }
  try{
   let preimage=before?.ok?responseEntry(before.data):undefined;
   const expected=operation.id==='updateRequirementExecution'?(args.input as any)?.expectedRevision:args.expectedRevision;
   if(operation.method==='PATCH'&&args.action!=='renew'&&preimage?.revision!==expected){
    if(result.data.duplicate!==true)throw Error('RECEIPT_PREIMAGE_UNAVAILABLE');
    // The durable API receipt is authoritative for inherited fields on replay;
    // its explicit arguments/CAS are still checked by the common validator.
    const entry=responseEntry(result.data);preimage={sourceId:entry?.sourceId,fields:entry?.fields};
   }
   verifyReceipt(operation,args,preimage,result.data);
  }catch{return unknown('API_RECEIPT_INVALID',result.status);}
  const readback=await this.readback(operation,args,result.data);
  return{ok:true,...result,readback,verification:isRequirementEventOperation(operation.id)?verifyExecutionCurrent(operation,args,result.data,readback):verifyCurrent(result.data,readback)};
 }
}
