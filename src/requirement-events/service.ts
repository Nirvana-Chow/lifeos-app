import {createHash,randomUUID} from 'node:crypto';
import {PlatformError,validateId,validateIdempotencyKey} from '../platform/domain.ts';
import {requirementId} from '../requirements-candidate/domain.ts';
import {eventOperations,type Claim,type EventActor,type EventStore,type ExecutionLease,type Work} from './contracts.ts';
export const leaseDuration=120000,maxAttempts=3,maxBatch=100;
function fail(status:number,code:string):never{throw new PlatformError(status,code,code);}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function cursor(value:unknown):string{if(typeof value!=='string'||! /^(0|[1-9][0-9]{0,18})$/.test(value)||BigInt(value)>9223372036854775807n)return fail(400,'INVALID_EVENT_CURSOR');return value;}

function assertActor(actor:EventActor,write=false){if(actor.kind!=='agent-grant'||!actor.ownerId||!actor.spaceId||!actor.grantId||!actor.scopes.includes('requirements:read')||write&&!actor.scopes.includes('requirements:write'))fail(403,'ACCESS_DENIED');}
function runnable(work:Work){return work.attempts<maxAttempts&&work.state==='ready'&&work.lease===null;}
export function assertLiveLease(work:Work|null,lease:ExecutionLease,actor:EventActor,now:number){
 if(!work||work.state!=='running'||!work.lease||work.lease.id!==lease.id||work.fence!==lease.fence||work.workDigest!==lease.workDigest||work.sourceId!==lease.sourceId||work.lease.holderId!==lease.holderId||work.lease.grantId!==actor.grantId||lease.grantId!==actor.grantId||work.lease.expiresAt<=now)fail(409,'EXECUTION_LEASE_LOST');
 return work;
}
export class RequirementEventService{
 readonly store:EventStore;
 constructor(store:EventStore){this.store=store;}
 async batch(actor:EventActor,after:string){assertActor(actor);after=cursor(after);return this.store.transaction(actor,eventOperations.stream,async tx=>{const page=await tx.replay(after,maxBatch),ready=(await tx.ready(maxBatch+1)).filter(runnable);return{...page,ready:ready.slice(0,maxBatch).map(work=>({...work,state:'ready' as const,lease:null})),readyTruncated:ready.length>maxBatch};});}
 async claim(actor:EventActor,input:Claim):Promise<ExecutionLease>{
  assertActor(actor,true);const id=requirementId(input.requirementId);validateIdempotencyKey(input.requestId);
  if(!/^[a-f0-9]{64}$/.test(input.workDigest)||! /^(?:[A-Za-z0-9][A-Za-z0-9._:-]{0,95})$/.test(input.holderId))fail(400,'INVALID_EXECUTION_CLAIM');
  const commandDigest=digest([id,input.workDigest,input.holderId,actor.grantId]);
  return this.store.transaction(actor,eventOperations.claim,async tx=>{
   const receipt=await tx.claimReceipt(input.requestId);if(receipt){if(receipt.digest!==commandDigest)fail(409,'COMMAND_CONFLICT');return receipt.lease;}
   const work=await tx.get(id),now=await tx.now();
   if(!work||work.workDigest!==input.workDigest)fail(409,'REQUIREMENT_WORK_CHANGED');
   if(work.attempts>=maxAttempts)fail(409,'EXECUTION_ATTEMPTS_EXHAUSTED');
   // Time cannot prove the old process stopped or reconcile a possible result.
   // Keep its lease and receipt until a separately qualified takeover decides.
   if(work.state==='running'&&work.lease&&work.lease.expiresAt<=now)fail(409,'EXECUTION_RECONCILIATION_REQUIRED');
   if(!runnable(work))fail(409,'EXECUTION_ALREADY_CLAIMED');
   const lease:ExecutionLease={id:randomUUID(),requirementId:id,sourceId:work.sourceId,revision:work.revision,workDigest:work.workDigest,holderId:input.holderId,grantId:actor.grantId,fence:work.fence+1,expiresAt:now+leaseDuration};
   await tx.put({...work,state:'running',fence:lease.fence,attempts:work.attempts+1,lease});await tx.saveClaimReceipt(input.requestId,{digest:commandDigest,lease});return lease;
  });
 }
 async inspect(actor:EventActor,id:string){assertActor(actor);return this.store.transaction(actor,'getRequirement',async tx=>{const work=await tx.get(requirementId(id)),now=await tx.now();return work?{...work,leaseActive:work.state==='running'&&!!work.lease&&work.lease.expiresAt>now}:null;});}
 async renew(actor:EventActor,lease:ExecutionLease,requestId?:string):Promise<ExecutionLease>{assertActor(actor,true);if(requestId)validateIdempotencyKey(requestId);return this.store.transaction(actor,eventOperations.update,async tx=>{if(requestId){const prior=await tx.claimReceipt(requestId);if(prior){if(prior.digest!==digest(['renew',lease]))fail(409,'COMMAND_CONFLICT');return prior.lease;}}const locked=await tx.get(requirementId(lease.requirementId)),now=await tx.now(),work=assertLiveLease(locked,lease,actor,now),updated={...work.lease!,expiresAt:now+leaseDuration};await tx.put({...work,lease:updated});if(requestId)await tx.saveClaimReceipt(requestId,{digest:digest(['renew',lease]),lease:updated});return updated;});}
}
