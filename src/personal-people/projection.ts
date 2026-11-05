import type {PublicEntry} from '../platform/contracts.ts';
import {object,validateId,validateRevision} from '../platform/domain.ts';
import {normalizePersonPersonalFields,type PersonPersonal,type PersonPersonalFields} from './model.ts';

export type PersonRow = {id:string;sourceId:string;revision:number;title:string;fields:PersonPersonalFields;summary:string[];entry:PublicEntry};
export function personBirthdayLabel(personal:PersonPersonal):string|null {
  if(personal.birthdayOn) return `生日 ${personal.birthdayOn}（公历）`;
  return personal.birthdayMonthDay?`生日 ${personal.birthdayMonthDay}（公历，年份未知）`:null;
}
export function personSummary(personal:PersonPersonal):string[] {
  return [personal.relationship,personal.company,personBirthdayLabel(personal)].filter((value):value is string=>value!==null);
}
/** Only project an already authorized PersonalService response. This is not an ownership gate. */
export function projectPeopleEntries(entries:readonly PublicEntry[],spaceId:string,search=''):PersonRow[] {
  const query=search.trim().toLocaleLowerCase(),rows:PersonRow[]=[];
  for(const entry of entries) {
    try {
      const source=entry.source,original=object(source.original,['marker','spaceId','type','input']);
      const initial=object(original.input,['spaceId','confirmed','fields']);
      if(original.marker!=='personal-manual-v1'||original.type!=='person'||original.spaceId!==spaceId||initial.spaceId!==spaceId||initial.confirmed!==true||source.system!=='website'||source.externalId!==entry.id||source.version!==1||entry.kind!=='inbox'||entry.syncState!=='draft'||entry.externalStatus!==null) continue;
      normalizePersonPersonalFields(initial.fields);
      const draft=object(entry.draft,['title','text','occurredOn','personal','disposition']);
      if(draft.disposition!=='reference') continue;
      const fields=normalizePersonPersonalFields({title:draft.title,text:draft.text,occurredOn:draft.occurredOn,personal:draft.personal});
      const id=validateId(entry.id),sourceId=validateId(source.id),revision=validateRevision(entry.revision),p=fields.personal;
      const searchText=[fields.title,fields.text,...p.aliases,p.phone,p.email,p.company,p.relationship,p.birthdayOn,p.birthdayMonthDay].filter(Boolean).join('\n').toLocaleLowerCase();
      if(query&&!searchText.includes(query)) continue;
      rows.push({id,sourceId,revision,title:fields.title,fields,summary:personSummary(p),entry});
    } catch { /* Malformed records do not become inferred people. Service errors stay with the caller. */ }
  }
  return rows;
}
