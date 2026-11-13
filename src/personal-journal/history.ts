import type {PublicEntry} from '../platform/contracts.ts';
import {validateId} from '../platform/domain.ts';
import {normalizePersonalFields} from '../personal-candidate/business.ts';
import {ownerRecord,recordFields,type RecordFields} from '../personal-candidate/record-model.ts';

export type JournalBinding={ownerId:string;spaceId:string};
export type JournalHistory=ReturnType<typeof projectJournalHistory>;
type Fetcher=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;
const base='/api/platform/personal/';
const invalid=():never=>{throw Error('日记读取未能完整核对，请重新读取。');};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const bindingKey=(binding:JournalBinding)=>JSON.stringify([binding.ownerId,binding.spaceId]);

/** Server snapshot time is the only clock. Recorded pure dates are never converted between zones. */
export function beijingJournalDate(observedAt:string):string {
 if(typeof observedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(observedAt))return invalid();
 const date=new Date(observedAt);if(!Number.isFinite(date.getTime())||date.toISOString()!==observedAt)return invalid();
 return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
export function journalRecordHref(id:string):string{return '/personal/journal?record='+validateId(id);}
export function projectJournalHistory(entries:PublicEntry[],observedAt:string){
 const today=beijingJournalDate(observedAt),rows=entries.map(entry=>({id:entry.id,...recordFields(entry,'journal'),href:journalRecordHref(entry.id)}));
 const dates=rows.map(row=>row.occurredOn).filter((date):date is string=>date!==null).sort();
 return {today,observedAt,matches:rows.filter(row=>row.occurredOn!==null&&row.occurredOn.slice(0,4)<today.slice(0,4)&&row.occurredOn.slice(5)===today.slice(5)).sort((a,b)=>b.occurredOn!.localeCompare(a.occurredOn!)||b.id.localeCompare(a.id)),coverage:{count:rows.length,dated:dates.length,undated:rows.length-dates.length,from:dates[0]??null,to:dates.at(-1)??null,historicalCompleteness:'unknown' as const}};
}
async function read(fetcher:Fetcher,path:string):Promise<Record<string,unknown>> {
 const response=await fetcher(base+path,{credentials:'same-origin',cache:'no-store'});
 if(!response.ok)throw Error(response.status===401?'请登录后重新读取日记。':'日记暂时无法读取，请稍后重试。');
 const value:unknown=await response.json();if(!record(value))return invalid();return value;
}
async function status(fetcher:Fetcher):Promise<JournalBinding>{
 const value=await read(fetcher,'status');
 if(typeof value.ownerId!=='string'||!value.ownerId||typeof value.spaceId!=='string'||!value.spaceId||value.storageVerified!==true||!Array.isArray(value.allowedTypes)||!value.allowedTypes.includes('journal'))throw Error('本人日记空间尚未开放。');
 return {ownerId:value.ownerId,spaceId:value.spaceId};
}
export async function readJournalHistory(fetcher:Fetcher=fetch):Promise<{binding:JournalBinding;history:JournalHistory}>{
 const before=await status(fetcher),snapshot=await read(fetcher,'journal/snapshot');
 if(snapshot.scope!=='full-current-snapshot'||snapshot.truncated!==false||!Array.isArray(snapshot.items)||snapshot.total!==snapshot.items.length||snapshot.items.length>10000||typeof snapshot.observedAt!=='string')return invalid();
 const entries=snapshot.items.map(entry=>ownerRecord(entry,'journal',before.spaceId));
 if(new Set(entries.map(entry=>entry.id)).size!==entries.length)return invalid();
 const history=projectJournalHistory(entries,snapshot.observedAt),after=await status(fetcher);
 if(bindingKey(before)!==bindingKey(after))throw Error('本人空间已变化，请重新读取。');
 return {binding:after,history};
}
export type JournalOriginal={entry:PublicEntry;current:RecordFields;original:RecordFields;history:PublicEntry[];historyTruncated:boolean};
export async function readJournalOriginal(fetcher:Fetcher,id:string,expected:JournalBinding):Promise<JournalOriginal>{
 validateId(id);const before=await status(fetcher);if(bindingKey(before)!==bindingKey(expected))throw Error('本人空间已变化，请重新读取。');
 const value=await read(fetcher,'journal/'+id),entry=ownerRecord(value.entry,'journal',before.spaceId);
 if(entry.id!==id)return invalid();
 const versions=await read(fetcher,'journal/'+id+'/history');
 if(versions.scope!=='bounded-record-history'||typeof versions.truncated!=='boolean'||!Array.isArray(versions.items)||versions.items.length>100)return invalid();
 const history=versions.items.map(row=>ownerRecord(row,'journal',before.spaceId));
 if(history.some((row,index)=>row.id!==id||row.source.id!==entry.source.id||row.revision>entry.revision||index>0&&row.revision>=history[index-1].revision))return invalid();
 const after=await status(fetcher);if(bindingKey(before)!==bindingKey(after))throw Error('本人空间已变化，请重新读取。');
 const source=entry.source.original as {input:{fields:unknown}};
 return {entry,current:recordFields(entry,'journal'),original:normalizePersonalFields('journal',source.input.fields) as RecordFields,history,historyTruncated:versions.truncated};
}
