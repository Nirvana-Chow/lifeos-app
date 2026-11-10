import {object,validateId,validateRevision} from '../platform/domain.ts';
import type {PublicEntry} from '../platform/contracts.ts';
import {normalizePersonalFields,type ObjectFields} from './business.ts';
export type RecordModule='journal'|'health'|'person'|'media'|'career'|'portfolio';
export type RecordFields={title:string;text:string;occurredOn:string|null;personal?:ObjectFields['personal']};
export function ownerRecord(entry:unknown,type:RecordModule|'cooking',spaceId:string):PublicEntry {
 const e=entry as PublicEntry,source=e?.source,original=object(source?.original,['marker','spaceId','type','input']);
 if('ownerId'in e||e.kind!=='inbox'||e.syncState!=='draft'||e.externalStatus!==null||source.system!=='website'||source.externalId!==e.id||source.version!==1||original.marker!=='personal-manual-v1'||original.type!==type||original.spaceId!==spaceId)throw Error('记录来源无法核对。');
 validateId(e.id);validateId(source.id);validateRevision(e.revision);
 const initial=object(original.input,['spaceId','confirmed','fields']);if(initial.spaceId!==spaceId||initial.confirmed!==true)throw Error('记录空间无法核对。');normalizePersonalFields(type,initial.fields);
 recordFields(e,type);return e;
}
export function recordFields(entry:PublicEntry,type:RecordModule|'cooking'):RecordFields {
 const raw=object(entry.draft,['title','text','occurredOn','disposition','personal']);if(raw.disposition!=='reference')throw Error('记录类别无法核对。');
 const {disposition,...fields}=raw;void disposition;return normalizePersonalFields(type,fields) as RecordFields;
}
