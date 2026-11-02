import {validateId,validateRevision,validateTodo,validateInbox} from '../platform/domain.ts';
import type {PublicEntry} from '../platform/contracts.ts';
import {isRecordEntry} from '../records-candidate/domain.ts';
import type {ProjectLinkType,ProjectLinkCandidate,ProjectLink,ProjectLinkState} from '../records-candidate/contracts.ts';

export const linkKind=(type:ProjectLinkType)=>type==='todo'?'todo' as const:'inbox' as const;
/** Project only validated business fields. Never expose repository ownership or
 * a target with an unexpected source/type as a selectable or current record. */
export function projectLinkCandidate(entry:PublicEntry|undefined|null,type:ProjectLinkType):ProjectLinkCandidate|null{
 if(!entry||entry.kind!==linkKind(type))return null;
 try{
  const id=validateId(entry.id),sourceId=validateId(entry.source.id),revision=validateRevision(entry.revision);
  if(entry.source.system!=='website'||entry.source.externalId!==entry.id||entry.syncState!=='draft'||entry.externalStatus!==null)return null;
  if(typeof entry.updatedAt!=='string'||!Number.isFinite(Date.parse(entry.updatedAt))||new Date(entry.updatedAt).toISOString()!==entry.updatedAt)return null;
  if(type!=='todo'&&!isRecordEntry(entry,type))return null;
  const draft=type==='todo'?validateTodo(entry.draft):validateInbox(entry.draft);
  const summary=('notes' in draft?draft.notes:draft.text).slice(0,500);
  return{link:{type,id,sourceId,revision},title:draft.title,summary,updatedAt:entry.updatedAt};
 }catch{return null;}
}
export function projectLinkState(link:ProjectLink,entry:PublicEntry|undefined):ProjectLinkState{
 const current=projectLinkCandidate(entry,link.type);
 if(!current||current.link.sourceId!==link.sourceId)return{link,status:'unavailable',current:null};
 return{link,status:current.link.revision===link.revision?'current':'updated',current};
}
