import type {PublicEntry} from '../platform/contracts.ts';
import {validateId} from '../platform/domain.ts';
import {ownerRecord,recordFields} from '../personal-candidate/record-model.ts';
import type {PersonalReference} from '../personal-candidate/business.ts';
import {journalRecordHref} from '../personal-journal/history.ts';
import type {PersonRow} from './projection.ts';

type JournalLink = {id:string; title:string; occurredOn:string|null};

export function personRecordId(value:unknown):string|null {
 try {return validateId(value);} catch {return null;}
}

export function personRecordHref(id:string):string {
 return '/personal/people?record='+validateId(id);
}

export function relatedJournalHref(journalId:string,personId:string):string {
 return journalRecordHref(journalId)+'&person='+validateId(personId);
}

export function verifiedPersonPin(pin:PersonalReference,person:Pick<PersonRow,'id'|'sourceId'|'revision'>):boolean {
 return pin.id===person.id&&pin.sourceId===person.sourceId&&pin.revision<=person.revision;
}

/** Uses the owner-bound current overview. A malformed or partial overview is distinct from zero links. */
export function projectRelatedJournals(snapshot:unknown,people:readonly PersonRow[],spaceId:string):Map<string,JournalLink[]>|null {
 if(!snapshot||typeof snapshot!=='object')return null;
 const {scope,truncated,total,items}=snapshot as {scope?:unknown;truncated?:unknown;total?:unknown;items?:unknown};
 if(scope!=='full-current-snapshot'||truncated!==false||!Array.isArray(items)||items.length!==total||items.length>10000)return null;
 const byPerson=new Map(people.map(person=>[person.id,person]));
 const linked=new Map<string,JournalLink[]>();
 const seen=new Set<string>();
 try {
  for(const item of items){
   const entry=item as PublicEntry;
   if(seen.has(entry.id))return null;
   seen.add(entry.id);
   const personal='personal' in entry.draft?entry.draft.personal:undefined;
   if(!personal||!('type' in personal)||personal.type!=='journal')continue;
   const row=ownerRecord(entry,'journal',spaceId), fields=recordFields(row,'journal');
   if(fields.personal?.type!=='journal')continue;
   const journal={id:row.id,title:fields.title,occurredOn:fields.occurredOn};
   for(const pin of fields.personal.links.people){
    const person=byPerson.get(pin.id);
    if(!person||!verifiedPersonPin(pin,person))continue;
    const records=linked.get(person.id)??[];
    records.push(journal);
    linked.set(person.id,records);
   }
  }
 } catch {return null;}
 for(const records of linked.values())records.sort((a,b)=>(b.occurredOn??'').localeCompare(a.occurredOn??'')||a.id.localeCompare(b.id));
 return linked;
}

export type RelatedJournals=NonNullable<ReturnType<typeof projectRelatedJournals>>;


export async function readLinkedPerson(
 pin:PersonalReference,
 binding:{ownerId:string;spaceId:string},
 fetcher:typeof fetch=fetch,
):Promise<boolean> {
 try {
  const options={cache:'no-store',credentials:'same-origin'} as const;
  const reply=await fetcher('/api/platform/personal/person/'+validateId(pin.id),options);
  if(!reply.ok)return false;
  const entry=ownerRecord((await reply.json()).entry,'person',binding.spaceId);
  if(!verifiedPersonPin(pin,{id:entry.id,sourceId:entry.source.id,revision:entry.revision}))return false;
  const status=await fetcher('/api/platform/personal/status',options);
  if(!status.ok)return false;
  const after=await status.json();
  return after.storageVerified===true&&after.peopleEnabled===true&&Array.isArray(after.allowedTypes)
   &&after.allowedTypes.includes('journal')&&after.ownerId===binding.ownerId&&after.spaceId===binding.spaceId;
 } catch {return false;}
}
