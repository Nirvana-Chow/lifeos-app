import {randomUUID} from 'node:crypto';
import {responseEntry,verifyReceipt,verifyCurrent,verifyClassification,verifyClassificationCurrent} from './semantic.mjs';
import {decodePreview,classificationCanonical} from '../personal-candidate/classification-contracts.ts';
import {agentOperations} from '../agent-api/capabilities.ts';
import {policyOperationScopes} from '../agent-api/business-policy.ts';
import {PlatformError} from '../platform/domain.ts';
import {parseMcpRuntimeConfig,type McpRuntimeConfig,type McpRuntimeOptions} from './config.ts';
import {parseArguments,type Operation} from './schemas.ts';
export type ReadbackResult={ok:boolean;status:number;data?:Record<string,unknown>;error?:string};
export type VerificationResult={verified:boolean;state:string;receiptRevision?:number;currentRevision?:number;entries?:readonly VerificationResult[]};
export type OperationResult=ReadbackResult&{verification?:VerificationResult;outcome?:'unknown';recovery?:{requestId:string;exactRetryRequired:true};readback?:ReadbackResult};
export type CapabilityCatalog={apiVersion:'2';operations:readonly Operation[]};
class ApiError extends Error{readonly status:number;constructor(status:number,code:string){super(code);this.status=status;}}
const isObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const mount='/api/platform/agent';
const responseLimit=8*1024*1024,requestLimit=131072;
// All executable descriptors originate in the shared reviewed source registry.
// Remote catalog text/unknown IDs are data, never executable route registration.
const supported=(operation:Operation)=>policyOperationScopes(operation)!==null&&(
 /^\/v1\/todos(?:\/(?:snapshot|\{id\}))?$/.test(operation.path)||
 /^\/v1\/organization\/(?:snapshot|\{type\}(?:\/\{id\})?)$/.test(operation.path)||
 /^\/v1\/requirements(?:\/(?:snapshot|\{id\}))?$/.test(operation.path)||
 /^\/v1\/records\/(?:journal|calendar|health|person|finance|media|career|portfolio)(?:\/(?:snapshot|\{id\}))?$/.test(operation.path)||
 /^\/v1\/feedback(?:\/(?:snapshot|\{id\}))?$/.test(operation.path)||
 /^\/v1\/storage-reviews(?:\/(?:snapshot|\{id\})(?:\/(?:checklist|decisions))?)?$/.test(operation.path)||
 /^\/v1\/todo-classifications\/(?:preview|commit)$/.test(operation.path));
