import {object,PlatformError} from '../platform/domain.ts';
export type CalendarSchedule={kind:'all-day';startDate:string;endDate:string}|{kind:'timed';startAt:string;endAt:string;timeZone:string};
export type CalendarDraft={title:string;notes:string;schedule:CalendarSchedule};
export type DayQuery={date:string;timeZone:string};
export const calendarKeys=['title','notes','schedule'] as const;
const invalid=(code:string,message:string):never=>{throw new PlatformError(400,code,message);};
export function validateCalendarDate(value:unknown):string {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000-'))return invalid('INVALID_DATE','需要真实的 YYYY-MM-DD 日期。');
 const date=new Date(value+'T00:00:00Z');
 if(!Number.isFinite(date.valueOf())||date.toISOString().slice(0,10)!==value)return invalid('INVALID_DATE','日期不存在。');
 return value;
}
function offsetMinutes(value:string):number|null {
 const match=/^([+-])(\d{2}):(\d{2})$/.exec(value);if(!match)return null;
 const hours=Number(match[2]),minutes=Number(match[3]);
 if(hours>14||minutes>59||(hours===14&&minutes!==0)||value==='-00:00')return invalid('INVALID_TIME_ZONE','需要有效时区或明确 UTC 偏移。');
 return (match[1]==='-'?-1:1)*(hours*60+minutes);
}
export function validateCalendarZone(value:unknown):string {
 if(typeof value!=='string'||value.length>100)return invalid('INVALID_TIME_ZONE','需要明确的 IANA 时区或 UTC 偏移。');
 if(offsetMinutes(value)!==null)return value;
 if(value!=='UTC'&&!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(value))return invalid('INVALID_TIME_ZONE','需要明确的 IANA 时区或 UTC 偏移。');
 try{new Intl.DateTimeFormat('en-US',{timeZone:value}).format(0);}catch{return invalid('INVALID_TIME_ZONE','时区不存在。');}
 return value;
}
function instant(value:unknown,zone:string):string {
 if(typeof value!=='string')return invalid('INVALID_INSTANT','时刻必须明确包含 Z 或 UTC 偏移。');
 const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
 if(!m)return invalid('INVALID_INSTANT','时刻必须明确包含 Z 或 UTC 偏移。');
 validateCalendarDate(m[1]);if(Number(m[2])>23||Number(m[3])>59||Number(m[4]??0)>59)return invalid('INVALID_INSTANT','时刻不存在。');
 const givenOffset=m[6]==='Z'?0:offsetMinutes(m[6])!,date=new Date(value);
 if(!Number.isFinite(date.valueOf()))return invalid('INVALID_INSTANT','时刻无效。');
 const normalized=date.toISOString();validateCalendarDate(normalized.slice(0,10));
 // UTC instants are unambiguous. For wall time plus offset, verify that the
 // supplied offset exists in the selected zone; never guess a DST transition.
 if(m[6]!=='Z'){
  const fixed=offsetMinutes(zone);
  const actual=fixed??(()=>{const part=new Intl.DateTimeFormat('en-US',{timeZone:zone,timeZoneName:'longOffset'}).formatToParts(date).find(p=>p.type==='timeZoneName')!.value;return part==='GMT'?0:offsetMinutes(part.replace('GMT',''))!;})();
  if(actual!==givenOffset)return invalid('TIME_ZONE_MISMATCH','时刻偏移与所选时区不一致，请明确夏令时时刻。');
 }
 return normalized;
}
export function validateCalendarSchedule(input:unknown):CalendarSchedule {
 const type=object(input,['kind','startDate','endDate','startAt','endAt','timeZone']).kind;
 if(type==='all-day'){
  const value=object(input,['kind','startDate','endDate']),startDate=validateCalendarDate(value.startDate),endDate=validateCalendarDate(value.endDate);
  if(endDate<=startDate)return invalid('INVALID_RANGE','结束日期（不含）必须晚于开始日期。');
  return{kind:'all-day',startDate,endDate};
 }
 if(type!=='timed')return invalid('INVALID_SCHEDULE','请选择全天或定时安排。');
 const value=object(input,['kind','startAt','endAt','timeZone']),timeZone=validateCalendarZone(value.timeZone),startAt=instant(value.startAt,timeZone),endAt=instant(value.endAt,timeZone);
 if(endAt<=startAt)return invalid('INVALID_RANGE','结束时刻必须晚于开始时刻。');
 return{kind:'timed',startAt,endAt,timeZone};
}
export function validateCalendarDraft(input:unknown):CalendarDraft {
 const value=object(input,calendarKeys),notes=value.notes??'';
 if(typeof value.title!=='string'||!value.title.trim()||value.title.length>240||value.title.includes('\0'))return invalid('INVALID_TITLE','标题为空、过长或无效。');
 if(typeof notes!=='string'||notes.length>16384||notes.includes('\0'))return invalid('INVALID_NOTES','备注过长或无效。');
 return{title:value.title.trim(),notes,schedule:validateCalendarSchedule(value.schedule)};
}
export function validateDayQuery(input:unknown):DayQuery {
 const value=object(input,['date','timeZone']);return{date:validateCalendarDate(value.date),timeZone:validateCalendarZone(value.timeZone)};
}
function localDate(at:number,zone:string):string {
 const fixed=offsetMinutes(zone);if(fixed!==null)return new Date(at+fixed*60_000).toISOString().slice(0,10);
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at),part=(key:string)=>parts.find(p=>p.type===key)!.value;
 return part('year').padStart(4,'0')+'-'+part('month')+'-'+part('day');
}
export function occursOnDay(schedule:CalendarSchedule,query:DayQuery):boolean {
 if(schedule.kind==='all-day')return schedule.startDate<=query.date&&query.date<schedule.endDate;
 return localDate(Date.parse(schedule.startAt),query.timeZone)<=query.date&&query.date<=localDate(Date.parse(schedule.endAt)-1,query.timeZone);
}
