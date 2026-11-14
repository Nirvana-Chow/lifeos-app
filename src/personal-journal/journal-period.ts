import {validateCalendarDate} from '../calendar-candidate/domain.ts';
import {calendarDayNumber,shiftCalendarDate} from '../calendar-candidate/personal-projection.ts';
import type {JournalHistory,JournalHistoryRow} from './history.ts';

export type JournalPeriod='day'|'week'|'month'|'quarter'|'year';
export type JournalPeriodRange={from:string;to:string};
const firstDate='0001-01-01',lastDate='9999-12-31';
const minDay=calendarDayNumber(firstDate),maxDay=calendarDayNumber(lastDate);
const civil=(year:number,month:number,day:number)=>`${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
const daysInMonth=(year:number,month:number)=>{const day=new Date(civil(year,month,1)+'T00:00:00Z');day.setUTCMonth(day.getUTCMonth()+1,0);return day.getUTCDate();};
const weekday=(date:string)=>(new Date(date+'T00:00:00Z').getUTCDay()+6)%7;
function boundedShift(date:string,days:number){const current=calendarDayNumber(date),target=Math.max(minDay,Math.min(maxDay,current+days));return shiftCalendarDate(date,target-current);}

/** Inclusive natural calendar boundaries. Pure dates never pass through a local timezone. */
export function journalPeriodRange(date:string,period:JournalPeriod):JournalPeriodRange {
 validateCalendarDate(date);const year=Number(date.slice(0,4)),month=Number(date.slice(5,7));
 if(period==='day')return{from:date,to:date};
 if(period==='week'){const day=weekday(date);return{from:boundedShift(date,-day),to:boundedShift(date,6-day)};}
 if(period==='month')return{from:civil(year,month,1),to:civil(year,month,daysInMonth(year,month))};
 if(period==='quarter'){const start=Math.floor((month-1)/3)*3+1;return{from:civil(year,start,1),to:civil(year,start+2,daysInMonth(year,start+2))};}
 if(period==='year')return{from:civil(year,1,1),to:civil(year,12,31)};
 throw Error('请选择有效的日记周期。');
}
export function shiftJournalMonth(date:string,delta:number):string|null {
 validateCalendarDate(date);if(!Number.isInteger(delta))throw Error('月份移动必须是整数。');
 const index=(Number(date.slice(0,4))-1)*12+Number(date.slice(5,7))-1+delta;
 if(index<0||index>=9999*12)return null;
 const year=Math.floor(index/12)+1,month=index%12+1;
 return civil(year,month,Math.min(Number(date.slice(8)),daysInMonth(year,month)));
}
export function journalMonthDays(date:string,rows:readonly JournalHistoryRow[]){
 const range=journalPeriodRange(date,'month'),offset=weekday(range.from),days=Number(range.to.slice(8)),counts=new Map<string,number>();
 for(const row of rows)if(row.occurredOn!==null)counts.set(row.occurredOn,(counts.get(row.occurredOn)??0)+1);
 return{month:date.slice(0,7),cells:Array.from({length:Math.ceil((offset+days)/7)*7},(_,index)=>{
  const day=index-offset+1;if(day<1||day>days)return null;
  const value=range.from.slice(0,8)+String(day).padStart(2,'0');return{date:value,count:counts.get(value)??0};
 })};
}
export function projectJournalPeriod(history:JournalHistory,date:string,period:JournalPeriod){
 const range=journalPeriodRange(date,period),rows=history.rows.filter(row=>row.occurredOn!==null&&row.occurredOn>=range.from&&row.occurredOn<=range.to).toSorted((a,b)=>b.occurredOn!.localeCompare(a.occurredOn!)||b.id.localeCompare(a.id));
 return{range,rows,recordedDays:new Set(rows.map(row=>row.occurredOn)).size,undated:history.rows.filter(row=>row.occurredOn===null)};
}