export function validateLocalArguments(operationId:string,input:unknown){const operation=agentOperations.find(op=>op.id===operationId&&supported(op));if(!operation)throw new ApiError(403,'OPERATION_UNAVAILABLE');return{operation,parsed:parseArguments(operation,input)};}
type FrozenRequest={requestId:string;operationId:string;argsJSON:string;path:string;encoded:string;key:string;before?:Record<string,unknown>;manifest?:Record<string,unknown>};
/** No SQL/session/credential tool, automatic retry, remote-code loader or alternate authority. */
export class LifeOSApiClient{
 #config:McpRuntimeConfig;#runtime:McpRuntimeOptions;#fetch:typeof fetch;
 #pending=new Map<string,FrozenRequest>();#active=new Set<string>();
 constructor(options:McpRuntimeOptions,fetcher:typeof fetch=fetch){
  this.#config=parseMcpRuntimeConfig({origin:options.origin});
  if((typeof options.credentialProvider!=='function'&&typeof options.nativeRequest!=='function')||options.beforeUse!==undefined&&typeof options.beforeUse!=='function')throw Error('MCP_CONFIG_INVALID');
  if(options.nativeRequest&&(!options.durable||!options.beforeUse||options.origin!=='https://lifeos.nirvanachow.com'))throw Error('NATIVE_HOST_INCOMPLETE');
  this.#runtime=Object.freeze({...options});this.#fetch=fetcher;
 }
 async #before(){try{await this.#runtime.beforeUse?.();}catch{throw new ApiError(0,'MCP_BEFORE_USE_FAILED');}}
 async #request(path:string,method:string,encoded?:string,key?:string){
  const target=new URL(this.#config.origin+mount+path);
  if(target.origin!==this.#config.origin||target.pathname!==mount+path||target.search||target.hash||!/^\/v[12]\/[a-zA-Z0-9/{}-]+$/.test(path))throw new ApiError(400,'API_PATH_REJECTED');
  if(encoded!==undefined&&Buffer.byteLength(encoded)>requestLimit)throw new ApiError(400,'REQUEST_TOO_LARGE');
  if(this.#runtime.nativeRequest){const result=await this.#runtime.nativeRequest(path,method,encoded,key);if(result.credentialFingerprint!==this.#runtime.durable!.binding.credentialFingerprint)throw new ApiError(403,'CREDENTIAL_BINDING_CHANGED');if(result.status<200||result.status>=300)throw new ApiError(result.status,result.status===401?'AUTH_REQUIRED':result.status===403?'ACCESS_DENIED':'API_ERROR');return result;}
  let token:unknown;try{token=await this.#runtime.credentialProvider!();}catch{throw new ApiError(401,'CREDENTIAL_UNAVAILABLE');}
  if(typeof token!=='string'||!/^[-A-Za-z0-9_]{1,256}$/.test(token))throw new ApiError(401,'CREDENTIAL_UNAVAILABLE');
  const secret=token;
  let response:Response;
  try{response=await this.#fetch(target.href,{method,redirect:'manual',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(30000),headers:{authorization:'Bearer '+secret,accept:'application/json',...(encoded===undefined?{}:{'content-type':'application/json'}),...(key?{'idempotency-key':key}:{})},body:encoded});}
  catch{throw new ApiError(0,'API_TRANSPORT_ERROR');}
  if(response.redirected||response.status>=300&&response.status<400){await response.body?.cancel();throw new ApiError(502,'API_REDIRECT_REJECTED');}
  if(response.url&&response.url!==target.href){await response.body?.cancel();throw new ApiError(502,'API_ORIGIN_REJECTED');}
  if(response.status===401||response.status===403){await response.body?.cancel().catch(()=>{});throw new ApiError(response.status,response.status===401?'AUTH_REQUIRED':'ACCESS_DENIED');}
  const reader=response.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
  try{if(reader)for(;;){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>responseLimit)throw Error();chunks.push(value);}}
  catch{await reader?.cancel().catch(()=>{});throw new ApiError(response.status,'API_RESPONSE_INVALID');}
  finally{reader?.releaseLock();}
  let data:unknown;
  try{
   const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
   data=JSON.parse(raw);if(!isObject(data))throw Error();
   // Reject a malicious upstream echo, including JSON-escaped credential characters.
   if(JSON.stringify(data).includes(secret))throw Error();
  }catch{throw new ApiError(response.status,'API_RESPONSE_INVALID');}
  if(!response.ok){const code=typeof data.error==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(data.error)?data.error:'API_ERROR';throw new ApiError(response.status,code);}
  return{status:response.status,data};
 }
 async #catalog():Promise<CapabilityCatalog>{
  const result=await this.#request('/v2/capabilities','GET');
  if(result.data.apiVersion!=='2'||!Array.isArray(result.data.operations)||result.data.operations.length>1000)throw new ApiError(502,'API_CATALOG_INVALID');
  const remote=result.data.operations;
  if(new Set(remote.map((x:any)=>x?.id)).size!==remote.length)throw new ApiError(502,'API_CATALOG_INVALID');
  for(const local of agentOperations){const matches=remote.filter((x:any)=>x?.id===local.id);if(matches.length&&(!isObject(matches[0])||matches[0].method!==local.method||matches[0].path!==local.path||!Array.isArray(matches[0].requiredScopes)||new Set(matches[0].requiredScopes).size!==matches[0].requiredScopes.length||JSON.stringify([...matches[0].requiredScopes].sort())!==JSON.stringify([...local.requiredScopes].sort())))throw new ApiError(502,'API_CONTRACT_MISMATCH');}
  const operations=agentOperations.filter(local=>supported(local)&&remote.filter((entry:unknown)=>isObject(entry)&&entry.id===local.id).length===1&&remote.some((entry:unknown)=>isObject(entry)&&entry.id===local.id&&entry.method===local.method&&entry.path===local.path&&Array.isArray(entry.requiredScopes)&&entry.requiredScopes.length===local.requiredScopes.length&&new Set(entry.requiredScopes).size===entry.requiredScopes.length&&local.requiredScopes.every(s=>entry.requiredScopes instanceof Array&&entry.requiredScopes.includes(s))));
  return{apiVersion:'2',operations};
 }
 async discover():Promise<CapabilityCatalog>{await this.#before();return this.#catalog();}
 #error(error:unknown):ReadbackResult{
  const status=error instanceof ApiError||error instanceof PlatformError?error.status:0;
  return{ok:false,status,error:error instanceof ApiError?error.message:error instanceof PlatformError?error.code:'API_TRANSPORT_ERROR'};
 }
 async #readback(operation:Operation,args:Record<string,unknown>,data?:Record<string,unknown>):Promise<ReadbackResult>{
  try{
   const catalog=await this.#catalog();
   const entry=isObject(data?.entry)?data.entry:data;
   const id=typeof args.id==='string'?args.id:typeof entry?.id==='string'?entry.id:undefined;
   const read=catalog.operations.find(op=>op.method==='GET'&&op.module===operation.module&&(id?op.path.endsWith('{id}'):op.id.startsWith('snapshot')))
     ??(operation.module==='classification'?catalog.operations.find(op=>op.id==='snapshotTodos'):undefined);
   if(!read)return{ok:false,status:403,error:'READBACK_UNAVAILABLE'};
   const parsed=parseArguments(read,{...(read.path.includes('{id}')?{id}:{}),...(read.path.includes('{type}')?{type:args.type}:{})});
   return{ok:true,...await this.#request(parsed.path,'GET')};
  }catch(error){return this.#error(error);}
 }
 async #send(operation:Operation,args:Record<string,unknown>,request:FrozenRequest):Promise<OperationResult>{
  const store=this.#runtime.durable;
  try{
   // Durability precedes the first byte of a business write. The store binds
   // origin + a native credential fingerprint and never receives a credential.
   store?.prepare(request);
   const settled=store?.settled(request.requestId);
   const response=settled??await this.#request(request.path,operation.method,request.encoded,request.key);
   if(operation.module==='classification')verifyClassification(request.manifest,response.data);
   else verifyReceipt(operation,args,request.before,response.data);
   // A valid historical receipt confirms the command even if current GET is
   // unavailable or a later legitimate edit differs. Preserve both separately.
   if(!settled)store?.receipt(request.requestId,response);
   const readback=operation.module==='classification'
    ?await this.#classificationReadback(request,response.data)
    :await this.#readback(operation,args,response.data);
   let verification:VerificationResult;
   try{verification=operation.module==='classification'?verifyClassificationCurrent(request.manifest,response.data,readback):verifyCurrent(response.data,readback);}
   catch{verification={verified:false,state:'READBACK_MISMATCH'};}
   this.#pending.delete(request.requestId);
   if(settled&&!(await this.#catalog()).operations.some(o=>o.id===operation.id))throw new ApiError(403,'OPERATION_UNAVAILABLE');
   store?.finish(request.requestId,{...response,readback,verification});
   return{ok:true,...response,readback,verification};
  }catch(error){
   const result=this.#error(error);
   if(result.status===0||result.status>=500||result.error==='API_RESPONSE_INVALID'){
    if(store?.settled(request.requestId))return{ok:false,status:0,error:'SETTLEMENT_READBACK_INTERRUPTED',recovery:{requestId:request.requestId,exactRetryRequired:true}};
    this.#pending.set(request.requestId,request);store?.unknown(request.requestId);
    return{...result,outcome:'unknown',recovery:{requestId:request.requestId,exactRetryRequired:true},...(operation.method==='PATCH'?{readback:await this.#readback(operation,args)}:operation.module==='classification'?{readback:await this.#classificationReadback(request,{entries:(request.manifest as any).changes.map((c:any)=>c.todo)})}:{})};
   }
   store?.rejected(request.requestId,result);
   return this.#pending.has(request.requestId)?{...result,outcome:'unknown',recovery:{requestId:request.requestId,exactRetryRequired:true}}:result;
  }
 }
 async #classificationReadback(request:FrozenRequest,data:Record<string,unknown>):Promise<ReadbackResult>{
  try{
   const catalog=await this.#catalog();if(!catalog.operations.some(o=>o.id==='getTodo'))return{ok:false,status:403,error:'READBACK_UNAVAILABLE'};
   const entries=[];for(const expected of (data.entries as any[])){const read=await this.#request('/v1/todos/'+expected.id,'GET');entries.push(responseEntry(read.data));}
   return{ok:true,status:200,data:{entries}};
  }catch(error){return this.#error(error);}
 }
 async execute(operationId:string,input:unknown):Promise<OperationResult>{return this.#runtime.durable?this.#runtime.durable.exclusive(()=>this.#execute(operationId,input)):this.#execute(operationId,input);}
 async #execute(operationId:string,input:unknown):Promise<OperationResult>{
  try{
   const {parsed}=validateLocalArguments(operationId,input);
   await this.#before();const operation=(await this.#catalog()).operations.find(op=>op.id===operationId);
   if(!operation)return{ok:false,status:403,error:'OPERATION_UNAVAILABLE'};
   if(operation.method==='GET')return{ok:true,...await this.#request(parsed.path,operation.method)};
   if(operation.id==='previewTodoClassification'){
    const response=await this.#request(parsed.path,operation.method,JSON.stringify(parsed.body));const preview=decodePreview(response.data);
    if(classificationCanonical(preview.changes)!==classificationCanonical((parsed.body as any).changes))throw new ApiError(502,'PREVIEW_MANIFEST_MISMATCH');
    this.#runtime.durable?.manifest(preview);return{ok:true,...response};
   }
   const encoded=JSON.stringify(parsed.body);if(Buffer.byteLength(encoded)>requestLimit)throw new ApiError(400,'REQUEST_TOO_LARGE');
   const prior=[...this.#pending.values()].find(p=>p.key===parsed.key)??this.#runtime.durable?.findRequestByKey(parsed.key!);
   if(prior)return{ok:false,status:409,error:'RECOVERY_REQUIRED',...(this.#runtime.durable?.settled(prior.requestId)?{}:{outcome:'unknown' as const}),recovery:{requestId:prior.requestId,exactRetryRequired:true}};
   if(this.#pending.size+this.#active.size>=100||this.#active.has(parsed.key!))return{ok:false,status:409,error:'MCP_WRITE_BUSY'};
   let before:Record<string,unknown>|undefined;
   if(operation.method==='PATCH'){
    const prior=await this.#readback(operation,input as Record<string,unknown>);const priorEntry=responseEntry(prior.data);if(!prior.ok||!priorEntry||priorEntry.revision!==(input as any).expectedRevision)throw new ApiError(409,'CAS_PREIMAGE_CHANGED');if(operation.module==='requirements'&&priorEntry.baselineConflict)throw new ApiError(409,'REQUIREMENT_BASELINE_CONFLICT');before=priorEntry;
   }
   const manifest=operation.module==='classification'?this.#runtime.durable?.getManifest((input as any).planId,(input as any).digest):undefined;
   if(operation.module==='classification'&&!manifest)throw new ApiError(403,'CLASSIFICATION_MANIFEST_REQUIRED');
   const request:FrozenRequest=Object.freeze({requestId:randomUUID(),operationId,argsJSON:JSON.stringify(input),path:parsed.path,encoded,key:parsed.key!,...(before?{before}:{}),...(manifest?{manifest}:{})});
   this.#active.add(request.key);
   try{return await this.#send(operation,JSON.parse(request.argsJSON),request);}finally{this.#active.delete(request.key);}
  }catch(error){return this.#error(error);}
 }
 async retry(requestId:string):Promise<OperationResult>{return this.#runtime.durable?this.#runtime.durable.exclusive(()=>this.#retry(requestId)):this.#retry(requestId);}
 async #retry(requestId:string):Promise<OperationResult>{
  const request=this.#pending.get(requestId)??this.#runtime.durable?.pending(requestId);if(!request)return{ok:false,status:404,error:'RECOVERY_NOT_FOUND'};
  try{
   await this.#before();const operation=(await this.#catalog()).operations.find(op=>op.id===request.operationId);
   if(!operation)throw new ApiError(403,'OPERATION_UNAVAILABLE');
   if(this.#active.has(request.key))throw new ApiError(409,'MCP_WRITE_BUSY');
   this.#active.add(request.key);
   try{return await this.#send(operation,JSON.parse(request.argsJSON),request);}finally{this.#active.delete(request.key);}
  }catch(error){return{...this.#error(error),outcome:'unknown',recovery:{requestId,exactRetryRequired:true}};}
 }
}
