import {validateCalendarRecord} from '../calendar-candidate/personal-record.ts';
import type {CalendarPersonal} from '../calendar-candidate/personal-domain.ts';
import {object,validateId,validateRevision,validateTodo} from '../platform/domain.ts';
import {normalizePersonalFields,personalTypes,type ObjectFields} from '../personal-candidate/business.ts';
import {appleOriginMarker,readAppleOrigin} from '../personal-candidate/apple-origin.ts';
import type {PersonalType} from '../personal-candidate/config.ts';
import type {PublicEntry} from '../platform/contracts.ts';
export const searchTypeLabels:Record<PersonalType,string>={todo:'待办',journal:'日记',project:'项目',domain:'领域',topic:'主题',calendar:'日程',health:'健康',person:'人物',media:'书影音',career:'职业与简历',portfolio:'账户资产投资',cooking:'做饭'};
export type SearchSelection={type:PersonalType;id:string};
export type SearchRow=SearchSelection&{sourceId:string;revision:number;title:string;text:string;excerpt:string;date:string|null;dateLabel:string;sourceLabel:string;calendar?:CalendarPersonal};
export type SearchCoverage={types:PersonalType[];scanned:number;matched:number};
export function searchHref(query:string,selection?:SearchSelection):string{const params=new URLSearchParams({q:query});if(selection){if(!personalTypes.includes(selection.type))throw Error('记录类别无法核对。');params.set('type',selection.type);params.set('id',validateId(selection.id));}return '/personal/search?'+params;}
export function readSearchSelection(type:unknown,id:unknown):SearchSelection|null{if(type===undefined&&id===undefined)return null;if(!personalTypes.includes(type as PersonalType))throw Error('记录类别无法核对。');return{type:type as PersonalType,id:validateId(id)};}
export function searchRow(value:unknown,spaceId:string,query:string):SearchRow{
 const entry=value as PublicEntry;if(!entry||typeof entry!=='object'||'ownerId'in entry)throw Error('记录来源无法核对。');
 const source=entry.source,original=source?.original as Record<string,unknown>;
 if(!source||!original||source.system!=='website'||source.externalId!==entry.id||source.version!==1||entry.syncState!=='draft'||entry.externalStatus!==null||original.spaceId!==spaceId)throw Error('记录来源无法核对。');
 const id=validateId(entry.id),sourceId=validateId(source.id),revision=validateRevision(entry.revision),type=original.type as PersonalType;
 if(!personalTypes.includes(type)||entry.kind!==(type==='todo'?'todo':'inbox'))throw Error('记录类别无法核对。');
 if(original.marker===appleOriginMarker){if(type!=='todo')throw Error('记录来源无法核对。');readAppleOrigin(original,spaceId);}else{
  object(original,['marker','spaceId','type','input']);const initial=object(original.input,['spaceId','confirmed','fields']);if(original.marker!=='personal-manual-v1'||initial.spaceId!==spaceId||initial.confirmed!==true)throw Error('记录来源无法核对。');normalizePersonalFields(type,initial.fields);
 }
 let title:string,text:string,date:string|null;
 if(type==='todo'){const draft=validateTodo(entry.draft);title=draft.title;text=draft.notes;date=draft.dueOn;}
 else{const raw=object(entry.draft,['title','text','occurredOn','disposition','personal']);if(raw.disposition!=='reference')throw Error('记录类别无法核对。');const{disposition,...fields}=raw;void disposition;const draft=normalizePersonalFields(type,fields) as ObjectFields;title=draft.title;text=draft.text;date=draft.occurredOn;}
 const excerpt=proseExcerpt(text,query);
 return{type,id,sourceId,revision,title,text,date,excerpt,dateLabel:type==='todo'?'截止日期':'记录日期',sourceLabel:original.marker===appleOriginMarker?'Apple 提醒事项导入':'本人手工记录'};
}

function proseExcerpt(text:string,query:string):string{const q=query.trim().toLowerCase(),match=q?text.toLowerCase().indexOf(q):0,start=Math.max(0,match-48);return(start?'…':'')+text.slice(start,start+180)+(text.length>start+180?'…':'');}
/** Calendar's native GET projection is not a PublicEntry security envelope. */
export function searchCalendarRow(value:unknown,spaceId:string,query:string):SearchRow{
 const record=validateCalendarRecord(value,spaceId),{title,text,occurredOn,personal}=record.fields;
 return{type:'calendar',id:record.id,sourceId:record.source.id,revision:record.revision,title,text,excerpt:proseExcerpt(text,query),date:occurredOn,dateLabel:'记录日期',sourceLabel:'本人手工记录',calendar:personal};
}
