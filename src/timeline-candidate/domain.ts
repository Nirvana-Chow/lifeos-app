import {PlatformError} from '../platform/domain.ts';
import {validateCalendarDate,validateCalendarZone} from '../calendar-candidate/domain.ts';
import type {TimelineAxis,TimelineQuery,TimelineComparisonQuery} from './contracts.ts';
const bad=():never=>{throw new PlatformError(400,'INVALID_TIMELINE_QUERY','请核对时间轴、日期、时区、类型和结果上限。');};
const types=['todo','finance','inbox','calendar','journal','learning','career','mood','article','resource','project','training'];
export function parseTimelineQuery(params:URLSearchParams):TimelineQuery{
 const known=['axis','from','to','timeZone','type','includeSynthetic','limit'],seen=new Set<string>();
 for(const[key]of params){if(!known.includes(key)||seen.has(key))bad();seen.add(key);}
 const axis=params.get('axis')??'occurred',from=params.get('from')||undefined,to=params.get('to')||undefined,type=params.get('type')||undefined,include=params.get('includeSynthetic');
 if(!['occurred','recorded','changed'].includes(axis)||type&&!types.includes(type)||include!==null&&include!=='true'&&include!=='false')bad();
 if(from)validateCalendarDate(from);if(to)validateCalendarDate(to);if(from&&to&&from>to)bad();
 const timeZone=validateCalendarZone(params.get('timeZone')??'Asia/Shanghai'),raw=params.get('limit');
 if(raw!==null&&!/^[1-9]\d{0,2}$/.test(raw))bad();const limit=raw===null?50:Number(raw);if(limit>100)bad();
 return{axis:axis as TimelineAxis,...(from?{from}:{}),...(to?{to}:{}),timeZone,...(type?{type}:{}),includeSynthetic:include==='true',limit};
}
export function parseTimelineComparisonQuery(params:URLSearchParams):TimelineComparisonQuery{
 const known=['aFrom','aTo','bFrom','bTo','timeZone','type','includeSynthetic','limit'],seen=new Set<string>();
 for(const[key]of params){if(!known.includes(key)||seen.has(key))bad();seen.add(key);}
 const aFrom=validateCalendarDate(params.get('aFrom')),aTo=validateCalendarDate(params.get('aTo')),bFrom=validateCalendarDate(params.get('bFrom')),bTo=validateCalendarDate(params.get('bTo'));
 if(aFrom>aTo||bFrom>bTo)bad();
 const type=params.get('type')||undefined,include=params.get('includeSynthetic');
 if(type&&!types.includes(type)||include!==null&&include!=='true'&&include!=='false')bad();
 const timeZone=validateCalendarZone(params.get('timeZone')??'Asia/Shanghai'),raw=params.get('limit');
 if(raw!==null&&!/^[1-9]\d?$/.test(raw))bad();const limit=raw===null?10:Number(raw);if(limit>50)bad();
 return{aFrom,aTo,bFrom,bTo,timeZone,...(type?{type}:{}),includeSynthetic:include==='true',limit};
}
/** Count inclusive civil dates, not elapsed local hours (which vary with DST).
 * Parsing full ISO dates also avoids Date.UTC's special handling of years 0-99. */
export function timelineCalendarDays(from:string,to:string):number{
 validateCalendarDate(from);validateCalendarDate(to);if(from>to)bad();
 return(Date.parse(to+'T00:00:00.000Z')-Date.parse(from+'T00:00:00.000Z'))/86_400_000+1;
}
/** Convert a stored UTC instant to a display date. Date-only values must never
 * enter this function: their recorded calendar date has no timezone precision. */
export function timelineLocalDate(instant:string,timeZone:string):string{
 validateCalendarZone(timeZone);
 const match=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(instant);
 if(!match)return bad();
 if(Number(match[2])>23||Number(match[3])>59||Number(match[4])>59)bad();
 validateCalendarDate(match[1]);const at=Date.parse(instant);if(!Number.isFinite(at))bad();
 let date:string;
 if(/^[+-]\d{2}:\d{2}$/.test(timeZone)){
  const offset=(Number(timeZone.slice(1,3))*60+Number(timeZone.slice(4,6)))*(timeZone[0]==='-'?-1:1);
  date=new Date(at+offset*60_000).toISOString().slice(0,10);
 }else{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',era:'short'}).formatToParts(at),part=(key:string)=>parts.find(p=>p.type===key)!.value;
  if(part('era')!=='AD')bad();date=part('year').padStart(4,'0')+'-'+part('month')+'-'+part('day');
 }
 return validateCalendarDate(date);
}
