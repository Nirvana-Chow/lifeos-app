import {object,validateId,validateIdempotencyKey,validateRevision} from '../platform/domain.ts';
import {validateRequirementFields} from '../requirements-candidate/domain.ts';
import {readRequirementItem,type RequirementBinding} from '../requirements-candidate/client.ts';
import {validateFeedbackInput,validateRequirementReference,validateRequirementSupportMetadata} from './domain.ts';
import type {FeedbackItem,ReleaseReadState} from './service.ts';
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'>;
type Fetch=(url:string,init?:RequestInit)=>Promise<Response>;
export type SupportCommand={ownerId:string;spaceId:string;kind:'create'|'review'|'read';id:string|null;key:string;body:Record<string,unknown>};
export type SupportMutationState={phase:'idle'|'saving'|'uncertain'|'saved'|'rejected';pending:SupportCommand|null;observed:FeedbackItem|ReleaseReadState|null;error:string};
const canonical=(v:unknown):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}':JSON.stringify(v);
const equal=(a:unknown,b:unknown):boolean=>canonical(a)===canonical(b);
const freeze=<T,>(value:T):T=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const unknown='保存结果尚未确认。请保留原请求，恢复本人身份后重试同一请求。';
export function readFeedbackItem(value:unknown):FeedbackItem{
 const v=object(value,['id','revision','sourceId','title','text','state','references','source','createdAt','updatedAt']);validateId(v.id);validateId(v.sourceId);validateRevision(v.revision);
 const source=object(v.source,['channel','label','asOf']);if(!['owner-web','agent-feedback'].includes(String(source.channel)))throw Error('反馈来源无效。');
 validateFeedbackInput({title:v.title,text:v.text,sourceLabel:source.label});validateRequirementSupportMetadata({schema:1,type:'feedback',state:v.state,references:v.references});
 for(const d of [v.createdAt,v.updatedAt,source.asOf])if(typeof d!=='string'||!Number.isFinite(Date.parse(d))||new Date(d).toISOString()!==d)throw Error('反馈时间无效。');
 if(v.createdAt!==source.asOf||String(v.updatedAt)<String(v.createdAt))throw Error('反馈时间无效。');return structuredClone(v) as FeedbackItem;
}
function readPreference(v:unknown):ReleaseReadState{const row=object(v,['sourceSha','seen','id','revision']);if(typeof row.sourceSha!=='string'||!/^[a-f0-9]{40}$/.test(row.sourceSha)||typeof row.seen!=='boolean')throw Error('版本状态无效。');if(row.seen){validateId(row.id);if(row.revision!==1)throw Error('版本状态无效。');}else if(row.id!==null||row.revision!==null)throw Error('版本状态无效。');return structuredClone(row) as ReleaseReadState;}
function checked(input:unknown,binding:RequirementBinding):SupportCommand{
 const v=object(input,['ownerId','spaceId','kind','id','key','body']);if(v.ownerId!==binding.ownerId||v.spaceId!==binding.spaceId||!['create','review','read'].includes(String(v.kind)))throw Error('请求与本人空间不匹配。');validateIdempotencyKey(v.key);
 const b=object(v.body,v.kind==='create'?['spaceId','confirmed','fields']:v.kind==='read'?['spaceId','confirmed','sourceSha']:['spaceId','confirmed','expectedRevision','action','fields','reference']);
 if(b.spaceId!==binding.spaceId||b.confirmed!==true)throw Error('请确认本人空间。');
 if(v.kind==='review'){validateId(v.id);validateRevision(b.expectedRevision);if(b.action==='archive')object(b,['spaceId','confirmed','expectedRevision','action']);else if(b.action==='link'){object(b,['spaceId','confirmed','expectedRevision','action','reference']);validateRequirementReference(b.reference);}else if(b.action==='convert'){object(b,['spaceId','confirmed','expectedRevision','action','fields']);validateRequirementFields(b.fields);}else throw Error('请选择整理操作。');}
 else{if(v.id!==null)throw Error('请求身份无效。');if(v.kind==='create')validateFeedbackInput(b.fields);else if(typeof b.sourceSha!=='string'||!/^[a-f0-9]{40}$/.test(b.sourceSha))throw Error('运行版本无效。');}
 return freeze(structuredClone(v) as SupportCommand);
}
export function makeSupportCommand(binding:RequirementBinding,kind:SupportCommand['kind'],id:string|null,body:Record<string,unknown>,key:string):SupportCommand{return checked({ownerId:binding.ownerId,spaceId:binding.spaceId,kind,id,key,body:{spaceId:binding.spaceId,confirmed:true,...body}},binding);}
/** Browser storage is only a pending command journal. All visible business rows come from server readback. */
export class SupportMutationSession{
 private binding:RequirementBinding;private storage?:Storage;private fetcher:Fetch;private active:()=>boolean;private invalid=false;private storageKey:string;private uncertain=false;private listeners=new Set<()=>void>();private state:SupportMutationState=freeze({phase:'idle',pending:null,observed:null,error:''});
 constructor(options:{binding:RequirementBinding;storage?:Storage;fetcher?:Fetch;assertBinding?:()=>boolean}){this.binding=Object.freeze({...options.binding});this.storage=options.storage;this.fetcher=options.fetcher??((url,init)=>fetch(url,init));this.active=options.assertBinding??(()=>true);this.storageKey='lifeos.requirement-support.pending.v1:'+encodeURIComponent(this.binding.ownerId)+':'+encodeURIComponent(this.binding.spaceId);try{const raw=this.storage?.getItem(this.storageKey);if(raw){if(raw.length>150000)throw Error();this.uncertain=true;this.state=freeze({phase:'uncertain',pending:checked(JSON.parse(raw),this.binding),observed:null,error:unknown});}}catch{this.uncertain=true;this.state=freeze({phase:'uncertain',pending:null,observed:null,error:'保留的原请求无法核对，请保留页面与原文。'});}}
 getSnapshot=()=>this.state;
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private update(next:SupportMutationState){this.state=freeze(next);this.listeners.forEach(fn=>fn());}
 invalidateBinding(){this.invalid=true;this.update({...this.state,observed:null,phase:this.state.pending?'uncertain':'idle',error:this.state.pending?unknown:''});}
 private valid(){return !this.invalid&&this.active();}
 async submit(input:SupportCommand){if(this.state.phase==='saving'||this.state.phase==='uncertain')return;let command:SupportCommand;try{if(!this.valid())throw Error('本人身份已变化。');command=checked(input,this.binding);if(this.storage){const raw=JSON.stringify(command),old=this.storage.getItem(this.storageKey);if(old&&old!==raw)throw Error('本人空间另有未确认请求。');this.storage.setItem(this.storageKey,raw);if(this.storage.getItem(this.storageKey)!==raw)throw Error('原请求无法保留。');}}catch(e){this.update({phase:'rejected',pending:null,observed:null,error:e instanceof Error?e.message:'请求未发送。'});return;}this.uncertain=false;this.update({phase:'saving',pending:command,observed:null,error:''});await this.send(command);}
 async retry(){if(this.state.phase!=='uncertain'||!this.state.pending||!this.valid())return;this.update({...this.state,phase:'saving',error:''});await this.send(this.state.pending!);}
 private clear(command:SupportCommand){if(this.storage){if(this.storage.getItem(this.storageKey)!==JSON.stringify(command))throw Error();this.storage.removeItem(this.storageKey);if(this.storage.getItem(this.storageKey)!==null)throw Error();}}
 private async send(command:SupportCommand){
  const base='/api/platform/personal/requirement-support';
  try{
   if(!this.valid())throw Error();const response=await this.fetcher(base+(command.kind==='read'?'/releases/read':'/feedback'+(command.id?'/'+command.id:'')),{method:command.kind==='review'?'PATCH':'POST',headers:{'content-type':'application/json','idempotency-key':command.key},credentials:'same-origin',body:JSON.stringify(command.body)}),value=await response.json();if(!this.valid())throw Error();
   if(response.status>=400&&response.status<500&&typeof value?.error?.code==='string'){if(this.uncertain)throw Error();this.clear(command);this.update({phase:'rejected',pending:null,observed:null,error:typeof value.error.message==='string'?value.error.message:'保存未被接受，请保留原文并重新核对。'});return;}
   if(![200,201].includes(response.status)||typeof value.duplicate!=='boolean')throw Error();
   let observed:FeedbackItem|ReleaseReadState;
   if(command.kind==='read'){const receipt=readPreference(value.entry);if(!receipt.seen||receipt.sourceSha!==command.body.sourceSha)throw Error();const read=await this.fetcher(base+'/releases/read/'+receipt.sourceSha,{credentials:'same-origin',cache:'no-store'});observed=readPreference((await read.json()).entry);if(read.status!==200||!equal(observed,receipt))throw Error();}
   else{
    const receipt=readFeedbackItem(value.entry);if(command.kind==='create'){const fields=validateFeedbackInput(command.body.fields);if(receipt.revision!==1||receipt.state!=='inbox'||receipt.source.channel!=='owner-web'||!equal({title:receipt.title,text:receipt.text,sourceLabel:receipt.source.label},fields))throw Error();}
    else{if(receipt.id!==command.id||receipt.revision!==Number(command.body.expectedRevision)+1||receipt.state!==(command.body.action==='archive'?'archived':command.body.action==='link'?'linked':'converted'))throw Error();if(command.body.action==='link'&&!receipt.references.some(ref=>equal(ref,validateRequirementReference(command.body.reference))))throw Error();}
    const read=await this.fetcher(base+'/feedback/'+receipt.id,{credentials:'same-origin',cache:'no-store'});observed=readFeedbackItem((await read.json()).entry);if(read.status!==200||observed.id!==receipt.id||observed.sourceId!==receipt.sourceId||observed.revision<receipt.revision||observed.text!==receipt.text||observed.title!==receipt.title||!equal(observed.source,receipt.source)||observed.revision===receipt.revision&&!equal(observed,receipt))throw Error();
    if(command.kind==='review'&&command.body.action==='convert'){const ref=receipt.references[0];if(!ref||ref.id.startsWith('LO-'))throw Error();const readTarget=await this.fetcher('/api/platform/personal/requirements/'+ref.id,{credentials:'same-origin',cache:'no-store'}),target=readRequirementItem((await readTarget.json()).entry);if(readTarget.status!==200||target.id!==ref.id||target.sourceId!==ref.sourceId||target.revision<ref.revision||target.revision===ref.revision&&!equal(target.fields,validateRequirementFields(command.body.fields)))throw Error();}
   }
   if(!this.valid())throw Error();this.clear(command);this.update({phase:'saved',pending:null,observed,error:''});
  }catch{this.uncertain=true;this.update({phase:'uncertain',pending:command,observed:null,error:unknown});}
 }
}
