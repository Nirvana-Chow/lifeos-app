import {object,validateId,validateRevision,PlatformError,validateInbox,validateTodo,type TodoDraft,type InboxDraft} from '../platform/domain.ts';
export const personalTypes=['todo','journal','project','domain','topic'] as const;
export type PersonalReference={id:string;sourceId:string;revision:number};
export type PersonalRelations={project:PersonalReference|null;domain:PersonalReference|null;topics:PersonalReference[]};
export type PersonalObject={type:'project';stage:'idea'|'planned'|'active'|'paused'|'closed';purpose:'maintain'|'advance'|'explore'|null;nextStep:string;domain:PersonalReference|null;topics:PersonalReference[]}|{type:'domain'|'topic'};
const invalid=():never=>{throw new PlatformError(400,'INVALID_PERSONAL_FIELDS','请核对用途、阶段与关联字段。');};
function ref(v:unknown):PersonalReference|null{if(v===undefined||v===null)return null;const r=object(v,['id','sourceId','revision']);return{id:validateId(r.id),sourceId:validateId(r.sourceId),revision:validateRevision(r.revision)};}
function topics(v:unknown):PersonalReference[]{if(v===undefined)return[];if(!Array.isArray(v)||v.length>20)return invalid();const result=v.map(x=>{const r=ref(x);if(!r)return invalid();return r;});if(new Set(result.map(r=>r.id)).size!==result.length)return invalid();return result;}
export function validatePersonalRelations(value:unknown):PersonalRelations{const v=object(value,['project','domain','topics']);return{project:ref(v.project),domain:ref(v.domain),topics:topics(v.topics)};}
export function validatePersonalObject(value:unknown):PersonalObject{const v=object(value,['type','stage','purpose','nextStep','domain','topics']);if(v.type==='domain'||v.type==='topic'){object(value,['type']);return{type:v.type};}if(v.type!=='project'||!['idea','planned','active','paused','closed'].includes(String(v.stage))||v.purpose!==null&&!['maintain','advance','explore'].includes(String(v.purpose))||typeof v.nextStep!=='string'||v.nextStep.length>4000||v.nextStep.includes('\0'))return invalid();return{type:'project',stage:v.stage as 'active',purpose:v.purpose as 'advance'|null,nextStep:v.nextStep,domain:ref(v.domain),topics:topics(v.topics)};}
export type ObjectFields={title:string;text:string;occurredOn:string|null;personal:PersonalObject};
export function normalizePersonalFields(type:string,value:unknown):TodoDraft|ObjectFields|Pick<InboxDraft,'title'|'text'|'occurredOn'>{
 if(type==='todo')return validateTodo(value);
 if(type==='journal'){const v=object(value,['title','text','occurredOn']),d=validateInbox({...v,disposition:'reference'});if(!d.text.trim())return invalid();return{title:d.title,text:d.text,occurredOn:d.occurredOn};}
 if(!['project','domain','topic'].includes(type))throw new PlatformError(400,'PERSONAL_TYPE_DENIED','此本人记录类别未开放。');
 const v=object(value,['title','text','occurredOn','personal']),meta=validatePersonalObject(v.personal);if(meta.type!==type)return invalid();const d=validateInbox({...v,personal:meta,disposition:'reference'});return{title:d.title,text:d.text,occurredOn:d.occurredOn,personal:meta};
}
export function personalReferences(draft:TodoDraft|InboxDraft):{type:'project'|'domain'|'topic';link:PersonalReference}[]{const v=draft.personal;if(!v)return[];const r:PersonalRelations= 'type'in v ? v.type==='project'?{project:null,domain:v.domain,topics:v.topics}:{project:null,domain:null,topics:[]} : v;return[...(r.project?[{type:'project' as const,link:r.project}]:[]),...(r.domain?[{type:'domain' as const,link:r.domain}]:[]),...r.topics.map(link=>({type:'topic' as const,link}))];}
