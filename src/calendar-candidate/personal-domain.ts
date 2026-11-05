import {object,PlatformError,validateId,validateRevision} from '../platform/domain.ts';
import {validateCalendarDate,validateCalendarSchedule,validateCalendarZone,type CalendarSchedule} from './domain.ts';

/** Owner calendar shares PersonalService's inbox writer; legacy synthetic calendar storage is separate. */
export type CalendarReference={id:string;sourceId:string;revision:number};
export type CalendarLinks={project:CalendarReference|null;domain:CalendarReference|null;people:CalendarReference[]};
type Common={type:'calendar';schemaVersion:1;links:CalendarLinks};
export type CalendarPersonal=Common&(
 {calendarKind:'event';schedule:CalendarSchedule|null}|
 {calendarKind:'anniversary';occasion:'birthday'|'anniversary';originOn:string|null;monthDay:string|null;calendarSystem:'gregorian';repeat:'none'|'yearly';timeZone:string}|
 {calendarKind:'countdown';targetOn:string|null;timeZone:string}|
 {calendarKind:'life-stage';startOn:string|null;endOn:string|null}
);
export type CalendarPersonalFields={title:string;text:string;occurredOn:null;personal:CalendarPersonal};
export const calendarKinds=['event','anniversary','countdown','life-stage'] as const;
const invalid=(message='请核对日程类别、日期和关联字段。'):never=>{throw new PlatformError(400,'INVALID_CALENDAR_FIELDS',message);};
const optionalDate=(value:unknown):string|null=>value===null||value===undefined?null:validateCalendarDate(value);
function reference(value:unknown):CalendarReference|null{if(value===null||value===undefined)return null;const v=object(value,['id','sourceId','revision']);return{id:validateId(v.id),sourceId:validateId(v.sourceId),revision:validateRevision(v.revision)};}
function links(value:unknown):CalendarLinks{const v=object(value??{},['project','domain','people']),people=v.people??[];if(!Array.isArray(people)||people.length>20)return invalid('关联人物最多20位。');const pins=people.map(value=>reference(value)??invalid());if(new Set(pins.map(pin=>pin.id)).size!==pins.length)return invalid('关联人物不能重复。');return{project:reference(v.project),domain:reference(v.domain),people:pins};}
export function validateCalendarPersonal(input:unknown):CalendarPersonal{
 const common=object(input,['type','schemaVersion','links','calendarKind','schedule','occasion','originOn','monthDay','calendarSystem','repeat','timeZone','targetOn','startOn','endOn']);
 if(common.type!=='calendar'||common.schemaVersion!==1||!calendarKinds.includes(common.calendarKind as typeof calendarKinds[number]))return invalid();
 const base:Common={type:'calendar',schemaVersion:1,links:links(common.links)},keys=['type','schemaVersion','links','calendarKind'];
 switch(common.calendarKind){
  case 'event':{const v=object(input,[...keys,'schedule']);return{...base,calendarKind:'event',schedule:v.schedule===null||v.schedule===undefined?null:validateCalendarSchedule(v.schedule)};}
  case 'anniversary':{
   const v=object(input,[...keys,'occasion','originOn','monthDay','calendarSystem','repeat','timeZone']);
   if(!['birthday','anniversary'].includes(String(v.occasion))||v.calendarSystem!=='gregorian'||!['none','yearly'].includes(String(v.repeat)))return invalid('目前仅支持公历日期；重复规则必须明确。');
   const originOn=optionalDate(v.originOn);let monthDay:string|null=null;
   if(v.monthDay!==null&&v.monthDay!==undefined){if(typeof v.monthDay!=='string'||!/^\d{2}-\d{2}$/.test(v.monthDay))return invalid('月日必须为 MM-DD。');validateCalendarDate('2000-'+v.monthDay);monthDay=v.monthDay;}
   if(originOn&&monthDay||monthDay&&v.repeat!=='yearly')return invalid('已知完整日期与仅知月日不能同时设置；未知年份的月日仅用于每年纪念。');
   return{...base,calendarKind:'anniversary',occasion:v.occasion as 'birthday'|'anniversary',originOn,monthDay,calendarSystem:'gregorian',repeat:v.repeat as 'none'|'yearly',timeZone:validateCalendarZone(v.timeZone)};
  }
  case 'countdown':{const v=object(input,[...keys,'targetOn','timeZone']);return{...base,calendarKind:'countdown',targetOn:optionalDate(v.targetOn),timeZone:validateCalendarZone(v.timeZone)};}
  case 'life-stage':{const v=object(input,[...keys,'startOn','endOn']),startOn=optionalDate(v.startOn),endOn=optionalDate(v.endOn);if(startOn&&endOn&&endOn<startOn)return invalid('人生阶段结束日期不能早于开始日期。');return{...base,calendarKind:'life-stage',startOn,endOn};}
  default:return invalid();
 }
}
export function normalizeCalendarPersonalFields(input:unknown):CalendarPersonalFields{
 const v=object(input,['title','text','occurredOn','personal']);
 if(typeof v.title!=='string'||!v.title.trim()||v.title.length>240||v.title.includes('\0'))return invalid('标题为空、过长或无效。');
 const text=v.text??'';if(typeof text!=='string'||text.length>16384||text.includes('\0')||v.occurredOn!==null&&v.occurredOn!==undefined)return invalid('正文过长或无效；日程日期应由明确的日程字段提供。');
 return{title:v.title.trim(),text,occurredOn:null,personal:validateCalendarPersonal(v.personal)};
}
export function calendarPersonalReferences(personal:CalendarPersonal):{type:'project'|'domain'|'person';link:CalendarReference}[]{
 const r=personal.links;return[...(r.project?[{type:'project' as const,link:r.project}]:[]),...(r.domain?[{type:'domain' as const,link:r.domain}]:[]),...r.people.map(link=>({type:'person' as const,link}))];
}
