import {getRecipe} from '../cooking/catalog.ts';
import type {CookingRecipePin} from '../cooking/log-domain.ts';
import {RequirementsService} from '../requirements-candidate/service.ts';
import {RequirementSupportService} from '../requirement-support-candidate/service.ts';
import {lockPersonalRecords} from './personal-record-locks.ts';
import {reminderSourceDigest} from '../import-preview/reminders.ts';
import {appleOriginMarker,readAppleOrigin} from './apple-origin.ts';
import {normalizePersonalFields,personalTypes,personalReferences,type ObjectFields} from './business.ts';
import {preserveOmittedPlanning} from './planning.ts';
import {createHash,randomUUID} from 'node:crypto';
import {PlatformError,object,validateId,validateIdempotencyKey,validateRevision,validateTodo,validateInbox,type TodoDraft,type InboxDraft} from '../platform/domain.ts';
import type {PlatformRepository,StoredEntry,PublicEntry,MutationResult,Transaction} from '../platform/contracts.ts';
import {compareWindowKeys,windowKey} from '../platform/window-domain.ts';
import type {PersonalConfig,PersonalType} from './config.ts';
export type PersonalGuard=()=>Promise<void>;
export type PersonalFields=TodoDraft|ObjectFields|Pick<InboxDraft,'title'|'text'|'occurredOn'>;
export type PersonalBody={spaceId:string;confirmed:true;fields:PersonalFields;expectedRevision?:number};
export type PersonalPage={items:PublicEntry[];truncated:boolean;scanned:number;limit:number;scope:'bounded-window';total:null};
const fail=(status:number,code:string,message:string):never=>{throw new PlatformError(status,code,message);};
const missing=():never=>fail(404,'NOT_FOUND','没有可访问的本人记录。');
const canonical=(value:unknown):string=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en')).map(([key,item])=>JSON.stringify(key)+':'+canonical(item)).join(',')+'}':JSON.stringify(value);
const publicEntry=(entry:StoredEntry):PublicEntry=>{const{ownerId,...result}=structuredClone(entry);void ownerId;return result;};
function cookingRecipe(fields:PersonalFields|PublicEntry['draft']):CookingRecipePin|null {
 const personal='personal' in fields?fields.personal:undefined;
 return personal&&'type' in personal&&personal.type==='cooking'?personal.recipe:null;
}

// IDs are hashes of the decoded upstream recipe path, independent of the catalog revision.
function storedCookingPin(pin:CookingRecipePin|null):boolean {
 if(!pin)return true;
 try {
  const pathStart=pin.sourceUrl.indexOf('/dishes/');
  if(pathStart<0)return false;
  const parts=pin.sourceUrl.slice(pathStart+1).split('/').map(decodeURIComponent);
  if(parts.some(part=>!part||part==='.'||part==='..'||/[\\/\u0000-\u001f\u007f]/u.test(part)))return false;
  return createHash('sha256').update(parts.join('/')).digest('hex').slice(0,16)===pin.id;
 } catch {
  return false;
 }
}

function checkNewCookingPin(fields:PublicEntry['draft'], previous?:PublicEntry['draft']):void {
 const pin=cookingRecipe(fields);
 if(!pin)return;
 const old=previous?cookingRecipe(previous):null;
 if(old?.id===pin.id&&old.sourceUrl===pin.sourceUrl)return;
 if(getRecipe(pin.id)?.sourceUrl!==pin.sourceUrl) {
  fail(400,'INVALID_COOKING_RECIPE','请选择当前菜谱库中的固定菜谱来源。');
 }
}

