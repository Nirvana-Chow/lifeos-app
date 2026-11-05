import {object,PlatformError,validateFinance,validateId,validateRevision} from '../platform/domain.ts';
import type {FinanceDraft} from '../platform/domain.ts';
import type {StoredEntry,PublicEntry} from '../platform/contracts.ts';
import type {FinanceSummary,PersonalFinanceEntry} from './contracts.ts';

export const personalFinanceMarker='personal-finance-manual-v1';
export const financeKindLabels:Record<FinanceDraft['kind'],string>={expense:'支出',income:'收入',refund:'退款',transfer:'转账',repayment:'还款'};
const record=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const unavailable=()=>new PlatformError(503,'FINANCE_RECORD_UNAVAILABLE','财务记录未通过来源与版本核对，未返回部分内容。');
const instant=(v:unknown):string=>{if(typeof v!=='string'||v.startsWith('0000-')||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,19)!==v.slice(0,19))throw unavailable();return v;};

/** A candidate record without this explicit manual source never becomes private finance. */
export function claimsPersonalFinance(value:unknown,spaceId:string):boolean{
 const row=record(value),source=record(row?.source),original=record(source?.original);
 return row?.kind==='finance'&&original?.marker===personalFinanceMarker&&original.spaceId===spaceId;
}
export function readPersonalFinanceEntry(value:StoredEntry|PublicEntry,spaceId:string):PersonalFinanceEntry{
 try{
  if(!claimsPersonalFinance(value,spaceId)||value.syncState!=='draft'||value.externalStatus!==null||value.inboxId!==undefined)throw unavailable();
  const id=validateId(value.id),revision=validateRevision(value.revision),source=value.source;object(source,['id','system','externalId','version','asOf','original']);const original=object(source.original,['marker','spaceId','fields']);
  if(source.system!=='website'||source.externalId!==id||source.version!==1||original.marker!==personalFinanceMarker||original.spaceId!==spaceId)throw unavailable();
  const fields=validateFinance(value.draft);validateFinance(original.fields);
  const createdAt=instant(value.createdAt),updatedAt=instant(value.updatedAt);instant(source.asOf);validateId(source.id);
  if(Date.parse(updatedAt)<Date.parse(createdAt)||Date.parse(source.asOf)>Date.parse(updatedAt))throw unavailable();
  return{id,type:'finance',spaceId,fields,source:structuredClone(source),revision,createdAt,updatedAt};
 }catch{throw unavailable();}
}
export function validatePersonalFinanceEntry(value:unknown,spaceId:string):PersonalFinanceEntry{
 try{
  const row=object(value,['id','type','spaceId','fields','source','revision','createdAt','updatedAt']);
  if(row.type!=='finance'||row.spaceId!==spaceId)throw unavailable();
  return readPersonalFinanceEntry({...row,kind:'finance',draft:row.fields,syncState:'draft',externalStatus:null} as unknown as PublicEntry,spaceId);
 }catch{throw unavailable();}
}
/** Convert a decimal string exactly. No floating multiplication or implicit rounding. */
export function financeAmountMinor(value:string):number{
 if(typeof value!=='string'||!/^\d{1,11}(?:\.\d{1,2})?$/.test(value))throw new PlatformError(400,'INVALID_AMOUNT','金额请填写正数，最多两位小数。');
 const [whole,fraction='']=value.split('.'),minor=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 if(minor<1n||minor>1_000_000_000_000n)throw new PlatformError(400,'INVALID_AMOUNT','金额超出可保存范围。');
 return Number(minor);
}
export function formatFinanceAmount(minor:number|string):string{
 const value=BigInt(minor),absolute=value<0n?-value:value;
 return`${value<0n?'-':''}${absolute/100n}.${String(absolute%100n).padStart(2,'0')}`;
}
export function summarizeFinance(entries:readonly PersonalFinanceEntry[]):FinanceSummary{
 const kinds=['expense','income','refund','transfer','repayment'] as const;
 const byKind=Object.fromEntries(kinds.map(kind=>{const rows=entries.filter(entry=>entry.fields.kind===kind);return[kind,{count:rows.length,totalMinor:rows.reduce((sum,row)=>sum+BigInt(row.fields.amountMinor),0n).toString()}];})) as FinanceSummary['byKind'];
 const netExpense=BigInt(byKind.expense.totalMinor)-BigInt(byKind.refund.totalMinor);
 return{currency:'CNY',byKind,netExpenseMinor:netExpense.toString(),netRecordedIncomeMinor:(BigInt(byKind.income.totalMinor)-netExpense).toString(),accountBalanceMinor:null};
}
