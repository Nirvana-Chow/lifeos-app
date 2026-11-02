import {object,validateId,validateTodo,type TodoDraft} from '../platform/domain.ts';
import type {ReminderPreviewRow} from '../import-preview/reminders.ts';
export const appleOriginMarker='personal-apple-reminders-v1';
export type AppleOrigin={marker:typeof appleOriginMarker;spaceId:string;type:'todo';sourceRef:string;sourceDigest:string;source:ReminderPreviewRow['source'];initialDraft:TodoDraft};
const fail=():never=>{throw Error('APPLE_ORIGIN_INVALID');};
const timestamp=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v));
/** Browser-safe origin validation. Immutable evidence, separate from editable draft. */
export function readAppleOrigin(value:unknown,spaceId?:string):AppleOrigin{
 const v=object(value,['marker','spaceId','type','sourceRef','sourceDigest','source','initialDraft']);
 if(v.marker!==appleOriginMarker||v.type!=='todo'||typeof v.spaceId!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(v.spaceId)||spaceId!==undefined&&v.spaceId!==spaceId||typeof v.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(v.sourceDigest))return fail();
 const s=object(v.source,['id','listID','capturedAt','isCompleted','dueDate','dueDateIsAllDay','completionDate','original','notesIncluded','sourceTimes']);
 const id=validateId(s.id).toUpperCase();validateId(s.listID);
 if(v.sourceRef!=='apple-reminder:'+id||!timestamp(s.capturedAt)||typeof s.isCompleted!=='boolean'||typeof s.notesIncluded!=='boolean'||s.dueDate!==null&&!timestamp(s.dueDate)||s.completionDate!==null&&!timestamp(s.completionDate)||s.dueDateIsAllDay!==null&&typeof s.dueDateIsAllDay!=='boolean'||s.dueDate!==null&&typeof s.dueDateIsAllDay!=='boolean')return fail();
 const original=object(s.original,['title','notes']),times=object(s.sourceTimes,['creationDate','lastModifiedDate','modificationDate','createdAt','modifiedAt']);
 if(Object.values(times).some(t=>!timestamp(t))||typeof original.title!=='string'||original.title.length>240||!original.title.trim()||s.notesIncluded===false&&'notes'in original||s.notesIncluded===true&&(typeof original.notes!=='string'||original.notes.length>16384))return fail();
 const initial=object(v.initialDraft,['title','notes','dueOn','status']),draft=validateTodo(initial),due=s.dueDate===null?null:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(s.dueDate as string));
 if(draft.title!==original.title.trim()||draft.notes!==(s.notesIncluded?original.notes:'')||draft.status!==(s.isCompleted?'done':'open')||draft.dueOn!==due)return fail();
 return structuredClone(v) as AppleOrigin;
}
export function originalPersonalType(original:unknown):string|null{
 if(!original||typeof original!=='object'||Array.isArray(original))return null;
 const v=original as Record<string,unknown>;
 if(v.marker===appleOriginMarker){try{return readAppleOrigin(v).type;}catch{return null;}}
 return v.marker==='personal-manual-v1'&&typeof v.type==='string'?v.type:null;
}
