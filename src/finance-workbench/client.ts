import type {PublicEntry} from '../platform/contracts.ts';
import {object,financeKeys,validateFinance,validateId,validateRevision,validateIdempotencyKey,type FinanceDraft} from '../platform/domain.ts';
import {draftFromFields,type FinanceFields} from './fields.ts';

export type FinanceEntry=Omit<PublicEntry,'kind'|'draft'>&{kind:'finance';draft:FinanceDraft};
export type FinanceMutationResult={entry:FinanceEntry;duplicate:boolean};
export type FinanceCommand=Readonly<{path:string;method:'POST'|'PATCH';body:string;key:string;owner:string;input:string}>;
export class FinanceRequestError extends Error{
 readonly status:number;readonly code:string;readonly uncertain:boolean;
 constructor(status:number,code:string,message:string,uncertain=false){super(message);this.name='FinanceRequestError';this.status=status;this.code=code;this.uncertain=uncertain;}
}
const messages:Record<string,string>={LOGIN_REQUIRED:'登录已失效，请使用原评审账号登录后继续。',ACCOUNT_NOT_ALLOWED:'当前账号没有财务记录的访问权限。',IDENTITY_CHANGED:'登录身份已变化，已阻止读取与保存。请恢复原评审账号后重试。',REVISION_CONFLICT:'记录已有新修订，请读取并核对后再保存。',COMMAND_CONFLICT:'请求标识冲突，原保存结果仍待确认，请保留本次请求。',NOT_FOUND:'记录不存在，或当前账号没有查看权限。',INVALID_AMOUNT:'金额不在允许范围内，请核对。',INVALID_DATE:'日期不存在，请核对年月日。',INVALID_TEXT:'文字为空或过长，请核对。',INVALID_ACCOUNT_REFERENCE:'账户引用格式无效。',ACCOUNT_LINK_REQUIRED:'转账和还款需要两端账户引用。',DISTINCT_ACCOUNTS_REQUIRED:'两端账户必须不同。',REFUND_LINK_REQUIRED:'退款需要关联原支出。',INVALID_REFUND_SOURCE:'退款只能关联同币种的原支出。',LINKED_REFUNDS:'已有退款关联此支出，不能改变其流水类型。',REVISION_LIMIT:'记录已达修订上限。',UNSUPPORTED_CURRENCY:'当前只支持 CNY。',INVALID_KIND:'流水类型无效。',UNEXPECTED_REFUND_LINK:'只有退款可以关联原支出。',INVALID_BODY:'输入内容无效。',UNKNOWN_FIELD:'输入包含不允许的字段。',INVALID_ID:'记录标识无效。',INVALID_REVISION:'修订版本无效。',INVALID_COMMAND_KEY:'请求标识无效。',EMPTY_PATCH:'没有修改内容。',ORIGIN_DENIED:'请求来源不被允许。',METHOD_NOT_ALLOWED:'此操作未开放。'};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const timestamp=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===(value.includes('.')?value:value.replace('Z','.000Z'));
const invalid=(write=false)=>new FinanceRequestError(200,'INVALID_RESPONSE',write?'保存回执无法核对，请保留并重试同一请求。':'读取结果格式无效，请重新读取。',write);
const canonicalDraft=(draft:FinanceDraft)=>JSON.stringify(validateFinance(draft));

