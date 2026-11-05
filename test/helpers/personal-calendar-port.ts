import {PlatformError} from '../../src/platform/domain.ts';
import {randomUUID} from 'node:crypto';
import {normalizeCalendarPersonalFields} from '../../src/calendar-candidate/personal-domain.ts';
export const calendarOwner='synthetic-owner-calendar',calendarSpace='synthetic-calendar-space';
export const calendarFields={title:'合成个人日程',text:'仅用于内部验证',occurredOn:null,personal:{type:'calendar',schemaVersion:1,calendarKind:'event',schedule:{kind:'all-day',startDate:'2030-11-05',endDate:'2030-11-06'},links:{project:null,domain:null,people:[]}}};
/** Internal verification port with the core writer's CAS/idempotency contract. Not runtime storage. */
export function personalCalendarPort(){
 const rows=new Map<string,any>(),receipts=new Map<string,any>(),revisions:any[]=[],calls:any[]=[];
 return{rows,calls,revisions,
 async currentSnapshot(owner:string){calls.push(['snapshot',owner]);return structuredClone([...rows.values()]);},
 async get(owner:string,type:string,id:string){calls.push(['get',owner,type,id]);const row=rows.get(id);if(!row)throw Error('not found');return structuredClone(row);},
 async mutate(owner:string,type:string,id:string|null,input:any,key:string,guard:()=>Promise<void>=async()=>{},txGuard?:Function){
  calls.push(['mutate',owner,type,id,structuredClone(input),key]);await guard();if(txGuard)await txGuard({});await guard();
  const digest=JSON.stringify([owner,type,id,input]),receipt=receipts.get(key);if(receipt){if(receipt.digest!==digest)throw new PlatformError(409,'COMMAND_CONFLICT','请求标识已用于不同内容。');return {...structuredClone(receipt.value),duplicate:true};}
  const old=id?rows.get(id):null;if(id&&old?.revision!==input.expectedRevision)throw new PlatformError(409,'REVISION_CONFLICT','记录版本已变化。');
  const recordId=id??randomUUID(),now='2030-11-05T08:00:00.000Z',fields=normalizeCalendarPersonalFields(input.fields);
  const entry={id:recordId,kind:'inbox',revision:(old?.revision??0)+1,draft:{...fields,disposition:'reference'},source:old?.source??{id:randomUUID(),system:'website',externalId:recordId,version:1,asOf:now,original:{marker:'personal-manual-v1',spaceId:input.spaceId,type:'calendar',input:structuredClone(input)}},syncState:'draft',externalStatus:null,createdAt:old?.createdAt??now,updatedAt:now};
  await guard();rows.set(recordId,structuredClone(entry));revisions.push(structuredClone(entry));const value={entry,duplicate:false};receipts.set(key,{digest,value});return value;
 },
 async history(_owner:string,_type:string,id:string){return{items:structuredClone(revisions.filter(entry=>entry.id===id)),truncated:false};},
 };
}
