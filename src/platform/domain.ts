import {validatePlanningFields,type PersonalPlanningFields} from '../personal-candidate/planning.ts';
import {validateRequirementMetadata,type RequirementMetadata} from '../requirements-candidate/domain.ts';
import {validateRequirementSupportMetadata,type RequirementSupportMetadata} from '../requirement-support-candidate/domain.ts';
import {validatePersonalRelations,validatePersonalObject,type PersonalRelations,type PersonalObject} from '../personal-candidate/business.ts';
import {validateRecordMetadata} from '../records-candidate/domain.ts';
import type {RecordMetadata} from '../records-candidate/contracts.ts';
export class PlatformError extends Error {
 status:number;
 code:string;
 constructor(status:number,code:string,message:string){super(message);this.name='PlatformError';this.status=status;this.code=code;}
}
const invalid=(code:string,message:string):never=>{throw new PlatformError(400,code,message);};
export function object(input:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!input||typeof input!=='object'||Array.isArray(input))return invalid('INVALID_BODY','需要一个有效的对象。');
 if(Object.keys(input).some(k=>!keys.includes(k)))return invalid('UNKNOWN_FIELD','包含不允许的字段。');
 return input as Record<string,unknown>;
}
function text(value:unknown,max:number,empty=false):string {
 if(typeof value!=='string'||value.includes('\0')||value.length>max||(!empty&&!value.trim()))return invalid('INVALID_TEXT','文字为空、过长或格式无效。');
 return value;
}
function date(value:unknown,optional=false):string|null {
 if(optional&&(value===undefined||value===null))return null;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return invalid('INVALID_DATE','日期需要有效的年月日。');
 const d=new Date(value+'T00:00:00Z');
 if(!Number.isFinite(d.valueOf())||d.toISOString().slice(0,10)!==value)return invalid('INVALID_DATE','日期不存在。');
 return value;
}
export function validateId(value:unknown):string {
 if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))return invalid('INVALID_ID','记录标识无效。');
 return value.toLowerCase();
}
export function validateRevision(value:unknown):number {
 if(typeof value!=='number'||!Number.isInteger(value)||value<1||value>2147483647)return invalid('INVALID_REVISION','需要当前有效版本号。');
 return value;
}
export function validateIdempotencyKey(value:unknown):string {
 if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/.test(value))return invalid('INVALID_COMMAND_KEY','需要有效的请求标识。');
 return value;
}
export type TodoDraft=PersonalPlanningFields&{title:string;notes:string;dueOn:string|null;status:'open'|'in_progress'|'done'|'cancelled';personal?:PersonalRelations};
export const todoRequiredKeys=['title','notes','dueOn','status','personal'] as const;
export const todoKeys=[...todoRequiredKeys,'plannedStartOn','plannedEndOn'] as const;
export function validateTodo(input:unknown):TodoDraft {
 const o=object(input,todoKeys),status=o.status===undefined?'open':o.status;
 if(!['open','in_progress','done','cancelled'].includes(status as string))return invalid('INVALID_STATUS','待办状态无效。');
 return {...validatePlanningFields(o),title:text(o.title,240).trim(),notes:text(o.notes===undefined?'':o.notes,16384,true),dueOn:date(o.dueOn,true),status:status as TodoDraft['status'],...('personal'in o?{personal:validatePersonalRelations(o.personal)}:{})};
}
export type FinanceDraft={kind:'expense'|'income'|'refund'|'transfer'|'repayment';amountMinor:number;currency:'CNY';occurredOn:string;category:string|null;fromAccountRef:string|null;toAccountRef:string|null;originalEntryId:string|null;notes:string};
export const financeKeys=['kind','amountMinor','currency','occurredOn','category','fromAccountRef','toAccountRef','originalEntryId','notes'] as const;
function account(value:unknown):string|null {
 if(value===null||value===undefined)return null;
 if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value))return invalid('INVALID_ACCOUNT_REFERENCE','账户引用格式无效。');
 return value;
}
export function validateFinance(input:unknown):FinanceDraft {
 const o=object(input,financeKeys);
 if(!['expense','income','refund','transfer','repayment'].includes(o.kind as string))return invalid('INVALID_KIND','流水类型无效。');
 if(typeof o.amountMinor!=='number'||!Number.isSafeInteger(o.amountMinor)||o.amountMinor<1||o.amountMinor>1_000_000_000_000)return invalid('INVALID_AMOUNT','金额需要正整数分，不能隐式换算。');
 if(o.currency!=='CNY')return invalid('UNSUPPORTED_CURRENCY','本候选暂只接受明确的 CNY 金额。');
 const from=account(o.fromAccountRef),to=account(o.toAccountRef);
 if(o.kind==='transfer'||o.kind==='repayment'){
  if(!from||!to)return invalid('ACCOUNT_LINK_REQUIRED','转账或还款需要两端账户引用。');
  if(from===to)return invalid('DISTINCT_ACCOUNTS_REQUIRED','两端账户不能相同。');
 }
 if(o.kind==='refund'&&(o.originalEntryId===undefined||o.originalEntryId===null))return invalid('REFUND_LINK_REQUIRED','退款需要原流水关联。');
 if(o.kind!=='refund'&&o.originalEntryId!==undefined&&o.originalEntryId!==null)return invalid('UNEXPECTED_REFUND_LINK','只有退款使用原流水关联。');
 return {kind:o.kind as FinanceDraft['kind'],amountMinor:o.amountMinor,currency:'CNY',occurredOn:date(o.occurredOn)!,category:o.category===undefined||o.category===null?null:text(o.category,80).trim(),fromAccountRef:from,toAccountRef:to,originalEntryId:o.kind==='refund'?validateId(o.originalEntryId):null,notes:text(o.notes===undefined?'':o.notes,16384,true)};
}

