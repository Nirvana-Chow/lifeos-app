import type {OperationScope} from '../agent-api/personal-operation-registry.ts';
import type {AgentGrantBinding} from '../agent-api/grant-fence.ts';
import type {WindowMode,WindowPosition,WindowRow} from './window-contracts.ts';
import type {TodoDraft,FinanceDraft,InboxDraft} from './domain.ts';
export type Kind='todo'|'finance'|'inbox';
export type Principal={userId:string;email:string};
export type SourceEvidence={id:string;system:'website';externalId:string;version:number;asOf:string;original:unknown};
export type StoredEntry={id:string;ownerId:string;kind:Kind;inboxId?:string;draft:TodoDraft|FinanceDraft|InboxDraft;source:SourceEvidence;revision:number;createdAt:string;updatedAt:string;syncState:'draft';externalStatus:null};
export type PublicEntry=Omit<StoredEntry,'ownerId'>;
export type MutationResult={entry:PublicEntry;duplicate:boolean};
export type Receipt={digest:string;result:MutationResult};
export interface Transaction {
 /** Fixed event commands/projection on this original owner transaction only. */
 readRequirementExecutionCommand?(binding:import('../requirement-events/admission.ts').ExecutionCommandBinding):Promise<{digest:string;response:unknown}|null>;
 projectRequirementExecution?(binding:import('../requirement-events/admission.ts').ExecutionProjectionBinding):Promise<import('../requirement-events/contracts.ts').Work&{leaseActive?:boolean}>;
 admitRequirementExecution?(binding:import('../requirement-events/admission.ts').ExecutionAdmissionBinding):Promise<import('../requirement-events/admission.ts').AdmissionResult>;
 /** Optional, default-closed worker fence on this same transaction/connection. */
 assertRequirementExecutionLease?(binding:import('../requirement-events/transaction.ts').LeaseWriteBinding):Promise<void>;
 /** Serialize deterministic identities even before the first record exists. */
 lockRecordIdentity?(kind:Kind,id:string):Promise<void>;
 lockAgentGrant?(grant:AgentGrantBinding,requiredScopes:readonly OperationScope[]):Promise<boolean>;
 /** OAuth keeps its current authorization and original grant on this connection. */
 lockOAuthAgentGrant?(grant:AgentGrantBinding,requiredScopes:readonly OperationScope[]):Promise<boolean>;
 /** Agent-only capability, held until this same transaction ends. */
 lockAgentTodoWriteGrant?(grant: Readonly<{grantId:string;ownerId:string;spaceId:string}>):Promise<boolean>;
 /** Nonlocking discovery on this transaction's connection. Decisions must use
  * a subsequent locked get and revision check, not this preliminary value. */
 peek(kind:Kind,id:string):Promise<StoredEntry|null>;
 /** Lock the row until commit. Refund creation and edits of its source must serialize. */
 get(kind:Kind,id:string):Promise<StoredEntry|null>;
 /** Called while the source row is locked; return current linked refunds in this transaction. */
 refundsFor(id:string):Promise<StoredEntry[]>;
 derivedTodo(inboxId:string):Promise<StoredEntry|null>;
 receipt():Promise<Receipt|null>;
 saveReceipt(value:Receipt):Promise<void>;
 write(entry:StoredEntry,raw:unknown,create:boolean):Promise<void>;
}
export interface PlatformRepository {
 /** Consistent current records only; at most 10001 so callers reject overflow. */
 readCurrentSnapshot?(owner:string):Promise<StoredEntry[]>;
 readWindow?(owner:string,mode:WindowMode,position:WindowPosition,limit:number):Promise<WindowRow[]>;
 list(owner:string,kind:Kind):Promise<StoredEntry[]>;
 history(owner:string,kind:Kind,id:string):Promise<StoredEntry[]>;
 exportSnapshot(owner:string):Promise<{entries:StoredEntry[];history:StoredEntry[]}>;
 get(owner:string,kind:Kind,id:string):Promise<StoredEntry|null>;
 transaction<T>(owner:string,key:string,fn:(tx:Transaction)=>Promise<T>):Promise<T>;
}
export interface SessionReader {read(headers:Headers):Promise<Principal|null>}

export interface ClassificationTransaction extends Transaction {
 getClassificationPlan(planId:string):Promise<import('../personal-candidate/classification-contracts.ts').ClassificationPlan|null>;
 lockClassificationPlan(planId:string):Promise<void>;
 saveClassificationPlan(plan:import('../personal-candidate/classification-contracts.ts').ClassificationPlan):Promise<void>;
 classificationApproval(planId:string):Promise<import('../personal-candidate/classification-contracts.ts').ClassificationApproval|null>;
 saveClassificationApproval(approval:import('../personal-candidate/classification-contracts.ts').ClassificationApproval):Promise<void>;
 classificationReceipt():Promise<import('../personal-candidate/classification-contracts.ts').ClassificationReceipt|null>;
 classificationPlanCommitted(planId:string):Promise<boolean>;
 classificationPlanReceipt(planId:string):Promise<import('../personal-candidate/classification-contracts.ts').ClassificationReceipt|null>;
 saveClassificationReceipt(receipt:import('../personal-candidate/classification-contracts.ts').ClassificationReceipt):Promise<void>;
}
export interface ClassificationRepository extends PlatformRepository {
 classificationTransaction<T>(owner:string,spaceId:string,key:string,fn:(tx:ClassificationTransaction)=>Promise<T>):Promise<T>;
}
