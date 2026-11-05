import {createHash} from 'node:crypto';
import {object,PlatformError,validateId,validateIdempotencyKey,validateRevision} from '../platform/domain.ts';
import type {Transaction} from '../platform/contracts.ts';
import {normalizeCalendarPersonalFields} from './personal-domain.ts';
import {readPersonalCalendarEntry} from './personal-record.ts';
import {projectCalendarRecords,validateCalendarWindow,type CalendarRecord,type CalendarWindow} from './personal-projection.ts';
export type CalendarAuthorityGuard=()=>Promise<void>;
/** Implemented by the existing PersonalService after its single-owner core hook is installed. */
export interface CalendarPersonalPort{
 currentSnapshot(owner:string):Promise<unknown[]>;
 get(owner:string,type:'calendar',id:string):Promise<unknown>;
 mutate(owner:string,type:'calendar',id:string|null,input:unknown,key:string,guard?:CalendarAuthorityGuard,transactionGuard?:(tx:Transaction)=>Promise<void>):Promise<{entry:unknown;duplicate:boolean}>;
 history?(owner:string,type:'calendar',id:string,limit:number):Promise<{items:unknown[];truncated:boolean}>;
}
const unavailable=():never=>{throw new PlatformError(503,'CALENDAR_UNAVAILABLE','个人日程尚未开放，没有确认保存。');};
const data=(value:unknown):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class PersonalCalendarService{
 readonly config:Readonly<{ownerId:string;spaceId:string;enabled:boolean;writable:boolean}>;
 private personal:CalendarPersonalPort;private now:()=>string;
 constructor(personal:CalendarPersonalPort,config:{ownerId:string;spaceId:string;enabled?:boolean;writable?:boolean},now=()=>new Date().toISOString()){
  this.personal=personal;this.now=now;
  this.config=Object.freeze({ownerId:config.ownerId,spaceId:config.spaceId,enabled:config.enabled===true,writable:config.enabled===true&&config.writable===true});
 }
 private authorize(owner:string,write=false){if(!this.config.enabled)return unavailable();if(owner!==this.config.ownerId)throw new PlatformError(403,'OWNER_ONLY','只允许已绑定本人身份。');if(write&&!this.config.writable)throw new PlatformError(403,'CALENDAR_READ_ONLY','当前仅可读取日程。');}
 status(owner:string){this.authorize(owner);return{scope:'personal-calendar-v1' as const,ownerId:owner,spaceId:this.config.spaceId,configured:true,writable:this.config.writable,sources:[{id:'personal-entry',label:'个人录入',connected:true,readOnly:!this.config.writable},{id:'holiday-subscription',label:'订阅节假日与节气',connected:false,readOnly:true},{id:'contact-calendar',label:'联系人生日',connected:false,readOnly:true},{id:'shared-calendar',label:'共享日历（创建者未核对）',connected:false,readOnly:true}]};}
 async get(owner:string,id:string){this.authorize(owner);id=validateId(id);return readPersonalCalendarEntry(await this.personal.get(owner,'calendar',id),this.config.spaceId);}
 async snapshot(owner:string,input:unknown){
  this.authorize(owner);const query=validateCalendarWindow(input),rows=await this.personal.currentSnapshot(owner);
  if(!Array.isArray(rows)||rows.length>10000)throw new PlatformError(503,'CALENDAR_SNAPSHOT_UNAVAILABLE','当前日程读取未完整，未返回部分结果。');
  const entries=rows.filter(row=>{const original=data(data(row).source).original;return data(original).type==='calendar'&&data(original).spaceId===this.config.spaceId;}).map(row=>readPersonalCalendarEntry(row,this.config.spaceId)).filter(record=>(query.calendarKind==='all'||record.fields.personal.calendarKind===query.calendarKind)&&(!query.search||(record.fields.title+'\n'+record.fields.text).normalize('NFKC').toLocaleLowerCase().includes(query.search.normalize('NFKC').toLocaleLowerCase()))).toSorted((a,b)=>a.id.localeCompare(b.id));
  if(new Set(entries.map(entry=>entry.id)).size!==entries.length)throw new PlatformError(503,'CALENDAR_SNAPSHOT_UNAVAILABLE','日程身份重复，未返回部分结果。');
  const window={from:query.from,to:query.to,timeZone:query.timeZone,search:query.search,calendarKind:query.calendarKind,limit:query.limit},snapshotId=digest([owner,this.config.spaceId,window,entries.map(record=>[record.id,record.revision,record.source.id,record.source.version])]);
  let index=0;if(query.cursor){try{const value=object(JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8')),['snapshotId','index']);if(value.snapshotId!==snapshotId)throw new PlatformError(409,'CALENDAR_SNAPSHOT_CHANGED','日程或筛选已变化，请从第一页重新读取。');if(!Number.isInteger(value.index)||(value.index as number)<1||(value.index as number)%query.limit!==0||(value.index as number)>=entries.length)throw Error();index=value.index as number;}catch(error){if(error instanceof PlatformError)throw error;throw new PlatformError(400,'INVALID_CALENDAR_CURSOR','日程分页标识无效。');}}
  const page=entries.slice(index,index+query.limit),truncated=index+page.length<entries.length,observedAt=this.now();
  return{scope:'personal-calendar-window-v1' as const,snapshotId,window,entries:page,total:entries.length,truncated,nextCursor:truncated?Buffer.from(JSON.stringify({snapshotId,index:index+query.limit})).toString('base64url'):null,observedAt,projection:projectCalendarRecords(page,query,observedAt),sources:this.status(owner).sources};
 }
 async mutate(owner:string,id:string|null,input:unknown,key:string,guard:CalendarAuthorityGuard=async()=>{},transactionGuard?:(tx:Transaction)=>Promise<void>){
  this.authorize(owner,true);validateIdempotencyKey(key);if(id)id=validateId(id);
  const raw=object(input,['spaceId','confirmed','fields',...(id?['expectedRevision']:[])]);
  if(raw.spaceId!==this.config.spaceId||raw.confirmed!==true)throw new PlatformError(403,'PERSONAL_CONFIRMATION_REQUIRED','需要核对本人空间并确认保存。');
  const fields=normalizeCalendarPersonalFields(raw.fields),body={spaceId:this.config.spaceId,confirmed:true as const,fields,...(id?{expectedRevision:validateRevision(raw.expectedRevision)}:{})};
  await guard();const receipt=await this.personal.mutate(owner,'calendar',id,body,key,guard,transactionGuard);
  return{entry:readPersonalCalendarEntry(receipt.entry,this.config.spaceId),duplicate:receipt.duplicate};
 }
 /** Owner-session picker only; Agent metadata does not advertise cross-module names. */
 async references(owner:string){this.authorize(owner);const rows=await this.personal.currentSnapshot(owner);if(!Array.isArray(rows)||rows.length>10000)return unavailable();const options:{projects:{title:string;pin:{id:string;sourceId:string;revision:number}}[];domains:{title:string;pin:{id:string;sourceId:string;revision:number}}[];people:{title:string;pin:{id:string;sourceId:string;revision:number}}[]}={projects:[],domains:[],people:[]};for(const raw of rows){const value=data(raw),source=data(value.source),original=data(source.original),draft=data(value.draft),type=original.type;if(!['project','domain','person'].includes(type)||original.marker!=='personal-manual-v1'||original.spaceId!==this.config.spaceId||value.kind!=='inbox'||value.syncState!=='draft'||value.externalStatus!==null||source.system!=='website'||source.externalId!==value.id||source.version!==1||data(draft.personal).type!==type||typeof draft.title!=='string'||!draft.title.trim()||draft.title.length>240)continue;const pin={id:validateId(value.id),sourceId:validateId(source.id),revision:validateRevision(value.revision)};options[type==='project'?'projects':type==='domain'?'domains':'people'].push({title:draft.title,pin});}return options;}
 async history(owner:string,id:string){this.authorize(owner);await this.get(owner,id);if(!this.personal.history)throw new PlatformError(503,'CALENDAR_HISTORY_UNAVAILABLE','日程历史读取尚未配置。');const page=await this.personal.history(owner,'calendar',id,100);if(!Array.isArray(page.items)||typeof page.truncated!=='boolean')return unavailable();const entries=page.items.map(row=>readPersonalCalendarEntry(row,this.config.spaceId));if(entries.some(entry=>entry.id!==id))return unavailable();return{entries,complete:!page.truncated,truncated:page.truncated};}
}
