import {PlatformError,validateIdempotencyKey} from '../platform/domain.ts';
import {assertLocalRequest} from '../platform/request-boundary.ts';
import {canonicalDigest} from './domain.ts';
import type {SyncPrincipal} from './store-contracts.ts';
import type {AppleSyncService} from './service.ts';
const fail=(status:number,code:string):never=>{throw new PlatformError(status,code,'同步候选请求未通过。');};
const respond=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Authorization','X-Content-Type-Options':'nosniff'}});
/** JSON.parse accepts duplicate keys; scan the validated token stream to reject
 * ambiguous input before the protocol can hash or authorize it. */
function strictJSON(text:string):unknown{
 let parsed:unknown;try{parsed=JSON.parse(text);}catch{return fail(400,'INVALID_JSON');}
 const tokens=text.match(/"(?:[^"\\]|\\.)*"|[{}\[\],:]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g)??[];let at=0;
 const value=(depth:number):void=>{
  if(depth>32)fail(400,'INVALID_JSON');const token=tokens[at++];
  if(token==='{'){const keys=new Set<string>();if(tokens[at]==='}'){at++;return;}for(;;){const key=JSON.parse(tokens[at++]) as string;if(keys.has(key))fail(400,'DUPLICATE_JSON_KEY');keys.add(key);at++;value(depth+1);if(tokens[at++]==='}')break;}}
  else if(token==='['){if(tokens[at]===']'){at++;return;}for(;;){value(depth+1);if(tokens[at++]===']')break;}}
 };
 value(0);canonicalDigest(parsed);return parsed;
}
async function body(request:Request):Promise<unknown>{
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')fail(415,'JSON_REQUIRED');
 const reader=request.body?.getReader();if(!reader)fail(400,'INVALID_JSON');const chunks:Uint8Array[]=[];let size=0;
 for(;;){const part=await reader!.read();if(part.done)break;size+=part.value.byteLength;if(size>131072){await reader!.cancel().catch(()=>{});fail(413,'BODY_TOO_LARGE');}chunks.push(part.value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return fail(400,'INVALID_JSON');}return strictJSON(text);
}
/** No identity implementation is provided here. Runtime must explicitly inject
 * an approved scoped device verifier; browser sessions are not bridge grants. */
export function createAppleSyncHandler(options:{baseURL:string;enabled?:boolean;service?:AppleSyncService;principalReader?:(request:Request)=>Promise<SyncPrincipal|null>}):(request:Request)=>Promise<Response>{
 return async request=>{
  try{
   if(options.enabled!==true||!options.service||!options.principalReader)fail(503,'SYNC_UNAVAILABLE');
   assertLocalRequest(request,options.baseURL);
   if(request.headers.has('cookie')||request.headers.has('origin')&&request.headers.get('origin')!==new URL(options.baseURL).origin)fail(403,'SYNC_DEVICE_BOUNDARY');
   const url=new URL(request.url);if(url.search)fail(400,'SYNC_QUERY_DENIED');
   const match=/^\/api\/platform\/personal\/apple-sync\/(capabilities|preview|lease|pull|prepare|claim|authorize-save|retire|observation|receipt|ack)$/.exec(url.pathname);if(!match)fail(404,'SYNC_OPERATION_DENIED');
   if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED');if(request.signal.aborted)fail(409,'REQUEST_CANCELLED');
   const principal=await options.principalReader!(request);if(!principal)fail(503,'SYNC_IDENTITY_UNAVAILABLE');
   const key=validateIdempotencyKey(request.headers.get('idempotency-key')??''),input=await body(request);if(request.signal.aborted)fail(409,'REQUEST_CANCELLED');
   return respond(await options.service!.dispatch(principal!,match![1],input,key));
  }catch(error){const known=error instanceof PlatformError;return respond({error:{code:known?error.code:'SYNC_UNAVAILABLE',message:'同步候选请求未通过，结果未确认。'}},known?error.status:503);}
 };
}
