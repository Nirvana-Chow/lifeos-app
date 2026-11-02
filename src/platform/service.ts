import {assertReadableEntries} from './data-compatibility.ts';
import type {CaptureRunEvidence} from '../capture-runs-candidate/contracts.ts';
import {captureRunEvidenceSchema} from '../capture-runs-candidate/repository.ts';
import{validateCaptureConfirmation}from'./capture.ts';
import {createHash,randomUUID} from 'node:crypto';
import {PlatformError,object,todoKeys,financeKeys,inboxKeys,validateTodo,validateFinance,validateInbox,validateId,validateRevision,validateIdempotencyKey} from './domain.ts';
import type {Kind,StoredEntry,PublicEntry,PlatformRepository,MutationResult,Transaction} from './contracts.ts';
import {validateRecordCommand,validateProjectReviewCommand,projectReviewAfterEdit,isRecordEntry,normalizeProjectLinks} from '../records-candidate/domain.ts';
import type {RecordType,RecordFields,RecordMutationResult,ProjectReviewCommand,ProjectLink} from '../records-candidate/contracts.ts';
import {linkKind,projectLinkCandidate} from '../project-candidate/links.ts';
const missing=()=>new PlatformError(404,'NOT_FOUND','没有可访问的记录。');
const canonical=(v:unknown):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}':JSON.stringify(v);
const publicEntry=(e:StoredEntry):PublicEntry=>{const {ownerId,...value}=structuredClone(e);return value;};
const owned=(e:StoredEntry|null,owner:string,kind:Kind,id?:string):e is StoredEntry=>!!e&&e.ownerId===owner&&e.kind===kind&&(!id||e.id===id);
const validate=(kind:Kind,input:unknown)=>kind==='todo'?validateTodo(input):kind==='inbox'?validateInbox(input):validateFinance(input);
export class DraftService {
 private repository:PlatformRepository;
 private trainingWritesEnabled:boolean;
 constructor(repository:PlatformRepository,options:{trainingWritesEnabled?:boolean}={}){this.repository=repository;this.trainingWritesEnabled=options.trainingWritesEnabled===true;}
 async list(owner:string,kind:Kind):Promise<PublicEntry[]>{const rows=(await this.repository.list(owner,kind)).filter(e=>owned(e,owner,kind));assertReadableEntries(rows);return rows.map(publicEntry);}
 async get(owner:string,kind:Kind,id:string):Promise<PublicEntry>{id=validateId(id);const e=await this.repository.get(owner,kind,id);if(!owned(e,owner,kind,id))throw missing();assertReadableEntries([e]);return publicEntry(e);}
 async exportSnapshot(owner:string){const snapshot=await this.repository.exportSnapshot(owner),entries=snapshot.entries.filter(e=>['todo','finance','inbox'].includes(e.kind)&&owned(e,owner,e.kind)),ids=new Set(entries.map(e=>e.id));return{entries:entries.map(publicEntry),history:snapshot.history.filter(e=>ids.has(e.id)&&owned(e,owner,e.kind)).map(publicEntry)};}
 async history(owner:string,kind:Kind,id:string):Promise<PublicEntry[]>{await this.get(owner,kind,id);const rows=(await this.repository.history(owner,kind,id)).filter(e=>owned(e,owner,kind,id));assertReadableEntries(rows);return rows.map(publicEntry);}
 async mutate(owner:string,kind:Kind,id:string|null,input:unknown,key:string):Promise<MutationResult>{
  return this.mutateDraft(owner,kind,id,input,key);
 }
 async mutateRecord(owner:string,type:RecordType,id:string|null,input:unknown,key:string):Promise<RecordMutationResult>{
  if(type==='training'&&!this.trainingWritesEnabled)throw new PlatformError(409,'TRAINING_WRITES_DISABLED','训练写入默认关闭；需要先完成数据兼容、目标数据库和界面验收。已有记录仍可读取及原样导出。');
  const normalized=validateRecordCommand(type,input,id!==null);
  const {confirmed,syntheticOnly,...fields}=input as Record<string,unknown>;
  void confirmed;void syntheticOnly;
  const result=await this.mutateDraft(owner,'inbox',id,{...fields,disposition:'reference'},key,{type,fields:normalized});
  if(!isRecordEntry(result.entry,type))throw missing();
  return{entry:result.entry,duplicate:result.duplicate};
 }
 async reviewProject(owner:string,id:string,input:unknown,key:string):Promise<RecordMutationResult>{
  const review=validateProjectReviewCommand(input);
  const result=await this.mutateDraft(owner,'inbox',id,input,key,{type:'project',review});
  if(!isRecordEntry(result.entry,'project'))throw missing();
  return{entry:result.entry,duplicate:result.duplicate};
 }
 private async mutateDraft(owner:string,kind:Kind,id:string|null,input:unknown,key:string,record?:{type:RecordType;fields:RecordFields}|{type:'project';review:ProjectReviewCommand}):Promise<MutationResult>{
  validateIdempotencyKey(key);if(id)id=validateId(id);
  const review=record&&'review' in record?record.review:undefined;
  const raw=structuredClone(object(input,review?['expectedRevision','decision','evidence','confirmed','syntheticOnly']:[...(kind==='todo'?todoKeys:kind==='inbox'?inboxKeys:financeKeys),...(id?['expectedRevision']:[])]));
  if(kind==='inbox'&&!record&&'record' in raw)throw new PlatformError(400,'RECORD_ROUTE_REQUIRED','类别记录需从对应类别入口核对并确认。');
  const expected=id?validateRevision(raw.expectedRevision):null;
  if(id&&Object.keys(raw).length===1)throw new PlatformError(400,'EMPTY_PATCH','修改内容不能为空。');
  // Typed commands replace the complete editable draft, including defaults for
  // omitted text/date. Raw input remains separate for provenance and receipts.
  const replacement=record&&'fields' in record?{...record.fields,disposition:'reference' as const}:undefined;
  const initial=id?null:replacement??validate(kind,raw);
  const digest=createHash('sha256').update(canonical({kind,id,raw,...(review?{action:'project.review'}:{})})).digest('hex');
  return this.repository.transaction(owner,key,async tx=>{
   const receipt=await tx.receipt();
   if(receipt){if(receipt.digest!==digest)throw new PlatformError(409,'COMMAND_CONFLICT','该请求标识已用于不同内容。');return {...structuredClone(receipt.result),duplicate:true};}
   // Wrong-typed incoming pins may name other project rows. Lock the entire
   // row set in one order (including this project), never project-first. The
   // review peek only discovers lock keys on the SAME connection; all decisions
   // use the later locked value and expectedRevision check.
   const locked=new Map<string,StoredEntry|null>();
   if(record?.type==='project'){
    let links=normalizeProjectLinks(replacement?.record.type==='project'?replacement.record.links:undefined);
    if(review&&id){const peek=await tx.peek('inbox',id);if(!owned(peek,owner,'inbox',id)||!isRecordEntry(peek,'project')||peek.draft.record.type!=='project')throw missing();links=normalizeProjectLinks(peek.draft.record.links);}
    const rows=new Map<string,{kind:Kind;id:string}>();
    if(id)rows.set('inbox:'+id,{kind:'inbox',id});
    for(const link of links){const kind=linkKind(link.type);rows.set(kind+':'+link.id,{kind,id:link.id});}
    for(const[key,row]of [...rows].sort(([a],[b])=>a.localeCompare(b,'en')))locked.set(key,await tx.get(row.kind,row.id));
   }
   const now=new Date().toISOString();let entry:StoredEntry;
   let oldLinks:ProjectLink[]=[];
   if(id){
    const old=locked.has(kind+':'+id)?locked.get(kind+':'+id)!:await tx.get(kind,id);if(!owned(old,owner,kind,id))throw missing();
    if(record&&!isRecordEntry(old,record.type))throw missing();
    if(kind==='inbox'&&!record&&'record' in old.draft)throw new PlatformError(400,'RECORD_ROUTE_REQUIRED','类别记录需从对应类别入口核对并确认。');
    if(old.revision!==expected)throw new PlatformError(409,'REVISION_CONFLICT','记录已更新，请读取当前版本再核对。');
    if(old.revision===2147483647)throw new PlatformError(409,'REVISION_LIMIT','版本已达候选上限。');
    const {expectedRevision,...patch}=raw;
    let draft=replacement??(review?old.draft:validate(kind,{...old.draft,...patch}));
    if(record?.type==='project'&&isRecordEntry(old,'project')&&old.draft.record.type==='project'){
     oldLinks=normalizeProjectLinks(old.draft.record.links);
     if(review)draft={...old.draft,record:{...old.draft.record,review:{decision:review.decision,evidence:review.evidence}}};
     else if(replacement?.record.type==='project')draft={...replacement,record:{...replacement.record,review:projectReviewAfterEdit(old.draft,replacement)}};
    }
    entry={...old,draft,revision:old.revision+1,updatedAt:now};
    if(old.kind==='finance'&&'kind' in old.draft&&old.draft.kind==='expense'&&'kind' in entry.draft&&(entry.draft.kind!=='expense'||entry.draft.currency!==old.draft.currency)){
     const refunds=await tx.refundsFor(old.id);
     if(refunds.some(e=>owned(e,owner,'finance')&&'kind' in e.draft&&e.draft.kind==='refund'&&e.draft.originalEntryId===old.id))throw new PlatformError(409,'LINKED_REFUNDS','已有退款关联此支出，不能改变其流水类型或币种。');
    }
   }else{
    const recordId=randomUUID(),sourceId=randomUUID();
    entry={id:recordId,ownerId:owner,kind,draft:initial!,source:{id:sourceId,system:'website',externalId:recordId,version:1,asOf:now,original:raw},revision:1,createdAt:now,updatedAt:now,syncState:'draft',externalStatus:null};
   }
   if(record?.type==='project'&&'record' in entry.draft&&entry.draft.record?.type==='project'&&review?.decision!=='rejected'){
    for(const link of normalizeProjectLinks(entry.draft.record.links)){
     const unchanged=oldLinks.some(old=>old.type===link.type&&old.id===link.id&&old.sourceId===link.sourceId&&old.revision===link.revision);
     if(!review&&unchanged)continue;
     const target=locked.get(linkKind(link.type)+':'+link.id),candidate=owned(target??null,owner,linkKind(link.type),link.id)?projectLinkCandidate(target,link.type):null;
     if(!candidate||candidate.link.sourceId!==link.sourceId||candidate.link.revision!==link.revision)throw new PlatformError(409,'PROJECT_LINK_UNAVAILABLE','关联记录已变化或暂不可用，请重新核对后保存。');
    }
   }
   await this.checkRefund(tx,entry,owner);
   await tx.write(entry,raw,!id);
   const result={entry:publicEntry(entry),duplicate:false};await tx.saveReceipt({digest,result});return result;
  });
 }
 async captureConfirmed(owner:string,input:unknown,key:string,evidence?:CaptureRunEvidence):Promise<MutationResult>{
  validateIdempotencyKey(key);const value=validateCaptureConfirmation(input),digest=createHash('sha256').update(canonical({action:'capture.confirm',raw:value.raw})).digest('hex');
  return this.repository.transaction(owner,key,async tx=>{
   const prior=await tx.receipt();if(prior){if(prior.digest!==digest)throw new PlatformError(409,'COMMAND_CONFLICT','该请求标识已用于不同内容。');return{...structuredClone(prior.result),duplicate:true};}
   if(value.raw.runId!==undefined){const proof=captureRunEvidenceSchema.safeParse(evidence);if(!proof.success||proof.data.id!==value.raw.runId)throw new PlatformError(503,'CAPTURE_RUN_UNAVAILABLE','运行凭证暂不可核对，未确认保存。');Object.assign(value.original.capture,{runReceipt:proof.data,modelRunVerified:proof.data.provenance!==null,realModelConfigured:proof.data.provenance?.mode==='approved-live'});}
   const now=new Date().toISOString(),id=randomUUID(),entry:StoredEntry={id,ownerId:owner,kind:value.kind,draft:value.draft,source:{id:randomUUID(),system:'website',externalId:id,version:1,asOf:now,original:value.original},revision:1,createdAt:now,updatedAt:now,syncState:'draft',externalStatus:null};
   await tx.write(entry,value.raw,true);const result={entry:publicEntry(entry),duplicate:false};await tx.saveReceipt({digest,result});return result;
  });
 }
 async createTodoFromInbox(owner:string,id:string,input:unknown,key:string):Promise<MutationResult>{
  id=validateId(id);validateIdempotencyKey(key);const raw=structuredClone(object(input,['expectedRevision','title','dueOn'])),expected=validateRevision(raw.expectedRevision);
  const digest=createHash('sha256').update(canonical({action:'inbox.to-todo',id,raw})).digest('hex');
  return this.repository.transaction(owner,key,async tx=>{
   const prior=await tx.receipt();if(prior){if(prior.digest!==digest)throw new PlatformError(409,'COMMAND_CONFLICT','请求标识已用于不同内容。');return{...structuredClone(prior.result),duplicate:true};}
   const inbox=await tx.get('inbox',id);if(!owned(inbox,owner,'inbox',id))throw missing();
   if(inbox.revision!==expected||inbox.revision===2147483647)throw new PlatformError(409,'REVISION_CONFLICT','收件箱版本已变化，请读取后确认。');
   if(!('disposition' in inbox.draft)||inbox.draft.disposition!=='pending')throw new PlatformError(409,'INBOX_DISPOSITION','仅资料或无需行动的记录不能直接创建待办。');
   if(await tx.derivedTodo(id))throw new PlatformError(409,'INBOX_ALREADY_LINKED','此记录已有待办，请查看关联事项。');
   const draft=validateTodo({title:raw.title===undefined?inbox.draft.title:raw.title,notes:inbox.draft.text,dueOn:raw.dueOn,status:'open'}),now=new Date().toISOString(),recordId=randomUUID();
   const original={...draft,originInbox:{id,sourceId:inbox.source.id,revision:inbox.revision}};
   const task:StoredEntry={id:recordId,ownerId:owner,kind:'todo',inboxId:id,draft,source:{id:randomUUID(),system:'website',externalId:recordId,version:1,asOf:now,original},revision:1,createdAt:now,updatedAt:now,syncState:'draft',externalStatus:null};
   await tx.write({...inbox,revision:inbox.revision+1,updatedAt:now},{action:'confirmed-task',taskId:recordId},false);await tx.write(task,original,true);
   const result={entry:publicEntry(task),duplicate:false};await tx.saveReceipt({digest,result});return result;
  });
 }
 private async checkRefund(tx:Transaction,e:StoredEntry,owner:string):Promise<void>{
  if(e.kind!=='finance'||!('kind' in e.draft)||e.draft.kind!=='refund')return;
  const original=await tx.get('finance',e.draft.originalEntryId!);
  if(!owned(original,owner,'finance')||original.id===e.id)throw missing();
  if(!('kind' in original.draft)||original.draft.kind!=='expense'||original.draft.currency!==e.draft.currency)throw new PlatformError(400,'INVALID_REFUND_SOURCE','退款需要关联同币种支出；不修改原流水。');
 }
}
