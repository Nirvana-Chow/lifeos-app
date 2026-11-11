import type {TrustedAgentActor} from '../agent-authority/contracts.ts';
export type EventActor=TrustedAgentActor;
export type DispatchState='candidate'|'ready'|'running'|'blocked'|'awaiting_review'|'done'|'paused'|'cancelled';
export type ExecutionLease={id:string;requirementId:string;sourceId:string;revision:number;workDigest:string;holderId:string;grantId:string;fence:number;expiresAt:number};
export type ExecutionFence=Pick<ExecutionLease,'id'|'holderId'|'grantId'|'fence'|'workDigest'>;
export type Work={requirementId:string;sourceId:string;revision:number;workDigest:string;state:DispatchState;attempts:number;fence:number;lease:ExecutionLease|null};
export type WorkEvent={cursor:string;requirementId:string;sourceId:string;revision:number;workDigest:string;state:DispatchState};
export type Claim={requirementId:string;workDigest:string;holderId:string;requestId:string};
export interface EventTransaction{
 now():Promise<number>;
 get(id:string):Promise<Work|null>;
 put(work:Work):Promise<void>;
 replay(cursor:string,limit:number):Promise<{events:WorkEvent[];cursor:string;reset:boolean}>;
 ready(limit:number):Promise<Work[]>;
 claimReceipt(requestId:string):Promise<{digest:string;lease:ExecutionLease}|null>;
 saveClaimReceipt(requestId:string,receipt:{digest:string;lease:ExecutionLease}):Promise<void>;
}
export interface EventStore{transaction<T>(actor:EventActor,operationId:string,run:(tx:EventTransaction)=>Promise<T>):Promise<T>}
export const eventOperations=Object.freeze({stream:'streamRequirementEvents',claim:'claimRequirementExecution',update:'updateRequirementExecution'});
export const streamPath='/api/platform/agent/v1/requirement-events/stream';
export const claimsPath='/api/platform/agent/v1/requirement-events/claims';
