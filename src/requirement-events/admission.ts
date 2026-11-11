import {createHash} from 'node:crypto';
import {assertAgentGrant} from '../agent-api/grant-fence.ts';
import {PlatformError,object,validateId,validateIdempotencyKey,validateRevision} from '../platform/domain.ts';
import type {PlatformRepository} from '../platform/contracts.ts';
import {requirementId} from '../requirements-candidate/domain.ts';
import type {RequirementItem,RequirementsService} from '../requirements-candidate/service.ts';
import {eventOperations,type EventActor,type Work} from './contracts.ts';
export type ExecutionCommandBinding={spaceId:string;grantId:string;key:string};
export type ExecutionProjectionBinding={spaceId:string;requirementId:string;sourceId:string;revision:number};
export type AdmissionResult={admission:Work;duplicate:boolean};
export type ExecutionAdmissionBinding=ExecutionCommandBinding&{digest:string;projection:Work};
export type AdmissionInput={action:'admit';requirementId:string;sourceId:string;expectedRevision:number;workDigest:string};
const fail=(code:string):never=>{throw new PlatformError(409,code,code);};
export function admissionInput(value:unknown):AdmissionInput{
 const v=object(value,['action','requirementId','sourceId','expectedRevision','workDigest']);
 if(v.action!=='admit'||typeof v.workDigest!=='string'||! /^[a-f0-9]{64}$/.test(v.workDigest))throw new PlatformError(400,'INVALID_EXECUTION_ADMISSION','入队请求无效。');
 return{action:'admit',requirementId:requirementId(v.requirementId),sourceId:validateId(v.sourceId),expectedRevision:validateRevision(v.expectedRevision),workDigest:v.workDigest};
}
const ordinary=(entry:RequirementItem)=>entry.sourceId!==null&&entry.revision>0&&!entry.baselineConflict&&['planned','in_progress'].includes(entry.fields.workflow?.state??'');
const available=(work:Work)=>['candidate','ready'].includes(work.state)&&work.attempts<3&&work.lease===null;
function recoveredAdmission(value:unknown,command:AdmissionInput):AdmissionResult{
 try{
 const saved=object(value,['kind','result']),result=object(saved.result,['admission','duplicate']),work=object(result.admission,['requirementId','sourceId','revision','workDigest','state','attempts','fence','lease']);
 if(saved.kind!=='admission-v1'||result.duplicate!==false||work.requirementId!==command.requirementId||work.sourceId!==command.sourceId||work.revision!==command.expectedRevision||work.workDigest!==command.workDigest||work.state!=='ready'||work.lease!==null||!Number.isInteger(work.attempts)||Number(work.attempts)<0||Number(work.attempts)>2||!Number.isSafeInteger(work.fence)||Number(work.fence)<0)throw new PlatformError(503,'EXECUTION_RECEIPT_INVALID','执行回执无效。');
 return{admission:work as Work,duplicate:true};
 }catch{throw new PlatformError(503,'EXECUTION_RECEIPT_INVALID','执行回执无效。');}
}
/** Used by the restricted PostgreSQL adapter after its owner/space and row locks.
 * Admission never replenishes a generation's attempts or clears a held decision. */
export function admissionTransition(prior:Work|null,projection:Work):{work:Work;changed:boolean}{
 if(prior&&(prior.sourceId!==projection.sourceId||prior.revision!==projection.revision||prior.workDigest!==projection.workDigest))return fail('REQUIREMENT_WORK_CHANGED');
 const current=prior??projection;
 if(!available(current))return fail(current.attempts>=3?'EXECUTION_ATTEMPTS_EXHAUSTED':'EXECUTION_ADMISSION_HELD');
 const {requirementId,sourceId,revision,workDigest,attempts,fence}=current;
 return{work:{requirementId,sourceId,revision,workDigest,attempts,fence,state:'ready',lease:null},changed:current.state!=='ready'||prior===null};
}
/** Composes the existing canonical requirement reader and restricted transaction.
 * No owner fields, workflow, acceptance evidence or original record are rewritten. */
export class RequirementAdmissionService{
 private repository:PlatformRepository;private requirements:RequirementsService;
 constructor(repository:PlatformRepository,requirements:RequirementsService){this.repository=repository;this.requirements=requirements;}
 async read(actor:EventActor,id:string,current:()=>Promise<void>){
  await current();const result=await this.repository.transaction(actor.ownerId,'event-projection:'+requirementId(id),async tx=>{
   await assertAgentGrant(tx,actor,['requirements:read'],'getRequirement');
   const entry=await this.requirements.getInTransaction(actor.ownerId,id,tx);
   if(!entry.sourceId)return{entry,execution:null};
   if(!tx.projectRequirementExecution)throw new PlatformError(503,'EXECUTION_PROJECTION_UNAVAILABLE','执行投影尚未启用。');
   const execution=await tx.projectRequirementExecution({spaceId:actor.spaceId,requirementId:entry.id,sourceId:entry.sourceId,revision:entry.revision});
   return{entry,execution:{...execution,admissionEligible:ordinary(entry)&&available(execution)}};
  });await current();return result;
 }
 async admit(actor:EventActor,input:unknown,key:string,current:()=>Promise<void>,mutationGuard:()=>Promise<void>=async()=>{}):Promise<AdmissionResult>{
  const command=admissionInput(input);validateIdempotencyKey(key);
  const digest=createHash('sha256').update(JSON.stringify(['admission-v1',actor.ownerId,actor.spaceId,actor.grantId,command])).digest('hex');
  await current();const result=await this.repository.transaction(actor.ownerId,key,async tx=>{
   await mutationGuard();await assertAgentGrant(tx,actor,['requirements:read','requirements:write'],eventOperations.claim);
   if(!tx.readRequirementExecutionCommand||!tx.projectRequirementExecution||!tx.admitRequirementExecution)throw new PlatformError(503,'EXECUTION_ADMISSION_UNAVAILABLE','受控入队尚未启用。');
   const binding={spaceId:actor.spaceId,grantId:actor.grantId,key},receipt=await tx.readRequirementExecutionCommand(binding);
   // Current authority remains mandatory. A confirmed historical command is
   // recovered before new-write CAS; later edits cannot force a new command key.
   if(receipt){if(receipt.digest!==digest)return fail('COMMAND_CONFLICT');return recoveredAdmission(receipt.response,command);}
   const entry=await this.requirements.getInTransaction(actor.ownerId,command.requirementId,tx);
   if(entry.sourceId!==command.sourceId||entry.revision!==command.expectedRevision)return fail('REVISION_CONFLICT');
   if(!ordinary(entry))return fail('EXECUTION_ADMISSION_HELD');
   const projection=await tx.projectRequirementExecution({spaceId:actor.spaceId,requirementId:entry.id,sourceId:entry.sourceId!,revision:entry.revision});
   if(projection.workDigest!==command.workDigest)return fail('REQUIREMENT_WORK_CHANGED');
   await mutationGuard();return tx.admitRequirementExecution({...binding,digest,projection});
  });
  // The transaction is already committed. Loss of authority/cancellation here
  // cannot honestly be reported as a rejected new write or invite a new key.
  try{await current();}catch{throw new PlatformError(503,'ADMISSION_OUTCOME_UNVERIFIED','入队回执需要按原请求恢复。');}return result;
 }
}
