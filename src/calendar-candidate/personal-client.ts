import {object,validateId,validateIdempotencyKey,validateRevision} from '../platform/domain.ts';
import {normalizeCalendarPersonalFields,type CalendarPersonalFields} from './personal-domain.ts';
import {validateCalendarRecord} from './personal-record.ts';
import {projectCalendarRecords,validateCalendarWindow,type CalendarRecord,type CalendarWindow,type CalendarProjection} from './personal-projection.ts';
export type CalendarBinding={ownerId:string;spaceId:string};
export type CalendarSourceState={id:string;label:string;connected:boolean;readOnly:boolean};
export type PersonalCalendarStatus={scope:'personal-calendar-v1';configured:false;writable:false;reason?:string}|({scope:'personal-calendar-v1';configured:true;writable:boolean;sources:CalendarSourceState[]}&CalendarBinding);
export type PersonalCalendarCommand={binding:CalendarBinding;key:string;path:string;method:'POST'|'PATCH';sourceId:string|null;body:{spaceId:string;confirmed:true;fields:CalendarPersonalFields;expectedRevision?:number}};
export type CalendarRecoveryStore=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type CalendarSnapshot={entries:CalendarRecord[];total:number;window:Omit<CalendarWindow,'cursor'>;snapshotId:string;observedAt:string;projection:CalendarProjection;sources:CalendarSourceState[]};
export class PersonalCalendarClientError extends Error{status:number;uncertain:boolean;constructor(message:string,status=0,uncertain=false){super(message);this.status=status;this.uncertain=uncertain;}}
const api='/api/platform/personal/calendar';
const rec=(value:unknown):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
const canonical=(value:unknown):string=>value&&typeof value==='object'?Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en')).map(([key,item])=>JSON.stringify(key)+':'+canonical(item)).join(',')+'}':JSON.stringify(value);
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const binding=(value:unknown):CalendarBinding=>{const v=object(value,['ownerId','spaceId']);if(typeof v.ownerId!=='string'||!v.ownerId||v.ownerId.length>256||typeof v.spaceId!=='string'||!v.spaceId||v.spaceId.length>256)throw new PersonalCalendarClientError('无法确认当前私人空间。');return{ownerId:v.ownerId,spaceId:v.spaceId};};
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
async function json(fetcher:typeof fetch,path:string,init:RequestInit={}):Promise<any>{
 let response:Response;try{response=await fetcher(api+path,{...init,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'content-type':'application/json',...Object.fromEntries(new Headers(init.headers))}});}catch{throw new PersonalCalendarClientError(init.method?'保存结果尚未确认，请重试原请求。':'日程读取失败。',0,!!init.method);}
 if(!response.ok){let message='日程操作未完成，请保留输入。';try{const body=rec(await response.json());if(typeof body.error?.message==='string'&&body.error.message.length<=500)message=body.error.message;}catch{}throw new PersonalCalendarClientError(message,response.status,!!init.method&&response.status>=500);}
 try{return await response.json();}catch{throw new PersonalCalendarClientError('日程响应未通过核对。',response.status,!!init.method);}
}
function sources(value:unknown):CalendarSourceState[]{if(!Array.isArray(value)||value.length>20)throw new PersonalCalendarClientError('日程来源状态未通过核对。');return value.map(raw=>{const v=rec(raw);if(typeof v.id!=='string'||v.id.length>100||typeof v.label!=='string'||v.label.length>240||typeof v.connected!=='boolean'||typeof v.readOnly!=='boolean')throw new PersonalCalendarClientError('日程来源状态未通过核对。');return{id:v.id,label:v.label,connected:v.connected,readOnly:v.readOnly};});}
export async function readPersonalCalendarStatus(fetcher:typeof fetch):Promise<PersonalCalendarStatus>{const value=rec(await json(fetcher,'/status'));if(value.scope!=='personal-calendar-v1'||typeof value.configured!=='boolean'||typeof value.writable!=='boolean')throw new PersonalCalendarClientError('无法确认日程模块状态。');if(!value.configured)return{scope:'personal-calendar-v1',configured:false,writable:false,reason:typeof value.reason==='string'?value.reason:undefined};return{scope:'personal-calendar-v1',configured:true,...binding({ownerId:value.ownerId,spaceId:value.spaceId}),writable:value.writable,sources:sources(value.sources)};}
function assertBinding(actual:PersonalCalendarStatus,expected:CalendarBinding){if(!actual.configured||!same({ownerId:actual.ownerId,spaceId:actual.spaceId},expected))throw new PersonalCalendarClientError('私人空间已变化，原请求没有在新空间执行。',403);}
export function freezePersonalCalendarCommand(owner:CalendarBinding,fields:unknown,entry:CalendarRecord|null,key:string):PersonalCalendarCommand{
 const scope=binding(owner);validateIdempotencyKey(key);if(entry){validateId(entry.id);validateRevision(entry.revision);validateId(entry.source.id);}
 return freeze({binding:scope,key,path:entry?'/'+entry.id:'',method:entry?'PATCH':'POST',sourceId:entry?entry.source.id:null,body:{spaceId:scope.spaceId,confirmed:true,fields:normalizeCalendarPersonalFields(fields),...(entry?{expectedRevision:entry.revision}:{})}});
}
const storageKey=(owner:CalendarBinding)=>'lifeos.personal.calendar.pending.v1:'+JSON.stringify(binding(owner));
function decodeCommand(raw:string,owner:CalendarBinding):PersonalCalendarCommand{
 if(raw.length>131072)throw new PersonalCalendarClientError('原请求过大，未读取。');const v=object(JSON.parse(raw),['binding','key','path','method','sourceId','body']),body=object(v.body,['spaceId','confirmed','fields','expectedRevision']);
 if(!same(v.binding,owner)||typeof v.key!=='string'||body.spaceId!==owner.spaceId||body.confirmed!==true||typeof v.path!=='string'||v.path!==''&&!/^\/[a-f\d-]{36}$/i.test(v.path))throw new PersonalCalendarClientError('原请求与当前私人空间不一致。');
 const entry=v.path?{id:validateId(v.path.slice(1)),revision:validateRevision(body.expectedRevision),source:{id:validateId(v.sourceId)}} as CalendarRecord:null;
 const expected=freezePersonalCalendarCommand(owner,body.fields,entry,v.key);if(!same(v,expected))throw new PersonalCalendarClientError('原请求内容已变化。');return expected;
}
export function readPersonalCalendarCommand(store:CalendarRecoveryStore,owner:CalendarBinding):PersonalCalendarCommand|null{const raw=store.getItem(storageKey(owner));return raw===null?null:decodeCommand(raw,owner);}
export function keepPersonalCalendarCommand(store:CalendarRecoveryStore,command:PersonalCalendarCommand){const decoded=decodeCommand(JSON.stringify(command),command.binding),previous=readPersonalCalendarCommand(store,command.binding);if(previous&&!same(previous,decoded))throw new PersonalCalendarClientError('已有待确认请求，请先处理原请求。');store.setItem(storageKey(command.binding),JSON.stringify(decoded));if(!same(readPersonalCalendarCommand(store,command.binding),decoded))throw new PersonalCalendarClientError('浏览器不能保留原请求，尚未发送。');}
export function clearPersonalCalendarCommand(store:CalendarRecoveryStore,command:PersonalCalendarCommand){if(readPersonalCalendarCommand(store,command.binding)?.key===command.key)store.removeItem(storageKey(command.binding));}
export async function readPersonalCalendarRecord(fetcher:typeof fetch,owner:CalendarBinding,id:string):Promise<CalendarRecord>{validateId(id);const value=rec(await json(fetcher,'/'+id));return validateCalendarRecord(value.entry,owner.spaceId);}
export async function readPersonalCalendarSnapshot(fetcher:typeof fetch,owner:CalendarBinding,input:unknown):Promise<CalendarSnapshot>{
 const query=validateCalendarWindow(input),entries:CalendarRecord[]=[],seen=new Set<string>();let cursor:string|null=null,snapshotId='',observedAt='',total=-1,sourceStates:CalendarSourceState[]=[];
 do{const params=new URLSearchParams({from:query.from,to:query.to,timeZone:query.timeZone,search:query.search,calendarKind:query.calendarKind,limit:String(query.limit),...(cursor?{cursor}:{})});const value=rec(await json(fetcher,'?'+params));
  const returnedWindow=validateCalendarWindow(value.window);if(!same({...returnedWindow,cursor:null},{...query,cursor:null})||typeof value.snapshotId!=='string'||!value.snapshotId||snapshotId&&value.snapshotId!==snapshotId||!Number.isInteger(value.total)||value.total<0||value.total>10000||total!==-1&&value.total!==total||typeof value.observedAt!=='string'||!Number.isFinite(Date.parse(value.observedAt))||!Array.isArray(value.entries)||value.entries.length>query.limit||typeof value.truncated!=='boolean'||value.truncated&&typeof value.nextCursor!=='string'||!value.truncated&&value.nextCursor!==null)throw new PersonalCalendarClientError('日程快照不完整或已变化，请重新读取。');
  snapshotId=value.snapshotId;observedAt||=value.observedAt;total=value.total;sourceStates=sources(value.sources);
  for(const raw of value.entries){const entry=validateCalendarRecord(raw,owner.spaceId);if(seen.has(entry.id))throw new PersonalCalendarClientError('日程分页身份重复，未展示部分结果。');seen.add(entry.id);entries.push(entry);}
  if(value.truncated&&value.entries.length!==query.limit||entries.length>total||value.nextCursor===cursor&&cursor)throw new PersonalCalendarClientError('日程分页无法继续。');cursor=value.nextCursor;
 }while(cursor);
 if(entries.length!==total)throw new PersonalCalendarClientError('日程快照缺少记录，未展示部分统计。');const{cursor:_,...window}=query;
 return{entries,total,window,snapshotId,observedAt,projection:projectCalendarRecords(entries,query,observedAt),sources:sourceStates};
}
/** A writer response must match the frozen fields/source/revision before a separate readback confirms it. */
export async function sendPersonalCalendarCommand(fetcher:typeof fetch,store:CalendarRecoveryStore,command:PersonalCalendarCommand):Promise<{receipt:CalendarRecord;current:CalendarRecord}>{
 keepPersonalCalendarCommand(store,command);const status=await readPersonalCalendarStatus(fetcher);assertBinding(status,command.binding);if(!status.writable)throw new PersonalCalendarClientError('当前不能保存日程，原请求已保留。',403);
 let accepted=false;try{
  const value=rec(await json(fetcher,command.path,{method:command.method,headers:{'idempotency-key':command.key},body:JSON.stringify(command.body)}));accepted=true;
  const receipt=validateCalendarRecord(value.entry,command.binding.spaceId),expected=command.body.expectedRevision??0;
  if(typeof value.duplicate!=='boolean'||receipt.revision!==expected+1||command.path&&receipt.id!==command.path.slice(1)||command.sourceId&&receipt.source.id!==command.sourceId||!same(receipt.fields,command.body.fields))throw new PersonalCalendarClientError('写入回执与原请求不一致，结果仍待确认。',0,true);
  const current=await readPersonalCalendarRecord(fetcher,command.binding,receipt.id);if(current.revision<receipt.revision||current.source.id!==receipt.source.id||current.revision===receipt.revision&&!same(current.fields,receipt.fields))throw new PersonalCalendarClientError('保存后的日程版本未完整读回。',0,true);
  assertBinding(await readPersonalCalendarStatus(fetcher),command.binding);clearPersonalCalendarCommand(store,command);return{receipt,current};
 }catch(error){if(accepted)throw new PersonalCalendarClientError(error instanceof Error?error.message:'保存仍待确认。',error instanceof PersonalCalendarClientError?error.status:0,true);throw error;}
}
export async function readPersonalCalendarReferences(fetcher:typeof fetch,_owner:CalendarBinding){const value=rec(await json(fetcher,'/references')).references,raw=rec(value),options:{projects:{title:string;pin:import('./personal-domain').CalendarReference}[];domains:{title:string;pin:import('./personal-domain').CalendarReference}[];people:{title:string;pin:import('./personal-domain').CalendarReference}[]}={projects:[],domains:[],people:[]};for(const key of ['projects','domains','people'] as const){if(!Array.isArray(raw[key])||raw[key].length>10000)throw new PersonalCalendarClientError('关联选项未完整读取。');options[key]=raw[key].map((row:unknown)=>{const v=rec(row),pin=rec(v.pin);if(typeof v.title!=='string'||!v.title||v.title.length>240)throw new PersonalCalendarClientError('关联选项未通过核对。');return{title:v.title,pin:{id:validateId(pin.id),sourceId:validateId(pin.sourceId),revision:validateRevision(pin.revision)}};});}return options;}
