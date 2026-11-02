import {object,validateInbox,validateId,validateIdempotencyKey,validateRevision} from '../platform/domain.ts';
import type {PublicEntry} from '../platform/contracts.ts';

export type JournalFields={title:string;text:string;occurredOn:string};
type CreateBody={text:string;kind:'life';timeZone:string;adapter:'manual';fields:{title:string;body:string;date:string|null};confirmed:true;singleItem:true;syntheticOnly:true};
type UpdateBody={expectedRevision:number;title:string;text:string;occurredOn:string|null};
export type JournalCommand={key:string;method:'POST';id:null;body:CreateBody}|{key:string;method:'PATCH';id:string;body:UpdateBody};
export type JournalState={phase:'idle'|'saving'|'uncertain'|'saved'|'rejected';pending:JournalCommand|null;saved:PublicEntry|null;error:string;status:number|null};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type JournalFetch=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;
export function createJournalDetailFence(){let generation=0;return{begin(){const current=++generation;return()=>current===generation;},invalidate(){generation++;}};}
const defaultPath='/api/platform/journal';
const unknownMessage='保存结果尚未确认。请保持本次内容不变，重试同一请求。';
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function prefix(path:string):string{if(!/^\/api\/platform\/[a-z][a-z0-9/-]*$/.test(path))throw Error('日记接口路径无效。');return path.replace(/\/$/,'');}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function validTimestamp(value:unknown):boolean{return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===(value.includes('.')?value:value.replace('Z','.000Z'));}
function validEntry(value:unknown):value is PublicEntry{
 if(!record(value)||value.kind!=='inbox'||!record(value.draft)||!record(value.source)||!record(value.source.original)||!record(value.source.original.capture)||value.source.original.capture.kind!=='life')return false;
 try{
  validateId(value.id);validateRevision(value.revision);validateInbox(value.draft);validateId(value.source.id);validateRevision(value.source.version);
  if(value.inboxId!==undefined)validateId(value.inboxId);
  return !('ownerId'in value)&&value.source.system==='website'&&value.source.externalId===value.id&&validTimestamp(value.source.asOf)&&validTimestamp(value.createdAt)&&validTimestamp(value.updatedAt)&&value.syncState==='draft'&&value.externalStatus===null;
 }catch{return false;}
}
function checkedCommand(value:unknown):JournalCommand{
 const command=object(value,['key','method','id','body']);validateIdempotencyKey(command.key);
 if(command.method==='POST'&&command.id===null){
  const body=object(command.body,['text','kind','timeZone','adapter','fields','confirmed','singleItem','syntheticOnly']);
  if(body.kind!=='life'||body.adapter!=='manual'||body.confirmed!==true||body.singleItem!==true||body.syntheticOnly!==true)throw Error('请确认只填写虚构测试日记。');
  const fields=object(body.fields,['title','body','date']);
  const draft=validateInbox({title:fields.title,text:fields.body,occurredOn:fields.date,disposition:'reference'});
  if(!draft.text.trim()||typeof body.text!=='string'||!body.text.trim()||body.text.includes('\0')||body.text.length>16384)throw Error('请填写日记正文。');
  if(typeof body.timeZone!=='string'||body.timeZone.length>80)throw Error('用户时区无效。');new Intl.DateTimeFormat('en',{timeZone:body.timeZone}).format();
 }else if(command.method==='PATCH'){
  validateId(command.id);const body=object(command.body,['expectedRevision','title','text','occurredOn']);validateRevision(body.expectedRevision);const draft=validateInbox({title:body.title,text:body.text,occurredOn:body.occurredOn,disposition:'reference'});if(!draft.text.trim())throw Error('请填写日记正文。');
 }else throw Error('日记命令无效。');
 return structuredClone(command) as JournalCommand;
}
export function makeJournalCreate(fields:JournalFields,key:string,timeZone:string,syntheticAcknowledged:boolean):Extract<JournalCommand,{method:'POST'}>{
 if(!syntheticAcknowledged)throw Error('请先确认本次内容为虚构测试数据。');
 return checkedCommand({key,method:'POST',id:null,body:{text:fields.text,kind:'life',timeZone,adapter:'manual',fields:{title:fields.title,body:fields.text,date:fields.occurredOn||null},confirmed:true,singleItem:true,syntheticOnly:true}}) as Extract<JournalCommand,{method:'POST'}>;
}
export function makeJournalUpdate(entry:PublicEntry,fields:JournalFields,key:string):Extract<JournalCommand,{method:'PATCH'}>{
 if(!validEntry(entry))throw Error('请选择可访问的日记记录。');
 return checkedCommand({key,method:'PATCH',id:entry.id,body:{expectedRevision:entry.revision,title:fields.title,text:fields.text,occurredOn:fields.occurredOn||null}}) as Extract<JournalCommand,{method:'PATCH'}>;
}
function matches(command:JournalCommand,entry:PublicEntry):boolean{
 const draft=entry.draft;if(!('text'in draft))return false;
 if(command.method==='PATCH')return entry.id===command.id&&entry.revision===command.body.expectedRevision+1&&draft.title===command.body.title.trim()&&draft.text===command.body.text&&draft.occurredOn===command.body.occurredOn;
 return entry.revision===1&&draft.title===command.body.fields.title.trim()&&draft.text===command.body.fields.body&&draft.occurredOn===command.body.fields.date&&record(entry.source.original)&&entry.source.original.inputText===command.body.text;
}
function apiError(value:unknown):string|null{
 if(!record(value)||!record(value.error)||typeof value.error.code!=='string'||typeof value.error.message!=='string')return null;
 switch(value.error.code){
  case 'UNAUTHENTICATED':case 'AUTH_REQUIRED':return '请先登录，再重试本次操作。';
  case 'REVISION_CONFLICT':return '记录版本已变化，请读取当前版本后重新核对。';
  case 'COMMAND_CONFLICT':return '本次请求标识已被使用，请核对保存状态。';
  case 'NOT_FOUND':return '没有可访问的日记记录。';
  case 'FORBIDDEN':case 'OWNER_ONLY':case 'ORIGIN_DENIED':return '当前会话无权完成此操作。';
  case 'INVALID_DATE':return '请填写真实有效的日期，或保留为空。';
  case 'INVALID_TEXT':case 'INVALID_CAPTURE':case 'INVALID_BODY':case 'UNKNOWN_FIELD':return '填写内容未通过校验，请检查后重试。';
  case 'STORAGE_UNAVAILABLE':return '日记服务暂不可用，请稍后重试。';
  default:return '请求未被接受，请核对当前状态后重试。';
 }
}
export class JournalMutationSession{
 private state:JournalState={phase:'idle',pending:null,saved:null,error:'',status:null};
 private fetcher:JournalFetch;private path:string;private storage:Store|undefined;private storageKey:string;private listeners=new Set<()=>void>();private everUncertain=false;
 constructor(options:{fetcher?:JournalFetch;apiPrefix?:string;storage?:Store}={}){
  this.fetcher=options.fetcher??fetch;this.path=prefix(options.apiPrefix??defaultPath);this.storage=options.storage;this.storageKey='lifeos.review.journal.pending.v1:'+this.path;
  try{const saved=this.storage?.getItem(this.storageKey);if(saved){if(saved.length>150000)throw Error();const pending=freeze(checkedCommand(JSON.parse(saved)));this.everUncertain=true;this.state={...this.state,phase:'uncertain',pending,error:'已恢复尚未确认的保存，请先重试本次请求。'};}}
  catch{this.everUncertain=true;this.state={...this.state,phase:'uncertain',error:'无法读取本页保留的保存请求。请保留此页面，暂勿发起新保存。'};}
 }
 getSnapshot=():JournalState=>this.state;
 subscribe=(listener:()=>void):(()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private update(value:JournalState):void{this.state=freeze(value);this.listeners.forEach(listener=>listener());}
 private keep(command:JournalCommand):void{if(!this.storage)return;const existing=this.storage.getItem(this.storageKey),serialized=JSON.stringify(command);if(existing&&existing!==serialized)throw Error('另有未确认的日记保存。');this.storage.setItem(this.storageKey,serialized);if(this.storage.getItem(this.storageKey)!==serialized)throw Error('本次请求未能保留。');}
 private clear(command:JournalCommand):void{if(!this.storage)return;const saved=this.storage.getItem(this.storageKey);if(saved&&JSON.stringify(checkedCommand(JSON.parse(saved)))!==JSON.stringify(command))throw Error('保留的请求已变化。');this.storage.removeItem(this.storageKey);if(this.storage.getItem(this.storageKey)!==null)throw Error('保存回执尚未完成本地确认。');}
 async submit(value:JournalCommand):Promise<void>{
  if(this.state.phase==='saving'||this.state.phase==='uncertain')return;
  let command:JournalCommand;try{command=freeze(checkedCommand(value));this.keep(command);}catch(error){this.update({phase:'rejected',pending:null,saved:null,status:null,error:error instanceof Error?error.message:'无法保留本次保存，尚未发送。'});return;}
  this.everUncertain=false;this.update({phase:'saving',pending:command,saved:null,error:'',status:null});await this.send(command);
 }
 async retry():Promise<void>{if(this.state.phase!=='uncertain'||!this.state.pending)return;const command=this.state.pending;this.update({...this.state,phase:'saving',error:''});await this.send(command);}
 private async send(command:JournalCommand):Promise<void>{
  let status:number|null=null;
  try{
   const response=await this.fetcher(this.path+(command.id?'/'+command.id:'')+(command.id?'?includeSynthetic=1':''),{method:command.method,credentials:'same-origin',headers:{'content-type':'application/json','idempotency-key':command.key},body:JSON.stringify(command.body)});status=response.status;
   const value:unknown=await response.json();
   if(response.status>=400&&response.status<500&&apiError(value)){
    if(this.everUncertain){this.update({...this.state,phase:'uncertain',error:apiError(value)+' 原保存仍未确认，请恢复访问后重试同一请求。',status});return;}
    this.clear(command);this.update({phase:'rejected',pending:null,saved:null,error:apiError(value)!,status});return;
   }
   if(!(response.status===200||command.method==='POST'&&response.status===201)||!record(value)||typeof value.duplicate!=='boolean'||!validEntry(value.entry)||!matches(command,value.entry))throw Error(unknownMessage);
   this.clear(command);this.update({phase:'saved',pending:null,saved:value.entry,error:'',status});
  }catch{this.everUncertain=true;this.update({...this.state,phase:'uncertain',saved:null,error:unknownMessage,status});}
 }
}
export class JournalReadError extends Error{status:number|null;constructor(message:string,status:number|null){super(message);this.status=status;}}
async function read(path:string,fetcher:JournalFetch):Promise<unknown>{
 let response:Response;try{response=await fetcher(path,{cache:'no-store',credentials:'same-origin'});}catch{throw new JournalReadError('读取失败，请重试。',null);}
 let value:unknown;try{value=await response.json();}catch{throw new JournalReadError('日记响应无法读取，请重试。',response.status);}
 if(!response.ok)throw new JournalReadError(apiError(value)??'日记暂不可用，请重试。',response.status);return value;
}
export async function readJournalList(fetcher:JournalFetch=fetch,includeSynthetic=false,apiPrefix=defaultPath):Promise<PublicEntry[]>{
 const value=await read(prefix(apiPrefix)+(includeSynthetic?'?includeSynthetic=1':''),fetcher);
 if(!record(value)||!Array.isArray(value.items)||!value.items.every(validEntry))throw new JournalReadError('日记列表响应无效，请重试。',null);return value.items;
}
export async function readJournalDetail(id:string,includeSynthetic=false,fetcher:JournalFetch=fetch,apiPrefix=defaultPath):Promise<{entry:PublicEntry;history:PublicEntry[]}>{
 validateId(id);const path=prefix(apiPrefix)+'/'+id,query=includeSynthetic?'?includeSynthetic=1':'';
 const value=await read(path+query,fetcher);if(!record(value)||!validEntry(value.entry)||value.entry.id!==id)throw new JournalReadError('日记详情响应无效，请重试。',null);
 const history=await read(path+'/history'+query,fetcher);if(!record(history)||!Array.isArray(history.history)||!history.history.every(item=>validEntry(item)&&item.id===id))throw new JournalReadError('日记历史响应无效，请重试。',null);
 return {entry:value.entry,history:history.history};
}
