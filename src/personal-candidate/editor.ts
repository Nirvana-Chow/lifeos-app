import {appleOriginMarker,readAppleOrigin} from './apple-origin.ts';
import {personalTypes,normalizePersonalFields,type PersonalRelations,type PersonalObject} from './business.ts';
import type {PublicEntry} from '../platform/contracts.ts';
import {object,validateTodo,validateInbox} from '../platform/domain.ts';
import type {PersonalCommand} from './client.ts';
import type {PersonalType} from './config.ts';
export type PersonalEditorFields={title:string;text:string;date:string;status:'open'|'in_progress'|'done'|'cancelled';personal?:PersonalRelations|PersonalObject};
function fields(type:PersonalType,value:unknown):PersonalEditorFields{
 if(type==='todo'){const draft=validateTodo(value);return{title:draft.title,text:draft.notes,date:draft.dueOn??'',status:draft.status,...(draft.personal?{personal:draft.personal}:{})};}
 const input=normalizePersonalFields(type,value),draft=validateInbox({...input,disposition:'reference'});
 return{title:draft.title,text:draft.text,date:draft.occurredOn??'',status:'open',...(draft.personal?{personal:draft.personal}:{})};
}
export function editorFromCommand(command:PersonalCommand):{type:PersonalType;fields:PersonalEditorFields}{return{type:command.type,fields:fields(command.type,command.body.fields)};}
/** A successful receipt chooses its domain, never the currently selected tab.
 * History is invalidated here and reread separately by the UI. */
export function editorFromEntry(entry:PublicEntry,spaceId:string):{type:PersonalType;fields:PersonalEditorFields;history:PublicEntry[]}{
 const raw=entry.source.original as {marker?:string};const original=raw?.marker===appleOriginMarker?readAppleOrigin(raw,spaceId):object(raw,['marker','spaceId','type','input']);
 if(original.marker!=='personal-manual-v1'&&original.marker!==appleOriginMarker||original.spaceId!==spaceId||!personalTypes.includes(original.type as never)||entry.kind!==(original.type==='todo'?'todo':'inbox'))throw Error('本人记录与空间不符。');
 const type=original.type as PersonalType,value=type==='todo'?entry.draft:'text'in entry.draft?{title:entry.draft.title,text:entry.draft.text,occurredOn:entry.draft.occurredOn,...(entry.draft.personal?{personal:entry.draft.personal}:{})}:null;
 return{type,fields:fields(type,value),history:[]};
}
