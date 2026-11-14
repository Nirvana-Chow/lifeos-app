import {PlatformError,object,validateIdempotencyKey,validateRevision} from '../platform/domain.ts';

export const storageReviewMarker='personal-storage-review-v1';
const fail=(status:number,code:string,message:string):never=>{throw new PlatformError(status,code,message);};
const text=(value:unknown,max:number,field:string,allowEmpty=false)=>{
 if(typeof value!=='string'||value.includes('\0')||value.length>max||!allowEmpty&&!value.trim())return fail(400,'STORAGE_REVIEW_INVALID',`${field}格式无效。`);
 return value;
};
const exact=(value:unknown,keys:readonly string[])=>object(value,keys);
export type StorageReviewItem={id:string;title:string;body:string;question:string;group:string;kind:'file'|'folder'|'media'|'app';status:'pending'|'processed'|'protected'};
export type StorageReviewChecklist={schema:1;revision:string;context:{summary:string};items:StorageReviewItem[]};
export type StorageReviewDecision={id:string;decision:'keep'|'trash'|'defer'};
export type StorageReviewNote={id:string;note:string};
export type ReviewSnapshot={revision:number;checklist:StorageReviewChecklist;decisions:StorageReviewDecision[];notes?:StorageReviewNote[]};
export type SaveChecklistInput={expectedRevision:number|null;checklist:StorageReviewChecklist};
export type SaveDecisionInput={expectedRevision:number;checklistRevision:string;id:string;decision:'keep'|'trash'|'defer'|null};
export type SaveNoteInput={expectedRevision:number;checklistRevision:string;id:string;note:string};