export type InboxDraft={title:string;text:string;occurredOn:string|null;disposition:'pending'|'reference'|'no_action';record?:RecordMetadata;personal?:PersonalObject;requirement?:RequirementMetadata;requirementSupport?:RequirementSupportMetadata};
export const inboxKeys=['title','text','occurredOn','disposition','record','personal','requirement','requirementSupport'] as const;
export function validateInbox(input:unknown):InboxDraft{
 const o=object(input,inboxKeys),base=validateTodo({title:o.title,notes:o.text,dueOn:o.occurredOn}),disposition=o.disposition===undefined?'pending':o.disposition;
 if(!['pending','reference','no_action'].includes(disposition as string))throw new PlatformError(400,'INVALID_DISPOSITION','选择待处理、仅资料或无需行动。');
 const record='record' in o?validateRecordMetadata(o.record):undefined;
 const support='requirementSupport'in o?validateRequirementSupportMetadata(o.requirementSupport):undefined;
 if(support&&(record||'personal'in o||'requirement'in o||base.dueOn!==null||disposition!==(support.type==='release-read'?'reference':support.state==='inbox'?'pending':support.state==='archived'?'no_action':'reference')))throw new PlatformError(400,'INVALID_REQUIREMENT_SUPPORT','反馈与版本偏好不能混用其他记录类别。');
 if(record&&disposition!=='reference')throw new PlatformError(400,'INVALID_RECORD_DISPOSITION','类别记录只能作为资料保存。');
 if('requirement'in o&&(record||'personal'in o||disposition!=='reference'))throw new PlatformError(400,'INVALID_REQUIREMENT_FIELDS','需求不能混用其他记录类别。');
 if('personal'in o&&(record||disposition!=='reference'))throw new PlatformError(400,'INVALID_PERSONAL_FIELDS','本人对象不能混用合成记录。');
 return{...(support?{requirementSupport:support}:{}),...('requirement'in o?{requirement:validateRequirementMetadata(o.requirement)}:{}),...('personal'in o?{personal:validatePersonalObject(o.personal)}:{}),title:base.title,text:base.notes,occurredOn:base.dueOn,disposition:disposition as InboxDraft['disposition'],...(record?{record}:{})};
}
