import {randomUUID} from 'node:crypto';
import {AuthorityService} from '../agent-authority/service.ts';
import type {TrustedActor} from '../agent-authority/contracts.ts';
import {assertAgentGrant} from '../agent-api/grant-fence.ts';
import type {AgentScope} from '../agent-api/scopes.ts';
import type {ClassificationRepository,ClassificationTransaction,StoredEntry} from '../platform/contracts.ts';
import {object,PlatformError,validateId,validateIdempotencyKey,type TodoDraft} from '../platform/domain.ts';
import type {PersonalConfig} from './config.ts';
import {personalEntryType} from './service.ts';
import {personalReferences} from './business.ts';
import {lockPersonalRecords} from './personal-record-locks.ts';
import {classificationCanonical,classificationDigest,classificationPlanDigest,classificationBindingsDigest,classificationNoOp,decodeChanges,decodePlan,decodeApproval,decodeReceipt,assertApprovalMatchesPlan,type ClassificationChange,type ClassificationPlan,type ClassificationPreview,type ClassificationApproval,type ClassificationResult,type ClassificationReview} from './classification-contracts.ts';
import {assertReceiptMatchesPlan} from './classification-postgres.ts';
const readScopes:readonly AgentScope[]=['todo:read','organization:read'];
const commitScopes:readonly AgentScope[]=['todo:read','todo:write','organization:read'];
const fail=(status:number,code:string):never=>{throw new PlatformError(status,code,'分类操作未完成，请保留原请求并重新核对。');};
const conflict=():never=>fail(409,'CLASSIFICATION_CONFLICT');
export function classificationConfirmation(input:unknown,withPlan=true):{planId:string;digest:string;confirmed:true}{
 const raw=object(input,withPlan?['planId','digest','confirmed']:['digest','confirmed']);
 if(raw.confirmed!==true||typeof raw.digest!=='string'||!/^[a-f0-9]{64}$/.test(raw.digest))return fail(400,'INVALID_CLASSIFICATION');
 return{planId:withPlan?validateId(raw.planId):'',digest:raw.digest,confirmed:true};
}
export function classificationPolicyRevision(config:PersonalConfig){return classificationDigest({version:'todo-classification-policy-v1',ownerId:config.ownerId,spaceId:config.spaceId,allowedTypes:config.allowedTypes});}
type Options={authority:AuthorityService;assertReady:()=>Promise<void>;assertWritable:()=>Promise<void>;policyRevision:()=>string;now?:()=>number};
/** One transaction and the original record/history writer for every entrypoint. */
export class ClassificationService {
 private readonly repository:ClassificationRepository;private readonly config:PersonalConfig;private readonly options:Options;
 constructor(repository:ClassificationRepository,config:PersonalConfig,options:Options){this.repository=repository;this.config=Object.freeze(structuredClone(config));this.options=options;}
 private now(){return this.options.now?.()??Date.now();}
 private async authorize(actor:TrustedActor,operation:string,write=false,ready=true){
  if(!actor||actor.kind==='run-capability'||actor.ownerId!==this.config.ownerId||actor.spaceId!==this.config.spaceId)return fail(403,'CLASSIFICATION_AUTHORITY');
  try{await this.options.authority.assertCurrentAuthority(actor,operation);}catch{return fail(403,'CLASSIFICATION_AUTHORITY');}
  // The transaction qualifies its own client; borrowing a second business connection here can deadlock a full pool.
  if(ready)await this.options.assertReady();if(write)await this.options.assertWritable();
 }
 private async fence(tx:ClassificationTransaction,actor:TrustedActor,plan:ClassificationPlan|null,commit=false){
  if(actor.kind==='agent-grant'&&plan&&actor.grantId!==plan.grantId)return fail(403,'CLASSIFICATION_AUTHORITY');
  const grantId=plan?plan.grantId:actor.kind==='agent-grant'?actor.grantId:null;
  if(grantId)await assertAgentGrant(tx,{grantId,ownerId:this.config.ownerId,spaceId:this.config.spaceId},commit&&actor.kind==='agent-grant'?commitScopes:readScopes);
 }
 private async producer(grantId:string|null){if(!grantId)return null;const revision=await this.options.authority.currentProducerRevision(grantId);if(!revision)return fail(403,'CLASSIFICATION_AUTHORITY');return revision;}
 private async current(plan:ClassificationPlan){
  if(plan.ownerId!==this.config.ownerId||plan.spaceId!==this.config.spaceId)return fail(403,'CLASSIFICATION_AUTHORITY');
  if(this.now()>=Date.parse(plan.preview.expiresAt)||plan.policyRevision!==this.options.policyRevision()||plan.producerAuthorizationRevision!==await this.producer(plan.grantId))return conflict();
 }
 private async plan(tx:ClassificationTransaction,id:string){const raw=await tx.getClassificationPlan(id);if(!raw)return fail(404,'CLASSIFICATION_NOT_FOUND');const plan=decodePlan(raw);if(plan.ownerId!==this.config.ownerId||plan.spaceId!==this.config.spaceId)return fail(403,'CLASSIFICATION_AUTHORITY');return plan;}
 private async records(tx:ClassificationTransaction,changes:readonly ClassificationChange[]){
  return lockPersonalRecords(tx,changes.flatMap(change=>[{kind:'todo' as const,id:change.todo.id},...[...personalReferences({personal:change.before} as TodoDraft),...personalReferences({personal:change.after} as TodoDraft)].map(({link})=>({kind:'inbox' as const,id:link.id}))]));
 }
 private validate(changes:readonly ClassificationChange[],records:ReadonlyMap<string,StoredEntry|null>){
  for(const change of changes){const row=records.get(JSON.stringify(['todo',change.todo.id]));
   if(!row||row.ownerId!==this.config.ownerId||personalEntryType(row,this.config.spaceId)!=='todo'||row.source.id!==change.todo.sourceId||row.revision!==change.todo.expectedRevision||classificationCanonical((row.draft as TodoDraft).personal??null)!==classificationCanonical(change.before)||!classificationNoOp(change.before,change.after)&&row.revision===2147483647)return conflict();
   for(const {type,link} of [...personalReferences({personal:change.before} as TodoDraft),...personalReferences({personal:change.after} as TodoDraft)]){const target=records.get(JSON.stringify(['inbox',link.id]));if(!target||target.ownerId!==this.config.ownerId||personalEntryType(target,this.config.spaceId)!==type||target.source.id!==link.sourceId||target.revision!==link.revision)return conflict();}
  }
 }
 async preview(actor:TrustedActor,input:unknown):Promise<ClassificationPreview>{
  const raw=object(input,['changes']),changes=decodeChanges(raw.changes);await this.authorize(actor,'previewTodoClassification');
  return this.repository.classificationTransaction(this.config.ownerId,this.config.spaceId,'preview-'+randomUUID(),async tx=>{
   await this.authorize(actor,'previewTodoClassification',false,false);await this.fence(tx,actor,null);
   const records=await this.records(tx,changes);this.validate(changes,records);
   const grantId=actor.kind==='agent-grant'?actor.grantId:null,createdAt=new Date(this.now()).toISOString();
   const plan:ClassificationPlan={schemaVersion:1,proposalRevision:1,ownerId:this.config.ownerId,spaceId:this.config.spaceId,grantId,producerAuthorizationRevision:await this.producer(grantId),policyRevision:this.options.policyRevision(),createdAt,preview:{planId:randomUUID(),digest:'0'.repeat(64),expiresAt:new Date(Date.parse(createdAt)+30*60*1000).toISOString(),changes,unchangedIds:changes.filter(c=>classificationNoOp(c.before,c.after)).map(c=>c.todo.id)}};
   const complete=decodePlan({...plan,preview:{...plan.preview,digest:classificationPlanDigest(plan)}});await this.authorize(actor,'previewTodoClassification',false,false);await tx.saveClassificationPlan(complete);return structuredClone(complete.preview);
  });
 }
 async review(actor:TrustedActor,id:string):Promise<ClassificationReview>{
  if(actor.kind!=='owner-session')return fail(403,'CLASSIFICATION_AUTHORITY');id=validateId(id);await this.authorize(actor,'reviewTodoClassification');
  return this.repository.classificationTransaction(this.config.ownerId,this.config.spaceId,'review-'+randomUUID(),async tx=>{
   await this.authorize(actor,'reviewTodoClassification',false,false);const plan=await this.plan(tx,id);await this.fence(tx,actor,plan);await tx.lockClassificationPlan(id);
   const records=await this.records(tx,plan.preview.changes);let stale=false;try{await this.current(plan);this.validate(plan.preview.changes,records);}catch(error){if(error instanceof PlatformError&&error.status===409)stale=true;else throw error;}
   const approval=await tx.classificationApproval(id);if(approval)assertApprovalMatchesPlan(approval,plan);
   const todos:ClassificationReview['labels']['todos'][number][]=[],organization:ClassificationReview['labels']['organization'][number][]=[];
   for(const row of records.values()){if(!row||row.ownerId!==this.config.ownerId)continue;const type=personalEntryType(row,this.config.spaceId);if(type==='todo')todos.push({id:row.id,sourceId:row.source.id,revision:row.revision,title:(row.draft as TodoDraft).title});else if(type==='project'||type==='domain'||type==='topic')organization.push({type,id:row.id,sourceId:row.source.id,revision:row.revision,title:'title'in row.draft?row.draft.title:''});}
   await this.authorize(actor,'reviewTodoClassification',false,false);return{preview:plan.preview,approval,committed:await tx.classificationPlanCommitted(id),stale,labels:{todos,organization}};
  });
 }
 async approve(actor:TrustedActor,input:unknown):Promise<ClassificationApproval>{
  if(actor.kind!=='owner-session')return fail(403,'CLASSIFICATION_AUTHORITY');const body=classificationConfirmation(input);await this.authorize(actor,'approveTodoClassification');
  return this.repository.classificationTransaction(this.config.ownerId,this.config.spaceId,'approve-'+randomUUID(),async tx=>{
   await this.authorize(actor,'approveTodoClassification',false,false);const plan=await this.plan(tx,body.planId);await this.fence(tx,actor,plan);await tx.lockClassificationPlan(body.planId);await this.current(plan);
   if(plan.preview.digest!==body.digest||await tx.classificationPlanCommitted(body.planId))return conflict();this.validate(plan.preview.changes,await this.records(tx,plan.preview.changes));await this.current(plan);
   const existing=await tx.classificationApproval(body.planId);if(existing){assertApprovalMatchesPlan(existing,plan);await this.authorize(actor,'approveTodoClassification',false,false);return existing;}
   const approval=decodeApproval({planId:body.planId,proposalRevision:plan.proposalRevision,digest:body.digest,operationIds:['commitTodoClassification'],bindingsDigest:classificationBindingsDigest(plan),producerAuthorizationRevision:plan.producerAuthorizationRevision,policyRevision:plan.policyRevision,approvedAt:new Date(this.now()).toISOString(),expiresAt:plan.preview.expiresAt});assertApprovalMatchesPlan(approval,plan);await this.authorize(actor,'approveTodoClassification',false,false);await tx.saveClassificationApproval(approval);return approval;
  });
 }
 async commit(actor:TrustedActor,input:unknown,key:string):Promise<ClassificationResult>{
  if(actor.kind==='run-capability')return fail(403,'CLASSIFICATION_AUTHORITY');const body=classificationConfirmation(input);validateIdempotencyKey(key);await this.authorize(actor,'commitTodoClassification',true);
  const requestDigest=classificationDigest({action:'todo-classification-v1',ownerId:this.config.ownerId,spaceId:this.config.spaceId,...body});
  return this.repository.classificationTransaction(this.config.ownerId,this.config.spaceId,key,async tx=>{
   await this.authorize(actor,'commitTodoClassification',true,false);const rawReceipt=await tx.classificationReceipt(),receipt=rawReceipt?decodeReceipt(rawReceipt):null;
   const plan=await this.plan(tx,receipt?.planId??body.planId);await this.fence(tx,actor,plan,true);
   if(receipt){assertReceiptMatchesPlan(receipt,plan);if(receipt.requestDigest!==requestDigest)return fail(409,'COMMAND_CONFLICT');await this.authorize(actor,'commitTodoClassification',true,false);return{...structuredClone(receipt.result),duplicate:true};}
   await tx.lockClassificationPlan(body.planId);if(await tx.classificationPlanCommitted(body.planId))return conflict();await this.current(plan);if(plan.preview.digest!==body.digest)return conflict();
   const approval=await tx.classificationApproval(body.planId);if(!approval)return fail(403,'CLASSIFICATION_APPROVAL_REQUIRED');assertApprovalMatchesPlan(approval,plan);
   const records=await this.records(tx,plan.preview.changes);this.validate(plan.preview.changes,records);await this.current(plan);const entries:ClassificationResult['entries'][number][]=[],updatedAt=new Date(this.now()).toISOString();
   for(const change of plan.preview.changes){const old=records.get(JSON.stringify(['todo',change.todo.id]))!;let row=old;
    if(!classificationNoOp(change.before,change.after)){row={...old,draft:{...old.draft,personal:structuredClone(change.after)} as TodoDraft,revision:old.revision+1,updatedAt};await this.authorize(actor,'commitTodoClassification',true,false);await tx.write(row,{action:'todo-classification-v1',planId:body.planId,digest:body.digest,change},false);}
    entries.push({id:row.id,sourceId:row.source.id,revision:row.revision,personal:(row.draft as TodoDraft).personal??null});
   }
   const result:ClassificationResult={planId:body.planId,digest:body.digest,duplicate:false,entries,unchangedIds:plan.preview.unchangedIds};await this.authorize(actor,'commitTodoClassification',true,false);await this.current(plan);await tx.saveClassificationReceipt({requestDigest,planId:body.planId,result});return result;
  });
 }
}
export function createClassificationAdapter(service:ClassificationService){return{preview:(actor:TrustedActor,input:unknown)=>service.preview(actor,input),commit:(actor:TrustedActor,input:unknown,key:string)=>service.commit(actor,input,key)};}