const stableJson=(value:unknown):string=>Array.isArray(value)?'['+value.map(stableJson).join(',')+']':value&&typeof value==='object'?'{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>JSON.stringify(k)+':'+stableJson(v)).join(',')+'}':JSON.stringify(value);
export const storageReviewJsonBytes=(value:unknown)=>Buffer.byteLength(stableJson(value),'utf8');
export function validateChecklist(input:unknown):StorageReviewChecklist{
 const row=exact(input,['schema','revision','context','items']);
 if(row.schema!==1)fail(400,'STORAGE_REVIEW_INVALID','审核清单版本无效。');
 const revision=text(row.revision,128,'清单版本');
 const contextRow=exact(row.context,['summary']);const context={summary:text(contextRow.summary,8000,'审核说明',true)};
 if(!Array.isArray(row.items)||row.items.length>500)return fail(400,'STORAGE_REVIEW_INVALID','审核条目数量超出范围。');
 const ids=new Set<string>();
 const items=row.items.map((value):StorageReviewItem=>{
  const item=exact(value,['id','title','body','question','group','kind','status']);
  const id=text(item.id,128,'条目标识');
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)||ids.has(id))fail(400,'STORAGE_REVIEW_INVALID','条目标识无效或重复。');ids.add(id);
  const kind=item.kind,status=item.status;
  if(typeof kind!=='string'||!['file','folder','media','app'].includes(kind)||typeof status!=='string'||!['pending','processed','protected'].includes(status))fail(400,'STORAGE_REVIEW_INVALID','条目类别或状态无效。');
  return{id,title:text(item.title,240,'标题'),body:text(item.body,16384,'说明',true),question:text(item.question,2000,'问题',true),group:text(item.group,240,'分组',true),kind:kind as StorageReviewItem['kind'],status:status as StorageReviewItem['status']};
 });
 const checklist={schema:1 as const,revision,context,items};
 if(storageReviewJsonBytes(checklist)>122880)fail(413,'STORAGE_REVIEW_TOO_LARGE','审核清单超过安全存储上限。');
 return checklist;
}
export function validateChecklistCommand(input:unknown):SaveChecklistInput{
 const row=exact(input,['expectedRevision','checklist']);
 const expectedRevision=row.expectedRevision===null?null:validateRevision(row.expectedRevision);
 const checklist=validateChecklist(row.checklist);
 if(storageReviewJsonBytes({expectedRevision,checklist})>131072)fail(413,'STORAGE_REVIEW_TOO_LARGE','审核请求超过安全大小上限。');
 return{expectedRevision,checklist};
}
export function validateDecisionCommand(input:unknown):SaveDecisionInput{
 const row=exact(input,['expectedRevision','checklistRevision','id','decision']);
 const expectedRevision=validateRevision(row.expectedRevision),checklistRevision=text(row.checklistRevision,128,'清单版本'),id=text(row.id,128,'条目标识');
 if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)||!(row.decision===null||typeof row.decision==='string'&&['keep','trash','defer'].includes(row.decision)))fail(400,'STORAGE_REVIEW_INVALID','处置选择无效。');
 const value={expectedRevision,checklistRevision,id,decision:row.decision as SaveDecisionInput['decision']};
 if(storageReviewJsonBytes(value)>131072)fail(413,'STORAGE_REVIEW_TOO_LARGE','审核请求超过安全大小上限。');
 return value;
}
export function validateNoteCommand(input:unknown):SaveNoteInput{
 const row=exact(input,['expectedRevision','checklistRevision','id','note']);
 const expectedRevision=validateRevision(row.expectedRevision),checklistRevision=text(row.checklistRevision,128,'清单版本'),id=text(row.id,128,'条目标识'),note=text(row.note,8000,'备注',true);
 if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))fail(400,'STORAGE_REVIEW_INVALID','条目标识无效。');
 return{expectedRevision,checklistRevision,id,note};
}
export function assertNotedItemsRetained(previous:ReviewSnapshot,next:StorageReviewChecklist):void{
 for(const note of previous.notes??[]){
  const before=previous.checklist.items.find(item=>item.id===note.id),after=next.items.find(item=>item.id===note.id);
  if(!before||!after||stableJson(before)!==stableJson(after))fail(409,'CHECKLIST_NOTE_CONFLICT','已备注条目发生变化，请先核对并明确清空原备注。');
 }
}
export function validateReviewSnapshot(input:unknown):ReviewSnapshot{
 const row=exact(input,['revision','checklist','decisions','notes']),revision=validateRevision(row.revision),checklist=validateChecklist(row.checklist);
 if(!Array.isArray(row.decisions)||row.decisions.length>checklist.items.length)return fail(409,'STORAGE_REVIEW_CORRUPT','审核决定记录无效。');
 const items=new Map(checklist.items.map(item=>[item.id,item])),seen=new Set<string>();
 const decisions=row.decisions.map((raw):StorageReviewDecision=>{
  const value=exact(raw,['id','decision']),id=text(value.id,128,'条目标识'),decision=value.decision;
  const item=items.get(id);
  if(!item||item.status!=='pending'||seen.has(id)||typeof decision!=='string'||!['keep','trash','defer'].includes(decision))fail(409,'STORAGE_REVIEW_CORRUPT','审核决定记录无法核对。');
  seen.add(id);return{id,decision:decision as StorageReviewDecision['decision']};
 });
 let notes:StorageReviewNote[]|undefined;
 if(Object.hasOwn(row,'notes')){
  if(!Array.isArray(row.notes)||row.notes.length>checklist.items.length)return fail(409,'STORAGE_REVIEW_CORRUPT','审核备注记录无效。');
  const noted=new Set<string>();
  notes=row.notes.map(raw=>{
   const value=exact(raw,['id','note']),id=text(value.id,128,'条目标识'),note=text(value.note,8000,'备注',true);
   if(!items.has(id)||noted.has(id)||note==='')fail(409,'STORAGE_REVIEW_CORRUPT','审核备注无法核对。');
   noted.add(id);return{id,note};
  });
 }
 const result={revision,checklist,decisions,...(notes!==undefined?{notes}:{})};
 if(storageReviewJsonBytes(result)>131072)fail(409,'STORAGE_REVIEW_CORRUPT','审核状态超过安全大小上限。');
 return result;
}
export function validateStorageReviewKey(key:string):string{try{return validateIdempotencyKey(key);}catch{return fail(400,'STORAGE_REVIEW_INVALID','请求标识无效。');}}
