import {setTimeout as delay} from 'node:timers/promises';
import {isDeepStrictEqual} from 'node:util';
import {object,PlatformError,validateId,validateIdempotencyKey,validateRevision} from '../platform/domain.ts';
import {assertLocalRequest,readJSONBody} from '../platform/request-boundary.ts';
import {assertAgentGrant} from '../agent-api/grant-fence.ts';
import type {RequirementsService} from '../requirements-candidate/service.ts';
import type {RequirementEventService} from './service.ts';
import {cursor} from './service.ts';
import type {RequirementAdmissionService} from './admission.ts';
import {claimsPath,streamPath,eventOperations,type EventActor,type ExecutionLease} from './contracts.ts';
export type NotificationWait={wait(signal:AbortSignal):Promise<void>;close():Promise<void>};
type Options={enabled?:boolean;origin:string;authorize:(request:Request,operationId:string)=>Promise<{actor:EventActor;current:()=>Promise<void>;mutationGuard?:()=>Promise<void>}>;events:RequirementEventService;requirements:RequirementsService;admission?:RequirementAdmissionService;wait?:(signal:AbortSignal)=>Promise<void>;openNotifications?:()=>Promise<NotificationWait>};
const headers={'Cache-Control':'private, no-store',Vary:'Authorization','X-Content-Type-Options':'nosniff'};
function json(status:number,value:unknown){return Response.json(value,{status,headers});}
async function afterWrite(current:()=>Promise<void>){try{await current();}catch{throw new PlatformError(503,'EXECUTION_OUTCOME_UNVERIFIED','执行回执需要按原请求恢复。');}}
function lease(value:unknown):ExecutionLease{
 const v=object(value,['id','requirementId','sourceId','revision','workDigest','holderId','grantId','fence','expiresAt']);
 validateId(v.id);validateId(v.sourceId);validateRevision(v.revision);
 if(typeof v.requirementId!=='string'||typeof v.holderId!=='string'||typeof v.grantId!=='string'||typeof v.workDigest!=='string'||! /^[a-f0-9]{64}$/.test(v.workDigest)||!Number.isSafeInteger(v.fence)||Number(v.fence)<1||!Number.isFinite(v.expiresAt))throw new PlatformError(400,'INVALID_EXECUTION_LEASE','执行租约无效。');
 return v as ExecutionLease;
}
export function createRequirementEventHandler(options:Options){return async(request:Request):Promise<Response>=>{
 const url=new URL(request.url),claimId=new RegExp('^'+claimsPath+'/([a-f0-9-]{36})$').exec(url.pathname)?.[1];
 if(options.enabled!==true||url.search||url.hash||![streamPath,claimsPath].includes(url.pathname)&&!claimId)return json(404,{error:'NOT_FOUND'});
 const operationId=url.pathname===streamPath?eventOperations.stream:url.pathname===claimsPath?eventOperations.claim:eventOperations.update;
 if(request.method!==(operationId===eventOperations.stream?'GET':operationId===eventOperations.claim?'POST':'PATCH'))return json(405,{error:'METHOD_NOT_ALLOWED'});
 try{
  assertLocalRequest(request,options.origin);const authorization=request.headers.get('authorization');if(!/^Bearer [A-Za-z0-9_-]{1,256}$/.test(authorization??''))return json(401,{error:'AUTH_REQUIRED'});
  const safeHeaders=new Headers(request.headers);safeHeaders.delete('cookie');const authorizationRequest=new Request(request.clone(),{headers:safeHeaders});
  const {actor,current,mutationGuard}=await options.authorize(authorizationRequest,operationId);await current();
  if(!actor.scopes.includes('requirements:read')||operationId!==eventOperations.stream&&!actor.scopes.includes('requirements:write'))return json(403,{error:'ACCESS_DENIED'});
  if(operationId===eventOperations.stream){
   let after=cursor(request.headers.get('last-event-id')??'0'),waiting=false,closed=false;const notifications=await options.openNotifications?.();
   let activeController:ReadableStreamDefaultController<Uint8Array>|undefined,onAbort=()=>{},authChecking=false,authTimer:ReturnType<typeof setInterval>|undefined;
   const close=async()=>{if(!closed){closed=true;if(authTimer)clearInterval(authTimer);request.signal.removeEventListener('abort',onAbort);await notifications?.close();}};
   onAbort=()=>{void close().catch(()=>{}).finally(()=>{try{activeController?.close();}catch{}});};
   request.signal.addEventListener('abort',onAbort,{once:true});
   // An idle or backpressured reader must not retain a revoked grant/notification slot.
   authTimer=setInterval(()=>{if(closed||authChecking)return;authChecking=true;void Promise.resolve().then(current).catch(onAbort).finally(()=>{authChecking=false;});},15000);authTimer.unref?.();
   const wait=notifications?.wait.bind(notifications)??options.wait??(async(signal:AbortSignal)=>{await delay(15000,undefined,{signal});});
   const stream=new ReadableStream<Uint8Array>({start(controller){activeController=controller;if(request.signal.aborted)onAbort();},async pull(controller){
    try{
     if(waiting)await wait(request.signal);request.signal.throwIfAborted();await current();
     const batch=await options.events.batch(actor,after);await current();request.signal.throwIfAborted();
     const payload=JSON.stringify({events:batch.events,ready:batch.ready,cursor:batch.cursor,reset:batch.reset,readyTruncated:batch.readyTruncated});
     after=batch.cursor;waiting=batch.events.length<100;
     controller.enqueue(new TextEncoder().encode(batch.events.length||batch.ready.length||batch.reset?`id: ${after}\nevent: requirement-work\ndata: ${payload}\n\n`:': keepalive\n\n'));
    }catch{await close();try{controller.close();}catch{}}
   },async cancel(){await close();}});
   return new Response(stream,{headers:{...headers,'Content-Type':'text/event-stream','X-Accel-Buffering':'no'}});
  }
  const key=request.headers.get('idempotency-key')??'';validateIdempotencyKey(key);
  if(operationId===eventOperations.claim){
   const raw=await readJSONBody(request);
   if(raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.hasOwn(raw,'action')){
    if(!options.admission)throw new PlatformError(503,'EXECUTION_ADMISSION_UNAVAILABLE','受控入队尚未启用。');
    return json(200,await options.admission.admit(actor,raw,key,current,mutationGuard));
   }
   const body=object(raw,['requirementId','workDigest','holderId']);const result=await options.events.claim(actor,{...body,requestId:key} as never);await afterWrite(current);return json(200,{lease:result});
  }
  const body=object(await readJSONBody(request),['action','lease','input']),binding=lease(body.lease);if(binding.id!==claimId||binding.grantId!==actor.grantId)throw new PlatformError(403,'ACCESS_DENIED','执行租约不属于当前授权。');
  if(body.action==='renew'&&!Object.hasOwn(body,'input')){const result=await options.events.renew(actor,binding,key);await afterWrite(current);return json(200,{lease:result});}
  if(body.action!=='progress')throw new PlatformError(400,'INVALID_EXECUTION_ACTION','执行动作无效。');
  const input=object(body.input,['fields','expectedRevision','baselineBinding']);
  const command={...input,spaceId:actor.spaceId,confirmed:true};
  // Metadata readiness uses the same bounded business pool. It was checked
  // before entering the writer and is checked again after; never recursively
  // acquire another business connection while holding this transaction.
  const result=await options.requirements.mutate(actor.ownerId,binding.requirementId,command,key,mutationGuard??current,tx=>assertAgentGrant(tx,actor,['requirements:read','requirements:write'],operationId),binding);
  await afterWrite(current);let observed;
  try{observed=await options.requirements.get(actor.ownerId,result.entry.id);await current();}catch{return json(200,{...result,verification:{verified:false},outcome:'unverified',retry:{operationId,leaseId:binding.id,idempotencyKey:key,input:body}});}
  const exact=observed.sourceId===result.entry.sourceId&&observed.revision===result.entry.revision&&isDeepStrictEqual(observed.fields,result.entry.fields);
  return json(200,{...result,verification:{verified:exact,current:observed,...(!exact?{historicalReceipt:true}:{})}});
 }catch(error){return error instanceof PlatformError?json(error.status,{error:error.code}):json(503,{error:'REQUIREMENT_EVENTS_UNAVAILABLE'});}
};}
