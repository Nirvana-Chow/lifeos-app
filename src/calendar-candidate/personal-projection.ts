import {object,PlatformError} from '../platform/domain.ts';
import type {SourceEvidence} from '../platform/contracts.ts';
import {validateCalendarDate,validateCalendarZone} from './domain.ts';
import {calendarKinds,type CalendarPersonalFields} from './personal-domain.ts';
export type CalendarRecord={id:string;revision:number;fields:CalendarPersonalFields;source:SourceEvidence;createdAt:string;updatedAt:string};
export type CalendarWindow={from:string;to:string;timeZone:string;search:string;calendarKind:'all'|typeof calendarKinds[number];limit:number;cursor:string|null};
export type CalendarOccurrence={occurrenceId:string;recordId:string;days:string[];startOn:string;endOn:string;kind:CalendarPersonalFields['personal']['calendarKind']};
export type CalendarProjection={occurrences:CalendarOccurrence[];unscheduled:string[];countdowns:{recordId:string;daysRemaining:number|null;asOfDate:string}[];lifeStages:{recordId:string;startOn:string|null;endOn:string|null}[]};
const dayMs=86400000;
export const calendarDayNumber=(date:string)=>Date.parse(validateCalendarDate(date)+'T00:00:00Z')/dayMs;
export function shiftCalendarDate(date:string,days:number):string{return validateCalendarDate(new Date((calendarDayNumber(date)+days)*dayMs).toISOString().slice(0,10));}
export function dateInCalendarZone(instant:string,timeZone:string):string{
 validateCalendarZone(timeZone);const stamp=Date.parse(instant);if(!Number.isFinite(stamp))throw new PlatformError(400,'INVALID_INSTANT','需要明确的观察时刻。');
 const fixed=/^([+-])(\d{2}):(\d{2})$/.exec(timeZone);
 if(fixed){const offset=(Number(fixed[2])*60+Number(fixed[3]))*(fixed[1]==='-'?-1:1);return validateCalendarDate(new Date(stamp+offset*60000).toISOString().slice(0,10));}
 const p=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(stamp),get=(name:string)=>p.find(part=>part.type===name)!.value;
 return validateCalendarDate(get('year').padStart(4,'0')+'-'+get('month')+'-'+get('day'));
}
export function validateCalendarWindow(input:unknown):CalendarWindow{
 const v=object(input,['from','to','timeZone','search','calendarKind','limit','cursor']),from=validateCalendarDate(v.from),to=validateCalendarDate(v.to),timeZone=validateCalendarZone(v.timeZone),days=calendarDayNumber(to)-calendarDayNumber(from),limit=v.limit??100;
 if(days<1||days>92||!Number.isInteger(limit)||(limit as number)<1||(limit as number)>100||v.search!==undefined&&(typeof v.search!=='string'||v.search.length>240)||v.calendarKind!==undefined&&v.calendarKind!=='all'&&!calendarKinds.includes(v.calendarKind as typeof calendarKinds[number])||v.cursor!==undefined&&v.cursor!==null&&(typeof v.cursor!=='string'||v.cursor.length>2048))throw new PlatformError(400,'INVALID_CALENDAR_QUERY','日期窗口须为1至92天，每页1至100项，筛选参数必须有效。');
 return{from,to,timeZone,search:typeof v.search==='string'?v.search.trim():'',calendarKind:(v.calendarKind??'all') as CalendarWindow['calendarKind'],limit:limit as number,cursor:(v.cursor??null) as string|null};
}
/** Calendar day arithmetic uses civil dates, never 24-hour increments through a local DST transition. */
export function projectCalendarRecords(records:readonly CalendarRecord[],window:CalendarWindow,observedAt:string):CalendarProjection{
 const days=Array.from({length:calendarDayNumber(window.to)-calendarDayNumber(window.from)},(_,i)=>shiftCalendarDate(window.from,i));
 const result:CalendarProjection={occurrences:[],unscheduled:[],countdowns:[],lifeStages:[]};
 function add(record:CalendarRecord,key:string,startOn:string,endOn:string,included:string[]){if(included.length)result.occurrences.push({occurrenceId:JSON.stringify([record.source.id,record.id,key]),recordId:record.id,days:included,startOn,endOn,kind:record.fields.personal.calendarKind});}
 for(const record of records){const p=record.fields.personal;
  if(p.calendarKind==='event'){
   if(!p.schedule){result.unscheduled.push(record.id);continue;}
   const schedule=p.schedule,start=schedule.kind==='all-day'?schedule.startDate:dateInCalendarZone(schedule.startAt,window.timeZone),end=schedule.kind==='all-day'?shiftCalendarDate(schedule.endDate,-1):dateInCalendarZone(new Date(Date.parse(schedule.endAt)-1).toISOString(),window.timeZone);
   add(record,'single',start,end,days.filter(date=>start<=date&&date<=end));continue;
  }
  if(p.calendarKind==='anniversary'){
   const monthDay=p.originOn?.slice(5)??p.monthDay;if(!monthDay){result.unscheduled.push(record.id);continue;}
   if(p.repeat==='none'){if(p.originOn)add(record,'single',p.originOn,p.originOn,days.filter(date=>date===p.originOn));continue;}
   for(let year=Number(window.from.slice(0,4));year<=Number(window.to.slice(0,4));year++){
    const date=String(year).padStart(4,'0')+'-'+monthDay;try{validateCalendarDate(date);}catch{continue;}
    // A birthday cannot occur before its actual known origin. Unknown birth years stay unknown.
    if(p.originOn&&date<p.originOn)continue;add(record,String(year),date,date,days.filter(day=>day===date));
   }continue;
  }
  if(p.calendarKind==='countdown'){
   const today=dateInCalendarZone(observedAt,p.timeZone);result.countdowns.push({recordId:record.id,daysRemaining:p.targetOn?calendarDayNumber(p.targetOn)-calendarDayNumber(today):null,asOfDate:today});
   if(!p.targetOn){result.unscheduled.push(record.id);continue;}add(record,'single',p.targetOn,p.targetOn,days.filter(date=>date===p.targetOn));continue;
  }
  result.lifeStages.push({recordId:record.id,startOn:p.startOn,endOn:p.endOn});
  if(!p.startOn||!p.endOn){result.unscheduled.push(record.id);continue;}add(record,'single',p.startOn,p.endOn,days.filter(date=>date>=p.startOn!&&date<=p.endOn!));
 }
 return result;
}
