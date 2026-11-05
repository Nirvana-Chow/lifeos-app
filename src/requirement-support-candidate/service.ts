import {createHash,randomUUID} from 'node:crypto';
import {object,PlatformError,validateId,validateIdempotencyKey,validateInbox,validateRevision} from '../platform/domain.ts';
import type {PlatformRepository,StoredEntry,PublicEntry,MutationResult,Transaction} from '../platform/contracts.ts';
import type {PersonalConfig} from '../personal-candidate/config.ts';
import {RequirementsService,requirementIdentity} from '../requirements-candidate/service.ts';
import {requirementId,validateRequirementFields,type RequirementFields} from '../requirements-candidate/domain.ts';
import {validateFeedbackInput,validateRequirementReference,type FeedbackInput,type FeedbackMetadata,type RequirementReference,type RequirementSupportMetadata} from './domain.ts';

export const requirementSupportMarker='personal-requirement-support-v1';
type Channel='owner-web'|'agent-feedback';
type Guard=()=>Promise<void>;
export type FeedbackItem={id:string;revision:number;sourceId:string;title:string;text:string;state:FeedbackMetadata['state'];references:RequirementReference[];source:{channel:Channel;label:string|null;asOf:string};createdAt:string;updatedAt:string};
export type ReleaseReadState={sourceSha:string;seen:boolean;id:string|null;revision:number|null};
type CreateBody={spaceId:string;confirmed:true;fields:FeedbackInput};
type ReviewBody={spaceId:string;confirmed:true;expectedRevision:number}&({action:'archive'}|{action:'link';reference:RequirementReference}|{action:'convert';fields:RequirementFields});
const fail=(status:number,code:string,message:string):never=>{throw new PlatformError(status,code,message);};
const missing=():never=>fail(404,'NOT_FOUND','没有可访问的反馈。');
const canonical=(v:unknown):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}':JSON.stringify(v);
const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const equal=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const publicEntry=(entry:StoredEntry):PublicEntry=>{const{ownerId,...value}=structuredClone(entry);void ownerId;return value;};
function sourceSha(value:unknown):string{if(typeof value!=='string'||!/^[a-f0-9]{40}$/.test(value))return fail(400,'INVALID_SOURCE_SHA','需要有效的运行版本。');return value;}
export function requirementSupportIdentity(owner:string,space:string,purpose:string,value:string):string{
 const h=digest([requirementSupportMarker,owner,space,purpose,value]);return h.slice(0,8)+'-'+h.slice(8,12)+'-8'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);
}
function confirmed(v:Record<string,unknown>,space:string){if(v.spaceId!==space||v.confirmed!==true)fail(403,'PERSONAL_CONFIRMATION_REQUIRED','需要核对本人空间并明确确认。');}
function createBody(input:unknown,space:string):CreateBody{const v=object(input,['spaceId','confirmed','fields']);confirmed(v,space);return{spaceId:space,confirmed:true,fields:validateFeedbackInput(v.fields)};}
function reviewBody(input:unknown,space:string):ReviewBody{
 const base=object(input,['spaceId','confirmed','expectedRevision','action','reference','fields']);confirmed(base,space);const expectedRevision=validateRevision(base.expectedRevision);
 if(base.action==='archive'){object(input,['spaceId','confirmed','expectedRevision','action']);return{spaceId:space,confirmed:true,expectedRevision,action:'archive'};}
 if(base.action==='link'){object(input,['spaceId','confirmed','expectedRevision','action','reference']);return{spaceId:space,confirmed:true,expectedRevision,action:'link',reference:validateRequirementReference(base.reference)};}
 if(base.action==='convert'){object(input,['spaceId','confirmed','expectedRevision','action','fields']);return{spaceId:space,confirmed:true,expectedRevision,action:'convert',fields:validateRequirementFields(base.fields)};}
 return fail(400,'INVALID_FEEDBACK_ACTION','选择关联需求、转为需求或归档。');
}
function parsed(entry:StoredEntry|PublicEntry,space:string):{metadata:RequirementSupportMetadata;channel:Channel;fields:FeedbackInput|null}|null{
 try{
  if(entry.kind!=='inbox'||entry.syncState!=='draft'||entry.externalStatus!==null||entry.source.system!=='website'||entry.source.version!==1||entry.source.externalId!==entry.id)return null;
  validateId(entry.id);validateId(entry.source.id);validateRevision(entry.revision);
  const o=object(entry.source.original,['marker','schema','spaceId','type','channel','input']);
  if(o.marker!==requirementSupportMarker||o.schema!==1||o.spaceId!==space||!['owner-web','agent-feedback'].includes(String(o.channel)))return null;
  const draft=validateInbox(entry.draft),meta=draft.requirementSupport;if(!meta||draft.record||draft.personal||draft.requirement||draft.occurredOn!==null||o.type!==meta.type)return null;
  if(entry.source.asOf!==entry.createdAt||new Date(entry.createdAt).toISOString()!==entry.createdAt||new Date(entry.updatedAt).toISOString()!==entry.updatedAt||entry.updatedAt<entry.createdAt)return null;
  if(meta.type==='feedback'){
   const original=createBody(o.input,space);
   if(draft.title!==original.fields.title||draft.text!==original.fields.text)return null;
   return{metadata:meta,channel:o.channel as Channel,fields:original.fields};
  }
  const initial=object(o.input,['spaceId','confirmed','sourceSha']);confirmed(initial,space);
  if(o.channel!=='owner-web'||sourceSha(initial.sourceSha)!==meta.sourceSha||draft.title!=='已读版本更新'||draft.text!==''||entry.revision!==1)return null;
  return{metadata:meta,channel:'owner-web',fields:null};
 }catch{return null;}
}
export class RequirementSupportService{
 readonly config:PersonalConfig;
 private repository:PlatformRepository;private requirements:RequirementsService;private options:{currentSourceSha?:()=>string|null};
 constructor(repository:PlatformRepository,config:PersonalConfig,requirements:RequirementsService,options:{currentSourceSha?:()=>string|null}={}){if(requirements.config.ownerId!==config.ownerId||requirements.config.spaceId!==config.spaceId||requirements.config.baseURL!==config.baseURL)fail(503,'SUPPORT_CONFIG_UNAVAILABLE','反馈与需求空间配置不匹配。');this.repository=repository;this.requirements=requirements;this.options=options;this.config=Object.freeze(structuredClone(config));}
 private owner(owner:string){if(owner!==this.config.ownerId)fail(403,'OWNER_ONLY','只允许已绑定本人身份。');if(this.config.requirementSupportEnabled!==true||this.config.requirementsEnabled!==true)fail(404,'REQUIREMENT_SUPPORT_DISABLED','反馈与版本偏好持久化尚未开放。');}
 private matches(entry:StoredEntry|null,owner:string,type:RequirementSupportMetadata['type']):entry is StoredEntry{
  if(!entry||entry.ownerId!==owner)return false;const p=parsed(entry,this.config.spaceId);
  if(!p||p.metadata.type!==type)return false;
  return p.metadata.type!=='release-read'||entry.id===requirementSupportIdentity(owner,this.config.spaceId,'release-read',p.metadata.sourceSha);
 }
 private feedbackItem(entry:StoredEntry|PublicEntry):FeedbackItem{
  const p=parsed(entry,this.config.spaceId);if(!p||p.metadata.type!=='feedback'||!p.fields)return missing();
  return{id:entry.id,revision:entry.revision,sourceId:entry.source.id,title:p.fields.title,text:p.fields.text,state:p.metadata.state,references:structuredClone(p.metadata.references),source:{channel:p.channel,label:p.fields.sourceLabel,asOf:entry.source.asOf},createdAt:entry.createdAt,updatedAt:entry.updatedAt};
 }
 private async identities(tx:Transaction,ids:string[]){if(!tx.lockRecordIdentity)fail(503,'SUPPORT_IDENTITY_LOCK_UNAVAILABLE','反馈身份锁尚未配置。');for(const id of [...new Set(ids)].sort())await tx.lockRecordIdentity!('inbox',id);}
 private async rows(owner:string){
  this.owner(owner);if(!this.repository.readCurrentSnapshot)fail(503,'SUPPORT_SNAPSHOT_UNAVAILABLE','完整反馈读取尚未配置。');
  const rows=await this.repository.readCurrentSnapshot!(owner);
  if(!Array.isArray(rows)||rows.length>10000||rows.some(r=>!r||r.ownerId!==owner)||new Set(rows.map(r=>r.id)).size!==rows.length)return fail(503,'SUPPORT_SNAPSHOT_UNAVAILABLE','反馈读取无效，未返回部分数据。');
  for(const row of rows){const o=row.source?.original;if(o&&typeof o==='object'&&!Array.isArray(o)&&(o as Record<string,unknown>).marker===requirementSupportMarker&&(o as Record<string,unknown>).spaceId===this.config.spaceId&&!parsed(row,this.config.spaceId))return fail(503,'SUPPORT_SNAPSHOT_UNAVAILABLE','反馈来源或状态损坏，未返回部分数据。');}
  return rows;
 }
 async feedback(owner:string,id:string):Promise<FeedbackItem>{this.owner(owner);id=validateId(id);const row=await this.repository.get(owner,'inbox',id);if(!this.matches(row,owner,'feedback'))return missing();return this.feedbackItem(row);}
 async snapshot(owner:string){const rows=await this.rows(owner),items=rows.filter(row=>this.matches(row,owner,'feedback')).map(row=>this.feedbackItem(row)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));return{scope:'full-current-feedback-snapshot' as const,items,total:items.length,truncated:false as const};}
 async forRequirement(owner:string,id:string){this.owner(owner);id=requirementId(id);await this.requirements.get(owner,id);const data=await this.snapshot(owner);const items=data.items.filter(item=>item.references.some(r=>r.id===id));return{scope:'full-current-requirement-feedback' as const,requirementId:id,items,total:items.length,truncated:false as const};}
 async history(owner:string,id:string,limit=50){
  const current=await this.feedback(owner,id);if(!Number.isInteger(limit)||limit<1||limit>100)fail(400,'INVALID_LIMIT','读取上限为1至100。');
  const rows=await this.repository.history(owner,'inbox',id);
  if(!Array.isArray(rows)||rows.length!==Math.min(current.revision,100)||rows.some((r,i)=>!this.matches(r,owner,'feedback')||r.id!==id||r.source.id!==current.sourceId||r.revision!==current.revision-i||this.feedbackItem(r).text!==current.text||this.feedbackItem(r).title!==current.title||!equal(this.feedbackItem(r).source,current.source)))fail(503,'SUPPORT_HISTORY_UNAVAILABLE','反馈历史无效。');
  return{scope:'bounded-feedback-history' as const,items:rows.slice(0,limit).map(row=>this.feedbackItem(row)),limit,truncated:rows.length>limit||rows.length===100&&rows.at(-1)!.revision>1};
 }
 async createFeedback(owner:string,input:unknown,key:string,guard:Guard=async()=>{},transactionGuard?:(tx:Transaction)=>Promise<void>,channel:Channel='owner-web'){
  this.owner(owner);validateIdempotencyKey(key);if(!['owner-web','agent-feedback'].includes(channel))fail(400,'INVALID_FEEDBACK_SOURCE','反馈来源无效。');const raw=structuredClone(input),body=createBody(raw,this.config.spaceId),commandDigest=digest({action:'feedback-create',owner,spaceId:this.config.spaceId,channel,raw});await guard();
  const result=await this.repository.transaction(owner,key,async tx=>{
   await guard();await transactionGuard?.(tx);const prior=await tx.receipt();if(prior){if(prior.digest!==commandDigest)fail(409,'COMMAND_CONFLICT','该请求标识已用于不同内容。');const item=this.feedbackItem(prior.result.entry);if(item.revision!==1||item.state!=='inbox'||item.source.channel!==channel||!equal({title:item.title,text:item.text,sourceLabel:item.source.label},body.fields))fail(503,'SUPPORT_RECEIPT_UNAVAILABLE','反馈回执无效。');return{...structuredClone(prior.result),duplicate:true};}
   const id=randomUUID(),now=new Date().toISOString();await this.identities(tx,[id]);if(await tx.get('inbox',id))fail(409,'REVISION_CONFLICT','反馈记录已存在。');
   const draft=validateInbox({title:body.fields.title,text:body.fields.text,occurredOn:null,disposition:'pending',requirementSupport:{schema:1,type:'feedback',state:'inbox',references:[]}});
   const entry:StoredEntry={id,ownerId:owner,kind:'inbox',draft,source:{id:randomUUID(),system:'website',externalId:id,version:1,asOf:now,original:{marker:requirementSupportMarker,schema:1,spaceId:this.config.spaceId,type:'feedback',channel,input:raw}},revision:1,createdAt:now,updatedAt:now,syncState:'draft',externalStatus:null};
   await guard();await tx.write(entry,raw,true);const result:MutationResult={entry:publicEntry(entry),duplicate:false};await tx.saveReceipt({digest:commandDigest,result});return result;
  });return{entry:this.feedbackItem(result.entry),duplicate:result.duplicate};
 }
 async reviewFeedback(owner:string,id:string,input:unknown,key:string,guard:Guard=async()=>{},transactionGuard?:(tx:Transaction)=>Promise<void>){
  this.owner(owner);id=validateId(id);validateIdempotencyKey(key);const raw=structuredClone(input),body=reviewBody(raw,this.config.spaceId),commandDigest=digest({action:'feedback-review',owner,spaceId:this.config.spaceId,id,raw});await guard();
  const result=await this.repository.transaction(owner,key,async tx=>{
   await guard();await transactionGuard?.(tx);const prior=await tx.receipt();if(prior){if(prior.digest!==commandDigest)fail(409,'COMMAND_CONFLICT','该请求标识已用于不同内容。');const item=this.feedbackItem(prior.result.entry);if(item.id!==id||item.revision!==body.expectedRevision+1||item.state!==(body.action==='archive'?'archived':body.action==='link'?'linked':'converted')||body.action==='link'&&!item.references.some(r=>equal(r,body.reference))||body.action==='convert'&&item.references[0]?.id!==requirementSupportIdentity(owner,this.config.spaceId,'feedback-conversion',id))fail(503,'SUPPORT_RECEIPT_UNAVAILABLE','反馈整理回执无效。');return{...structuredClone(prior.result),duplicate:true};}
   const targetId=body.action==='convert'?requirementSupportIdentity(owner,this.config.spaceId,'feedback-conversion',id):body.action==='link'?(body.reference.id.startsWith('LO-')?requirementIdentity(owner,this.config.spaceId,body.reference.id):body.reference.id):null;
   await this.identities(tx,[id,...(targetId?[targetId]:[])]);
   for(const recordId of [...new Set([id,...(targetId?[targetId]:[])])].sort())await tx.get('inbox',recordId);
   const old=await tx.get('inbox',id);if(!this.matches(old,owner,'feedback'))return missing();
   if(old.revision!==body.expectedRevision||old.revision===2147483647)fail(409,'REVISION_CONFLICT','反馈已变化，请重新读取。');
   const current=this.feedbackItem(old);if(current.state==='archived'||body.action!=='archive'&&current.state==='converted')fail(409,'FEEDBACK_STATE_CONFLICT','此反馈状态不允许该操作。');
   let references=structuredClone(current.references),state:FeedbackMetadata['state'];
   if(body.action==='archive')state='archived';
   else if(body.action==='link'){
    if(references.length>=20||references.some(r=>r.id===body.reference.id))fail(409,'FEEDBACK_LINK_CONFLICT','关联已存在或达到上限。');
    const target=await this.requirements.getInTransaction(owner,body.reference.id,tx),pin={id:target.id,revision:target.revision,sourceId:target.sourceId,baselineBinding:target.baselineBinding};
    if(target.baselineConflict||!equal(pin,body.reference))fail(409,'REFERENCE_CONFLICT','需求版本已变化，请重新核对。');references.push(pin);state='linked';
   }else{
    if(current.references.length)fail(409,'FEEDBACK_STATE_CONFLICT','已关联反馈不能重复转为新需求，请使用已有需求。');
    const entry=await this.requirements.createInTransaction(owner,targetId!,{spaceId:this.config.spaceId,confirmed:true,fields:body.fields},tx,guard);
    references=[{id:entry.id,revision:entry.revision,sourceId:entry.source.id,baselineBinding:null}];state='converted';
   }
   const draft=validateInbox({...old.draft,disposition:state==='archived'?'no_action':'reference',requirementSupport:{schema:1,type:'feedback',state,references}}),entry={...old,draft,revision:old.revision+1,updatedAt:new Date().toISOString()};
   await guard();await tx.write(entry,raw,false);const result:MutationResult={entry:publicEntry(entry),duplicate:false};await tx.saveReceipt({digest:commandDigest,result});return result;
  });return{entry:this.feedbackItem(result.entry),duplicate:result.duplicate};
 }
 async releaseRead(owner:string,value:string):Promise<ReleaseReadState>{
  this.owner(owner);const sha=sourceSha(value),id=requirementSupportIdentity(owner,this.config.spaceId,'release-read',sha),row=await this.repository.get(owner,'inbox',id);
  if(!row)return{sourceSha:sha,seen:false,id:null,revision:null};
  if(!this.matches(row,owner,'release-read'))fail(503,'RELEASE_READ_UNAVAILABLE','版本已读状态无效。');return{sourceSha:sha,seen:true,id:row.id,revision:row.revision};
 }
 async markReleaseRead(owner:string,input:unknown,key:string,guard:Guard=async()=>{}){
  this.owner(owner);validateIdempotencyKey(key);const raw=structuredClone(input),body=object(raw,['spaceId','confirmed','sourceSha']);confirmed(body,this.config.spaceId);const sha=sourceSha(body.sourceSha),id=requirementSupportIdentity(owner,this.config.spaceId,'release-read',sha),commandDigest=digest({action:'release-read',owner,spaceId:this.config.spaceId,raw});
  const current=()=>{const observed=this.options.currentSourceSha?.();if(!observed)fail(503,'RELEASE_METADATA_UNAVAILABLE','运行版本信息暂不可用。');if(observed!==sha)fail(409,'CURRENT_RELEASE_CHANGED','当前运行版本已变化，请重新读取。');};current();await guard();
  const result=await this.repository.transaction(owner,key,async tx=>{
   await guard();current();const prior=await tx.receipt();if(prior){if(prior.digest!==commandDigest)fail(409,'COMMAND_CONFLICT','该请求标识已用于不同内容。');const meta=parsed(prior.result.entry,this.config.spaceId)?.metadata;if(meta?.type!=='release-read'||meta.sourceSha!==sha||prior.result.entry.id!==id)fail(503,'SUPPORT_RECEIPT_UNAVAILABLE','版本已读回执无效。');return{...structuredClone(prior.result),duplicate:true};}
   await this.identities(tx,[id]);const old=await tx.get('inbox',id);if(old&&!this.matches(old,owner,'release-read'))fail(503,'RELEASE_READ_UNAVAILABLE','版本偏好身份不可用。');
   if(old){const result:MutationResult={entry:publicEntry(old),duplicate:true};await guard();current();await tx.saveReceipt({digest:commandDigest,result});return result;}
   const now=new Date().toISOString(),draft=validateInbox({title:'已读版本更新',text:'',occurredOn:null,disposition:'reference',requirementSupport:{schema:1,type:'release-read',sourceSha:sha}}),entry:StoredEntry={id,ownerId:owner,kind:'inbox',draft,source:{id:randomUUID(),system:'website',externalId:id,version:1,asOf:now,original:{marker:requirementSupportMarker,schema:1,spaceId:this.config.spaceId,type:'release-read',channel:'owner-web',input:raw}},revision:1,createdAt:now,updatedAt:now,syncState:'draft',externalStatus:null};
   await guard();current();await tx.write(entry,raw,true);const result:MutationResult={entry:publicEntry(entry),duplicate:false};await tx.saveReceipt({digest:commandDigest,result});return result;
  });return{entry:{sourceSha:sha,seen:true as const,id:result.entry.id,revision:result.entry.revision},duplicate:result.duplicate};
 }
}
