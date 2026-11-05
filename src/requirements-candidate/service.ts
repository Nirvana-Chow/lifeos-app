import {createHash,randomUUID} from 'node:crypto';
import {requirements,type Requirement,type RequirementBaseline} from '../platform/requirements.ts';
import {object,PlatformError,validateId,validateIdempotencyKey,validateInbox,validateRevision,type InboxDraft} from '../platform/domain.ts';
import type {PlatformRepository,StoredEntry,PublicEntry,Transaction,MutationResult} from '../platform/contracts.ts';
import type {PersonalConfig} from '../personal-candidate/config.ts';
import {requirementId,validateBaselineBinding,validateRequirementFields,type BaselineBinding,type RequirementFields,type RequirementMetadata} from './domain.ts';
export type RequirementItem={id:string;revision:number;sourceId:string|null;fields:RequirementFields;baselineBinding:BaselineBinding|null;baselineConflict:boolean;requirement:Requirement};
export type RequirementsSnapshot={scope:'full-current-requirements-snapshot';items:RequirementItem[];total:number;truncated:false;observedAt:string;baseline:RequirementBaseline};
export type RequirementCommand={spaceId:string;confirmed:true;fields:RequirementFields;expectedRevision?:number;baselineBinding?:BaselineBinding|null};
export const requirementMarker='personal-requirement-v2';
const fail=(status:number,code:string,message:string):never=>{throw new PlatformError(status,code,message);};
const missing=():never=>fail(404,'NOT_FOUND','没有可访问的需求。');
const canonical=(v:unknown):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}':JSON.stringify(v);
const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const publicEntry=(entry:StoredEntry):PublicEntry=>{const{ownerId,...result}=structuredClone(entry);void ownerId;return result;};
export function requirementBinding(baseline:RequirementBaseline,id:string):BaselineBinding{
 const item=baseline.requirements.find(r=>r.id===id);if(!item)return missing();
 return{baselineVersion:baseline.baselineVersion,itemVersion:item.version,digest:digest(item)};
}
/** Stable UUID (v8) of the full owner/space/public-ID tuple, independent of commands or baseline upgrades. */
export function requirementIdentity(owner:string,space:string,id:string):string{
 const h=digest(['lifeos.requirement.identity.v2',owner,space,id]);return h.slice(0,8)+'-'+h.slice(8,12)+'-8'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);
}
function command(input:unknown,id:string|null,space:string):RequirementCommand{
 const v=object(input,id?['spaceId','confirmed','fields','expectedRevision','baselineBinding']:['spaceId','confirmed','fields']);
 if(v.spaceId!==space||v.confirmed!==true)return fail(403,'PERSONAL_CONFIRMATION_REQUIRED','需要核对本人空间并明确确认保存。');
 const fields=validateRequirementFields(v.fields);
 if(!id)return{spaceId:space,confirmed:true,fields};
 const expected=v.expectedRevision===0&&id.startsWith('LO-')?0:validateRevision(v.expectedRevision),binding=validateBaselineBinding(v.baselineBinding);
 if(id.startsWith('LO-')!==!!binding)return fail(400,'INVALID_BASELINE_BINDING','需要匹配公共需求或私有需求基线。');
 return{spaceId:space,confirmed:true,fields,expectedRevision:expected,baselineBinding:binding};
}
function metadata(entry:PublicEntry|StoredEntry,space:string):RequirementMetadata|null{
 try{
  if(entry.kind!=='inbox'||entry.syncState!=='draft'||entry.externalStatus!==null||entry.source.system!=='website'||entry.source.version!==1||entry.source.externalId!==entry.id)return null;
  validateId(entry.id);validateId(entry.source.id);validateRevision(entry.revision);
  const original=object(entry.source.original,['marker','spaceId','type','schema','input']);
  if(original.marker!==requirementMarker||original.spaceId!==space||original.type!=='requirement'||original.schema!==2)return null;
  const draft=validateInbox(entry.draft);if(draft.record||draft.personal||draft.disposition!=='reference'||draft.occurredOn!==null||!draft.requirement)return null;
  const meta=draft.requirement,initial=command(original.input,meta.baselineBinding?meta.id:null,space);
  if(entry.revision===1&&!same(fieldsFrom(draft),initial.fields))return null;
  if(!same(meta.baselineBinding,initial.baselineBinding??null)||initial.expectedRevision!==undefined&&initial.expectedRevision!==0||!meta.baselineBinding&&entry.id!==meta.id)return null;
  if('ownerId'in entry&&meta.baselineBinding&&entry.id!==requirementIdentity(entry.ownerId,space,meta.id))return null;
  return meta;
 }catch{return null;}
}
const fieldsFrom=(draft:InboxDraft):RequirementFields=>({title:draft.title,body:draft.text,phaseId:draft.requirement!.phaseId,priority:draft.requirement!.priority,plannedStartOn:draft.requirement!.plannedStartOn,plannedEndOn:draft.requirement!.plannedEndOn});
export class RequirementsService{
 private repository:PlatformRepository;readonly config:PersonalConfig;private baseline:()=>RequirementBaseline;
 constructor(repository:PlatformRepository,config:PersonalConfig,baseline:()=>RequirementBaseline=requirements){this.repository=repository;this.config=Object.freeze(structuredClone(config));this.baseline=baseline;}
 private owner(owner:string){if(owner!==this.config.ownerId)fail(403,'OWNER_ONLY','只允许已绑定本人身份。');if(this.config.requirementsEnabled!==true)fail(404,'REQUIREMENTS_DISABLED','需求持久化尚未开放。');}
 private matches(entry:StoredEntry|null,owner:string,id?:string):entry is StoredEntry{return !!entry&&entry.ownerId===owner&&!!metadata(entry,this.config.spaceId)&&(!id||metadata(entry,this.config.spaceId)!.id===id);}
 private project(id:string,entry:PublicEntry|null,b=this.baseline()):RequirementItem{
  const base=b.requirements.find(r=>r.id===id),meta=entry?metadata(entry,this.config.spaceId):null;
  if(entry&&!meta||!base&&!meta)return missing();
  const fields=entry?fieldsFrom(validateInbox(entry.draft)):{title:base!.title,body:base!.description,phaseId:base!.roadmap?.phaseId??b.roadmap!.phases[0].id,priority:base!.roadmap?.priority??'P2',plannedStartOn:null,plannedEndOn:null} as RequirementFields;
  const binding=meta?.baselineBinding??(base?requirementBinding(b,id):null),baselineConflict=!!meta?.baselineBinding&&(!base||!same(meta.baselineBinding,requirementBinding(b,id)));
  const record:Requirement=base?structuredClone(base):{id,version:1,title:fields.title,description:fields.body,status:'not_started',delivery:'backlog',sourceRefs:['owner-private-input'],acceptanceCriteria:['待本人补充验收条件。'],evidence:[],blockedBy:[]};
  record.title=fields.title;record.description=fields.body;
  if(record.roadmap){record.roadmap.phaseId=fields.phaseId;record.roadmap.priority=fields.priority;}
  else record.roadmap={phaseId:fields.phaseId,priority:fields.priority,implementation:'not_started',summary:'本人私有需求',nextStep:'细化并实现后验证。',issueRefs:[],prRefs:[],specTaskRefs:[]};
  return{id,revision:entry?.revision??0,sourceId:entry?.source.id??null,fields,baselineBinding:binding,baselineConflict,requirement:record};
 }
 async snapshot(owner:string):Promise<RequirementsSnapshot>{
  this.owner(owner);if(!this.repository.readCurrentSnapshot)return fail(503,'REQUIREMENTS_SNAPSHOT_UNAVAILABLE','完整需求读取尚未配置。');
  const rows=await this.repository.readCurrentSnapshot(owner);
  if(!Array.isArray(rows)||rows.length>10000||rows.some(r=>!r||r.ownerId!==owner)||new Set(rows.map(r=>r.id)).size!==rows.length)return fail(503,'REQUIREMENTS_SNAPSHOT_UNAVAILABLE','需求读取无效，未返回部分需求。');
  const b=this.baseline(),overlays=new Map<string,StoredEntry>();
  for(const row of rows){const original=row.source?.original as Record<string,unknown>|undefined;if(!this.matches(row,owner)){if(original?.marker===requirementMarker&&original.spaceId===this.config.spaceId)fail(503,'REQUIREMENTS_SNAPSHOT_UNAVAILABLE','需求来源或结构无效，未返回部分需求。');continue;}const id=metadata(row,this.config.spaceId)!.id;if(overlays.has(id))return fail(503,'REQUIREMENTS_SNAPSHOT_UNAVAILABLE','需求身份重复，未返回部分需求。');overlays.set(id,row);}
  const items=b.requirements.map(r=>{const row=overlays.get(r.id);overlays.delete(r.id);return this.project(r.id,row?publicEntry(row):null,b);});
  for(const[id,row]of overlays)items.push(this.project(id,publicEntry(row),b));
  return{scope:'full-current-requirements-snapshot',items,total:items.length,truncated:false,observedAt:new Date().toISOString(),baseline:structuredClone(b)};
 }
 async get(owner:string,id:string):Promise<RequirementItem>{this.owner(owner);id=requirementId(id);const recordId=id.startsWith('LO-')?requirementIdentity(owner,this.config.spaceId,id):id,row=await this.repository.get(owner,'inbox',recordId);if(row&&!this.matches(row,owner,id))return missing();return this.project(id,row?publicEntry(row):null);}
 async history(owner:string,id:string,limit=50){
  this.owner(owner);id=requirementId(id);if(!Number.isInteger(limit)||limit<1||limit>100)fail(400,'INVALID_LIMIT','读取上限为1至100。');
  const current=await this.get(owner,id);if(current.revision===0)return{items:[],limit,truncated:false,scope:'bounded-requirement-history' as const};
  const recordId=id.startsWith('LO-')?requirementIdentity(owner,this.config.spaceId,id):id,rows=await this.repository.history(owner,'inbox',recordId);
  if(!Array.isArray(rows)||rows.length>100||rows.some((r,i)=>!this.matches(r,owner,id)||r.id!==recordId||r.source.id!==current.sourceId||r.revision>current.revision||i>0&&rows[i-1].revision<=r.revision))fail(503,'REQUIREMENTS_HISTORY_UNAVAILABLE','需求历史无效。');
  return{items:rows.slice(0,limit).map(row=>this.project(id,publicEntry(row))),limit,truncated:rows.length>limit||rows.length===100&&rows.at(-1)!.revision>1,scope:'bounded-requirement-history' as const};
 }
 async mutate(owner:string,id:string|null,input:unknown,key:string,guard:()=>Promise<void>=async()=>{},transactionGuard?:(tx:Transaction)=>Promise<void>):Promise<{entry:RequirementItem;duplicate:boolean}>{
  this.owner(owner);if(id)id=requirementId(id);validateIdempotencyKey(key);const raw=structuredClone(input),body=command(raw,id,this.config.spaceId),commandDigest=digest({action:requirementMarker,owner,spaceId:this.config.spaceId,id,raw});await guard();
  const result=await this.repository.transaction(owner,key,async tx=>{
   await guard();await transactionGuard?.(tx);const receipt=await tx.receipt();
   if(receipt){if(receipt.digest!==commandDigest)fail(409,'COMMAND_CONFLICT','该请求标识已用于不同内容。');if(!metadata(receipt.result.entry,this.config.spaceId))return missing();return{...structuredClone(receipt.result),duplicate:true};}
   const b=this.baseline();if(!b.roadmap?.phases.some(p=>p.id===body.fields.phaseId))fail(400,'INVALID_REQUIREMENT_PHASE','需求阶段不存在。');
   if(id?.startsWith('LO-')&&!same(body.baselineBinding,requirementBinding(b,id)))fail(409,'BASELINE_CONFLICT','公共需求基线已变化，请重新核对。');
   const stableId=id??randomUUID(),recordId=stableId.startsWith('LO-')?requirementIdentity(owner,this.config.spaceId,stableId):stableId;
   if(!tx.lockRecordIdentity)fail(503,'REQUIREMENTS_IDENTITY_LOCK_UNAVAILABLE','需求身份锁尚未配置。');await tx.lockRecordIdentity!('inbox',recordId);
   const old=await tx.get('inbox',recordId);if(old&&!this.matches(old,owner,stableId))return missing();
   if(id&&((old?.revision??0)!==body.expectedRevision||old?.revision===2147483647)||!id&&old)fail(409,'REVISION_CONFLICT','需求版本已变化，请重新读取。');
   if(id&&!old&&!stableId.startsWith('LO-'))return missing();
   const oldMeta=old?metadata(old,this.config.spaceId):null;
   if(oldMeta&&!same(oldMeta.baselineBinding,body.baselineBinding??null))fail(409,'BASELINE_CONFLICT','私有修改绑定的基线已变化，请保留内容并核对。');
   const {title,body:text,...planning}=body.fields,meta:RequirementMetadata={schema:2,id:stableId,baselineBinding:body.baselineBinding??null,...planning};
   const draft=validateInbox({title,text,occurredOn:null,disposition:'reference',requirement:meta}),now=new Date().toISOString();
   const entry:StoredEntry=old?{...old,draft,revision:old.revision+1,updatedAt:now}:{id:recordId,ownerId:owner,kind:'inbox',draft,source:{id:randomUUID(),system:'website',externalId:recordId,version:1,asOf:now,original:{marker:requirementMarker,schema:2,type:'requirement',spaceId:this.config.spaceId,input:raw}},revision:1,createdAt:now,updatedAt:now,syncState:'draft',externalStatus:null};
   await guard();await tx.write(entry,raw,!old);const result:MutationResult={entry:publicEntry(entry),duplicate:false};await tx.saveReceipt({digest:commandDigest,result});return result;
  });
  return{entry:this.project(metadata(result.entry,this.config.spaceId)!.id,result.entry),duplicate:result.duplicate};
 }
}
