import {PlatformError,object,validateInbox,validateRevision,validateId} from '../platform/domain.ts';
import {validateCalendarDate} from '../calendar-candidate/domain.ts';
import type {PublicEntry} from '../platform/contracts.ts';
import {recordTypes,type RecordType,type RecordMetadata,type RecordFields,type RecordEntry,type ProjectReview,type ProjectReviewCommand,type ProjectRecord,type ProjectLink,type ProjectLinkType} from './contracts.ts';

const invalid=(code:string,message:string):never=>{throw new PlatformError(400,code,message);};
export function validateRecordType(input:unknown):RecordType{
 if(typeof input!=='string'||!recordTypes.includes(input as RecordType))return invalid('INVALID_RECORD_TYPE','记录类别无效。');
 return input as RecordType;
}
function text(input:unknown,max:number,optional=false):string|null{
 if(optional&&(input===undefined||input===null))return null;
 if(typeof input!=='string'||input.includes('\0')||input.length>max)return invalid('INVALID_RECORD_TEXT','类别文字格式无效或过长。');
 const value=input.trim();
 if(!value)return optional?null:invalid('INVALID_RECORD_TEXT','请明确填写此类别信息。');
 return value;
}
function url(input:unknown,optional=false):string|null{
 if(typeof input==='string'&&/[\u0000-\u001f\u007f]/.test(input))return invalid('INVALID_RECORD_URL','引用地址不能包含控制字符。');
 const value=text(input,2048,optional);if(value===null)return null;
 // Reference only. Never fetch, parse HTML or accept credential-bearing URLs.
 if(!/^https?:\/\//i.test(value)||/[\u0000-\u0020\u007f\\]/.test(value))return invalid('INVALID_RECORD_URL','引用需要有效的 HTTP 或 HTTPS 地址。');
 let parsed:URL;try{parsed=new URL(value);}catch{return invalid('INVALID_RECORD_URL','引用需要有效的 HTTP 或 HTTPS 地址。');}
 if(!['http:','https:'].includes(parsed.protocol)||!parsed.hostname||parsed.username||parsed.password)return invalid('INVALID_RECORD_URL','引用需要不含登录信息的 HTTP 或 HTTPS 地址。');
 return value;
}
export function validateRecordMetadata(input:unknown):RecordMetadata{
 const common=object(input,['type','syntheticOnly','topic','status','nextStep','resourceURL','evidence','label','intensity','author','attribution','sourceURL','url','stage','completion','testing','review','links','exercise','sets']);
 const type=validateRecordType(common.type);
 const fields={training:['exercise','sets'],learning:['topic','status','nextStep','resourceURL'],career:['evidence','nextStep'],mood:['label','intensity'],article:['author','attribution','sourceURL'],resource:['url','author'],project:['stage','nextStep','completion','testing','review','links']}[type];
 const value=object(common,['type','syntheticOnly',...fields]);
 if(value.syntheticOnly!==true)return invalid('SYNTHETIC_ONLY','此候选只接受明确的合成记录。');
 switch(type){
  case 'training':{
   if(!Array.isArray(value.sets)||value.sets.length>50)return invalid('INVALID_TRAINING','最多记录 50 组；未知组数保留空。');
   const number=(v:unknown)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1e6)return invalid('INVALID_TRAINING','测量值需要有效非负数字。');return v;};
   const measure=(v:unknown,units:readonly string[])=>{if(v===null)return null;const m=object(v,['value','unit']);if(!units.includes(m.unit as string))return invalid('INVALID_TRAINING','请明确填写测量单位。');return{value:number(m.value),unit:m.unit};};
   const sets=value.sets.map(raw=>{const row=object(raw,['reps','weight','duration']);const reps=row.reps===null?null:number(row.reps);if(reps!==null&&!Number.isInteger(reps))return invalid('INVALID_TRAINING','次数需要整数。');return{reps,weight:measure(row.weight,['kg','lb']),duration:measure(row.duration,['s','min'])};});
   return{type,syntheticOnly:true,exercise:text(value.exercise,240,true),sets} as RecordMetadata;
  }
  case 'learning':
   if(!['planned','active','done'].includes(value.status as string))return invalid('INVALID_LEARNING_STATUS','请明确选择计划、进行中或完成。');
   return{type,syntheticOnly:true,topic:text(value.topic,240)!,status:value.status as 'planned'|'active'|'done',nextStep:text(value.nextStep,4000,true),resourceURL:url(value.resourceURL,true)};
  case 'career':return{type,syntheticOnly:true,evidence:text(value.evidence,16384)!,nextStep:text(value.nextStep,4000,true)};
  case 'mood':{
   const intensity=value.intensity===undefined||value.intensity===null||value.intensity===''?null:value.intensity;
   if(intensity!==null&&(typeof intensity!=='number'||!Number.isInteger(intensity)||intensity<1||intensity>5))return invalid('INVALID_MOOD_INTENSITY','自报强度只能为 1 至 5 的整数或留空。');
   return{type,syntheticOnly:true,label:text(value.label,80)!,intensity:intensity as 1|2|3|4|5|null};
  }
  case 'article':
   if(!['original','excerpt','summary'].includes(value.attribution as string))return invalid('INVALID_ARTICLE_ATTRIBUTION','请明确选择原创、摘录或摘要。');
   return{type,syntheticOnly:true,author:text(value.author,240,true),attribution:value.attribution as 'original'|'excerpt'|'summary',sourceURL:url(value.sourceURL,true)};
  case 'resource':return{type,syntheticOnly:true,url:url(value.url)!,author:text(value.author,240,true)};
  case 'project':{
   if(!['idea','planned','active','paused','closed'].includes(value.stage as string))return invalid('INVALID_PROJECT_STAGE','请明确选择项目阶段。');
   const completion=object(value.completion,['selfReported','status','evidence']),testing=object(value.testing,['manuallyRecorded','outcome','evidence']);
   if(completion.selfReported!==true||!['not-complete','complete'].includes(completion.status as string))return invalid('INVALID_PROJECT_COMPLETION','完成情况只能是明确自报的未完成或完成。');
   if(testing.manuallyRecorded!==true||!['not-run','passed','failed','blocked'].includes(testing.outcome as string))return invalid('INVALID_PROJECT_TESTING','测试情况只能作为人工记录，不能冒充系统实测。');
   const review=value.review===undefined?{decision:'pending',evidence:null}:object(value.review,['decision','evidence']);
   if(!['pending','accepted','rejected'].includes(review.decision as string))return invalid('INVALID_PROJECT_REVIEW','项目审阅决定无效。');
   const evidence=text(review.evidence,16384,review.decision==='pending');
   if(review.decision==='pending'&&evidence!==null)return invalid('INVALID_PROJECT_REVIEW','待确认项目不能携带旧确认结论。');
   return{type,syntheticOnly:true,stage:value.stage as ProjectRecord['stage'],nextStep:text(value.nextStep,4000,true),
    completion:{selfReported:true,status:completion.status as ProjectRecord['completion']['status'],evidence:text(completion.evidence,16384,completion.status==='not-complete')},
    testing:{manuallyRecorded:true,outcome:testing.outcome as ProjectRecord['testing']['outcome'],evidence:text(testing.evidence,16384,testing.outcome==='not-run')},
    review:{decision:review.decision as ProjectReview['decision'],evidence},links:normalizeProjectLinks(value.links)};
  }
 }
}
export function normalizeProjectLinks(input:unknown):ProjectLink[]{
 if(input===undefined)return[];
 if(!Array.isArray(input)||input.length>20)return invalid('INVALID_PROJECT_LINK','项目最多关联 20 条已有待办、资料或文章。');
 const seen=new Set<string>();
 return input.map(raw=>{
  const value=object(raw,['type','id','sourceId','revision']);
  if(!['todo','resource','article'].includes(value.type as string))return invalid('INVALID_PROJECT_LINK','仅可关联已有待办、资料或文章。');
  const type=value.type as ProjectLinkType,id=validateId(value.id),key=type+':'+id;
  if(seen.has(key))return invalid('INVALID_PROJECT_LINK','同一条记录不能重复关联。');seen.add(key);
  return{type,id,sourceId:validateId(value.sourceId),revision:validateRevision(value.revision)};
 }).sort((a,b)=>(a.type+':'+a.id).localeCompare(b.type+':'+b.id,'en'));
}
export function validateRecordFields(input:unknown):RecordFields{
 const value=object(input,['title','text','occurredOn','record']);
 const draft=validateInbox({...value,disposition:'reference'});
 if(draft.record?.type==='training'&&draft.occurredOn!==null)validateCalendarDate(draft.occurredOn);
 if(!draft.record)return invalid('INVALID_RECORD_TYPE','需要明确的记录类别。');
 return{title:draft.title,text:draft.text,occurredOn:draft.occurredOn,record:draft.record};
}
export function validateRecordCommand(type:RecordType,input:unknown,update=false):RecordFields{
 validateRecordType(type);
 const value=object(input,['title','text','occurredOn','record','confirmed','syntheticOnly',...(update?['expectedRevision']:[])]);
 if(value.confirmed!==true)return invalid('CONFIRMATION_REQUIRED','请核对并确认这一条记录。');
 if(value.syntheticOnly!==true)return invalid('SYNTHETIC_ONLY','此候选只接受明确的合成记录。');
 if(update)validateRevision(value.expectedRevision);
 const fields=validateRecordFields({title:value.title,text:value.text,occurredOn:value.occurredOn,record:value.record});
 if(fields.record.type!==type)return invalid('RECORD_TYPE_MISMATCH','地址类别与记录类别不一致。');
 if(fields.record.type==='project'&&fields.record.review.decision!=='pending')return invalid('PROJECT_REVIEW_ACTION_REQUIRED','已接受或已拒绝只能由独立的项目确认操作记录。');
 return fields;
}
export function validateProjectReviewCommand(input:unknown):ProjectReviewCommand{
 const value=object(input,['expectedRevision','decision','evidence','confirmed','syntheticOnly']);
 if(value.confirmed!==true)return invalid('CONFIRMATION_REQUIRED','请核对并确认这一条合成项目的审阅决定。');
 if(value.syntheticOnly!==true)return invalid('SYNTHETIC_ONLY','此候选只接受明确的合成项目确认。');
 if(value.decision!=='accepted'&&value.decision!=='rejected')return invalid('INVALID_PROJECT_REVIEW','请明确选择接受或拒绝这一条合成项目。');
 return{expectedRevision:validateRevision(value.expectedRevision),decision:value.decision,evidence:text(value.evidence,16384)!,confirmed:true,syntheticOnly:true};
}
/** Inputs are normalized editable fields. Review is server-owned: an equivalent
 * save preserves it; changes to any substantive field require a fresh review. */
