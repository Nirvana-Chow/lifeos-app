import {createHash,randomUUID} from 'node:crypto';
import {object,PlatformError,validateId,validateIdempotencyKey,validateRevision} from '../platform/domain.ts';
import {calendarKeys,occursOnDay,validateCalendarDraft,validateDayQuery} from './domain.ts';
import type {CalendarRepository,CalendarEntry,CalendarResult,PublicCalendarEntry} from './contracts.ts';
const missing=()=>new PlatformError(404,'NOT_FOUND','没有可访问的日历安排。');
const canonical=(value:unknown):string=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en')).map(([key,v])=>JSON.stringify(key)+':'+canonical(v)).join(',')+'}':JSON.stringify(value);
const owned=(entry:CalendarEntry|null,owner:string,id?:string):entry is CalendarEntry=>!!entry&&entry.ownerId===owner&&(!id||entry.id===id);
const publicEntry=(entry:CalendarEntry):PublicCalendarEntry=>{const{ownerId,...rest}=structuredClone(entry);return rest;};
export class CalendarService {
 private repository:CalendarRepository;
 constructor(repository:CalendarRepository){this.repository=repository;}
 async exportSnapshot(owner:string){const snapshot=await this.repository.exportSnapshot(owner),entries=snapshot.entries.filter(entry=>owned(entry,owner)),ids=new Set(entries.map(entry=>entry.id));return{entries:entries.map(publicEntry),history:snapshot.history.filter(row=>owned(row.entry,owner)&&ids.has(row.entry.id)).map(row=>({entry:publicEntry(row.entry),raw:structuredClone(row.raw)}))};}
 async list(owner:string,input:unknown):Promise<PublicCalendarEntry[]>{
  const query=validateDayQuery(input);return(await this.repository.list(owner)).filter(entry=>owned(entry,owner)&&occursOnDay(entry.schedule,query)).sort((a,b)=>{
   const left=a.schedule.kind==='all-day'?a.schedule.startDate:a.schedule.startAt,right=b.schedule.kind==='all-day'?b.schedule.startDate:b.schedule.startAt;
   return left.localeCompare(right)||a.id.localeCompare(b.id);
  }).map(publicEntry);
 }
 async get(owner:string,id:string):Promise<PublicCalendarEntry>{id=validateId(id);const entry=await this.repository.get(owner,id);if(!owned(entry,owner,id))throw missing();return publicEntry(entry);}
 async history(owner:string,id:string){id=validateId(id);await this.get(owner,id);return(await this.repository.history(owner,id)).filter(row=>owned(row.entry,owner,id)).map(row=>({entry:publicEntry(row.entry),raw:structuredClone(row.raw)}));}
 async create(owner:string,input:unknown,key:string):Promise<CalendarResult>{return this.mutate(owner,null,'create',input,key);}
 async update(owner:string,id:string,input:unknown,key:string):Promise<CalendarResult>{return this.mutate(owner,validateId(id),'update',input,key);}
 async cancel(owner:string,id:string,input:unknown,key:string):Promise<CalendarResult>{return this.mutate(owner,validateId(id),'cancel',input,key);}
 private async mutate(owner:string,id:string|null,action:'create'|'update'|'cancel',input:unknown,key:string):Promise<CalendarResult>{
  validateIdempotencyKey(key);
  const raw=structuredClone(object(input,action==='cancel'?['expectedRevision']:[...calendarKeys,...(id?['expectedRevision']:[])]));
  const expected=id?validateRevision(raw.expectedRevision):null,initial=id?null:validateCalendarDraft(raw);
  if(action==='update'&&Object.keys(raw).length===1)throw new PlatformError(400,'EMPTY_PATCH','修改内容不能为空。');
  const digest=createHash('sha256').update(canonical({action,id,raw})).digest('hex');
  return this.repository.transaction(owner,key,async tx=>{
   const receipt=await tx.receipt();
   if(receipt){if(receipt.digest!==digest)throw new PlatformError(409,'COMMAND_CONFLICT','请求标识已用于不同内容。');return{...structuredClone(receipt.result),duplicate:true};}
   const now=new Date().toISOString();let entry:CalendarEntry;
   if(id){
    const old=await tx.get(id);if(!owned(old,owner,id))throw missing();
    if(old.revision!==expected)throw new PlatformError(409,'REVISION_CONFLICT','安排已变化，请读取当前版本后核对。');
    if(old.revision===2147483647)throw new PlatformError(409,'REVISION_LIMIT','版本已达候选上限。');
    if(old.status==='cancelled')throw new PlatformError(409,'EVENT_CANCELLED','此安排已取消，历史保留且不能再修改。');
    const{expectedRevision,...patch}=raw;
    entry={...old,...(action==='update'?validateCalendarDraft({title:old.title,notes:old.notes,schedule:old.schedule,...patch}):{}),status:action==='cancel'?'cancelled':'planned',revision:old.revision+1,updatedAt:now};
   }else{
    const recordId=randomUUID();entry={...initial!,id:recordId,ownerId:owner,status:'planned',revision:1,source:{id:randomUUID(),system:'website',externalId:recordId,version:1,asOf:now,original:raw},createdAt:now,updatedAt:now};
   }
   await tx.write(entry,raw,action==='create');
   const result={entry:publicEntry(entry),duplicate:false};await tx.saveReceipt({digest,result});return result;
  });
 }
}
