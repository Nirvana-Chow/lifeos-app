import {randomUUID} from 'node:crypto';
import {agentOperations} from '../agent-api/capabilities.ts';
import {policyOperationScopes} from '../agent-api/business-policy.ts';
import {PlatformError} from '../platform/domain.ts';
import {parseMcpRuntimeConfig,type McpRuntimeConfig,type McpRuntimeOptions} from './config.ts';
import {parseArguments,type Operation} from './schemas.ts';
export type ReadbackResult={ok:boolean;status:number;data?:Record<string,unknown>;error?:string};
export type OperationResult=ReadbackResult&{outcome?:'unknown';recovery?:{requestId:string;exactRetryRequired:true};readback?:ReadbackResult};
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
 /^\/v1\/todo-classifications\/(?:preview|commit)$/.test(operation.path));
type FrozenRequest={requestId:string;operationId:string;argsJSON:string;path:string;encoded:string;key:string};
/** No SQL/session/credential tool, automatic retry, remote-code loader or alternate authority. */
export class LifeOSApiClient{
 #config:McpRuntimeConfig;#runtime:McpRuntimeOptions;#fetch:typeof fetch;
 #pending=new Map<string,FrozenRequest>();#active=new Set<string>();
 constructor(options:McpRuntimeOptions,fetcher:typeof fetch=fetch){
  this.#config=parseMcpRuntimeConfig({origin:options.origin});
  if(typeof options.credentialProvider!=='function'||options.beforeUse!==undefined&&typeof options.beforeUse!=='function')throw Error('MCP_CONFIG_INVALID');
  this.#runtime=Object.freeze({...options});this.#fetch=fetcher;
 }
 async #before(){try{await this.#runtime.beforeUse?.();}catch{throw new ApiError(0,'MCP_BEFORE_USE_FAILED');}}
 async #request(path:string,method:string,encoded?:string,key?:string){
  const target=new URL(this.#config.origin+mount+path);
  if(target.origin!==this.#config.origin||target.pathname!==mount+path||target.search||target.hash||!/^\/v[12]\/[a-zA-Z0-9/{}-]+$/.test(path))throw new ApiError(400,'API_PATH_REJECTED');
  if(encoded!==undefined&&Buffer.byteLength(encoded)>requestLimit)throw new ApiError(400,'REQUEST_TOO_LARGE');
  let token:unknown;try{token=await this.#runtime.credentialProvider();}catch{throw new ApiError(401,'CREDENTIAL_UNAVAILABLE');}
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
  try{
   const response=await this.#request(request.path,operation.method,request.encoded,request.key);
   const readback=await this.#readback(operation,args,response.data);
   this.#pending.delete(request.requestId);
   return{ok:true,...response,readback};
  }catch(error){
   const result=this.#error(error);
   if(result.status===0||result.status>=500||result.error==='API_RESPONSE_INVALID'){
    this.#pending.set(request.requestId,request);
    return{...result,outcome:'unknown',recovery:{requestId:request.requestId,exactRetryRequired:true},readback:await this.#readback(operation,args)};
   }
   return this.#pending.has(request.requestId)?{...result,outcome:'unknown',recovery:{requestId:request.requestId,exactRetryRequired:true}}:result;
  }
 }
 async execute(operationId:string,input:unknown):Promise<OperationResult>{
  try{
   await this.#before();const operation=(await this.#catalog()).operations.find(op=>op.id===operationId);
   if(!operation)return{ok:false,status:403,error:'OPERATION_UNAVAILABLE'};
   const parsed=parseArguments(operation,input);
   if(operation.method==='GET'||operation.id==='previewTodoClassification')return{ok:true,...await this.#request(parsed.path,operation.method,parsed.body===undefined?undefined:JSON.stringify(parsed.body),parsed.key)};
   const encoded=JSON.stringify(parsed.body);if(Buffer.byteLength(encoded)>requestLimit)throw new ApiError(400,'REQUEST_TOO_LARGE');
   const prior=[...this.#pending.values()].find(p=>p.key===parsed.key);
   if(prior)return{ok:false,status:409,error:'RECOVERY_REQUIRED',outcome:'unknown',recovery:{requestId:prior.requestId,exactRetryRequired:true}};
   if(this.#pending.size+this.#active.size>=100||this.#active.has(parsed.key!))return{ok:false,status:409,error:'MCP_WRITE_BUSY'};
   const request:FrozenRequest=Object.freeze({requestId:randomUUID(),operationId,argsJSON:JSON.stringify(input),path:parsed.path,encoded,key:parsed.key!});
   this.#active.add(request.key);
   try{return await this.#send(operation,JSON.parse(request.argsJSON),request);}finally{this.#active.delete(request.key);}
  }catch(error){return this.#error(error);}
 }
 async retry(requestId:string):Promise<OperationResult>{
  const request=this.#pending.get(requestId);if(!request)return{ok:false,status:404,error:'RECOVERY_NOT_FOUND'};
  try{
   await this.#before();const operation=(await this.#catalog()).operations.find(op=>op.id===request.operationId);
   if(!operation)throw new ApiError(403,'OPERATION_UNAVAILABLE');
   if(this.#active.has(request.key))throw new ApiError(409,'MCP_WRITE_BUSY');
   this.#active.add(request.key);
   try{return await this.#send(operation,JSON.parse(request.argsJSON),request);}finally{this.#active.delete(request.key);}
  }catch(error){return{...this.#error(error),outcome:'unknown',recovery:{requestId,exactRetryRequired:true}};}
 }
}
