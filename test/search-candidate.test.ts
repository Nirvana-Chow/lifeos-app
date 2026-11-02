import test from 'node:test';
import assert from 'node:assert/strict';
import {DraftService} from '../src/platform/service.ts';
import {CalendarService} from '../src/calendar-candidate/service.ts';
import {MemoryPort} from './helpers/platform.ts';
import {CalendarMemoryPort,calendarInput} from './calendar-candidate-helpers.test.ts';
import {SearchService,parseSearchQuery} from '../src/search-candidate/service.ts';
import {handleSearchRequest} from '../src/search-candidate/http.ts';
const failure=(code:string)=>(error:unknown)=>!!error&&typeof error==='object'&&'code' in error&&error.code===code;
function fixture(){const repository=new MemoryPort(),drafts=new DraftService(repository),calendarRepository=new CalendarMemoryPort(),calendar=new CalendarService(calendarRepository);return{repository,drafts,calendarRepository,calendar,search:new SearchService(drafts,calendar)};}
const query=(q='',extra:Record<string,string>={})=>parseSearchQuery(new URLSearchParams({q,includeSynthetic:'true',...extra}));
test('search stays closed without explicit synthetic view and performs no reads',async()=>{
 const f=fixture();await f.drafts.mutate('a','todo',null,{title:'synthetic'},'search-create-001');const before=f.repository.reads;
 assert.deepEqual((await f.search.search('a',parseSearchQuery(new URLSearchParams()))).items,[]);assert.equal(f.repository.reads,before);
 await assert.rejects(f.search.source('a','todo',[...f.repository.rows.keys()][0],false),failure('NOT_FOUND'));assert.equal(f.repository.reads,before);
});
test('query rejects injected owner, unknown/duplicate fields, invalid ranges and unbounded requests',()=>{
 for(const raw of ['ownerId=b','q=a&q=b','from=2026-02-30','from=2026-10-24&to=2026-10-23','from=0000-01-01','includeSynthetic=1','limit=101','limit=1.5','type=../secret','q='+encodeURIComponent('x'.repeat(201))])assert.throws(()=>parseSearchQuery(new URLSearchParams(raw)));
 assert.equal(parseSearchQuery(new URLSearchParams('q=%20MiXeD%20&from=2024-02-29&limit=1')).q,'MiXeD');
});
test('search matches current/original business text, source IDs, type and year without credentials',async()=>{
 const f=fixture(),made=await f.drafts.mutate('a','inbox',null,{title:'原始合成资料',text:'Reference Alpha',occurredOn:'2025-12-31',disposition:'reference'},'search-create-001');
 await f.drafts.mutate('a','inbox',made.entry.id,{title:'当前修订 Beta',occurredOn:'2026-01-02',expectedRevision:1},'search-update-001');
 const row=f.repository.rows.get(made.entry.id)!;row.source.original={...(row.source.original as object),apiKey:'DO-NOT-INDEX-CREDENTIAL'};
 for(const term of ['beta','ALPHA',made.entry.id,made.entry.source.id,'website','inbox','2026'])assert.equal((await f.search.search('a',query(term))).items.length,1,term);
 assert.equal((await f.search.search('a',query('DO-NOT-INDEX-CREDENTIAL'))).items.length,0);
 assert.equal((await f.search.search('a',query('alpha beta'))).items.length,1);
 const source=await f.search.source('a','inbox',made.entry.id,true);
 assert.equal(source.current.title,'当前修订 Beta');assert.equal(source.original.title,'原始合成资料');assert.equal(source.original.date,'2025-12-31');assert.equal(source.current.date,'2026-01-02');
 assert.equal(source.current.sourceId,made.entry.source.id);assert.deepEqual(source.history.map(h=>h.revision),[2,1]);assert.equal(JSON.stringify(source).includes('DO-NOT-INDEX-CREDENTIAL'),false);
});
test('malicious repositories cannot cross owner in lists, details or history',async()=>{
 const f=fixture(),own=await f.drafts.mutate('a','todo',null,{title:'shared'},'search-create-001'),other=await f.drafts.mutate('b','todo',null,{title:'shared secret'},'search-create-001');
 f.repository.history=async()=>structuredClone(f.repository.historyRows);
 assert.deepEqual((await f.search.search('a',query('shared'))).items.map(i=>i.id),[own.entry.id]);
 await assert.rejects(f.search.source('a','todo',other.entry.id,true),failure('NOT_FOUND'));
 assert.deepEqual((await f.search.source('a','todo',own.entry.id,true)).history.map(i=>i.id),[own.entry.id]);
});
test('date filtering never assigns today to missing dates and ordering is stable',async()=>{
 const f=fixture();for(const [index,date]of [null,'2026-10-20','2026-10-22','2026-10-21'].entries())await f.drafts.mutate('a','todo',null,{title:'stable '+index,dueOn:date},'search-create-00'+index);
 const all=await f.search.search('a',query('stable',{limit:'2'}));assert.deepEqual(all.items.map(i=>i.date),['2026-10-22','2026-10-21']);assert.equal(all.truncated,true);
 f.repository.rows=new Map([...f.repository.rows].reverse());assert.deepEqual(await f.search.search('a',query('stable',{limit:'2'})),all);
 assert.deepEqual((await f.search.search('a',query('stable',{from:'2026-10-21',to:'2026-10-21'}))).items.map(i=>i.date),['2026-10-21']);
 assert.equal((await f.search.search('a',query('stable'))).items.at(-1)?.date,null);
});
test('calendar source preserves original schedule, owner and bounded revision history',async()=>{
 const f=fixture(),first=await f.calendar.create('a',{...calendarInput,title:'Calendar synthetic'},'calendar-search-001');await f.calendar.update('a',first.entry.id,{title:'Changed calendar',expectedRevision:1},'calendar-search-002');await f.calendar.create('b',{...calendarInput,title:'Hidden calendar'},'calendar-search-001');
 assert.equal((await f.search.search('a',query('calendar',{type:'calendar'}))).items.length,1);
 const detail=await f.search.source('a','calendar',first.entry.id,true);assert.equal(detail.current.title,'Changed calendar');assert.equal(detail.original.title,'Calendar synthetic');assert.equal(detail.current.sourceId,first.entry.source.id);assert.deepEqual(detail.history.map(h=>h.revision),[2,1]);
 assert.equal((await f.search.search('b',query(first.entry.id))).items.length,0);
});
test('HTTP handler is read-only, rejects owner injection, safely bounds errors, and leaves unrelated routes alone',async()=>{
 const f=fixture();const request=(suffix:string,method='GET')=>{const req=new Request('http://candidate.test/api/platform/search'+suffix,{method,...(method==='POST'?{body:JSON.stringify({ownerId:'b'})}:{})});return handleSearchRequest(f.drafts,f.calendar,'a',req);};
 assert.equal((await request('','POST'))?.status,405);assert.equal((await request('?ownerId=b'))?.status,400);
 const good=await request('?q=anything');assert.equal(good?.headers.get('cache-control'),'private, no-store');assert.deepEqual((await good!.json()).items,[]);
 f.repository.fail=true;f.repository.exportSnapshot=async()=>{throw Error('fixture-private snapshot unavailable');};const failed=await request('?q=x&includeSynthetic=true');assert.equal(failed?.status,503);assert.equal((await failed!.text()).includes('fixture-private'),false);
 assert.equal(await handleSearchRequest(f.drafts,f.calendar,'a',new Request('http://candidate.test/api/platform/else')),null);
});
test('scan cap is deterministic and disclosed, while date/type restrictions are applied before it',async()=>{
 const f=fixture(),base=(await f.drafts.mutate('a','todo',null,{title:'newer synthetic',dueOn:'2026-10-22'},'search-create-001')).entry,template=f.repository.rows.get(base.id)!;f.repository.rows.clear();
 for(let index=1;index<=2001;index++){const id='10000000-0000-4000-8000-'+String(index).padStart(12,'0');f.repository.rows.set(id,{...structuredClone(template),id,source:{...structuredClone(template.source),externalId:id}});}
 const old=await f.drafts.mutate('a','inbox',null,{title:'older reference',text:'range witness',occurredOn:'2025-12-31'},'search-create-002');
 const limited=await f.search.search('a',query('older'));assert.equal(limited.scanned,2000);assert.equal(limited.coverage.scanTruncated,true);assert.equal(limited.truncated,true);assert.equal(limited.items.length,0);
 assert.deepEqual((await f.search.search('a',query('older',{to:'2025-12-31'}))).items.map(i=>i.id),[old.entry.id]);
 assert.deepEqual((await f.search.search('a',query('older',{type:'inbox'}))).items.map(i=>i.id),[old.entry.id]);
});
test('project evidence and captured original text stay searchable with source dates and complete body',async()=>{
 const f=fixture(),project=await f.drafts.mutateRecord('a','project',null,{title:'合成项目',text:'项目正文',occurredOn:'2026-10-10',record:{type:'project',syntheticOnly:true,stage:'active',nextStep:'复核 alpha',completion:{selfReported:true,status:'complete',evidence:'交付说明'},testing:{manuallyRecorded:true,outcome:'passed',evidence:'手动合成测试'},review:{decision:'pending',evidence:null}},confirmed:true,syntheticOnly:true},'search-project-001');
 assert.equal((await f.search.search('a',query('手动合成测试',{type:'project'}))).items[0]?.id,project.entry.id);const detail=await f.search.source('a','inbox',project.entry.id,true);assert.equal(detail.current.type,'project');assert.equal(detail.current.fields.find(f=>f.label==='手动测试记录 · 结果')?.value,'passed');
 const inputText='【虚构】口述原始资料 '+ '全文'.repeat(1000),journal=await f.drafts.captureConfirmed('a',{text:inputText,kind:'life',timeZone:'UTC',adapter:'manual',fields:{title:'人工核对日志',body:'整理后的正文',date:null},confirmed:true,singleItem:true,syntheticOnly:true},'search-journal-001');
 assert.equal((await f.search.search('a',query('口述原始资料',{type:'journal'}))).items[0]?.id,journal.entry.id);const original=(await f.search.source('a','inbox',journal.entry.id,true)).original;assert.equal(original.date,null);assert.equal(original.fields.find(f=>f.label==='原始输入全文')?.value,inputText);
});
test('history is bounded and calendar date uses its declared local time zone',async()=>{
 const f=fixture(),first=await f.drafts.mutate('a','todo',null,{title:'bounded history'},'search-create-001');const template=f.repository.rows.get(first.entry.id)!;
 f.repository.historyRows=Array.from({length:25},(_,index)=>({...structuredClone(template),revision:index+1}));f.repository.rows.set(first.entry.id,{...template,revision:25});
 const detail=await f.search.source('a','todo',first.entry.id,true);assert.equal(detail.history.length,20);assert.equal(detail.historyTruncated,true);assert.equal(detail.history[0].revision,25);assert.equal(detail.history.at(-1)?.revision,6);
 const calendar=await f.calendar.create('a',{title:'timezone synthetic',notes:'',schedule:{kind:'timed',startAt:'2026-10-22T23:30:00Z',endAt:'2026-10-23T01:00:00Z',timeZone:'Asia/Shanghai'}},'search-calendar-01');
 const result=await f.search.search('a',query('timezone',{from:'2026-10-23',to:'2026-10-23'}));assert.equal(result.items[0]?.id,calendar.entry.id);assert.equal(result.items[0]?.date,'2026-10-23');
});
