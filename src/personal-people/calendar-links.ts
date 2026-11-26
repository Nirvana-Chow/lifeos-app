import {readPersonalCalendarEntry} from '../calendar-candidate/personal-record.ts';
import {dateInCalendarZone} from '../calendar-candidate/personal-projection.ts';
import {validateId} from '../platform/domain.ts';
import {verifiedPersonPin} from './journal-links.ts';
import type {PersonRow} from './projection.ts';

type LinkedEvent={id:string;title:string;date:string|null};
export type RelatedCalendarEvents=Map<string,LinkedEvent[]>;

export function linkedCalendarHref(id:string):string{return '/personal/schedule?record='+validateId(id);}

/** Project explicitly linked, owner-verified website events only. A partial source never implies zero. */
export function projectRelatedCalendarEvents(snapshot:unknown,people:readonly PersonRow[],spaceId:string):RelatedCalendarEvents|null{
 if(!snapshot||typeof snapshot!=='object')return null;
 const {scope,truncated,total,items}=snapshot as {scope?:unknown;truncated?:unknown;total?:unknown;items?:unknown};
 if(scope!=='full-current-snapshot'||truncated!==false||!Array.isArray(items)||total!==items.length||items.length>10000)return null;
 const byPerson=new Map(people.map(person=>[person.id,person]));
 const related:RelatedCalendarEvents=new Map();
 const seen=new Set<string>();
 try {
  for(const item of items){
   if(!item||typeof item!=='object'||typeof item.id!=='string'||seen.has(item.id))return null;
   seen.add(item.id);
   if(item.source?.original?.type!=='calendar')continue;
   const {id,fields}=readPersonalCalendarEntry(item,spaceId);
   const calendar=fields.personal;
   if(calendar.calendarKind!=='event')continue;
   const schedule=calendar.schedule;
   const date=!schedule?null:schedule.kind==='all-day'?schedule.startDate:dateInCalendarZone(schedule.startAt,schedule.timeZone);
   const event={id,title:fields.title,date};
   for(const pin of calendar.links.people){
    const person=byPerson.get(pin.id);
    if(!person||!verifiedPersonPin(pin,person))continue;
    const events=related.get(person.id)??[];
    events.push(event);
    related.set(person.id,events);
   }
  }
 } catch {return null;}
 for(const events of related.values())events.sort((a,b)=>(b.date??'').localeCompare(a.date??'')||a.id.localeCompare(b.id));
 return related;
}
