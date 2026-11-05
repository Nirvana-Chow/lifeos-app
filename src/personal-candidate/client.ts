import {preserveOmittedPlanning} from './planning.ts';
import {appleOriginMarker,readAppleOrigin} from './apple-origin.ts';
import {personalTypes,normalizePersonalFields} from './business.ts';
import {object,validateId,validateIdempotencyKey,validateRevision,validateTodo,validateInbox} from '../platform/domain.ts';
import type {PublicEntry} from '../platform/contracts.ts';
import type {PersonalFields,PersonalBody} from './service.ts';
import type {PersonalType} from './config.ts';
export type {PersonalFields};
export type PersonalBinding=Readonly<{ownerId:string;spaceId:string}>;
export type PersonalCommand=Readonly<{ownerId:string;spaceId:string;type:PersonalType;id:string|null;key:string;method:'POST'|'PATCH';body:PersonalBody}>;
export type PersonalState=Readonly<{phase:'idle'|'saving'|'uncertain'|'saved'|'rejected';pending:PersonalCommand|null;saved:PublicEntry|null;error:string}>;
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type PersonalFetch=(url:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;
const obj=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const canonical=(value:unknown):string=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en')).map(([key,item])=>JSON.stringify(key)+':'+canonical(item)).join(',')+'}':JSON.stringify(value);
const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function checkBinding(binding:PersonalBinding):void{if(!/^[A-Za-z0-9_-]{6,80}$/.test(binding.ownerId)||!/^[A-Za-z0-9_-]{8,80}$/.test(binding.spaceId))throw Error('本人身份或空间无效。');}
function checked(value:unknown,binding:PersonalBinding):PersonalCommand{
 checkBinding(binding);const raw=object(value,['ownerId','spaceId','type','id','key','method','body']);
 if(raw.ownerId!==binding.ownerId||raw.spaceId!==binding.spaceId||!personalTypes.includes(raw.type as PersonalType)||raw.method!==(raw.id===null?'POST':'PATCH'))throw Error('请求与当前本人身份或空间不符。');
 validateIdempotencyKey(raw.key);if(raw.id!==null)validateId(raw.id);
 const body=object(raw.body,['spaceId','confirmed','fields',...(raw.id!==null?['expectedRevision']:[])]);
 if(body.spaceId!==binding.spaceId||body.confirmed!==true)throw Error('请先确认本次本人手动保存。');
 normalizePersonalFields(raw.type as string,body.fields);
 if(raw.id!==null)validateRevision(body.expectedRevision);
 return freeze(structuredClone(raw) as PersonalCommand);
}
export function makePersonalCommand(binding:PersonalBinding,type:PersonalType,id:string|null,fields:PersonalFields,key:string,confirmed:boolean,expectedRevision?:number):PersonalCommand{
 return checked({...binding,type,id,key,method:id===null?'POST':'PATCH',body:{spaceId:binding.spaceId,confirmed,fields,...(id===null?{}:{expectedRevision})}},binding);
}
function matches(command:PersonalCommand,value:unknown):value is PublicEntry{
 if(!obj(value)||!obj(value.source)||!obj(value.source.original)||!obj(value.draft)||'ownerId'in value)return false;
 const original=value.source.original;if(original.marker!=='personal-manual-v1'&&!(command.id&&command.type==='todo'&&original.marker===appleOriginMarker)||original.spaceId!==command.spaceId||original.type!==command.type||value.kind!==(command.type==='todo'?'todo':'inbox')||value.syncState!=='draft'||value.externalStatus!==null||value.source.externalId!==value.id||value.source.system!=='website'||value.source.version!==1)return false;
 try{if(original.marker===appleOriginMarker)readAppleOrigin(original,command.spaceId);else object(original,['marker','spaceId','type','input']);validateId(value.id);validateId(value.source.id);validateRevision(value.revision);const fields=command.body.fields,normalized=command.type==='todo'?validateTodo(fields):validateInbox({...normalizePersonalFields(command.type,fields),disposition:'reference'});if(canonical(command.id?preserveOmittedPlanning(command.type,fields,value.draft,normalized):normalized)!==canonical(value.draft))return false;return command.id?value.id===command.id&&value.revision===command.body.expectedRevision!+1:value.revision===1&&canonical(original.input)===canonical(command.body);}catch{return false;}
}
const unknown='保存结果尚未确认。请保留原请求，恢复当前本人身份后重试同一内容。';
export class PersonalMutationSession{
 private state:PersonalState=freeze({phase:'idle',pending:null,saved:null,error:''});private binding:PersonalBinding;private storage?:Store;private fetcher:PersonalFetch;private assertBinding:()=>boolean;private storageKey:string;private listeners=new Set<()=>void>();private uncertain=false;private invalidated=false;private controller:AbortController|null=null;private attemptGeneration=0;
 constructor(options:{binding:PersonalBinding;storage?:Store;fetcher?:PersonalFetch;assertBinding?:()=>boolean}){
  checkBinding(options.binding);this.binding=freeze(structuredClone(options.binding));this.storage=options.storage;this.fetcher=options.fetcher??((input,init)=>fetch(input,init));this.assertBinding=options.assertBinding??(()=>true);this.storageKey='lifeos.personal.pending.v1:'+encodeURIComponent(this.binding.ownerId)+':'+encodeURIComponent(this.binding.spaceId);
  try{const saved=this.storage?.getItem(this.storageKey);if(saved){if(saved.length>150000)throw Error();this.uncertain=true;this.state=freeze({phase:'uncertain',pending:checked(JSON.parse(saved),this.binding),saved:null,error:unknown});}}catch{this.uncertain=true;this.state=freeze({phase:'uncertain',pending:null,saved:null,error:'保留的请求无法核对，请保留当前页面。'});}
 }
 getSnapshot=():PersonalState=>this.state;
 subscribe=(listener:()=>void):(()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private update(state:PersonalState){this.state=freeze(state);this.listeners.forEach(listener=>listener());}
 private active(){return !this.invalidated&&this.assertBinding();}
 private keep(command:PersonalCommand){if(!this.storage)return;const serialized=JSON.stringify(command),prior=this.storage.getItem(this.storageKey);if(prior&&prior!==serialized)throw Error('当前本人空间另有未确认请求。');this.storage.setItem(this.storageKey,serialized);if(this.storage.getItem(this.storageKey)!==serialized)throw Error('无法保留本次请求，尚未发送。');}
 private clear(command:PersonalCommand){if(!this.storage)return;const prior=this.storage.getItem(this.storageKey);if(prior!==JSON.stringify(command))throw Error('保留的请求已变化。');this.storage.removeItem(this.storageKey);if(this.storage.getItem(this.storageKey)!==null)throw Error('保存回执仍未确认。');}
 invalidateBinding(){this.invalidated=true;this.attemptGeneration++;this.controller?.abort();this.controller=null;if(this.state.pending){this.uncertain=true;this.update({...this.state,phase:'uncertain',saved:null,error:unknown});}}
 cancel(){if(this.state.phase==='saving'){this.attemptGeneration++;this.controller?.abort();this.controller=null;this.uncertain=true;this.update({...this.state,phase:'uncertain',saved:null,error:unknown});}else if(this.state.phase!=='uncertain')this.update({phase:'idle',pending:null,saved:null,error:''});}
 async submit(value:PersonalCommand){if(this.state.phase==='saving'||this.state.phase==='uncertain')return;let command:PersonalCommand;try{if(!this.active())throw Error('当前本人身份或空间已变化，未发送。');command=checked(value,this.binding);this.keep(command);}catch(error){this.update({phase:'rejected',pending:null,saved:null,error:error instanceof Error?error.message:'请求未发送。'});return;}this.uncertain=false;this.update({phase:'saving',pending:command,saved:null,error:''});await this.send(command);}
 async retry(){if(this.state.phase!=='uncertain'||!this.state.pending||!this.active())return;const command=this.state.pending;this.update({...this.state,phase:'saving',error:''});await this.send(command);}
 private async send(command:PersonalCommand){
  if(this.state.phase!=='saving'||this.state.pending!==command)return;
  const generation=++this.attemptGeneration,controller=new AbortController(),current=()=>generation===this.attemptGeneration;this.controller=controller;
  try{if(!this.active())throw Error();const response=await this.fetcher('/api/platform/personal/'+command.type+(command.id?'/'+command.id:''),{method:command.method,headers:{'content-type':'application/json','idempotency-key':command.key},credentials:'same-origin',body:JSON.stringify(command.body),signal:controller.signal});if(!current())return;const value:unknown=await response.json();if(!current())return;if(!this.active()||controller.signal.aborted)throw Error();
   if(response.status>=400&&response.status<500&&obj(value)&&obj(value.error)&&typeof value.error.code==='string'){if(this.uncertain)throw Error();this.clear(command);this.update({phase:'rejected',pending:null,saved:null,error:value.error.code==='REVISION_CONFLICT'?'版本冲突：请重新读取当前记录，核对后再保存。':value.error.code==='REFERENCE_CONFLICT'?'关联版本冲突：请重新选择当前来源后保存。':'请求未被接受，请重新核对本人身份、内容或版本。'});return;}
   if(!(response.status===200||command.method==='POST'&&response.status===201)||!obj(value)||typeof value.duplicate!=='boolean'||!matches(command,value.entry))throw Error();this.clear(command);this.update({phase:'saved',pending:null,saved:value.entry,error:''});
  }catch{if(current()){this.uncertain=true;this.update({phase:'uncertain',pending:command,saved:null,error:unknown});}}finally{if(current()&&this.controller===controller)this.controller=null;}
 }
}
