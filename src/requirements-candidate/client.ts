import {object,validateId,validateIdempotencyKey,validateRevision} from '../platform/domain.ts';
import {requirementId,validateBaselineBinding,validateRequirementFields,type RequirementFields,type BaselineBinding} from './domain.ts';
import type {RequirementItem} from './service.ts';
export type RequirementBinding={ownerId:string;spaceId:string};
export type RequirementCommand={ownerId:string;spaceId:string;id:string|null;key:string;method:'POST'|'PATCH';body:{spaceId:string;confirmed:true;fields:RequirementFields;expectedRevision?:number;baselineBinding?:BaselineBinding|null}};
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'>;
type Fetch=(url:string,init?:RequestInit)=>Promise<Response>;
export type RequirementMutationState={phase:'idle'|'saving'|'uncertain'|'saved'|'rejected';pending:RequirementCommand|null;saved:RequirementItem|null;observed:RequirementItem|null;error:string};
const freeze=<T>(v:T):T=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const canonical=(v:unknown):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}':JSON.stringify(v);
function checked(value:unknown,binding:RequirementBinding):RequirementCommand{
 const v=object(value,['ownerId','spaceId','id','key','method','body']);
 if(!/^[A-Za-z0-9_-]{6,80}$/.test(binding.ownerId)||!/^[A-Za-z0-9_-]{8,80}$/.test(binding.spaceId)||v.ownerId!==binding.ownerId||v.spaceId!==binding.spaceId||v.method!==(v.id===null?'POST':'PATCH'))throw Error('需求请求与当前本人身份或空间不符。');
 if(v.id!==null)requirementId(v.id);validateIdempotencyKey(v.key);
 const b=object(v.body,v.id===null?['spaceId','confirmed','fields']:['spaceId','confirmed','fields','expectedRevision','baselineBinding']);
 if(b.spaceId!==binding.spaceId||b.confirmed!==true)throw Error('需要确认当前本人空间。');
 const fields=validateRequirementFields(b.fields);
 const body:RequirementCommand['body']={spaceId:binding.spaceId,confirmed:true,fields};
 if(v.id!==null){const id=v.id as string;body.expectedRevision=b.expectedRevision===0&&id.startsWith('LO-')?0:validateRevision(b.expectedRevision);body.baselineBinding=validateBaselineBinding(b.baselineBinding);if(id.startsWith('LO-')!==!!body.baselineBinding)throw Error('需求基线绑定无效。');}
 return freeze({ownerId:binding.ownerId,spaceId:binding.spaceId,id:v.id as string|null,key:v.key as string,method:v.method as 'POST'|'PATCH',body});
}
export function makeRequirementCommand(binding:RequirementBinding,id:string|null,fields:RequirementFields,key:string,expectedRevision?:number,baselineBinding?:BaselineBinding|null):RequirementCommand{return checked({...binding,id,key,method:id?'PATCH':'POST',body:{spaceId:binding.spaceId,confirmed:true,fields,...(id?{expectedRevision,baselineBinding}:{})}},binding);}
export function readRequirementItem(value:unknown):RequirementItem{
 const v=object(value,['id','revision','sourceId','fields','baselineBinding','baselineConflict','requirement']);requirementId(v.id);if(v.revision!==0)validateRevision(v.revision);if(v.sourceId!==null)validateId(v.sourceId);
 const binding=validateBaselineBinding(v.baselineBinding);validateRequirementFields(v.fields);
 if(typeof v.baselineConflict!=='boolean'||v.revision===0&&v.sourceId!==null||v.revision!==0&&v.sourceId===null||String(v.id).startsWith('LO-')!==!!binding||!v.requirement||typeof v.requirement!=='object')throw Error('需求读取响应无效。');
 return structuredClone(v) as RequirementItem;
}
const unknown='保存结果尚未确认。请保留原请求，恢复当前本人身份后重试同一内容。';
export class RequirementMutationSession{
 private state:RequirementMutationState=freeze({phase:'idle',pending:null,saved:null,observed:null,error:''});private readonly binding:RequirementBinding;private readonly storage?:Storage;private readonly fetcher:Fetch;private readonly assertBinding:()=>boolean;private readonly storageKey:string;private listeners=new Set<()=>void>();private uncertain=false;private invalidated=false;private controller:AbortController|null=null;private generation=0;
 constructor(options:{binding:RequirementBinding;storage?:Storage;fetcher?:Fetch;assertBinding?:()=>boolean}){
  this.binding=freeze(structuredClone(options.binding));this.storage=options.storage;this.fetcher=options.fetcher??((url,init)=>fetch(url,init));this.assertBinding=options.assertBinding??(()=>true);this.storageKey='lifeos.requirements.pending.v1:'+encodeURIComponent(this.binding.ownerId)+':'+encodeURIComponent(this.binding.spaceId);
  try{const saved=this.storage?.getItem(this.storageKey);if(saved){if(saved.length>150000)throw Error();this.uncertain=true;this.state=freeze({phase:'uncertain',pending:checked(JSON.parse(saved),this.binding),saved:null,observed:null,error:unknown});}}catch{this.uncertain=true;this.state=freeze({phase:'uncertain',pending:null,saved:null,observed:null,error:'保留的需求请求无法核对，请保留当前页面。'});}
 }
 getSnapshot=()=>this.state;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private update(state:RequirementMutationState){this.state=freeze(state);this.listeners.forEach(listener=>listener());}
 private active(){return !this.invalidated&&this.assertBinding();}
 private keep(command:RequirementCommand){if(!this.storage)return;const serialized=JSON.stringify(command),old=this.storage.getItem(this.storageKey);if(old&&old!==serialized)throw Error('当前本人空间另有未确认需求请求。');this.storage.setItem(this.storageKey,serialized);if(this.storage.getItem(this.storageKey)!==serialized)throw Error('无法保留本次需求请求。');}
 private clear(command:RequirementCommand){if(!this.storage)return;if(this.storage.getItem(this.storageKey)!==JSON.stringify(command))throw Error('保留的需求请求已变化。');this.storage.removeItem(this.storageKey);if(this.storage.getItem(this.storageKey)!==null)throw Error('保留的需求请求尚未清除。');}
 invalidateBinding(){this.invalidated=true;this.generation++;this.controller?.abort();this.controller=null;this.update({...this.state,phase:this.state.pending?'uncertain':'idle',saved:null,observed:null,error:this.state.pending?unknown:''});}
 cancel(){if(this.state.phase==='saving'){this.generation++;this.controller?.abort();this.controller=null;this.uncertain=true;this.update({...this.state,phase:'uncertain',saved:null,observed:null,error:unknown});}else if(this.state.phase!=='uncertain')this.update({phase:'idle',pending:null,saved:null,observed:null,error:''});}
 async submit(input:RequirementCommand){if(this.state.phase==='saving'||this.state.phase==='uncertain')return;let command:RequirementCommand;try{if(!this.active())throw Error('本人身份或空间已变化。');command=checked(input,this.binding);this.keep(command);}catch(error){this.update({phase:'rejected',pending:null,saved:null,observed:null,error:error instanceof Error?error.message:'需求请求未发送。'});return;}this.uncertain=false;this.update({phase:'saving',pending:command,saved:null,observed:null,error:''});await this.send(command);}
 async retry(){if(this.state.phase!=='uncertain'||!this.state.pending||!this.active())return;this.update({...this.state,phase:'saving',error:''});await this.send(this.state.pending!);}
 private async send(command:RequirementCommand){
  const generation=++this.generation,controller=new AbortController(),current=()=>generation===this.generation;this.controller=controller;
  try{
   if(!this.active())throw Error();
   const url='/api/platform/personal/requirements'+(command.id?'/'+command.id:''),response=await this.fetcher(url,{method:command.method,headers:{'content-type':'application/json','idempotency-key':command.key},credentials:'same-origin',body:JSON.stringify(command.body),signal:controller.signal});
   if(!current())return;const value=await response.json();if(!current())return;if(!this.active()||controller.signal.aborted)throw Error();
   if(response.status>=400&&response.status<500&&value?.error&&typeof value.error.code==='string'){
    if(this.uncertain)throw Error();this.clear(command);this.update({phase:'rejected',pending:null,saved:null,observed:null,error:['REVISION_CONFLICT','BASELINE_CONFLICT'].includes(value.error.code)?'需求版本或基线已变化，请保留草稿并重新读取核对。':'需求请求未被接受，请核对权限与完整字段。'});return;
   }
   if(!(response.status===200||command.method==='POST'&&response.status===201)||typeof value?.duplicate!=='boolean')throw Error();
   const receipt=readRequirementItem(value.entry),expected=command.id?command.body.expectedRevision!+1:1;
   if(receipt.revision!==expected||command.id&&receipt.id!==command.id||canonical(receipt.fields)!==canonical(command.body.fields)||canonical(receipt.baselineBinding)!==canonical(command.body.baselineBinding??null))throw Error();
   const read=await this.fetcher('/api/platform/personal/requirements/'+receipt.id,{method:'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal});
   if(!current())return;const observed=readRequirementItem((await read.json()).entry);
   if(!current())return;if(!this.active()||controller.signal.aborted||read.status!==200||observed.id!==receipt.id||observed.sourceId!==receipt.sourceId||observed.revision<receipt.revision||observed.revision===receipt.revision&&canonical(observed.fields)!==canonical(receipt.fields))throw Error();
   this.clear(command);this.update({phase:'saved',pending:null,saved:receipt,observed,error:observed.revision>receipt.revision?'保存已确认；记录之后又有更新，现显示最新版本。':''});
  }catch{if(current()){this.uncertain=true;this.update({phase:'uncertain',pending:command,saved:null,observed:null,error:unknown});}}finally{if(current()&&this.controller===controller)this.controller=null;}
 }
}
