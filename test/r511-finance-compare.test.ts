import test from 'node:test';
import assert from 'node:assert/strict';
import {DraftService} from '../src/platform/service.ts';
import {PlatformError} from '../src/platform/domain.ts';
import type {StoredEntry} from '../src/platform/contracts.ts';
import {MemoryPort} from './helpers/platform.ts';
import {FinanceComparisonService} from '../src/finance-candidate/service.ts';
import {parseFinanceComparisonQuery,financeCalendarDays} from '../src/finance-candidate/domain.ts';
import {handleFinanceComparisonRequest} from '../src/finance-candidate/http.ts';
const owner='synthetic-finance-comparison',at='2028-03-02T00:00:00.000Z';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function entry(n:number,patch:Record<string,unknown>={}):StoredEntry{const draft={kind:'expense',amountMinor:100,currency:'CNY',occurredOn:'2028-02-29',category:null,fromAccountRef:null,toAccountRef:null,originalEntryId:null,notes:'Synthetic finance only',...patch};return{id:id(n),ownerId:owner,kind:'finance',draft:draft as StoredEntry['draft'],source:{id:id(100000+n),system:'website',externalId:id(n),version:1,asOf:at,original:structuredClone(draft)},revision:1,createdAt:at,updatedAt:at,syncState:'draft',externalStatus:null};}
const query=(extra:Record<string,string>={})=>parseFinanceComparisonQuery(new URLSearchParams({aFrom:'2028-02-01',aTo:'2028-02-29',bFrom:'2028-02-29',bTo:'2028-03-01',includeSynthetic:'true',...extra}));
function setup(rows:StoredEntry[],history:StoredEntry[]=[]){const repository=new MemoryPort();let reads=0;repository.exportSnapshot=async requested=>{assert.equal(requested,owner);reads++;return structuredClone({entries:rows,history});};repository.transaction=async()=>{throw Error('Unexpected write');};const drafts=new DraftService(repository);return{drafts,service:new FinanceComparisonService(drafts,()=>new Date(at)),reads:()=>reads};}
const uri=(suffix='')=>'https://synthetic.invalid/api/platform/finance/compare?aFrom=2028-02-01&aTo=2028-02-29&bFrom=2028-02-29&bTo=2028-03-01&includeSynthetic=true'+suffix;
test('comparison query is strict, dates remain civil and inclusive across leap/year boundaries',()=>{
 assert.equal(query().limit,20);assert.equal(financeCalendarDays('2027-12-31','2028-02-29'),61);assert.equal(financeCalendarDays('0099-12-31','0100-01-01'),2);
 for(const suffix of ['&currency=USD','&timeZone=UTC','&limit=0','&limit=51','&limit=01','&aFrom=2028-01-01'])assert.throws(()=>parseFinanceComparisonQuery(new URL(uri(suffix)).searchParams));
 for(const extra of [{aFrom:'2028-02-30'},{aFrom:'2028-03-01'},{includeSynthetic:'yes'},{aFrom:'0000-01-01'}] as Record<string,string>[])assert.throws(()=>query(extra));
});
test('default off makes no snapshot read and gives unknown coverage, not fabricated zero history',async()=>{const f=setup([entry(1)]),result=await f.service.compare(owner,query({includeSynthetic:'false'}));assert.equal(f.reads(),0);assert.equal(result.comparison,null);assert.equal(result.coverage.currentFinanceRecords,null);assert.equal(result.syntheticIncluded,false);});
test('five independent totals, refund occurrence date and overlap use only current same-owner entries',async()=>{
 const rows=[entry(1,{kind:'income',amountMinor:900}),entry(2,{amountMinor:500}),entry(3,{kind:'refund',amountMinor:700,originalEntryId:id(99)}),entry(4,{kind:'transfer',amountMinor:20,fromAccountRef:'synthetic-a',toAccountRef:'synthetic-b'}),entry(5,{kind:'repayment',amountMinor:30,fromAccountRef:'synthetic-a',toAccountRef:'synthetic-b'}),entry(6,{occurredOn:'2028-02-02',amountMinor:200}),{...entry(9),ownerId:'synthetic-other'}];
 const f=setup(rows,[entry(88,{amountMinor:90000})]),result=await f.service.compare(owner,query({limit:'2'})),c=result.comparison!;
 assert.equal(f.reads(),1);assert.equal(c.a.calendarDays,29);assert.equal(c.b.calendarDays,2);assert.equal(c.a.recordCount,6);assert.equal(c.b.recordCount,5);assert.equal(c.a.byKind.income.totalMinor,'900');assert.equal(c.a.byKind.expense.totalMinor,'700');assert.equal(c.a.byKind.refund.totalMinor,'700');assert.equal(c.a.byKind.transfer.totalMinor,'20');assert.equal(c.a.byKind.repayment.totalMinor,'30');assert.equal(c.a.netExpenseMinor,'0');assert.equal(c.b.netExpenseMinor,'-200');assert.equal(c.delta.netExpenseMinor,'-200');assert.equal(c.delta.direction,'b-minus-a');assert.deepEqual(c.overlap,{from:'2028-02-29',to:'2028-02-29',calendarDays:1,recordCount:5});assert.equal(c.a.items.length,2);assert.equal(c.a.itemsTruncated,true);assert.deepEqual(c.a.items.map(x=>x.id),[id(1),id(2)]);assert.equal(result.coverage.currentFinanceRecords,6);assert.equal(result.observedAt,at);
});
test('zero and disjoint intervals return explicit zero money and no implied real-world completeness',async()=>{const result=await setup([entry(1)]).service.compare(owner,query({aFrom:'2027-01-01',aTo:'2027-01-01',bFrom:'2029-01-01',bTo:'2029-01-01'}));assert.equal(result.comparison!.a.netExpenseMinor,'0');assert.equal(result.comparison!.a.recordedDays,0);assert.deepEqual(result.comparison!.overlap,{from:null,to:null,calendarDays:0,recordCount:0});assert.equal(result.coverage.meaning,'existing-records-only');assert.equal(result.coverage.datedRecords,1);});
test('missing dates and unsupported currencies are mutually exclusive exclusions with no content or fallback',async()=>{
 const rows=[entry(1,{occurredOn:null}),entry(2,{occurredOn:undefined}),entry(3,{occurredOn:''}),entry(4,{currency:'USD',notes:'Synthetic excluded secret'}),entry(5,{currency:'USD',occurredOn:null}),entry(6,{occurredOn:'2027-12-31'})],result=await setup(rows).service.compare(owner,query());
 assert.equal(result.coverage.currentFinanceRecords,6);assert.equal(result.coverage.unknownDateRecords,3);assert.equal(result.coverage.unsupportedCurrencyRecords,2);assert.equal(result.coverage.datedRecords,1);assert.equal(result.coverage.firstOccurredOn,'2027-12-31');assert.equal(result.comparison!.a.recordCount,0);assert.doesNotMatch(JSON.stringify(result),/Synthetic excluded secret|10000000-0000-4000-8000-000000000001/);
});
test('malformed nonempty dates, financial fields and source identity fail the entire snapshot closed',async()=>{
 const bad=[entry(1,{occurredOn:'2028-02-30'}),entry(1,{occurredOn:' '}),entry(1,{amountMinor:0}),entry(1,{amountMinor:1.1}),entry(1,{kind:'unknown'}),entry(1,{currency:'usd'}),entry(1,{unexpected:'Synthetic bad field'}),{...entry(1),source:{...entry(1).source,externalId:id(2)}},{...entry(1),source:{...entry(1).source,id:'invalid'}},{...entry(1),source:{...entry(1).source,version:2}}];
 for(const row of bad)await assert.rejects(()=>setup([row]).service.compare(owner,query()),{code:'FINANCE_COMPARISON_UNAVAILABLE'});
});
test('identical current same-ID rows deduplicate; conflicting current identity/revision fails and history never counts',async()=>{
 const one=entry(1),f=setup([one,structuredClone(one)],[one,entry(2)]);assert.equal((await f.service.compare(owner,query())).comparison!.a.recordCount,1);
 for(const conflict of [{...one,revision:2},{...one,source:{...one.source,id:id(7)}},entry(1,{amountMinor:200})])await assert.rejects(()=>setup([one,conflict]).service.compare(owner,query()),{code:'FINANCE_COMPARISON_UNAVAILABLE'});
});
test('exact BigInt totals exceed safe number range without rounding; bounded source samples retain revision pins',async()=>{
 const rows=Array.from({length:10000},(_,i)=>entry(i+1,{amountMinor:1_000_000_000_000,notes:'S'.repeat(700)})),result=await setup(rows).service.compare(owner,query({limit:'1'}));assert.equal(result.comparison!.a.byKind.expense.totalMinor,'10000000000000000');const item=result.comparison!.a.items[0];assert.equal(item.sourceId,rows[0].source.id);assert.equal(item.revision,1);assert.equal(item.kind,'finance');assert.equal(item.type,'finance');assert.equal(item.transactionKind,'expense');assert.ok(item.summary.length<=500);assert.equal(result.comparison!.a.recordCount,10000);
});
test('HTTP route is read-only strict, default off and no-store; owner postflight failure contains no amounts',async()=>{
 const f=setup([entry(1)]);assert.equal(await handleFinanceComparisonRequest(f.drafts,owner,new Request('https://synthetic.invalid/other')),null);assert.equal((await handleFinanceComparisonRequest(f.drafts,owner,new Request(uri(),{method:'POST'})))!.status,405);
 assert.equal((await handleFinanceComparisonRequest(f.drafts,owner,new Request(uri('&unknown=yes'))))!.status,400);
 const response=await handleFinanceComparisonRequest(f.drafts,owner,new Request(uri()),{assertOwner:async()=>{throw new PlatformError(401,'LOGIN_REQUIRED','Synthetic hidden error');}},()=>new Date(at));assert.equal(response!.status,401);assert.doesNotMatch(await response!.text(),/Synthetic hidden|Synthetic finance|amountMinor/);
 const good=await handleFinanceComparisonRequest(f.drafts,owner,new Request(uri()),{},()=>new Date(at));assert.equal(good!.status,200);assert.match(good!.headers.get('cache-control')!,/no-store/);
});
test('request abort and deadline settle ignored snapshot/owner waits without returning late content',async t=>{
 for(const phase of ['snapshot','owner']){const f=setup([entry(1)]),controller=new AbortController();let start!:()=>void,release!:(x:any)=>void;const begun=new Promise<void>(r=>{start=r;}),wait=new Promise<any>(r=>{release=r;});if(phase==='snapshot')f.drafts.exportSnapshot=async()=>{start();return wait;};const pending=handleFinanceComparisonRequest(f.drafts,owner,new Request(uri(),{signal:controller.signal}),{assertOwner:async()=>{if(phase==='owner'){start();await wait;}}});await begun;controller.abort();const response=await pending;assert.equal(response!.status,499);release({entries:[],history:[]});await new Promise<void>(r=>setImmediate(r));}
 const f=setup([entry(1)]),deadline=new AbortController();t.mock.method(AbortSignal,'timeout',()=>deadline.signal);f.drafts.exportSnapshot=async()=>new Promise(()=>{});const pending=handleFinanceComparisonRequest(f.drafts,owner,new Request(uri()));deadline.abort(new DOMException('Synthetic deadline','TimeoutError'));assert.equal((await pending)!.status,503);
});
