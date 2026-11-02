import type {PublicEntry} from '../platform/contracts.ts';
import {validateTodo,validateId,validateRevision,validateIdempotencyKey,type TodoDraft} from '../platform/domain.ts';

export type TaskEntry=Omit<PublicEntry,'kind'|'draft'>&{kind:'todo';draft:TodoDraft};
export type TaskMutationResult={entry:TaskEntry;duplicate:boolean};
export type TaskFields=Omit<TodoDraft,'dueOn'>&{dueOn:string|null};
export type TaskCommand=Readonly<{path:string;method:'POST'|'PATCH';body:string;key:string}>;
export class TaskRequestError extends Error{
 readonly status:number;readonly code:string;readonly uncertain:boolean;
 constructor(status:number,code:string,message:string,uncertain=false){super(message);this.name='TaskRequestError';this.status=status;this.code=code;this.uncertain=uncertain;}
}
const messages:Record<string,string>={
 LOGIN_REQUIRED:'登录已失效，请重新登录后继续。',ACCOUNT_NOT_ALLOWED:'当前账号没有访问待办的权限。',
 REVISION_CONFLICT:'记录已被更新，请读取最新版本并核对你的修改。',COMMAND_CONFLICT:'请求标识与已有请求冲突，本次结果需要核对，请保留当前请求。',
 NOT_FOUND:'记录不存在，或当前账号没有查看权限。',INVALID_DATE:'截止日期不存在，请核对年月日。',INVALID_TEXT:'请填写有效标题，并核对文字长度。',
};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function parseEntry(value:unknown):TaskEntry{
 if(!record(value)||value.kind!=='todo'||value.syncState!=='draft'||value.externalStatus!==null||'ownerId'in value||!record(value.source))throw Error('Invalid task response');
 validateId(value.id);validateRevision(value.revision);
 if(!record(value.draft)||!['title','notes','dueOn','status'].every(key=>Object.hasOwn(value.draft as object,key)))throw Error('Incomplete task draft');
 const draft=validateTodo(value.draft);
 const source=value.source;
 if(typeof value.createdAt!=='string'||typeof value.updatedAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||!Number.isFinite(Date.parse(value.updatedAt))||source.system!=='website'||typeof source.id!=='string'||typeof source.externalId!=='string'||!Number.isInteger(source.version)||typeof source.asOf!=='string'||!('original'in source))throw Error('Invalid task provenance');
 if(value.inboxId!==undefined)validateId(value.inboxId);
 return {...value,draft} as TaskEntry;
}
export function createTaskCommand(fields:TaskFields,entry:Pick<TaskEntry,'id'|'revision'>|null,key:string):TaskCommand{
 const draft={...fields,dueOn:fields.dueOn===''?null:fields.dueOn};validateTodo(draft);validateIdempotencyKey(key);
 const id=entry?validateId(entry.id):null;
 const body=entry?{...draft,expectedRevision:validateRevision(entry.revision)}:draft;
 return Object.freeze({path:'/api/platform/todos'+(id?'/'+id:''),method:entry?'PATCH':'POST',body:JSON.stringify(body),key});
}
export class TasksClient{
 private readonly transport:typeof fetch;
 constructor(transport:typeof fetch=fetch){this.transport=transport;}
 private async request(path:string,command?:TaskCommand):Promise<unknown>{
  let response:Response;
  try{response=await this.transport(path,{method:command?.method??'GET',credentials:'same-origin',cache:'no-store',...(command?{headers:{'content-type':'application/json','idempotency-key':command.key},body:command.body}:{})});}
  catch{throw new TaskRequestError(0,'NETWORK_UNAVAILABLE',command?'保存结果未确认，请重试同一请求。':'暂时无法读取待办，请重试。',!!command);}
  if(response.status>=500)throw new TaskRequestError(response.status,'SERVICE_UNAVAILABLE',command?'服务未确认保存结果，请重试同一请求。':'待办服务暂不可用，请重试。',!!command);
  let value:unknown;try{value=await response.json();}catch{value=null;}
  if(!response.ok){const code=record(value)&&record(value.error)&&typeof value.error.code==='string'?value.error.code:response.status===401?'LOGIN_REQUIRED':response.status===403?'ACCOUNT_NOT_ALLOWED':'REQUEST_REJECTED';throw new TaskRequestError(response.status,code,messages[code]??'请求被拒绝，请核对输入或稍后重新读取。',code==='COMMAND_CONFLICT'&&!!command);}
  if(!record(value))throw new TaskRequestError(response.status,'INVALID_RESPONSE',command?'保存回执无法核对，请重试同一请求。':'读取结果格式无效，请重新读取。',!!command);
  return value;
 }
 private invalidResponse(write=false){return new TaskRequestError(200,'INVALID_RESPONSE',write?'保存回执无法核对，请重试同一请求。':'读取结果格式无效，请重新读取。',write);}
 async list():Promise<TaskEntry[]>{
  const value=await this.request('/api/platform/todos');try{if(!record(value)||!Array.isArray(value.items))throw Error();return value.items.map(parseEntry);}catch{throw this.invalidResponse();}
 }
 async detail(id:string):Promise<TaskEntry>{
  id=validateId(id);const value=await this.request('/api/platform/todos/'+id);try{if(!record(value))throw Error();const entry=parseEntry(value.entry);if(entry.id!==id)throw Error();return entry;}catch{throw this.invalidResponse();}
 }
 async history(id:string):Promise<TaskEntry[]>{
  id=validateId(id);const value=await this.request('/api/platform/todos/'+id+'/history');try{if(!record(value)||!Array.isArray(value.history))throw Error();const entries=value.history.map(parseEntry);if(entries.some(entry=>entry.id!==id))throw Error();return entries;}catch{throw this.invalidResponse();}
 }
 async send(command:TaskCommand):Promise<TaskMutationResult>{
  const value=await this.request(command.path,command);try{if(!record(value)||typeof value.duplicate!=='boolean')throw Error();const entry=parseEntry(value.entry);if(command.method==='PATCH'&&!command.path.endsWith('/'+entry.id))throw Error();return{entry,duplicate:value.duplicate};}catch{throw this.invalidResponse(true);}
 }
}
