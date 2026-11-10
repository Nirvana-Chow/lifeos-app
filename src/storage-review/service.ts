import {createHash,randomUUID} from 'node:crypto';
import type {PlatformRepository,StoredEntry,PublicEntry,MutationResult,Transaction} from '../platform/contracts.ts';
import type {InboxDraft} from '../platform/domain.ts';
import {PlatformError,validateId,validateRevision} from '../platform/domain.ts';
import {storageReviewMarker,validateChecklistCommand,validateDecisionCommand,validateReviewSnapshot,validateStorageReviewKey,storageReviewJsonBytes,type ReviewSnapshot} from './domain.ts';

type ReviewDraft=InboxDraft&{storageReview:ReviewSnapshot};
type ReviewEntry=StoredEntry&{draft:ReviewDraft};
type Config={ownerId:string;spaceId:string};
const missing=()=>new PlatformError(404,'NOT_FOUND','没有可访问的个人审核记录。');
const unavailable=()=>new PlatformError(503,'STORAGE_REVIEW_UNAVAILABLE','审核记录暂不可读取。');
const canonical=(value:unknown):string=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}':JSON.stringify(value);
const digest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
const staticDraft={title:'个人存储审核',text:'仅保存审核状态；审核清单由私有审核入口提供。',occurredOn:null,disposition:'reference' as const};
function recordId(owner:string,spaceId:string){
 const hex=createHash('sha256').update(JSON.stringify(['personal-storage-review-v1',owner,spaceId])).digest('hex').slice(0,32).split('');hex[12]='5';hex[16]=((parseInt(hex[16]!,16)&3)|8).toString(16);
 const value=hex.join('');return`${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
}
function originalOf(entry:unknown):Record<string,unknown>|null{
 if(!entry||typeof entry!=='object'||Array.isArray(entry))return null;
 const source=(entry as Record<string,unknown>).source;if(!source||typeof source!=='object'||Array.isArray(source))return null;
 const original=(source as Record<string,unknown>).original;return original&&typeof original==='object'&&!Array.isArray(original)?original as Record<string,unknown>:null;
}
/** Hide even malformed tagged rows from generic inbox projections. */
export function isStorageReviewEntry(entry:unknown):boolean{
 if(!entry||typeof entry!=='object'||Array.isArray(entry))return false;
 const value=entry as Record<string,unknown>,original=originalOf(value),draft=value.draft&&typeof value.draft==='object'&&!Array.isArray(value.draft)?value.draft as Record<string,unknown>:null;
 return original?.marker===storageReviewMarker||!!draft&&Object.hasOwn(draft,'storageReview');
}
function checkedEntry(entry:StoredEntry|null,owner:string,spaceId:string,id:string):ReviewEntry{
 if(!entry||entry.ownerId!==owner||entry.kind!=='inbox'||entry.id!==id||entry.syncState!=='draft'||entry.externalStatus!==null)throw unavailable();
 const source=entry.source,original=originalOf(entry);
 if(!source||source.system!=='website'||source.externalId!==id||source.version!==1||!original||Object.keys(original).sort().join(',')!=='marker,spaceId'||original.marker!==storageReviewMarker||original.spaceId!==spaceId)throw unavailable();
 const draft=entry.draft as unknown as Record<string,unknown>;
 if(!draft||Object.keys(draft).sort().join(',')!=='disposition,occurredOn,storageReview,text,title'||draft.title!==staticDraft.title||draft.text!==staticDraft.text||draft.occurredOn!==null||draft.disposition!=='reference')throw unavailable();
 try{
  validateId(entry.id);validateId(source.id);validateRevision(entry.revision);
  const state=validateReviewSnapshot(draft.storageReview);
  if(state.revision!==entry.revision)throw Error();
  return{...entry,draft:{...staticDraft,storageReview:state}} as ReviewEntry;
 }catch{throw unavailable();}
}
function snapshot(entry:ReviewEntry):ReviewSnapshot{return structuredClone(entry.draft.storageReview);}
function entryFrom(owner:string,id:string,spaceId:string,current:ReviewEntry|null,state:ReviewSnapshot):ReviewEntry{
 if(storageReviewJsonBytes(state)>131072)throw new PlatformError(413,'STORAGE_REVIEW_TOO_LARGE','审核状态超过安全持久化上限。');
 state=validateReviewSnapshot(state);
 const now=new Date().toISOString();
 return{...(current??{} as ReviewEntry),id,ownerId:owner,kind:'inbox',draft:{...staticDraft,storageReview:structuredClone(state)},source:current?.source??{id:randomUUID(),system:'website',externalId:id,version:1,asOf:now,original:{marker:storageReviewMarker,spaceId}},revision:state.revision,createdAt:current?.createdAt??now,updatedAt:now,syncState:'draft',externalStatus:null} as ReviewEntry;
}
function saved(entry:ReviewEntry,duplicate=false):MutationResult{return{entry:(()=>{const {ownerId,...publicValue}=structuredClone(entry);void ownerId;return publicValue;})() as PublicEntry,duplicate};}
function snapshotFromReceipt(raw:unknown,owner:string,spaceId:string,id:string):ReviewSnapshot{
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error();
  const result=(raw as Record<string,unknown>).entry;if(!result||typeof result!=='object'||Array.isArray(result))throw Error();
  const entry={...(result as StoredEntry),ownerId:owner};return snapshot(checkedEntry(entry,owner,spaceId,id));
 }catch{throw unavailable();}
}
async function identityLock(tx:Transaction,id:string){if(!tx.lockRecordIdentity)throw new PlatformError(503,'STORAGE_REVIEW_LOCK_UNAVAILABLE','审核记录身份锁尚未配置。');await tx.lockRecordIdentity('inbox',id);}
function guardFn(guard?:()=>Promise<void>){return guard??(async()=>{});}
function same(a:unknown,b:unknown){return canonical(a)===canonical(b);}

export class StorageReviewService{
 private repository:PlatformRepository;private config:Config;private id:string;
 constructor(repository:PlatformRepository,config:Config){
  if(!config||typeof config.ownerId!=='string'||!config.ownerId||typeof config.spaceId!=='string'||!config.spaceId)throw new TypeError('Storage review owner and space are required');
  this.repository=repository;this.config={...config};this.id=recordId(config.ownerId,config.spaceId);
 }
 private authorize(owner:string){if(owner!==this.config.ownerId)throw missing();}
 private async locate(owner:string):Promise<ReviewEntry|null>{
  const entry=await this.repository.get(owner,'inbox',this.id);return entry?checkedEntry(entry,owner,this.config.spaceId,this.id):null;
 }
 async get(owner:string):Promise<ReviewSnapshot|null>{this.authorize(owner);const entry=await this.locate(owner);return entry?snapshot(entry):null;}
 async saveChecklist(owner:string,input:unknown,key:string,guard?:()=>Promise<void>):Promise<ReviewSnapshot>{
  this.authorize(owner);validateStorageReviewKey(key);const command=validateChecklistCommand(input),raw=structuredClone(command),commandDigest=digest({action:storageReviewMarker,owner,spaceId:this.config.spaceId,kind:'checklist',input:raw}),checkGuard=guardFn(guard);
  if(storageReviewJsonBytes({owner,spaceId:this.config.spaceId,input:raw})>131072)throw new PlatformError(413,'STORAGE_REVIEW_TOO_LARGE','审核请求超过安全大小上限。');
  await checkGuard();
  return this.repository.transaction(owner,key,async tx=>{
   await checkGuard();const receipt=await tx.receipt();
   if(receipt){if(receipt.digest!==commandDigest)throw new PlatformError(409,'COMMAND_CONFLICT','该请求标识已用于不同内容。');return snapshotFromReceipt(receipt.result,owner,this.config.spaceId,this.id);}
   await identityLock(tx,this.id);const rawEntry=await tx.get('inbox',this.id),current=rawEntry?checkedEntry(rawEntry,owner,this.config.spaceId,this.id):null;
   if(!current){if(command.expectedRevision!==null)throw new PlatformError(409,'REVISION_CONFLICT','审核状态已变化，请重新读取。');}
   else if(command.expectedRevision!==current.revision)throw new PlatformError(409,'REVISION_CONFLICT','审核状态已变化，请重新读取。');
   let state:ReviewSnapshot;
   if(current&&command.checklist.revision===current.draft.storageReview.checklist.revision){
    if(!same(command.checklist,current.draft.storageReview.checklist))throw new PlatformError(409,'CHECKLIST_REVISION_CONFLICT','相同清单版本不能替换内容。');
    state=snapshot(current);const result=saved(current);await tx.saveReceipt({digest:commandDigest,result});return state;
   }else{
    if(current&&current.revision===2147483647)throw new PlatformError(409,'REVISION_LIMIT','审核状态版本已达上限。');
    state={revision:(current?.revision??0)+1,checklist:command.checklist,decisions:[]};
    const entry=entryFrom(owner,this.id,this.config.spaceId,current,state);await checkGuard();await tx.write(entry as StoredEntry,raw,!current);
    const result=saved(entry);await tx.saveReceipt({digest:commandDigest,result});return state;
   }
   const entry=entryFrom(owner,this.id,this.config.spaceId,current,state),result=saved(entry);await tx.saveReceipt({digest:commandDigest,result});return state;
  });
 }
 async saveDecision(owner:string,input:unknown,key:string,guard?:()=>Promise<void>):Promise<ReviewSnapshot>{
  this.authorize(owner);validateStorageReviewKey(key);const command=validateDecisionCommand(input),raw=structuredClone(command),commandDigest=digest({action:storageReviewMarker,owner,spaceId:this.config.spaceId,kind:'decision',input:raw}),checkGuard=guardFn(guard);
  if(storageReviewJsonBytes({owner,spaceId:this.config.spaceId,input:raw})>131072)throw new PlatformError(413,'STORAGE_REVIEW_TOO_LARGE','审核请求超过安全大小上限。');
  await checkGuard();
  return this.repository.transaction(owner,key,async tx=>{
   await checkGuard();const receipt=await tx.receipt();
   if(receipt){if(receipt.digest!==commandDigest)throw new PlatformError(409,'COMMAND_CONFLICT','该请求标识已用于不同内容。');return snapshotFromReceipt(receipt.result,owner,this.config.spaceId,this.id);}
   await identityLock(tx,this.id);const rawEntry=await tx.get('inbox',this.id);if(!rawEntry)throw missing();const current=checkedEntry(rawEntry,owner,this.config.spaceId,this.id),old=current.draft.storageReview;
   if(command.expectedRevision!==current.revision||command.checklistRevision!==old.checklist.revision)throw new PlatformError(409,'REVISION_CONFLICT','审核状态或清单版本已变化，请重新读取。');
   const item=old.checklist.items.find(value=>value.id===command.id);if(!item||item.status!=='pending')throw new PlatformError(409,'PROTECTED_ITEM','仅待处理条目可以修改处置。');
   const decisions=old.decisions.filter(value=>value.id!==command.id);
   if(command.decision!==null)decisions.push({id:command.id,decision:command.decision});
   decisions.sort((a,b)=>old.checklist.items.findIndex(value=>value.id===a.id)-old.checklist.items.findIndex(value=>value.id===b.id));
   if(same(decisions,old.decisions)){
    await tx.saveReceipt({digest:commandDigest,result:saved(current)});return snapshot(current);
   }
   if(current.revision===2147483647)throw new PlatformError(409,'REVISION_LIMIT','审核状态版本已达上限。');
   const state:ReviewSnapshot={revision:current.revision+1,checklist:old.checklist,decisions},entry=entryFrom(owner,this.id,this.config.spaceId,current,state);
   await checkGuard();await tx.write(entry as StoredEntry,raw,false);const result=saved(entry);await tx.saveReceipt({digest:commandDigest,result});return state;
  });
 }
}
