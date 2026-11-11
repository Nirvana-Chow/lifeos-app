import {z} from 'zod';
import type {LifeOSApiClient,OperationResult} from '../mcp-candidate/client.ts';
import {executionLeaseSchema} from '../requirement-events/argument-schemas.ts';
import type {ExecutionLease} from '../requirement-events/contracts.ts';
import {validateRequirementFields} from '../requirements-candidate/domain.ts';

const uuid=z.string().uuid(),digest=z.string().regex(/^[a-f0-9]{64}$/),key=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/);
const assignmentSchema=z.strictObject({jobId:uuid,requirementId:z.union([uuid,z.string().regex(/^LO-[A-Z]+-\d{3}$/)]),sourceId:uuid,workDigest:digest,holderId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/),claimKey:key});
const workflow=z.strictObject({state:z.enum(['in_progress','blocked','awaiting_review','done']),purpose:z.string().max(4096),nextStep:z.string().max(4096)});
const commandSchema=z.discriminatedUnion('command',[
 z.strictObject({command:z.literal('read')}),z.strictObject({command:z.literal('claim')}),
 z.strictObject({command:z.literal('renew'),idempotencyKey:key}),
 z.strictObject({command:z.literal('progress'),expectedRevision:z.number().int().positive().max(2147483647),workflow,idempotencyKey:key}),
]);
export type WorkerAssignment=z.infer<typeof assignmentSchema>;
export type WorkerBusinessClient=Pick<LifeOSApiClient,'execute'|'retry'>;
export type WorkerPending={operationId:string;requestId:string|null;reason:'unknown'|'readback-unverified'};
export type WorkerOutcomeJournal={read():Promise<WorkerPending|null>;remember(pending:WorkerPending):Promise<void>;clear():Promise<void>};
type Options={assignment:WorkerAssignment;client:WorkerBusinessClient;journal:WorkerOutcomeJournal;attest:()=>Promise<void>};
function reject(code:string):never{throw Error(code);}
const map=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);

/** Host-only factory. No credential, arbitrary operation or owner writer is delegated.
 * Native peer attestation and the adopted client/journal are mandatory injected ports.
 * This is a same-UID cooperative boundary, not protection from malicious local code. */
export function createWorkerChannel(options:Options){
 const assignment=Object.freeze(assignmentSchema.parse(options.assignment));
 if(!options.client||!options.journal||typeof options.attest!=='function')reject('WORKER_HOST_NOT_READY');
 let lease:ExecutionLease|null=null,pending:WorkerPending|null=null,tail:Promise<unknown>=Promise.resolve();
 const serial=<T>(run:()=>Promise<T>):Promise<T>=>{const next=tail.then(run);tail=next.catch(()=>undefined);return next;};
 const read=async()=>{
  const result=await options.client.execute('getRequirement',{id:assignment.requirementId});
  const entry=result.data?.entry,execution=result.data?.execution;
  if(!result.ok||!map(entry)||!map(execution)||entry.id!==assignment.requirementId||entry.sourceId!==assignment.sourceId||entry.baselineConflict===true||execution.requirementId!==assignment.requirementId||execution.sourceId!==assignment.sourceId||execution.workDigest!==assignment.workDigest||execution.revision!==entry.revision)reject('WORKER_ASSIGNMENT_CHANGED');
  validateRequirementFields(entry.fields);return{result,entry,execution};
 };
 const live=(execution:Record<string,any>)=>{
  const current=executionLeaseSchema.parse(execution.lease);
  if(!lease||execution.state!=='running'||execution.leaseActive!==true||current.id!==lease.id||current.fence!==lease.fence||execution.fence!==lease.fence||current.grantId!==lease.grantId||current.requirementId!==assignment.requirementId||current.sourceId!==assignment.sourceId||current.workDigest!==assignment.workDigest||current.holderId!==assignment.holderId)reject('WORKER_LEASE_LOST');
  return current;
 };
 const remember=async(operationId:string,result:OperationResult)=>{
  if(result.outcome==='unknown'||result.ok&&result.verification?.verified!==true){
   pending={operationId,requestId:result.recovery?.requestId??null,reason:result.outcome==='unknown'?'unknown':'readback-unverified'};
   // Retain the in-memory blockade even when durable metadata persistence fails.
   // The existing client remains owner of original body/key/receipt recovery.
   await options.journal.remember(pending);
  }
  return result;
 };
 return{
  assignment,
  async handle(input:unknown):Promise<OperationResult>{
   const parsed=commandSchema.safeParse(input);if(!parsed.success)reject('WORKER_INPUT_REJECTED');const command=parsed.data;
   return serial(async()=>{
    await options.attest();
    if(command.command==='read')return(await read()).result;
    if(pending||await options.journal.read())reject('WORKER_OUTCOME_UNCERTAIN');
    const current=await read();
    if(command.command==='claim'){
     const result=await remember('claimRequirementExecution',await options.client.execute('claimRequirementExecution',{requirementId:assignment.requirementId,workDigest:assignment.workDigest,holderId:assignment.holderId,idempotencyKey:assignment.claimKey}));
     if(result.ok&&result.verification?.verified===true){const value=executionLeaseSchema.parse(result.data?.lease);if(value.requirementId!==assignment.requirementId||value.sourceId!==assignment.sourceId||value.workDigest!==assignment.workDigest||value.holderId!==assignment.holderId)reject('WORKER_LEASE_LOST');lease=value;}
     return result;
    }
    const active=live(current.execution);
    if(command.command==='renew'){
     const result=await remember('updateRequirementExecution',await options.client.execute('updateRequirementExecution',{id:active.id,action:'renew',lease:active,idempotencyKey:command.idempotencyKey}));
     if(result.ok&&result.verification?.verified===true)lease=executionLeaseSchema.parse(result.data?.lease);
     return result;
    }
    if(current.entry.revision!==command.expectedRevision)reject('WORKER_REVISION_CHANGED');
    const fields={...structuredClone(current.entry.fields),workflow:command.workflow};
    return remember('updateRequirementExecution',await options.client.execute('updateRequirementExecution',{id:active.id,action:'progress',lease:active,input:{fields,expectedRevision:command.expectedRevision,baselineBinding:current.entry.baselineBinding},idempotencyKey:command.idempotencyKey}));
   });
  },
  /** Operator-only recovery; deliberately absent from model tool/command grammar. */
  settlePending():Promise<OperationResult>{return serial(async()=>{
   await options.attest();const original=pending??await options.journal.read();
   if(!original?.requestId)reject('WORKER_ORIGINAL_RECOVERY_REQUIRED');
   const result=await options.client.retry(original.requestId);
   if(result.ok&&result.verification?.verified===true){pending=null;await options.journal.clear();}
   return result;
  });},
 };
}
export type WorkerChannel=ReturnType<typeof createWorkerChannel>;
