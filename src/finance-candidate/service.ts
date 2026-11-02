import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import type {DraftService} from '../platform/service.ts';
import {PlatformError,object,validateFinance,validateId,validateRevision} from '../platform/domain.ts';
import {validateCalendarDate} from '../calendar-candidate/domain.ts';
import {financeKinds,financeCalendarDays,parseFinanceComparisonQuery} from './domain.ts';
import type {FinanceComparisonItem,FinanceComparisonPeriod,FinanceComparisonQuery,FinanceComparisonResponse,FinanceKindTotals,FinanceKind} from './contracts.ts';
const unavailable=():never=>{throw new PlatformError(503,'FINANCE_COMPARISON_UNAVAILABLE','财务记录暂时无法核对，未返回部分统计。');};
const instant=z.iso.datetime().refine(value=>!value.startsWith('0000-'));
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
function checked(value:unknown){
 const row=object(value,['id','kind','draft','source','revision','createdAt','updatedAt','syncState','externalStatus','inboxId']),id=validateId(row.id),revision=validateRevision(row.revision);
 if(row.kind!=='finance'||row.syncState!=='draft'||row.externalStatus!==null)unavailable();if(row.inboxId!==undefined)validateId(row.inboxId);
 const createdAt=instant.parse(row.createdAt),updatedAt=instant.parse(row.updatedAt),source=object(row.source,['id','system','externalId','version','asOf','original']),sourceId=validateId(source.id);
 if(source.system!=='website'||validateId(source.externalId)!==id||validateRevision(source.version)>revision||!Object.hasOwn(source,'original')||source.original===undefined||Date.parse(updatedAt)<Date.parse(createdAt)||Date.parse(instant.parse(source.asOf))>Date.parse(updatedAt))unavailable();
 const raw=object(row.draft,['kind','amountMinor','currency','occurredOn','category','fromAccountRef','toAccountRef','originalEntryId','notes']);
 if(typeof raw.currency!=='string'||!/^([A-Z]{3})$/.test(raw.currency))unavailable();
 const occurredOn=raw.occurredOn===null||raw.occurredOn===undefined||raw.occurredOn===''?null:validateCalendarDate(raw.occurredOn);
 // Reuse the existing five-kind validator for all remaining fields. This local
 // placeholder is never used for grouping, coverage or output of an unknown date.
 const draft=validateFinance({...raw,currency:'CNY',occurredOn:occurredOn??'2000-01-01'});
 return{id,revision,sourceId,occurredOn,supported:raw.currency==='CNY',draft};
}
export class FinanceComparisonService{
 private drafts:DraftService;private now:()=>Date;
 constructor(drafts:DraftService,now:()=>Date=()=>new Date()){this.drafts=drafts;this.now=now;}
 async compare(owner:string,input:FinanceComparisonQuery):Promise<FinanceComparisonResponse>{
  const query=parseFinanceComparisonQuery(new URLSearchParams(Object.entries(input).map(([key,value])=>[key,String(value)])));
  try{
   const observedAt=this.now().toISOString();instant.parse(observedAt);
   const result:FinanceComparisonResponse={query,observedAt,dataStatus:'isolated-test-drafts',syntheticIncluded:query.includeSynthetic,comparison:null,coverage:{currentFinanceRecords:null,datedRecords:null,unknownDateRecords:null,unsupportedCurrencyRecords:null,firstOccurredOn:null,lastOccurredOn:null,snapshot:'single-owner-snapshot',summaryScope:'all-current-snapshot-records',meaning:'existing-records-only'}};
   if(!query.includeSynthetic)return result;
   const snapshot=await this.drafts.exportSnapshot(owner);if(!Array.isArray(snapshot.entries))unavailable();
   const rows=new Map<string,unknown>(),items:FinanceComparisonItem[]=[];let unknown=0,unsupported=0;
   for(const entry of snapshot.entries){if(entry.kind!=='finance')continue;const row=checked(entry),prior=rows.get(row.id);if(prior!==undefined){if(!isDeepStrictEqual(prior,entry))unavailable();continue;}rows.set(row.id,entry);
    if(!row.supported){unsupported++;continue;}if(row.occurredOn===null){unknown++;continue;}
    items.push({id:row.id,kind:'finance',type:'finance',transactionKind:row.draft.kind,sourceId:row.sourceId,revision:row.revision,occurredOn:row.occurredOn,amountMinor:row.draft.amountMinor,currency:'CNY',summary:row.draft.notes.slice(0,500)});
   }
   items.sort((a,b)=>compare(b.occurredOn,a.occurredOn)||compare(a.id,b.id));
   const period=(from:string,to:string):FinanceComparisonPeriod=>{
    const matched=items.filter(item=>item.occurredOn>=from&&item.occurredOn<=to),byKind={} as FinanceKindTotals;
    for(const kind of financeKinds){const selected=matched.filter(item=>item.transactionKind===kind);byKind[kind]={count:selected.length,totalMinor:selected.reduce((sum,item)=>sum+BigInt(item.amountMinor),0n).toString()};}
    return{from,to,calendarDays:financeCalendarDays(from,to),recordCount:matched.length,recordedDays:new Set(matched.map(item=>item.occurredOn)).size,byKind,netExpenseMinor:(BigInt(byKind.expense.totalMinor)-BigInt(byKind.refund.totalMinor)).toString(),items:matched.slice(0,query.limit),itemsTruncated:matched.length>query.limit};
   };
   const a=period(query.aFrom,query.aTo),b=period(query.bFrom,query.bTo),from=query.aFrom>query.bFrom?query.aFrom:query.bFrom,to=query.aTo<query.bTo?query.aTo:query.bTo,overlaps=from<=to,byKindMinor={} as Record<FinanceKind,string>;
   for(const kind of financeKinds)byKindMinor[kind]=(BigInt(b.byKind[kind].totalMinor)-BigInt(a.byKind[kind].totalMinor)).toString();
   result.comparison={currency:'CNY',a,b,overlap:{from:overlaps?from:null,to:overlaps?to:null,calendarDays:overlaps?financeCalendarDays(from,to):0,recordCount:overlaps?items.filter(item=>item.occurredOn>=from&&item.occurredOn<=to).length:0},delta:{direction:'b-minus-a',byKindMinor,netExpenseMinor:(BigInt(b.netExpenseMinor)-BigInt(a.netExpenseMinor)).toString()}};
   result.coverage={...result.coverage,currentFinanceRecords:rows.size,datedRecords:items.length,unknownDateRecords:unknown,unsupportedCurrencyRecords:unsupported,firstOccurredOn:items.at(-1)?.occurredOn??null,lastOccurredOn:items[0]?.occurredOn??null};
   // observedAt is a response observation marker, not an assertion of live freshness.
   result.observedAt=this.now().toISOString();instant.parse(result.observedAt);return result;
  }catch{return unavailable();}
 }
}
