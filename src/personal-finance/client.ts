import {object,validateFinance,validateId,validateIdempotencyKey,validateRevision} from '../platform/domain.ts';
import type {FinanceBinding,FinanceSnapshot,PersonalFinanceEntry,PersonalFinanceStatus} from './contracts.ts';
import {summarizeFinance,validatePersonalFinanceEntry} from './domain.ts';

export type FinanceRecoveryStore=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type PersonalFinanceCommand={binding:FinanceBinding;key:string;path:string;method:'POST'|'PATCH';sourceId:string|null;body:{spaceId:string;confirmed:true;fields:ReturnType<typeof validateFinance>;expectedRevision?:number}};
export class PersonalFinanceClientError extends Error{status:number;uncertain:boolean;constructor(message:string,status=0,uncertain=false){super(message);this.status=status;this.uncertain=uncertain;}}
const api='/api/platform/personal/finance';
const rec=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
const canonical=(v:unknown):string=>v&&typeof v==='object'?Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b,'en')).map(([key,value])=>JSON.stringify(key)+':'+canonical(value)).join(',')+'}':JSON.stringify(v);
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function binding(value:unknown):FinanceBinding{const v=object(value,['ownerId','spaceId']);if(typeof v.ownerId!=='string'||!v.ownerId||v.ownerId.length>256||typeof v.spaceId!=='string'||!v.spaceId||v.spaceId.length>256)throw new PersonalFinanceClientError('无法确认当前财务空间。');return{ownerId:v.ownerId,spaceId:v.spaceId};}
async function json(fetcher:typeof fetch,path:string,init:RequestInit={}):Promise<any>{
 let response:Response;
 try{response=await fetcher(path,{...init,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'content-type':'application/json',...Object.fromEntries(new Headers(init.headers))}});}catch{throw new PersonalFinanceClientError(init.method?'保存结果尚未确认，请重试原请求。':'财务读取失败。',0,!!init.method);}
 if(!response.ok){let message='财务操作未完成，请保留输入。',definite=false;try{const body=rec(await response.json());if(typeof body.error?.message==='string'&&body.error.message.length<=500)message=body.error.message;definite=typeof body.error?.code==='string'&&['REVISION_CONFLICT','REVISION_LIMIT','NOT_FOUND','OWNER_ONLY','OWNER_SESSION_REQUIRED','LOGIN_REQUIRED','ACCOUNT_NOT_ALLOWED','ORIGIN_DENIED','PERSONAL_CONFIRMATION_REQUIRED','FINANCE_READ_ONLY','INVALID_AMOUNT','INVALID_DATE','INVALID_TEXT','INVALID_KIND','INVALID_BODY','UNKNOWN_FIELD','INVALID_ACCOUNT_REFERENCE','ACCOUNT_LINK_REQUIRED','DISTINCT_ACCOUNTS_REQUIRED','REFUND_LINK_REQUIRED','INVALID_REFUND_SOURCE','LINKED_REFUNDS','UNSUPPORTED_CURRENCY','UNEXPECTED_REFUND_LINK','INVALID_ID','INVALID_REVISION','INVALID_COMMAND_KEY','METHOD_NOT_ALLOWED'].includes(body.error.code)&&[400,401,403,404,405,409].includes(response.status);}catch{}throw new PersonalFinanceClientError(message,response.status,!!init.method&&!definite);}
 if(response.status!==200&&!(init.method==='POST'&&response.status===201))throw new PersonalFinanceClientError('财务响应状态未通过核对。',response.status,!!init.method);
 try{return await response.json();}catch{throw new PersonalFinanceClientError('财务响应未通过核对。',response.status,!!init.method);}
}
export async function readPersonalFinanceStatus(fetcher:typeof fetch):Promise<PersonalFinanceStatus>{
 const value=rec(await json(fetcher,api+'/status'));
 if(value.scope!=='personal-finance-v1'||typeof value.configured!=='boolean'||typeof value.writable!=='boolean')throw new PersonalFinanceClientError('无法核对财务模块状态。');
 if(!value.configured){if(value.writable)throw new PersonalFinanceClientError('财务状态不一致。');return{scope:'personal-finance-v1',configured:false,writable:false,reason:typeof value.reason==='string'?value.reason:'财务记录尚未开放。'};}
 if(value.source!=='manual-entry'||value.authority!=='manual-records-only'||value.accountBalances!=='unknown')throw new PersonalFinanceClientError('财务来源状态未通过核对。');
 return{scope:'personal-finance-v1',configured:true,writable:value.writable,...binding({ownerId:value.ownerId,spaceId:value.spaceId}),source:'manual-entry',authority:'manual-records-only',accountBalances:'unknown'};
}
function assertBinding(status:PersonalFinanceStatus,expected:FinanceBinding){if(!status.configured||!same({ownerId:status.ownerId,spaceId:status.spaceId},expected))throw new PersonalFinanceClientError('私人空间已变化，原财务请求没有在新空间执行。',403);}
export function freezePersonalFinanceCommand(owner:FinanceBinding,fields:unknown,entry:PersonalFinanceEntry|null,key:string):PersonalFinanceCommand{
 const scope=binding(owner);validateIdempotencyKey(key);
 if(entry){validateId(entry.id);validateRevision(entry.revision);validateId(entry.source.id);if(entry.spaceId!==scope.spaceId)throw new PersonalFinanceClientError('记录不属于当前财务空间。');}
 return freeze({binding:scope,key,path:api+(entry?'/'+entry.id:''),method:entry?'PATCH':'POST',sourceId:entry?entry.source.id:null,body:{spaceId:scope.spaceId,confirmed:true,fields:validateFinance(fields),...(entry?{expectedRevision:entry.revision}:{})}});
}
const storageKey=(owner:FinanceBinding)=>'lifeos.personal.finance.pending.v1:'+JSON.stringify(binding(owner));
function decodeCommand(raw:string,owner:FinanceBinding):PersonalFinanceCommand{
 if(raw.length>131072)throw new PersonalFinanceClientError('原财务请求过大。');
 const value=object(JSON.parse(raw),['binding','key','path','method','sourceId','body']),body=object(value.body,['spaceId','confirmed','fields','expectedRevision']);
 if(!same(value.binding,owner)||body.spaceId!==owner.spaceId||body.confirmed!==true||typeof value.path!=='string'||value.path!==api&&!new RegExp('^'+api+'/[a-f0-9-]{36}$','i').test(value.path))throw new PersonalFinanceClientError('原财务请求与当前空间不一致。');
 const entry=value.path===api?null:{id:validateId(value.path.slice(api.length+1)),spaceId:owner.spaceId,revision:validateRevision(body.expectedRevision),source:{id:validateId(value.sourceId)}} as PersonalFinanceEntry;
 const expected=freezePersonalFinanceCommand(owner,body.fields,entry,value.key as string);if(!same(expected,value))throw new PersonalFinanceClientError('原财务请求内容已变化。');return expected;
}
type Recovery={command:PersonalFinanceCommand;phase:'prepared'|'uncertain'|'rejected'};
function readRecovery(store:FinanceRecoveryStore,owner:FinanceBinding):Recovery|null{const raw=store.getItem(storageKey(owner));if(raw===null)return null;if(raw.length>131072)throw new PersonalFinanceClientError('原财务请求过大。');const value=object(JSON.parse(raw),['command','phase']);if(!['prepared','uncertain','rejected'].includes(value.phase as string))throw new PersonalFinanceClientError('原财务请求状态无法核对。');return{command:decodeCommand(JSON.stringify(value.command),owner),phase:value.phase as Recovery['phase']};}
function writeRecovery(store:FinanceRecoveryStore,recovery:Recovery){store.setItem(storageKey(recovery.command.binding),JSON.stringify(recovery));if(!same(readRecovery(store,recovery.command.binding),recovery))throw new PersonalFinanceClientError('浏览器不能保留原财务请求，尚未发送。');}
export function readPersonalFinanceCommand(store:FinanceRecoveryStore,owner:FinanceBinding):PersonalFinanceCommand|null{return readRecovery(store,owner)?.command??null;}
export function keepPersonalFinanceCommand(store:FinanceRecoveryStore,command:PersonalFinanceCommand){const decoded=decodeCommand(JSON.stringify(command),command.binding),previous=readRecovery(store,command.binding);if(previous&&!same(previous.command,decoded))throw new PersonalFinanceClientError('已有待确认财务请求，请先处理原请求。');writeRecovery(store,{command:decoded,phase:previous?.phase??'prepared'});}
function clearCommand(store:FinanceRecoveryStore,command:PersonalFinanceCommand){const previous=readPersonalFinanceCommand(store,command.binding);if(previous&&!same(previous,command))throw new PersonalFinanceClientError('待确认请求已变化，不能清除。');if(previous)store.removeItem(storageKey(command.binding));if(readPersonalFinanceCommand(store,command.binding)!==null)throw new PersonalFinanceClientError('浏览器未确认清除原财务请求。',0,true);}
export function isRejectedPersonalFinanceCommand(store:FinanceRecoveryStore,command:PersonalFinanceCommand):boolean{const recovery=readRecovery(store,command.binding);return recovery?.phase==='rejected'&&same(recovery.command,command);}
/** Only a never-unknown, definite rejection may be abandoned or replaced by an edited command. */
export function clearPersonalFinanceCommand(store:FinanceRecoveryStore,command:PersonalFinanceCommand){if(!isRejectedPersonalFinanceCommand(store,command))throw new PersonalFinanceClientError('保存结果仍待确认，只能重试原请求。',0,true);clearCommand(store,command);}
export async function readPersonalFinanceRecord(fetcher:typeof fetch,owner:FinanceBinding,id:string):Promise<PersonalFinanceEntry>{id=validateId(id);const value=rec(await json(fetcher,api+'/'+id)),entry=validatePersonalFinanceEntry(value.entry,owner.spaceId);if(entry.id!==id)throw new PersonalFinanceClientError('财务详情身份未通过核对。');return entry;}
export async function readPersonalFinanceSnapshot(fetcher:typeof fetch,owner:FinanceBinding):Promise<FinanceSnapshot>{
 const value=rec(await json(fetcher,api+'/snapshot'));
 if(value.scope!=='personal-finance-snapshot-v1'||value.spaceId!==owner.spaceId||!Array.isArray(value.entries)||value.entries.length>10000||value.total!==value.entries.length||typeof value.observedAt!=='string'||!Number.isFinite(Date.parse(value.observedAt)))throw new PersonalFinanceClientError('财务快照未完整读回，未展示部分统计。');
 const entries=value.entries.map((entry:unknown)=>validatePersonalFinanceEntry(entry,owner.spaceId));
 if(new Set(entries.map(entry=>entry.id)).size!==entries.length)throw new PersonalFinanceClientError('财务快照身份重复。');
 const summary=summarizeFinance(entries),dates=entries.map(entry=>entry.fields.occurredOn).sort();
 const coverage={meaning:'recorded-manual-transactions-only' as const,source:'manual-entry' as const,recordCount:entries.length,firstOccurredOn:dates[0]??null,lastOccurredOn:dates.at(-1)??null,externalLedgerConnected:false as const,accountBalances:'unknown' as const};
 const references=new Set<string>(),categories=new Set<string>();for(const entry of entries){if(entry.fields.fromAccountRef)references.add(entry.fields.fromAccountRef);if(entry.fields.toAccountRef)references.add(entry.fields.toAccountRef);if(entry.fields.category)categories.add(entry.fields.category);}
 const accounts=[...references].sort().map(reference=>({reference,balanceMinor:null}));
 if(!same(value.summary,summary)||!same(value.coverage,coverage)||!same(value.accounts,accounts)||!same(value.categories,[...categories].sort()))throw new PersonalFinanceClientError('财务统计与原始记录不一致，未展示汇总。');
 return{scope:'personal-finance-snapshot-v1',spaceId:owner.spaceId,entries,total:entries.length,observedAt:value.observedAt,summary,coverage,accounts,categories:[...categories].sort()};
}
export async function readPersonalFinanceHistory(fetcher:typeof fetch,owner:FinanceBinding,id:string){
 validateId(id);const value=rec(await json(fetcher,api+'/'+id+'/history'));
 if(!Array.isArray(value.entries)||value.entries.length<1||value.entries.length>100||typeof value.complete!=='boolean'||typeof value.truncated!=='boolean'||value.complete===value.truncated)throw new PersonalFinanceClientError('财务历史未通过核对。');
 const entries=value.entries.map((entry:unknown)=>validatePersonalFinanceEntry(entry,owner.spaceId)),currentRevision=validateRevision(value.currentRevision);
 if(entries.some((entry,index)=>entry.id!==id||entry.revision>currentRevision||entry.source.id!==entries[0].source.id||index>0&&entry.revision>=entries[index-1].revision)||new Set(entries.map(entry=>entry.revision)).size!==entries.length||value.complete&&(entries.length!==currentRevision||entries.some((entry,index)=>entry.revision!==currentRevision-index)))throw new PersonalFinanceClientError('财务历史不完整。');
 return{entries,currentRevision,complete:value.complete as boolean,truncated:value.truncated as boolean};
}
/** Preserve the frozen key until both receipt validation and an independent GET succeed. */
export async function sendPersonalFinanceCommand(fetcher:typeof fetch,store:FinanceRecoveryStore,command:PersonalFinanceCommand):Promise<{receipt:PersonalFinanceEntry;current:PersonalFinanceEntry}>{
 keepPersonalFinanceCommand(store,command);const wasUncertain=readRecovery(store,command.binding)?.phase==='uncertain';let accepted=false,attempted=false;
 try{
  const status=await readPersonalFinanceStatus(fetcher);assertBinding(status,command.binding);if(!status.writable)throw new PersonalFinanceClientError('当前不能保存财务记录，原请求已保留。',403);
  // Persist uncertainty before dispatch: a closed tab cannot turn a possible commit into a rejected write.
  writeRecovery(store,{command,phase:'uncertain'});attempted=true;
  const value=rec(await json(fetcher,command.path,{method:command.method,headers:{'idempotency-key':command.key},body:JSON.stringify(command.body)}));accepted=true;
  const receipt=validatePersonalFinanceEntry(value.entry,command.binding.spaceId),expected=command.body.expectedRevision??0;
  if(typeof value.duplicate!=='boolean'||receipt.revision!==expected+1||command.method==='PATCH'&&receipt.id!==command.path.slice(api.length+1)||command.sourceId&&receipt.source.id!==command.sourceId||command.method==='POST'&&!same(rec(receipt.source.original).fields,command.body.fields)||!same(receipt.fields,command.body.fields))throw new PersonalFinanceClientError('写入回执与原财务请求不一致。',0,true);
  const current=await readPersonalFinanceRecord(fetcher,command.binding,receipt.id);
  if(current.revision<receipt.revision||!same(current.source,receipt.source)||current.createdAt!==receipt.createdAt||current.revision===receipt.revision&&!same(current.fields,receipt.fields))throw new PersonalFinanceClientError('保存后的财务版本未完整读回。',0,true);
  assertBinding(await readPersonalFinanceStatus(fetcher),command.binding);clearCommand(store,command);return{receipt,current};
 }catch(error){const uncertain=wasUncertain||accepted||error instanceof PersonalFinanceClientError&&error.uncertain||attempted&&!(error instanceof PersonalFinanceClientError);if(!uncertain&&(attempted||error instanceof PersonalFinanceClientError&&error.status>=400&&error.status<500))writeRecovery(store,{command,phase:'rejected'});if(uncertain)throw new PersonalFinanceClientError(error instanceof Error?error.message:'保存仍待确认。',error instanceof PersonalFinanceClientError?error.status:0,true);throw error;}
}