export async function readFinanceIdentity(transport:typeof fetch=fetch):Promise<string>{
 let response:Response;try{response=await transport('/api/platform/auth/get-session',{credentials:'same-origin',cache:'no-store'});}catch{throw new FinanceRequestError(0,'AUTH_UNAVAILABLE','暂时无法核对登录身份。');}
 if(!response.ok)throw new FinanceRequestError(response.status,response.status===401?'LOGIN_REQUIRED':'AUTH_UNAVAILABLE',response.status===401?messages.LOGIN_REQUIRED:'暂时无法核对登录身份。');
 let value:unknown;try{value=await response.json();}catch{throw invalid();}
 if(value===null)throw new FinanceRequestError(401,'LOGIN_REQUIRED',messages.LOGIN_REQUIRED);
 if(!record(value)||!record(value.user)||!record(value.session)||value.session.userId!==value.user.id||typeof value.user.id!=='string'||!value.user.id.trim()||value.user.id.length>256||/[\u0000-\u001f\u007f]/.test(value.user.id)||typeof value.user.email!=='string'||!value.user.email.includes('@')||value.user.email.length>320||/[\u0000-\u0020\u007f]/.test(value.user.email))throw invalid();
 return JSON.stringify([value.user.id,value.user.email.toLowerCase()]);
}
export function parseFinanceEntry(value:unknown):FinanceEntry{
 if(!record(value)||value.kind!=='finance'||value.syncState!=='draft'||value.externalStatus!==null||'ownerId'in value||!record(value.source)||!record(value.draft)||!financeKeys.every(key=>Object.hasOwn(value.draft as object,key)))throw Error('Invalid finance response');
 object(value,['id','kind','draft','source','revision','createdAt','updatedAt','syncState','externalStatus','inboxId']);
 const id=validateId(value.id);validateRevision(value.revision);const draft=validateFinance(value.draft),source=value.source;
 if(!timestamp(value.createdAt)||!timestamp(value.updatedAt)||Date.parse(value.updatedAt)<Date.parse(value.createdAt)||source.system!=='website'||validateId(source.externalId)!==id||!timestamp(source.asOf)||!Object.hasOwn(source,'original'))throw Error('Invalid finance provenance');
 object(source,['id','system','externalId','version','asOf','original']);validateId(source.id);if(validateRevision(source.version)>Number(value.revision))throw Error('Invalid source version');validateFinance(source.original);
 if(value.inboxId!==undefined)validateId(value.inboxId);
 return{...value,draft}as FinanceEntry;
}
export function createFinanceCommand(fields:FinanceFields,entry:Pick<FinanceEntry,'id'|'revision'>|null,key:string,owner:string):FinanceCommand{
 const draft=draftFromFields(fields);validateIdempotencyKey(key);
 if(typeof owner!=='string'||!owner||owner.length>1024)throw Error('缺少已核对的评审身份。');
 const id=entry?validateId(entry.id):null,body=entry?{...draft,expectedRevision:validateRevision(entry.revision)}:draft;
 return Object.freeze({path:'/api/platform/finance'+(id?'/'+id:''),method:entry?'PATCH':'POST',body:JSON.stringify(body),key,owner,input:JSON.stringify(fields)});
}
export class FinanceClient{
 readonly owner:string;private readonly transport:typeof fetch;
 constructor(owner:string,transport:typeof fetch=fetch){this.owner=owner;this.transport=transport;}
 private async identity(){if(await readFinanceIdentity(this.transport)!==this.owner)throw new FinanceRequestError(403,'IDENTITY_CHANGED',messages.IDENTITY_CHANGED);}
 private async request(path:string,command?:FinanceCommand):Promise<Record<string,unknown>>{
  if(command?.owner&&command.owner!==this.owner)throw new FinanceRequestError(403,'IDENTITY_CHANGED',messages.IDENTITY_CHANGED);
  await this.identity();let response:Response;
  try{response=await this.transport(path,{method:command?.method??'GET',credentials:'same-origin',cache:'no-store',...(command?{headers:{'content-type':'application/json','idempotency-key':command.key},body:command.body}:{})});}
  catch{throw new FinanceRequestError(0,'NETWORK_UNAVAILABLE',command?'保存结果未确认，请重试同一请求。':'暂时无法读取财务记录，请重试。',!!command);}
  if(response.status>=500)throw new FinanceRequestError(response.status,'SERVICE_UNAVAILABLE',command?'服务未确认保存结果，请重试同一请求。':'财务服务暂不可用，请重试。',!!command);
  let value:unknown;try{value=await response.json();}catch{value=null;}
  if(!response.ok){const errorValue=record(value)&&record(value.error)?value.error:null;const structured=!!errorValue&&typeof errorValue.code==='string'&&typeof errorValue.message==='string';const code=structured?errorValue.code as string:'UNKNOWN_RESULT';const definitive=structured&&[400,401,403,404,405,409].includes(response.status)&&Object.hasOwn(messages,code)&&code!=='COMMAND_CONFLICT';throw new FinanceRequestError(response.status,code,messages[code]??'请求结果无法核对，请重新读取或保留原请求。',!!command&&!definitive);}
  if(response.status!==200&&!(command?.method==='POST'&&response.status===201))throw invalid(!!command);
  if(!record(value))throw invalid(!!command);
  try{await this.identity();}catch(cause){if(command&&cause instanceof FinanceRequestError)throw new FinanceRequestError(cause.status,cause.code,cause.message,true);throw cause;}
  return value;
 }
 async list():Promise<FinanceEntry[]>{const value=await this.request('/api/platform/finance');try{if(!Array.isArray(value.items)||value.dataStatus!=='isolated-test-drafts')throw Error();const rows=value.items.map(parseFinanceEntry);if(new Set(rows.map(row=>row.id)).size!==rows.length)throw Error();return rows;}catch{throw invalid();}}
 async detail(id:string):Promise<FinanceEntry>{id=validateId(id);const value=await this.request('/api/platform/finance/'+id);try{const entry=parseFinanceEntry(value.entry);if(entry.id!==id)throw Error();return entry;}catch{throw invalid();}}
 async history(id:string):Promise<FinanceEntry[]>{id=validateId(id);const value=await this.request('/api/platform/finance/'+id+'/history');try{if(!Array.isArray(value.history)||value.limit!==100)throw Error();const rows=value.history.map(parseFinanceEntry);if(rows.length>100||rows.some((entry,index)=>entry.id!==id||index>0&&entry.revision>=rows[index-1].revision))throw Error();return rows;}catch{throw invalid();}}
 async send(command:FinanceCommand):Promise<FinanceMutationResult>{
  const value=await this.request(command.path,command);try{
   if(typeof value.duplicate!=='boolean')throw Error();const entry=parseFinanceEntry(value.entry),{expectedRevision,...draft}=JSON.parse(command.body);
   if(canonicalDraft(entry.draft)!==canonicalDraft(draft))throw Error();
   if(command.method==='PATCH'){if(command.path!=='/api/platform/finance/'+entry.id||entry.revision!==expectedRevision+1)throw Error();}
   else if(entry.revision!==1||canonicalDraft(validateFinance(entry.source.original))!==canonicalDraft(draft))throw Error();
   return{entry,duplicate:value.duplicate};
  }catch{throw invalid(true);}
 }
}
