import {z} from 'zod';
import {validateCalendarDraft,validateDayQuery} from './domain.ts';

export type CalendarForm={title:string;notes:string;kind:'all-day'|'timed';startDate:string;endDate:string;startAt:string;endAt:string;timeZone:string};
export type CalendarSchedule={kind:'all-day';startDate:string;endDate:string}|{kind:'timed';startAt:string;endAt:string;timeZone:string};
export type CalendarEntry={id:string;title:string;notes:string;schedule:CalendarSchedule;status:'planned'|'cancelled';revision:number;source:{id:string;system:'website';externalId:string;version:number;asOf:string;original:unknown};createdAt:string;updatedAt:string};
export type CalendarBody={title:string;notes:string;schedule:CalendarSchedule};
export type CalendarCommand={ownerScope:string;key:string;path:string;method:'POST'|'PATCH';body:CalendarBody&{expectedRevision?:number}|{expectedRevision:number};form:CalendarForm};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const uuid=z.string().uuid();
const formSchema=z.strictObject({title:z.string().max(240),notes:z.string().max(16000),kind:z.enum(['all-day','timed']),startDate:z.string(),endDate:z.string(),startAt:z.string(),endAt:z.string(),timeZone:z.string().max(100)});
const scheduleSchema=z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('all-day'),startDate:z.string(),endDate:z.string()}),z.strictObject({kind:z.literal('timed'),startAt:z.string(),endAt:z.string(),timeZone:z.string()})]);
const entrySchema=z.object({id:uuid,title:z.string(),notes:z.string(),schedule:scheduleSchema,status:z.enum(['planned','cancelled']),revision:z.number().int().positive(),source:z.object({id:uuid,system:z.literal('website'),externalId:z.string(),version:z.number().int().positive(),asOf:z.string(),original:z.unknown()}),createdAt:z.string(),updatedAt:z.string()});
const bodySchema=z.union([z.strictObject({title:z.string(),notes:z.string(),schedule:scheduleSchema,expectedRevision:z.number().int().positive().optional()}),z.strictObject({expectedRevision:z.number().int().positive()})]);
const commandSchema=z.strictObject({ownerScope:z.string().min(1).max(256),key:uuid,path:z.string(),method:z.enum(['POST','PATCH']),body:bodySchema,form:formSchema});
export function calendarFormBody(form:CalendarForm):CalendarBody{
 const value=formSchema.parse(form);
 const schedule:CalendarSchedule=value.kind==='all-day'?{kind:'all-day',startDate:value.startDate,endDate:value.endDate}:{kind:'timed',startAt:value.startAt,endAt:value.endAt,timeZone:value.timeZone};
 const body={title:value.title,notes:value.notes,schedule};validateCalendarDraft(body);return body;
}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export function freezeCalendarCommand(ownerScope:string,key:string,form:CalendarForm,entry?:{id:string;revision:number},cancel=false):CalendarCommand{
 z.string().min(1).max(256).parse(ownerScope);uuid.parse(key);formSchema.parse(form);if(entry){uuid.parse(entry.id);z.number().int().min(1).max(2147483647).parse(entry.revision);}if(cancel&&!entry)throw Error('取消需要当前事件版本。');
 const body=cancel?{expectedRevision:entry!.revision}:{...calendarFormBody(form),...(entry?{expectedRevision:entry.revision}:{})};
 return freeze({ownerScope,key,path:entry?'/'+entry.id+(cancel?'/cancel':''):'',method:entry&&!cancel?'PATCH':'POST',body,form:structuredClone(form)});
}
const storageKey=(ownerScope:string)=>'lifeos.calendar.candidate.pending.v1:'+encodeURIComponent(z.string().min(1).max(256).parse(ownerScope));
export function readCalendarPending(store:Store,ownerScope:string):CalendarCommand|null{
 const raw=store.getItem(storageKey(ownerScope));return raw===null?null:decodePending(raw,ownerScope);
}
function decodePending(raw:string,ownerScope:string):CalendarCommand{
 if(raw.length>100000)throw Error('未确认请求记录过大。');
 const command=commandSchema.parse(JSON.parse(raw));if(command.ownerScope!==ownerScope)throw Error('未确认请求所属会话不一致。');
 const m=/^\/([a-f\d-]{36})(\/cancel)?$/i.exec(command.path),revision='expectedRevision'in command.body?command.body.expectedRevision:undefined;
 if(command.path&&!m)throw Error('未确认请求路径无效。');
 const expected=freezeCalendarCommand(ownerScope,command.key,command.form,m?{id:m[1],revision:revision!}:undefined,!!m?.[2]);
 if(JSON.stringify(command)!==JSON.stringify(expected))throw Error('未确认请求内容不一致。');return expected;
}
export function keepCalendarPending(store:Store,ownerScope:string,command:CalendarCommand):void{
 decodePending(JSON.stringify(command),ownerScope);const existing=readCalendarPending(store,ownerScope);
 if(existing&&JSON.stringify(existing)!==JSON.stringify(command))throw Error('已有未确认请求，请先解决。');
 store.setItem(storageKey(ownerScope),JSON.stringify(command));if(JSON.stringify(readCalendarPending(store,ownerScope))!==JSON.stringify(command))throw Error('无法保留本次请求，尚未发送。');
}
export function clearCalendarPending(store:Store,ownerScope:string,key:string):void{if(readCalendarPending(store,ownerScope)?.key===key)store.removeItem(storageKey(ownerScope));}
export class CalendarClientError extends Error{status:number;uncertain:boolean;constructor(message:string,status:number,uncertain=false){super(message);this.status=status;this.uncertain=uncertain;}}
export type CalendarHistory={entry:CalendarEntry;raw:unknown};
export type CalendarResponse={entry:CalendarEntry;duplicate?:boolean}|{entries:CalendarEntry[]}|{history:CalendarHistory[]};
export async function calendarRequest(fetcher:typeof fetch,path:string,method='GET',body?:unknown,key?:string):Promise<CalendarResponse>{
 let response:Response;
 try{response=await fetcher('/api/platform/calendar'+path,{method,credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});}catch{throw new CalendarClientError(method==='GET'?'日历读取失败。':'保存结果未确认。请保留本次请求并重试。',0,method!=='GET');}
 if(response.status===401)throw new CalendarClientError('请先登录获准的评审账号。原输入已保留。',401);
 if(response.status===409)throw new CalendarClientError('日程或请求版本存在冲突。请读取最新版本并核对草稿。',409);
 if(!response.ok)throw new CalendarClientError(response.status===503?'日历候选服务尚未开放。':response.status===400?'输入未通过校验，请核对日期、时区与内容。':'日历操作未完成。',response.status,response.status>=500&&method!=='GET');
 let value:unknown;try{value=await response.json();}catch{throw new CalendarClientError('响应无法确认，请保留本次请求。',response.status,method!=='GET');}
 const schema=method!=='GET'?z.object({entry:entrySchema,duplicate:z.boolean()}):path.split('?')[0].endsWith('/history')?z.object({history:z.array(z.object({entry:entrySchema,raw:z.unknown()}))}):path.startsWith('?')||path===''?z.object({entries:z.array(entrySchema)}):z.object({entry:entrySchema});
 const checked=schema.safeParse(value);if(!checked.success)throw new CalendarClientError('响应内容未通过校验，未确认保存。',response.status,method!=='GET');return checked.data as CalendarResponse;
}
export async function sendCalendarCommand(fetcher:typeof fetch,store:Store,command:CalendarCommand):Promise<CalendarEntry>{
 keepCalendarPending(store,command.ownerScope,command);let mutationAccepted=false;
 try{
  const mutation=await calendarRequest(fetcher,command.path,command.method,command.body,command.key);mutationAccepted=true;if(!('entry'in mutation))throw Error('保存响应无法确认。');
  const read=await calendarRequest(fetcher,'/'+mutation.entry.id);if(!('entry'in read)||read.entry.id!==mutation.entry.id||read.entry.revision<mutation.entry.revision)throw new CalendarClientError('保存后的版本尚未读回，请保留本次请求重试。',0,true);
  clearCalendarPending(store,command.ownerScope,command.key);return read.entry;
 }catch(cause){
  if(mutationAccepted)throw new CalendarClientError('写入响应已收到，但结果尚未完整读回。请保留本次请求并使用同一标识重试。',cause instanceof CalendarClientError?cause.status:0,true);
  if(cause instanceof CalendarClientError&&!cause.uncertain&&cause.status>=400&&cause.status<500&&cause.status!==401&&cause.status!==409)clearCalendarPending(store,command.ownerScope,command.key);
  throw cause;
 }
}
export function createCalendarDetailReader(fetcher:typeof fetch){
 let generation=0;
 return{
  invalidate(){generation++;},
  async read(id:string):Promise<CalendarEntry|null>{
   const request=++generation;
   try{const result=await calendarRequest(fetcher,'/'+id);if(request!==generation)return null;if(!('entry'in result))throw new CalendarClientError('无法确认日程详情。',0);return result.entry;}
   catch(cause){if(request!==generation)return null;throw cause;}
  },
 };
}
export function calendarEntryForm(entry:CalendarEntry):CalendarForm{return{title:entry.title,notes:entry.notes,kind:entry.schedule.kind,startDate:entry.schedule.kind==='all-day'?entry.schedule.startDate:'',endDate:entry.schedule.kind==='all-day'?entry.schedule.endDate:'',startAt:entry.schedule.kind==='timed'?entry.schedule.startAt:'',endAt:entry.schedule.kind==='timed'?entry.schedule.endAt:'',timeZone:entry.schedule.kind==='timed'?entry.schedule.timeZone:'UTC'};}
export async function calendarDayRequest(fetcher:typeof fetch,{access='unavailable',ownerScope=''}:{access?:'unavailable'|'developer-review';ownerScope?:string},date:string,timeZone:string):Promise<CalendarEntry[]|null>{
 if(access!=='developer-review'||!ownerScope)return null;
 validateDayQuery({date,timeZone});
 const result=await calendarRequest(fetcher,'?'+new URLSearchParams({date,timeZone}));if(!('entries'in result))throw new CalendarClientError('无法确认日列表。',0);return result.entries;
}

/** Adapter readiness is distinct from authentication and local command recovery. */
export function calendarStorageAccess(access:'unavailable'|'developer-review',ownerScope:string,storageReady:boolean):boolean{return access==='developer-review'&&!!ownerScope&&storageReady===true;}
