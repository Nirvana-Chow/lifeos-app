import {object,PlatformError,validateId,validateRevision} from '../platform/domain.ts';
import {validateCalendarDate} from '../calendar-candidate/domain.ts';

export type PersonReference = {id:string;sourceId:string;revision:number};
export type PersonLinks = {project:PersonReference|null;domain:PersonReference|null;topics:PersonReference[]};
/** Birthdays are Gregorian civil dates. A month/day never implies a birth year or age. */
export type PersonPersonal = {
  type:'person';schemaVersion:1;aliases:string[];phone:string|null;email:string|null;
  birthdayOn:string|null;birthdayMonthDay:string|null;company:string|null;relationship:string|null;links:PersonLinks;
};
export type PersonPersonalFields = {title:string;text:string;occurredOn:string|null;personal:PersonPersonal};
const personKeys = ['type','schemaVersion','aliases','phone','email','birthdayOn','birthdayMonthDay','company','relationship','links'] as const;
const invalid = (message='请核对人物资料与关联字段。'):never => {throw new PlatformError(400,'INVALID_PERSON_FIELDS',message);};
function required(value:Record<string,unknown>,keys:readonly string[]) {
  if(keys.some(key=>!Object.hasOwn(value,key)||value[key]===undefined)) invalid('请提供完整人物字段；未知资料请明确使用 null 或空数组。');
}
function nullableText(value:unknown,max:number):string|null {
  if(value===null) return null;
  if(typeof value!=='string'||value.length>max||value.includes('\0')) return invalid('人物资料过长或格式无效。');
  return value.trim()||null;
}
function reference(value:unknown):PersonReference|null {
  if(value===null) return null;
  const v=object(value,['id','sourceId','revision']);
  return {id:validateId(v.id),sourceId:validateId(v.sourceId),revision:validateRevision(v.revision)};
}
function links(value:unknown):PersonLinks {
  const v=object(value,['project','domain','topics']);required(v,['project','domain','topics']);
  if(!Array.isArray(v.topics)||v.topics.length>20) return invalid('关联主题最多20个。');
  const topics=v.topics.map(value=>reference(value)??invalid('主题引用无效。'));
  if(new Set(topics.map(pin=>pin.id)).size!==topics.length) return invalid('关联主题不能重复。');
  return {project:reference(v.project),domain:reference(v.domain),topics};
}
export function emptyPersonPersonal():PersonPersonal {
  return {type:'person',schemaVersion:1,aliases:[],phone:null,email:null,birthdayOn:null,birthdayMonthDay:null,company:null,relationship:null,links:{project:null,domain:null,topics:[]}};
}
export function validatePersonPersonal(input:unknown):PersonPersonal {
  const v=object(input,personKeys);required(v,personKeys);
  if(v.type!=='person'||v.schemaVersion!==1||!Array.isArray(v.aliases)||v.aliases.length>20) return invalid();
  const aliases=v.aliases.map(value=>typeof value==='string'?nullableText(value,240):invalid('别名必须为文字。')).filter((value):value is string=>value!==null);
  if(new Set(aliases.map(value=>value.toLocaleLowerCase())).size!==aliases.length) return invalid('别名不能重复。');
  const email=nullableText(v.email,254);
  if(email&&!/^[^\s@]+@[^\s@]+$/.test(email)) return invalid('邮箱格式无效。');
  const birthdayOn=v.birthdayOn===null?null:validateCalendarDate(v.birthdayOn);
  let birthdayMonthDay:string|null=null;
  if(v.birthdayMonthDay!==null) {
    if(typeof v.birthdayMonthDay!=='string'||!/^\d{2}-\d{2}$/.test(v.birthdayMonthDay)) return invalid('生日月日需要 MM-DD。');
    validateCalendarDate('2000-'+v.birthdayMonthDay);birthdayMonthDay=v.birthdayMonthDay;
  }
  if(birthdayOn&&birthdayMonthDay) return invalid('完整生日与仅知月日不能同时设置。');
  return {type:'person',schemaVersion:1,aliases,phone:nullableText(v.phone,80),email,birthdayOn,birthdayMonthDay,company:nullableText(v.company,240),relationship:nullableText(v.relationship,240),links:links(v.links)};
}
export function normalizePersonPersonalFields(input:unknown):PersonPersonalFields {
  const v=object(input,['title','text','occurredOn','personal']);required(v,['title','text','occurredOn','personal']);
  if(typeof v.title!=='string'||!v.title.trim()||v.title.length>240||v.title.includes('\0')) return invalid('姓名为空、过长或无效。');
  if(typeof v.text!=='string'||v.text.length>16384||v.text.includes('\0')) return invalid('人物说明过长或无效。');
  return {title:v.title.trim(),text:v.text,occurredOn:v.occurredOn===null?null:validateCalendarDate(v.occurredOn),personal:validatePersonPersonal(v.personal)};
}
/** Ownership/type/current-pin checks remain with PersonalService's single writer. */
export function personPersonalReferences(personal:PersonPersonal):{type:'project'|'domain'|'topic';link:PersonReference}[] {
  const r=personal.links;
  return [...(r.project?[{type:'project' as const,link:r.project}]:[]),...(r.domain?[{type:'domain' as const,link:r.domain}]:[]),...r.topics.map(link=>({type:'topic' as const,link}))];
}
