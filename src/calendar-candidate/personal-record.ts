import {PlatformError,validateId,validateRevision} from '../platform/domain.ts';
import type {SourceEvidence} from '../platform/contracts.ts';
import {normalizeCalendarPersonalFields} from './personal-domain.ts';
import type {CalendarRecord} from './personal-projection.ts';
const row=(value:unknown):Record<string,any>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
const missing=():never=>{throw new PlatformError(404,'NOT_FOUND','没有可访问的本人日程。');};
function timestamp(value:unknown):string{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value)||!Number.isFinite(Date.parse(value)))return missing();return value;}
export function validateCalendarRecord(input:unknown,spaceId:string):CalendarRecord{
 const value=row(input),source=row(value.source),original=row(source.original),initial=row(original.input);
 if(original.marker!=='personal-manual-v1'||original.type!=='calendar'||original.spaceId!==spaceId||initial.spaceId!==spaceId||initial.confirmed!==true||source.system!=='website'||source.externalId!==value.id||source.version!==1)return missing();
 normalizeCalendarPersonalFields(initial.fields);
 return{id:validateId(value.id),revision:validateRevision(value.revision),fields:normalizeCalendarPersonalFields(value.fields),source:{id:validateId(source.id),system:'website',externalId:value.id,version:1,asOf:timestamp(source.asOf),original:structuredClone(source.original)} as SourceEvidence,createdAt:timestamp(value.createdAt),updatedAt:timestamp(value.updatedAt)};
}
export function readPersonalCalendarEntry(input:unknown,spaceId:string):CalendarRecord{
 const value=row(input),draft=row(value.draft);if(value.kind!=='inbox'||value.syncState!=='draft'||value.externalStatus!==null||draft.disposition!=='reference'||draft.record)return missing();
 return validateCalendarRecord({id:value.id,revision:value.revision,fields:{title:draft.title,text:draft.text,occurredOn:draft.occurredOn,personal:draft.personal},source:value.source,createdAt:value.createdAt,updatedAt:value.updatedAt},spaceId);
}
