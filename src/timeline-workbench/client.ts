import type {TimelineItem,TimelineQuery,TimelineResponse,TimelineComparisonQuery,TimelineComparisonPeriod,TimelineComparisonResponse} from '../timeline-candidate/contracts.ts';
import {parseTimelineQuery,parseTimelineComparisonQuery,timelineCalendarDays,timelineLocalDate} from '../timeline-candidate/domain.ts';
import {validateCalendarDate,validateCalendarZone} from '../calendar-candidate/domain.ts';
import {object,validateId,validateRevision} from '../platform/domain.ts';
import {SearchClient,SearchRequestError} from '../search-workbench/client.ts';
import type {SearchDocument,SourceResponse} from '../search-candidate/contracts.ts';

export class TimelineRequestError extends Error{
 readonly status:number;readonly code:string;
 constructor(status:number,code:string,message:string){super(message);this.name='TimelineRequestError';this.status=status;this.code=code;}
}
export const isTimelineIdentityFailure=(cause:unknown)=>cause instanceof TimelineRequestError&&(cause.status===401||cause.status===403||cause.code==='IDENTITY_UNAVAILABLE');
const invalid=()=>new TimelineRequestError(0,'INVALID_RESPONSE','读取结果无法核对，请重新读取时间线。');
const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const equal=(a:unknown,b:unknown):boolean=>JSON.stringify(a)===JSON.stringify(b);
const kinds=['todo','finance','inbox','calendar'];
const types=['todo','finance','inbox','calendar','journal','learning','career','mood','article','resource','project','training'];
function text(value:unknown,max:number,empty=false):asserts value is string{if(typeof value!=='string'||value.length>max||/[\u0000]/.test(value)||!empty&&!value.trim())throw invalid();}
function instant(value:unknown):asserts value is string{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==(value.includes('.')?value:value.replace('Z','.000Z')))throw invalid();}
const count=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
function normalized(input:Partial<TimelineQuery>):TimelineQuery{
 try{const query=parseTimelineQuery(new URLSearchParams(Object.entries(input).filter(([,value])=>value!==undefined&&value!=='').map(([key,value])=>[key,String(value)])));if(!query.includeSynthetic)throw invalid();return query;}catch{throw new TimelineRequestError(400,'INVALID_TIMELINE_QUERY','请核对日期范围、时间依据和时区，并确认合成评审范围。');}
}
function normalizedComparison(input:Partial<TimelineComparisonQuery>):TimelineComparisonQuery{
 try{const query=parseTimelineComparisonQuery(new URLSearchParams(Object.entries(input).filter(([,value])=>value!==undefined&&value!=='').map(([key,value])=>[key,String(value)])));if(!query.includeSynthetic)throw invalid();return query;}catch{throw new TimelineRequestError(400,'INVALID_TIMELINE_QUERY','请填写 A、B 两期的首尾日期，核对时区，并确认合成评审范围。');}
}
function parseItem(input:unknown,query:TimelineQuery):TimelineItem{
 const row=object(input,['eventKey','id','kind','type','sourceId','revision','currentRevision','title','summary','date','at','dateKind','sourceTimeZone','timeRole','status','isHistorical']);
 const id=validateId(row.id),sourceId=validateId(row.sourceId),revision=validateRevision(row.revision),currentRevision=validateRevision(row.currentRevision);text(row.eventKey,100);text(row.title,240);text(row.summary,500,true);
 if(id!==row.id||sourceId!==row.sourceId||!kinds.includes(row.kind as string)||!types.includes(row.type as string)||(row.kind==='inbox'?['todo','finance','calendar'].includes(row.type as string):row.type!==row.kind)||revision>currentRevision||row.isHistorical!==(revision<currentRevision))throw invalid();
 const role=query.axis==='occurred'?(row.kind==='todo'?'due':row.kind==='calendar'?'scheduled':'occurred'):query.axis;
 if(row.timeRole!==role||row.eventKey!==query.axis+':'+row.kind+':'+id+(query.axis==='changed'?':'+revision:''))throw invalid();
 if(query.axis==='changed'?revision<2:revision!==currentRevision)throw invalid();
 if(row.status!==null)text(row.status,120);if(row.date!==null)validateCalendarDate(row.date);
 if(row.dateKind==='unknown'){if(row.date!==null||row.at!==null||row.sourceTimeZone!==null||query.axis!=='occurred')throw invalid();}
 else if(row.dateKind==='date'){if(row.date===null||row.at!==null||row.sourceTimeZone!==null||query.axis!=='occurred')throw invalid();}
 else if(row.dateKind==='instant'){instant(row.at);validateCalendarZone(row.sourceTimeZone);if(row.date!==timelineLocalDate(row.at,query.timeZone)||query.axis==='occurred'&&row.kind!=='calendar'||query.axis!=='occurred'&&row.sourceTimeZone!=='UTC')throw invalid();}
 else throw invalid();
 if(query.axis!=='occurred'&&row.dateKind!=='instant'||query.from&&(!row.date||String(row.date)<query.from)||query.to&&(!row.date||String(row.date)>query.to)||query.type&&query.type!==row.type&&query.type!==row.kind)throw invalid();
 return structuredClone(row) as TimelineItem;
}
function parseResponse(input:unknown,query:TimelineQuery):TimelineResponse{
 try{const raw=object(input,['items','query','limit','truncated','observedAt','dataStatus','syntheticIncluded','coverage']);
  const actual=object(raw.query,['axis','from','to','timeZone','type','includeSynthetic','limit']),checked=normalized(actual as Partial<TimelineQuery>);
  if(!equal(checked,query)||Object.keys(actual).length!==Object.keys(checked).length||Object.entries(checked).some(([key,value])=>actual[key]!==value)||raw.limit!==query.limit||typeof raw.truncated!=='boolean'||raw.dataStatus!=='isolated-test-drafts'||raw.syntheticIncluded!==true||!Array.isArray(raw.items)||raw.items.length>query.limit)throw invalid();instant(raw.observedAt);
  const items=raw.items.map(row=>parseItem(row,query));if(new Set(items.map(row=>row.eventKey)).size!==items.length)throw invalid();
  const c=object(raw.coverage,['currentRecords','firstRecordedAt','lastRecordedAt','recordedDateCount','recordedFrom','recordedTo','unknownOccurredRecords','matchedEvents','scannedEvents','scanLimit','scanTruncated','calendarAvailable','snapshotConsistency','meaning']);
  for(const key of ['currentRecords','recordedDateCount','unknownOccurredRecords','matchedEvents','scannedEvents'])if(!count(c[key]))throw invalid();
  if(c.scanLimit!==2000||typeof c.scanTruncated!=='boolean'||typeof c.calendarAvailable!=='boolean'||!['owner-snapshot','per-adapter-snapshots'].includes(String(c.snapshotConsistency))||c.meaning!=='existing-record-coverage-only'||Number(c.recordedDateCount)>Number(c.currentRecords)||Number(c.unknownOccurredRecords)>Number(c.currentRecords)||Number(c.scannedEvents)>2000||Number(c.matchedEvents)>Number(c.scannedEvents)||items.length>Number(c.matchedEvents))throw invalid();
  for(const key of ['firstRecordedAt','lastRecordedAt'])if(c[key]!==null)instant(c[key]);for(const key of ['recordedFrom','recordedTo'])if(c[key]!==null)validateCalendarDate(c[key]);
  if(c.currentRecords===0?(c.firstRecordedAt!==null||c.lastRecordedAt!==null||c.recordedFrom!==null||c.recordedTo!==null||c.recordedDateCount!==0):(c.firstRecordedAt===null||c.lastRecordedAt===null||c.recordedFrom===null||c.recordedTo===null||c.recordedDateCount===0)||c.firstRecordedAt!==null&&String(c.firstRecordedAt)>String(c.lastRecordedAt)||c.recordedFrom!==null&&String(c.recordedFrom)>String(c.recordedTo)||!c.calendarAvailable&&items.some(row=>row.kind==='calendar'))throw invalid();
  return {...raw,items,query:checked,coverage:c} as TimelineResponse;
 }catch{throw invalid();}
}
function parseComparison(input:unknown,query:TimelineComparisonQuery):TimelineComparisonResponse{
 try{
  const raw=object(input,['query','observedAt','dataStatus','syntheticIncluded','comparison','coverage']),actual=object(raw.query,['aFrom','aTo','bFrom','bTo','timeZone','type','includeSynthetic','limit']),checked=normalizedComparison(actual as Partial<TimelineComparisonQuery>);
  if(!equal(checked,query)||Object.keys(actual).length!==Object.keys(checked).length||Object.entries(checked).some(([key,value])=>actual[key]!==value)||raw.dataStatus!=='isolated-test-drafts'||raw.syntheticIncluded!==true)throw invalid();instant(raw.observedAt);
  const coverage=object(raw.coverage,['currentRecords','calendarAvailable','snapshotConsistency','summaryScope','meaning']);
  if(!count(coverage.currentRecords)||typeof coverage.calendarAvailable!=='boolean'||!['owner-snapshot','per-adapter-snapshots'].includes(String(coverage.snapshotConsistency))||coverage.summaryScope!=='all-current-snapshot-records'||coverage.meaning!=='existing-record-coverage-only')throw invalid();
  if(coverage.snapshotConsistency!==(coverage.calendarAvailable?'per-adapter-snapshots':'owner-snapshot'))throw invalid();
  const comparison=object(raw.comparison,['a','b','overlap']);
  function period(input:unknown,from:string,to:string):TimelineComparisonPeriod{
   const p=object(input,['from','to','calendarDays','recordCount','recordedDays','recordedDayRatio','items','itemsTruncated']);
   if(p.from!==from||p.to!==to||p.calendarDays!==timelineCalendarDays(from,to)||!count(p.recordCount)||!count(p.recordedDays)||p.recordCount>Number(coverage.currentRecords)||p.recordedDays>Math.min(p.recordCount,Number(p.calendarDays))||(p.recordCount===0)!==(p.recordedDays===0)||typeof p.recordedDayRatio!=='number'||!Number.isFinite(p.recordedDayRatio)||p.recordedDayRatio<0||p.recordedDayRatio>1||Math.abs(p.recordedDayRatio-p.recordedDays/Number(p.calendarDays))>1e-12||!Array.isArray(p.items)||p.items.length!==Math.min(p.recordCount,query.limit)||p.itemsTruncated!==(p.recordCount>query.limit))throw invalid();
   const items=p.items.map(item=>parseItem(item,{axis:'recorded',from,to,timeZone:query.timeZone,...(query.type?{type:query.type}:{}),includeSynthetic:true,limit:query.limit})),days=new Set(items.map(item=>item.date)).size;
   if(new Set(items.map(item=>item.eventKey)).size!==items.length||days>p.recordedDays||!p.itemsTruncated&&days!==p.recordedDays||!coverage.calendarAvailable&&items.some(item=>item.kind==='calendar'))throw invalid();
   return {...p,items} as TimelineComparisonPeriod;
  }
  const a=period(comparison.a,query.aFrom,query.aTo),b=period(comparison.b,query.bFrom,query.bTo),overlap=object(comparison.overlap,['from','to','calendarDays','recordCount']),from=query.aFrom>query.bFrom?query.aFrom:query.bFrom,to=query.aTo<query.bTo?query.aTo:query.bTo,intersects=from<=to;
  if(overlap.from!==(intersects?from:null)||overlap.to!==(intersects?to:null)||overlap.calendarDays!==(intersects?timelineCalendarDays(from,to):0)||!count(overlap.recordCount)||overlap.recordCount>Math.min(a.recordCount,b.recordCount)||!intersects&&overlap.recordCount!==0||a.recordCount+b.recordCount-overlap.recordCount>Number(coverage.currentRecords))throw invalid();
  for(const p of [a,b]){const sampleOverlap=p.items.filter(item=>intersects&&item.date!>=from&&item.date!<=to).length;if(sampleOverlap>overlap.recordCount||!p.itemsTruncated&&sampleOverlap!==overlap.recordCount)throw invalid();}
  for(const [complete,other] of [[a,b],[b,a]])if(!complete.itemsTruncated){const ids=new Set(complete.items.map(item=>item.eventKey));if(other.items.some(item=>intersects&&item.date!>=from&&item.date!<=to&&!ids.has(item.eventKey)))throw invalid();}
  const samples=new Map(a.items.map(item=>[item.eventKey,item]));for(const item of b.items){const prior=samples.get(item.eventKey);if(prior&&Object.keys(prior).some(key=>prior[key as keyof TimelineItem]!==item[key as keyof TimelineItem]))throw invalid();}
  return {...raw,query:checked,comparison:{a,b,overlap},coverage} as TimelineComparisonResponse;
 }catch{throw invalid();}
}
export function formatTimelineTime(item:Pick<TimelineItem,'dateKind'|'date'|'at'>,zone:string):string{
 if(item.dateKind==='unknown')return '日期未知';if(item.dateKind==='date')return item.date+'（仅日期）';
 validateCalendarZone(zone);instant(item.at);const parts=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(item.at)),part=(kind:string)=>parts.find(value=>value.type===kind)!.value;
 return part('year')+'-'+part('month')+'-'+part('day')+' '+part('hour')+':'+part('minute')+':'+part('second')+'（'+zone+'）';
}
export function validateTimelineSource(item:TimelineItem,value:SourceResponse):{selected:SearchDocument|null;selectedOutsideHistory:boolean;currentChanged:boolean}{
 const current=value.current;if([current,value.original,...value.history].some(doc=>doc.id!==item.id||doc.kind!==item.kind||doc.type!==item.type||doc.sourceId!==item.sourceId)||current.revision<item.currentRevision)throw invalid();
 const selected=[current,...value.history].find(doc=>doc.revision===item.revision)??null;
 if(selected?selected.title!==item.title:!value.historyTruncated)throw invalid();
 return {selected,selectedOutsideHistory:selected===null,currentChanged:current.revision>item.currentRevision};
}
export class TimelineClient{
 private readonly transport:typeof fetch;private ownerId:string|undefined;
 constructor(transport:typeof fetch=fetch){this.transport=transport;}
 private async request(path:string):Promise<unknown>{
  let response:Response;try{response=await this.transport(path,{credentials:'same-origin',cache:'no-store'});}catch{throw new TimelineRequestError(0,'NETWORK_UNAVAILABLE','暂时无法读取时间线，请重试。');}
  if(response.status>=500)throw new TimelineRequestError(response.status,'SERVICE_UNAVAILABLE','时间线服务暂不可用，请重试。');
  let value:unknown;try{const raw=await response.text();if(raw.length>2_000_000)throw invalid();value=JSON.parse(raw);}catch{throw invalid();}
  if(!response.ok){const code=isObject(value)&&isObject(value.error)&&typeof value.error.code==='string'?value.error.code:'';throw new TimelineRequestError(response.status,code,code==='DATA_READER_INCOMPATIBLE'?'当前读者不支持部分记录，已停止读取；请使用兼容版本或完整原样导出。':response.status===401?'登录已失效，请恢复原账号后重试。':response.status===403?'当前账号不能查看这些记录。':response.status===404?'来源不可用，请返回时间线重新核对。':'读取未完成，请核对条件后重试。');}
  if(response.status!==200)throw invalid();return value;
 }
 async identity():Promise<string>{
  try{const value=await this.request('/api/platform/auth/get-session');if(value===null)throw new TimelineRequestError(401,'LOGIN_REQUIRED','登录已失效，请恢复原账号后重试。');if(!isObject(value)||!isObject(value.user)||!isObject(value.session)||value.user.id!==value.session.userId)throw invalid();text(value.user.id,256);if(/[\u0000-\u001f\u007f]/.test(value.user.id))throw invalid();if(this.ownerId!==undefined&&value.user.id!==this.ownerId)throw new TimelineRequestError(403,'ACCOUNT_CHANGED','登录账号已变化，已隐藏原账号内容。请恢复原账号或重新加载页面。');this.ownerId=value.user.id;return value.user.id;
  }catch(cause){if(cause instanceof TimelineRequestError&&(cause.status===401||cause.status===403))throw cause;throw new TimelineRequestError(cause instanceof TimelineRequestError?cause.status:0,'IDENTITY_UNAVAILABLE','暂时无法核对登录账号，已隐藏读取内容。');}
 }
 async read(input:Partial<TimelineQuery>):Promise<TimelineResponse>{const query=normalized(input);await this.identity();let value:unknown;try{value=await this.request('/api/platform/timeline?'+new URLSearchParams(Object.entries(query).map(([key,value])=>[key,String(value)])));}catch(cause){await this.identity();throw cause;}await this.identity();return parseResponse(value,query);}
 async compare(input:Partial<TimelineComparisonQuery>):Promise<TimelineComparisonResponse>{const query=normalizedComparison(input);await this.identity();let value:unknown;try{value=await this.request('/api/platform/timeline/compare?'+new URLSearchParams(Object.entries(query).map(([key,value])=>[key,String(value)])));}catch(cause){await this.identity();throw cause;}await this.identity();return parseComparison(value,query);}
 async source(item:TimelineItem):Promise<SourceResponse>{
  if(this.ownerId===undefined)throw new TimelineRequestError(0,'IDENTITY_UNAVAILABLE','请先重新读取时间线以核对来源账号。');await this.identity();
  try{const value=await new SearchClient(this.transport).source(item.kind,item.id,true);await this.identity();validateTimelineSource(item,value);return value;}catch(cause){await this.identity();if(cause instanceof SearchRequestError)throw new TimelineRequestError(cause.status,cause.code,cause.message);throw cause;}
 }
}
export function createTimelineReadFence(){let generation=0,disposed=false;return {begin(){const version=++generation;return()=>!disposed&&version===generation;},invalidate(){generation++;},dispose(){disposed=true;generation++;}};}

export const parseTimelineWindowItem=(value:unknown,query:TimelineQuery)=>parseItem(value,query);
