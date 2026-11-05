import {DraftService} from '../platform/service.ts';
import {object,PlatformError,validateFinance,validateId,validateIdempotencyKey,validateRevision} from '../platform/domain.ts';
import type {PlatformRepository} from '../platform/contracts.ts';
import type {FinanceMutationContext,FinanceSnapshot,PersonalFinanceConfig,PersonalFinanceResult,PersonalFinanceStatus} from './contracts.ts';
import {claimsPersonalFinance,readPersonalFinanceEntry,summarizeFinance} from './domain.ts';
import {personalFinanceRepository} from './repository.ts';

export class PersonalFinanceService{
 readonly config:Readonly<Required<PersonalFinanceConfig>>;
 private repository:PlatformRepository;private now:()=>string;
 constructor(repository:PlatformRepository,config:PersonalFinanceConfig,now=()=>new Date().toISOString()){
  if(!config.ownerId||config.ownerId.length>256||!config.spaceId||config.spaceId.length>256)throw Error('Explicit finance owner and space required');
  this.repository=repository;this.now=now;this.config=Object.freeze({...config,enabled:config.enabled===true,writable:config.enabled===true&&config.writable===true});
 }
 private authorize(owner:string,write=false){
  if(owner!==this.config.ownerId)throw new PlatformError(403,'OWNER_ONLY','只允许已绑定本人身份。');
  if(!this.config.enabled)throw new PlatformError(503,'FINANCE_UNAVAILABLE','财务真实记录尚未开放，未确认保存。');
  if(write&&!this.config.writable)throw new PlatformError(403,'FINANCE_READ_ONLY','当前财务记录仅可读取。');
 }
 status(owner:string):PersonalFinanceStatus{
  if(owner!==this.config.ownerId)throw new PlatformError(403,'OWNER_ONLY','只允许已绑定本人身份。');
  if(!this.config.enabled)return{scope:'personal-finance-v1',configured:false,writable:false,reason:'财务共享存储与写入权限尚未开放。'};
  return{scope:'personal-finance-v1',configured:true,writable:this.config.writable,ownerId:owner,spaceId:this.config.spaceId,source:'manual-entry',authority:'manual-records-only',accountBalances:'unknown'};
 }
 async get(owner:string,id:string){this.authorize(owner);id=validateId(id);const entry=await new DraftService(personalFinanceRepository(this.repository,this.config)).get(owner,'finance',id);return readPersonalFinanceEntry(entry,this.config.spaceId);}
 async snapshot(owner:string):Promise<FinanceSnapshot>{
  this.authorize(owner);if(!this.repository.readCurrentSnapshot)throw new PlatformError(503,'FINANCE_SNAPSHOT_UNAVAILABLE','完整财务快照尚未配置，未返回部分统计。');
  const rows=await this.repository.readCurrentSnapshot(owner);
  if(!Array.isArray(rows)||rows.length>10000)throw new PlatformError(503,'FINANCE_SNAPSHOT_UNAVAILABLE','当前快照不完整，未返回部分统计。');
  const entries=rows.filter(row=>row.ownerId===owner&&claimsPersonalFinance(row,this.config.spaceId)).map(row=>readPersonalFinanceEntry(row,this.config.spaceId)).sort((a,b)=>b.fields.occurredOn.localeCompare(a.fields.occurredOn)||a.id.localeCompare(b.id));
  if(new Set(entries.map(entry=>entry.id)).size!==entries.length)throw new PlatformError(503,'FINANCE_SNAPSHOT_UNAVAILABLE','财务身份重复，未返回部分统计。');
  const dates=entries.map(entry=>entry.fields.occurredOn).sort(),references=new Set<string>(),categories=new Set<string>();
  for(const entry of entries){if(entry.fields.fromAccountRef)references.add(entry.fields.fromAccountRef);if(entry.fields.toAccountRef)references.add(entry.fields.toAccountRef);if(entry.fields.category)categories.add(entry.fields.category);}
  return{scope:'personal-finance-snapshot-v1',spaceId:this.config.spaceId,entries,total:entries.length,observedAt:this.now(),summary:summarizeFinance(entries),coverage:{meaning:'recorded-manual-transactions-only',source:'manual-entry',recordCount:entries.length,firstOccurredOn:dates[0]??null,lastOccurredOn:dates.at(-1)??null,externalLedgerConnected:false,accountBalances:'unknown'},accounts:[...references].sort().map(reference=>({reference,balanceMinor:null})),categories:[...categories].sort()};
 }
 async list(owner:string,limit=100){if(!Number.isInteger(limit)||limit<1||limit>1000)throw new PlatformError(400,'INVALID_FINANCE_LIMIT','财务读取上限需要 1 至 1000。');const snapshot=await this.snapshot(owner);return{entries:snapshot.entries.slice(0,limit),total:snapshot.total,truncated:snapshot.total>limit,observedAt:snapshot.observedAt};}
 async history(owner:string,id:string){
  const current=await this.get(owner,id),rows=await new DraftService(personalFinanceRepository(this.repository,this.config)).history(owner,'finance',id);
  const entries=rows.map(row=>readPersonalFinanceEntry(row,this.config.spaceId)).sort((a,b)=>b.revision-a.revision);
  if(!entries.length||entries.some(entry=>entry.id!==id||entry.source.id!==current.source.id||entry.revision>current.revision)||new Set(entries.map(entry=>entry.revision)).size!==entries.length)throw new PlatformError(503,'FINANCE_HISTORY_UNAVAILABLE','财务历史未完整核对。');
  const complete=entries.length===current.revision&&entries.every((entry,index)=>entry.revision===current.revision-index);
  return{entries,currentRevision:current.revision,complete,truncated:!complete};
 }
 create(owner:string,input:unknown,key:string,context:FinanceMutationContext={}){return this.mutate(owner,null,input,key,context);}
 update(owner:string,id:string,input:unknown,key:string,context:FinanceMutationContext={}){return this.mutate(owner,id,input,key,context);}
 async mutate(owner:string,id:string|null,input:unknown,key:string,context:FinanceMutationContext={}):Promise<PersonalFinanceResult>{
  this.authorize(owner,true);await context.assertActor?.();validateIdempotencyKey(key);if(id)id=validateId(id);
  const raw=object(input,['spaceId','confirmed','fields',...(id?['expectedRevision']:[])]);
  if(raw.spaceId!==this.config.spaceId||raw.confirmed!==true)throw new PlatformError(403,'PERSONAL_CONFIRMATION_REQUIRED','需要核对本人财务空间并确认保存。');
  const fields=validateFinance(raw.fields),body={...fields,...(id?{expectedRevision:validateRevision(raw.expectedRevision)}:{})};
  const receipt=await new DraftService(personalFinanceRepository(this.repository,this.config,context)).mutate(owner,'finance',id,body,key);
  return{entry:readPersonalFinanceEntry(receipt.entry,this.config.spaceId),duplicate:receipt.duplicate};
 }
}