const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function personalEntryType(entry:PublicEntry|StoredEntry,spaceId:string):PersonalType|null{
 const source=entry.source,original=source?.original;
 if(!obj(original)||!['personal-manual-v1',appleOriginMarker].includes(String(original.marker))||original.spaceId!==spaceId||source.system!=='website'||source.externalId!==entry.id||source.version!==1||entry.syncState!=='draft'||entry.externalStatus!==null)return null;
 if(original.marker===appleOriginMarker){try{const origin=readAppleOrigin(original,spaceId);if(reminderSourceDigest(origin.source)!==origin.sourceDigest)return null;validateTodo(entry.draft);validateId(entry.id);validateId(source.id);validateRevision(entry.revision);return entry.kind==='todo'?'todo':null;}catch{return null;}}
 if(!obj(original.input)||original.input.spaceId!==spaceId||original.input.confirmed!==true)return null;
 const type=personalTypes.includes(original.type as PersonalType)&&entry.kind===(original.type==='todo'?'todo':'inbox')?original.type as PersonalType:null;
 if(!type)return null;
 try{object(original,['marker','spaceId','type','input']);const originalFields=validatePersonalBody(type,null,original.input,spaceId).fields;validateId(entry.id);validateId(source.id);validateRevision(entry.revision);if(type==='todo')validateTodo(entry.draft);else{const draft=validateInbox(entry.draft);if(draft.record||draft.disposition!=='reference'||type==='journal'&&(!draft.text.trim()||draft.personal&&draft.personal.type!=='journal')||type!=='journal'&&draft.personal?.type!==type)return null;if(type==='cooking'&&(!draft.occurredOn||draft.occurredOn.startsWith('0000-')||!storedCookingPin(cookingRecipe(draft))||!storedCookingPin(cookingRecipe(originalFields))))return null;}return type;}catch{return null;}
}
export function validatePersonalBody(type:PersonalType,id:string|null,input:unknown,spaceId:string):PersonalBody{
 const raw=object(input,['spaceId','confirmed','fields',...(id?['expectedRevision']:[])]);
 if(raw.spaceId!==spaceId||raw.confirmed!==true)return fail(403,'PERSONAL_CONFIRMATION_REQUIRED','需要核对本人空间并明确确认保存。');
 const fields=normalizePersonalFields(type,raw.fields);
 return{spaceId,confirmed:true,fields,...(id?{expectedRevision:validateRevision(raw.expectedRevision)}:{})};
}
export class PersonalService{
 readonly config:PersonalConfig;readonly requirements:RequirementsService;readonly requirementSupport:RequirementSupportService;private repository:PlatformRepository;
 constructor(repository:PlatformRepository,config:PersonalConfig,options:{currentSourceSha?:()=>string|null}={}){this.repository=repository;this.config=Object.freeze(structuredClone(config));this.requirements=new RequirementsService(repository,this.config);this.requirementSupport=new RequirementSupportService(repository,this.config,this.requirements,options);}
 private allows(type:PersonalType){return type==='cooking'?this.config.cookingEnabled===true:type==='media'?this.config.mediaEnabled===true:type==='career'?this.config.careerEnabled===true:type==='portfolio'?this.config.portfolioEnabled===true:type==='calendar'?this.config.calendarEnabled===true:type==='health'?this.config.healthEnabled===true:type==='person'?this.config.peopleEnabled===true:this.config.allowedTypes.includes(type);}
 private enabled(type:PersonalType){if(!this.allows(type))fail(400,'PERSONAL_TYPE_DENIED','此本人记录类别未开放。');}
 private owner(owner:string){if(owner!==this.config.ownerId)fail(403,'OWNER_ONLY','只允许已绑定本人身份。');}
 private matches(entry:StoredEntry|null,owner:string,type?:PersonalType|'person',id?:string):entry is StoredEntry{return !!entry&&entry.ownerId===owner&&(!id||entry.id===id)&&!!personalEntryType(entry,this.config.spaceId)&&this.allows(personalEntryType(entry,this.config.spaceId)!)&&(!type||personalEntryType(entry,this.config.spaceId)===type);}
 async get(owner:string,type:PersonalType,id:string):Promise<PublicEntry>{this.owner(owner);this.enabled(type);id=validateId(id);const entry=await this.repository.get(owner,type==='todo'?'todo':'inbox',id);if(!this.matches(entry,owner,type,id))return missing();return publicEntry(entry);}
 private async page(owner:string,mode:'current'|'history',limit:number,type?:PersonalType,id?:string):Promise<PersonalPage>{
  this.owner(owner);if(type&&['media','career','portfolio','cooking'].includes(type))this.enabled(type);if(!Number.isInteger(limit)||limit<1||limit>100)fail(400,'INVALID_LIMIT','读取上限为1至100。');
  if(!this.repository.readWindow)return fail(503,'PERSONAL_WINDOW_UNAVAILABLE','未配置有界读取，已停止。');
  const rows=await this.repository.readWindow(owner,mode,{anchor:null,after:null},limit+1);
  if(!Array.isArray(rows)||rows.length>limit+1)return fail(503,'PERSONAL_WINDOW_UNAVAILABLE','有界存储响应无效。');
  for(let i=0;i<rows.length;i++){
   const row=rows[i],entry=row.entry;
   if(!entry||entry.ownerId!==owner||row.currentKind!==entry.kind||row.currentSourceId!==entry.source.id||row.currentRevision<entry.revision||mode==='current'&&row.currentRevision!==entry.revision||JSON.stringify(row.key)!==JSON.stringify(windowKey(mode==='current'?entry.createdAt:entry.updatedAt,entry.id,mode==='current'?0:entry.revision,mode))||i>0&&compareWindowKeys(rows[i-1].key,row.key)<=0)return fail(503,'PERSONAL_WINDOW_UNAVAILABLE','有界存储响应无效。');
  }
  const scanned=rows.slice(0,limit);return{items:scanned.filter(row=>this.matches(row.entry,owner,type,id)).map(row=>publicEntry(row.entry)),truncated:rows.length>limit,scanned:scanned.length,limit,scope:'bounded-window',total:null};
 }
 async list(owner:string,type?:PersonalType,limit=50){return this.page(owner,'current',limit,type);}
 async history(owner:string,type:PersonalType,id:string,limit=50){
  const current=await this.get(owner,type,id);if(!['calendar','journal','health','person','media','career','portfolio','cooking'].includes(type))return this.page(owner,'history',limit,type,id);
  if(!Number.isInteger(limit)||limit<1||limit>100)fail(400,'INVALID_LIMIT','读取上限为1至100。');
  const rows=await this.repository.history(owner,'inbox',id);
  if(!Array.isArray(rows)||rows.length!==Math.min(current.revision,100)||rows[0]?.revision!==current.revision||rows.some((row,index)=>!this.matches(row,owner,type,id)||row.id!==id||row.source.id!==current.source.id||row.revision>current.revision||index>0&&rows[index-1].revision!==row.revision+1))fail(503,'CALENDAR_HISTORY_UNAVAILABLE','日程历史读取无效。');
  return{items:rows.slice(0,limit).map(publicEntry),truncated:rows.length>limit||rows.length===100&&rows.at(-1)!.revision>1,scope:'bounded-record-history' as const,scanned:rows.length,limit,total:null};
 }

