import {randomUUID} from 'node:crypto';
import type {DurableStore} from '../mcp-candidate/native-store.mjs';
import type {OperationResult as ApiOperationResult,ReadbackResult as ApiReadbackResult} from '../mcp-candidate/client.ts';
import {responseEntry,verifyReceipt,verifyCurrent} from '../mcp-candidate/semantic.mjs';
import {canonicalJSON,intersectDefinitions,isObject,validateHostCall,localDefinitions as reviewedDefinitions,type OperationDefinition} from './contracts.ts';
import type {createMcpChannel,DiscoveryInput} from './channel.ts';
import {retryAfterSeconds} from './broker-result.ts';

// MCP transport hints do not change the REST adapter's published result contract.
type ReadbackResult=ApiReadbackResult&{retryAfterSeconds?:number};
type OperationResult=ApiOperationResult&ReadbackResult&{readback?:ReadbackResult};
export type DurableMcpResult=OperationResult&{serverReadback?:OperationResult['readback'];serverVerification?:OperationResult['verification']};
type Channel=ReturnType<typeof createMcpChannel>;
export type McpFrozenRequest={requestId:string;transport:'server-mcp-v1';operationId:string;definitionJSON:string;argsJSON:string;path:'/api/platform/mcp';encoded:string;key:string;businessPath:string;businessEncoded:string;before?:Record<string,unknown>};
class HostError extends Error{
 readonly status:number;
 constructor(code:string,status=0){super(code);this.status=status;}
}
function fail(code:string,status=0):never{throw new HostError(code,status);}
function errorResult(error:unknown):ReadbackResult{
 const value=isObject(error)?error:undefined,seconds=retryAfterSeconds(value?.retryAfterSeconds);
 return{ok:false,status:typeof value?.status==='number'&&Number.isInteger(value.status)&&value.status>=0&&value.status<=599?value.status:0,error:error instanceof Error&&/^[A-Z][A-Z0-9_]{0,79}$/.test(error.message)?error.message:'MCP_HOST_INTERRUPTED',...(seconds===undefined?{}:{retryAfterSeconds:seconds})};
}
/** A client of the reviewed store and fixed protocol channel; no runtime adoption or credential access. */
export class DurableMcpClient{
 readonly #channel:Channel;readonly #store:DurableStore;readonly #definitions:readonly OperationDefinition[];
 constructor(options:{channel:Channel;store:DurableStore;localDefinitions?:readonly OperationDefinition[]}){
  this.#channel=options.channel;this.#store=options.store;
  const definitions=structuredClone(options.localDefinitions??reviewedDefinitions);
  // Validate injected subsets against the reviewed source immediately; retain a private snapshot.
  intersectDefinitions(definitions,{apiVersion:'2',operations:definitions});this.#definitions=definitions;
 }
 async #catalog():Promise<readonly OperationDefinition[]>{
  await this.#channel.ready();
  if(this.#channel.credentialFingerprint!==this.#store.binding.credentialFingerprint)fail('CREDENTIAL_BINDING_CHANGED',403);
  const result=await this.#channel.discover({});
  if(result.isError===true)fail('HOST_CATALOG_INVALID',403);
  return intersectDefinitions(this.#definitions,result.structuredContent);
 }
 async discover(input:DiscoveryInput={}):Promise<Record<string,unknown>>{
  // No caller-supplied discovery shape ever reaches the broker before validation.
  if(!isObject(input)||!(Object.keys(input).length===0||Object.keys(input).length===1&&('view'in input&&input.view==='index'||'operationId'in input&&typeof input.operationId==='string'&&input.operationId.length>0&&input.operationId.length<=100)))fail('INVALID_ARGUMENTS',400);
  return this.#store.exclusive(async()=>{
   const operations=await this.#catalog();
   if('operationId'in input){const operation=operations.find(op=>op.id===input.operationId);if(!operation)fail('OPERATION_UNAVAILABLE',403);return{apiVersion:'2',operation};}
   return 'view'in input?{apiVersion:'2',view:'index',operations:operations.map(({id,module,method,description})=>({id,module,method,description}))}:{apiVersion:'2',operations};
  });
 }
 #result(value:unknown):OperationResult{
  if(!isObject(value)||typeof value.ok!=='boolean'||!Number.isInteger(value.status)||(value.status as number)<0||(value.status as number)>599)fail('MCP_BUSINESS_RESULT_INVALID');
  if(value.outcome!==undefined&&value.outcome!=='unknown')fail('MCP_BUSINESS_RESULT_INVALID');
  if(value.ok){
   if((value.status as number)<200||(value.status as number)>299||!isObject(value.data)||value.outcome!==undefined)fail('MCP_BUSINESS_RESULT_INVALID');
  }else if(typeof value.error!=='string'||! /^[A-Z][A-Z0-9_]{0,79}$/.test(value.error)||value.status!==0&&(value.status as number)<400)fail('MCP_BUSINESS_RESULT_INVALID');
  const result=structuredClone(value) as OperationResult,seconds=retryAfterSeconds(value.retryAfterSeconds);
  delete result.retryAfterSeconds;if(!result.ok&&seconds!==undefined)result.retryAfterSeconds=seconds;
  return result;
 }
 #unwrap(result:Awaited<ReturnType<Channel['call']>>):OperationResult{
  const value=this.#result(result.structuredContent);
  if(result.isError===true&&value.ok)fail('MCP_BUSINESS_RESULT_INVALID');
  return value;
 }
 async #readback(operation:OperationDefinition,args:Record<string,unknown>,catalog:readonly OperationDefinition[],data?:Record<string,unknown>):Promise<ReadbackResult>{
  try{
   const id=typeof args.id==='string'?args.id:responseEntry(data)?.id;
   const read=catalog.find(op=>op.method==='GET'&&op.module===operation.module&&op.path.endsWith('{id}'));
   if(!read||typeof id!=='string')return{ok:false,status:403,error:'READBACK_UNAVAILABLE'};
   const input={id,...(read.path.includes('{type}')?{type:args.type}:{})};
   validateHostCall(read.id,input);
   return this.#unwrap(await this.#channel.call(read.id,input));
  }catch(error){return errorResult(error);}
 }
 #validatePrior(prior:unknown,operation:OperationDefinition,argsJSON:string,parsed:ReturnType<typeof validateHostCall>['parsed']):McpFrozenRequest{
  if(!isObject(prior)||prior.transport!=='server-mcp-v1')fail('LEGACY_HOST_RECOVERY_REQUIRED',409);
  if(prior.operationId!==operation.id||prior.argsJSON!==argsJSON||prior.definitionJSON!==canonicalJSON(operation)||prior.key!==parsed.key||prior.path!=='/api/platform/mcp'||prior.businessPath!==parsed.path||prior.businessEncoded!==JSON.stringify(parsed.body)||typeof prior.requestId!=='string'||! /^[a-f0-9-]{36}$/i.test(prior.requestId)||typeof prior.encoded!=='string')fail('ORIGINAL_COMMAND_REQUIRED',409);
  // The store digest guards persisted bytes; separately bind their semantic command.
  let rpc:unknown;try{rpc=JSON.parse(prior.encoded);}catch{return fail('ORIGINAL_COMMAND_REQUIRED',409);}
  if(!isObject(rpc)||rpc.method!=='tools/call'||!isObject(rpc.params)||rpc.params.name!=='lifeos_call'||!isObject(rpc.params.arguments)||rpc.params.arguments.operationId!==operation.id||canonicalJSON(rpc.params.arguments.arguments)!==argsJSON)fail('ORIGINAL_COMMAND_REQUIRED',409);
  // Reuse the channel's encoder as the exact protocol validator, preserving the
  // original ID only for comparison. The generated envelope is never sent or saved.
  const expected=JSON.parse(this.#channel.prepareCall(operation.id,JSON.parse(argsJSON)));
  if(!Number.isSafeInteger(rpc.id)||(rpc.id as number)<1)fail('ORIGINAL_COMMAND_REQUIRED',409);
  expected.id=rpc.id;if(JSON.stringify(expected)!==prior.encoded)fail('ORIGINAL_COMMAND_REQUIRED',409);
  if(operation.method==='PATCH'&&!isObject(prior.before))fail('ORIGINAL_COMMAND_REQUIRED',409);
  return prior as McpFrozenRequest;
 }
 async execute(operationId:string,input:unknown):Promise<DurableMcpResult>{
  // Canonicalization happens synchronously before any provider or lock, and freezes caller mutation.
  let validated:ReturnType<typeof validateHostCall>;
  try{validated=validateHostCall(operationId,input);}catch(error){return{...errorResult(error),status:400};}
  const {operation,argsJSON}=validated,args=JSON.parse(argsJSON) as Record<string,unknown>;
  // Reparse the frozen JSON: nested unknown-valued fields may alias caller objects.
  const {parsed}=validateHostCall(operationId,args);
  try{return await this.#store.exclusive(async()=>{
   const catalog=await this.#catalog(),definition=catalog.find(op=>op.id===operation.id);
   if(!definition)return{ok:false,status:403,error:'OPERATION_UNAVAILABLE'};
   if(operation.method==='GET')return this.#unwrap(await this.#channel.call(operationId,args));
   const prior=this.#store.findRequestByKey(parsed.key!);
   let request:McpFrozenRequest;
   if(prior)request=this.#validatePrior(prior,definition,argsJSON,parsed);
   else{
    let before:Record<string,unknown>|undefined;
    if(operation.method==='PATCH'){
     const preimage=await this.#readback(definition,args,catalog),entry=responseEntry(preimage.data);
     if(!preimage.ok||!entry||entry.id!==args.id||entry.revision!==args.expectedRevision||!(typeof entry.sourceId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(entry.sourceId)||operation.module==='requirements'&&args.expectedRevision===0&&entry.sourceId===null))fail('CAS_PREIMAGE_CHANGED',409);
     if(operation.module==='requirements'&&(entry.baselineConflict||!Object.hasOwn(entry,'baselineBinding')||canonicalJSON(args.baselineBinding)!==canonicalJSON(entry.baselineBinding)))fail('REQUIREMENT_BASELINE_CONFLICT',409);
     before=structuredClone(entry);
    }
    request={requestId:randomUUID(),transport:'server-mcp-v1',operationId,definitionJSON:canonicalJSON(definition),argsJSON,path:'/api/platform/mcp',encoded:this.#channel.prepareCall(operationId,args),key:parsed.key!,businessPath:parsed.path,businessEncoded:JSON.stringify(parsed.body),...(before?{before}:{})};
    // fsync completes before any attempt to send. A failed prepare never sends.
    this.#store.prepare(request);
   }
   return this.#settle(request,definition,args,catalog,Boolean(prior));
  });}catch(error){return errorResult(error);}
 }
 async #settle(request:McpFrozenRequest,definition:OperationDefinition,args:Record<string,unknown>,catalog:readonly OperationDefinition[],recovering:boolean):Promise<DurableMcpResult>{
  const recovery={requestId:request.requestId,exactRetryRequired:true as const};
  let confirmed:OperationResult|undefined;
  try{
   const stored:unknown=this.#store.settled(request.requestId);
   if(stored!==undefined){
    const receipt=this.#result(stored);if(!receipt.ok)fail('JOURNAL_SETTLEMENT_INVALID');
    verifyReceipt(definition,args,request.before,receipt.data);confirmed=receipt;
   }else{
    const response=this.#unwrap(await this.#channel.sendPrepared(request.encoded,this.#store.binding.credentialFingerprint));
    if(!response.ok){
     this.#store.rejected(request.requestId,response);
     if(recovering||response.outcome==='unknown'||response.status===0||response.status>=500){this.#store.unknown(request.requestId);return{...response,outcome:'unknown',recovery};}
     return response;
    }
    verifyReceipt(definition,args,request.before,response.data);
    // Preserve the server's own readback evidence inside this durable response.
    this.#store.receipt(request.requestId,response);confirmed=response;
   }
   const readback=await this.#readback(definition,args,catalog,confirmed.data);
   const verification=verifyCurrent(confirmed.data,readback);
   const result={...confirmed,...(confirmed.readback?{serverReadback:confirmed.readback}:{}),...(confirmed.verification?{serverVerification:confirmed.verification}:{}),readback,verification};
   this.#store.finish(request.requestId,result);return result;
  }catch(error){
   // A receipt fsync may have succeeded even if its caller was interrupted.
   const settled=this.#store.settled(request.requestId);
   if(settled)return{ok:false,status:0,error:'SETTLEMENT_READBACK_INTERRUPTED',recovery};
   const result=errorResult(error);
   if(result.status>=400&&result.status<500){this.#store.rejected(request.requestId,result);if(!recovering)return result;}
   this.#store.unknown(request.requestId);return{...result,outcome:'unknown',recovery};
  }
 }
}