export function projectReviewAfterEdit(current:RecordFields,next:RecordFields):ProjectReview{
 if(current.record.type!=='project'||next.record.type!=='project')return{decision:'pending',evidence:null};
 const a=current.record,b=next.record;
 const same=current.title===next.title&&current.text===next.text&&current.occurredOn===next.occurredOn&&a.stage===b.stage&&a.nextStep===b.nextStep&&a.completion.status===b.completion.status&&a.completion.evidence===b.completion.evidence&&a.testing.outcome===b.testing.outcome&&a.testing.evidence===b.testing.evidence&&JSON.stringify(normalizeProjectLinks(a.links))===JSON.stringify(normalizeProjectLinks(b.links));
 return same?{...a.review}:{decision:'pending',evidence:null};
}
export function isRecordEntry(entry:PublicEntry,type?:RecordType):entry is RecordEntry{
 if(entry.kind!=='inbox'||!('record' in entry.draft)||!entry.draft.record||!('disposition' in entry.draft)||entry.draft.disposition!=='reference')return false;
 const original=entry.source.original;
 if(!original||typeof original!=='object'||Array.isArray(original)||!('record' in original))return false;
 try{
  const current=validateRecordMetadata(entry.draft.record),source=validateRecordMetadata(original.record);
  return current.type===source.type&&(!type||current.type===type);
 }catch{return false;}
}