 async exportSnapshot(owner:string,limit=50){const [entries,history]=await Promise.all([this.page(owner,'current',limit),this.page(owner,'history',limit)]);return{format:'lifeos.personal.manual.export.v1',spaceId:this.config.spaceId,entries:entries.items,history:history.items,truncated:entries.truncated||history.truncated,windows:{entries,history},backupOrRestoreVerified:false};}
 async currentSnapshot(owner:string){this.owner(owner);if(!this.repository.readCurrentSnapshot)fail(503,'PERSONAL_SNAPSHOT_UNAVAILABLE','全量查询未配置，不能计算总数。');const rows=await this.repository.readCurrentSnapshot!(owner);if(!Array.isArray(rows)||rows.length>10000||rows.some(r=>!r||r.ownerId!==owner)||new Set(rows.map(r=>r.id)).size!==rows.length)fail(503,'PERSONAL_SNAPSHOT_UNAVAILABLE','全量查询超过安全上限或响应无效，未返回部分统计。');return rows.filter(r=>this.matches(r,owner)).map(publicEntry);}
 async overview(owner:string,today:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(today)||Number.isNaN(Date.parse(today+'T00:00:00Z'))||new Date(today+'T00:00:00Z').toISOString().slice(0,10)!==today)fail(400,'INVALID_DATE','需要有效日期。');const items=await this.currentSnapshot(owner),drafts=items.filter(e=>personalEntryType(e,this.config.spaceId)==='todo').map(e=>e.draft as TodoDraft);return{items,scope:'full-current-snapshot' as const,total:items.length,truncated:false,observedAt:new Date().toISOString(),today,counts:{open:drafts.filter(d=>d.status==='open'||d.status==='in_progress').length,done:drafts.filter(d=>d.status==='done').length,cancelled:drafts.filter(d=>d.status==='cancelled').length,overdue:drafts.filter(d=>(d.status==='open'||d.status==='in_progress')&&d.dueOn&&d.dueOn<today).length},projects:items.filter(e=>personalEntryType(e,this.config.spaceId)==='project'),domains:items.filter(e=>personalEntryType(e,this.config.spaceId)==='domain')};}
 async search(owner:string,query:string){if(typeof query!=='string'||query.length>240)fail(400,'INVALID_QUERY','搜索内容过长。');const items=await this.currentSnapshot(owner),q=query.trim().toLocaleLowerCase();return{scope:'full-current-snapshot',items:items.filter(e=>JSON.stringify(e.draft).toLocaleLowerCase().includes(q)),query};}
 async referenceStates(owner:string,id:string){this.owner(owner);const entry=await this.repository.get(owner,'todo',validateId(id));if(!this.matches(entry,owner,'todo',id))return missing();return Promise.all(personalReferences(entry.draft as TodoDraft).map(async({type,link})=>{const target=await this.repository.get(owner,'inbox',link.id),allowed=this.matches(target,owner,type,link.id)&&target.source.id===link.sourceId;return{type,link,status:!allowed?'unavailable':target!.revision===link.revision?'current':'updated',current:allowed?publicEntry(target!):null};}));}
 async mutate(owner:string,type:PersonalType,id:string|null,input:unknown,key:string,guard:PersonalGuard=async()=>{},transactionGuard?:(tx:Transaction)=>Promise<void>):Promise<MutationResult>{
  this.owner(owner);this.enabled(type);validateIdempotencyKey(key);if(id)id=validateId(id);validatePersonalBody(type,id,input,this.config.spaceId);const raw=structuredClone(input),body=validatePersonalBody(type,id,raw,this.config.spaceId),kind=type==='todo'?'todo':'inbox';
  const digest=createHash('sha256').update(canonical({action:'personal-manual-v1',owner,spaceId:this.config.spaceId,type,id,raw})).digest('hex');
  await guard();
  return this.repository.transaction(owner,key,async tx=>{
   await guard();await transactionGuard?.(tx);const receipt=await tx.receipt();
   if(receipt){if(receipt.digest!==digest)fail(409,'COMMAND_CONFLICT','该请求标识已用于不同内容。');if(!personalEntryType(receipt.result.entry,this.config.spaceId))return missing();return{...structuredClone(receipt.result),duplicate:true};}
   const now=new Date().toISOString(),draft=type==='todo'?body.fields as TodoDraft:{...body.fields,disposition:'reference'} as InboxDraft;let entry:StoredEntry;
   const references=personalReferences(draft);
   const records=await lockPersonalRecords(tx,[...(id?[{kind,id} as const]:[]),...references.map(({link})=>({kind:'inbox' as const,id:link.id}))]);
   if(id){const old=records.get(JSON.stringify([kind,id]))??null;if(!this.matches(old,owner,type,id))return missing();if(old.revision!==body.expectedRevision||old.revision===2147483647)fail(409,'REVISION_CONFLICT','记录版本已变化，请重新核对。');if(type==='cooking')checkNewCookingPin(draft,old.draft);entry={...old,draft:preserveOmittedPlanning(type,(raw as {fields:unknown}).fields,old.draft,draft),revision:old.revision+1,updatedAt:now};}
   else{if(type==='cooking')checkNewCookingPin(draft);const recordId=randomUUID();entry={id:recordId,ownerId:owner,kind,draft,source:{id:randomUUID(),system:'website',externalId:recordId,version:1,asOf:now,original:{marker:'personal-manual-v1',spaceId:this.config.spaceId,type,input:raw}},revision:1,createdAt:now,updatedAt:now,syncState:'draft',externalStatus:null};}
   for(const reference of references){
    const {type:targetType,link}=reference,target=records.get(JSON.stringify(['inbox',link.id]))??null;
    if(!this.matches(target,owner,targetType,link.id)||target.source.id!==link.sourceId||target.revision!==link.revision)fail(409,'REFERENCE_CONFLICT','关联记录已变化或不可访问，请重新核对。');
    if('expectedKinds'in reference&&reference.expectedKinds){
     const personal=target&&'personal'in target.draft?target.draft.personal:undefined,subtype=personal&&'type'in personal?(personal.type==='career'?personal.careerKind:personal.type==='portfolio'?personal.portfolioKind:null):null;
     if(!subtype||!(reference.expectedKinds as readonly string[]).includes(subtype))fail(409,'REFERENCE_CONFLICT','关联记录子类型不符合当前字段，请重新核对。');
    }
   }
   await guard();await tx.write(entry,raw,!id);const result={entry:publicEntry(entry),duplicate:false};await tx.saveReceipt({digest,result});return result;
  });
 }
}
