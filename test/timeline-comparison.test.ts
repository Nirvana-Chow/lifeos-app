import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformHandler} from '../src/platform/http.ts';
import {CalendarService} from '../src/calendar-candidate/service.ts';
import {MemoryPort} from './helpers/platform.ts';
import {CalendarMemoryPort} from './calendar-candidate-helpers.test.ts';
import type {StoredEntry,Principal} from '../src/platform/contracts.ts';
import type {CalendarEntry} from '../src/calendar-candidate/contracts.ts';

const owner={id:'comparison-owner',email:'comparison@example.invalid'},baseURL='http://127.0.0.1:3190';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function row(n:number,at='2027-01-02T01:00:00.000Z',patch:Partial<StoredEntry>={}):StoredEntry{
 const draft={title:'Synthetic comparison '+n,text:'Synthetic body '+n,occurredOn:null,disposition:'reference' as const};
 return{id:id(n),ownerId:owner.id,kind:'inbox',draft,source:{id:id(n+10000),system:'website',externalId:id(n),version:1,asOf:at,original:{...draft}},revision:1,createdAt:at,updatedAt:at,syncState:'draft',externalStatus:null,...patch};
}
function calendarRow(n:number,at='2027-01-02T01:00:00.000Z',patch:Partial<CalendarEntry>={}):CalendarEntry{
 const base=row(n,at),schedule={kind:'all-day' as const,startDate:'2040-12-31',endDate:'2041-01-01'};
 return{id:base.id,ownerId:owner.id,title:'Synthetic schedule '+n,notes:'Synthetic plan',schedule,status:'planned',revision:1,source:{...base.source,original:{title:'Synthetic schedule '+n,notes:'Synthetic plan',schedule}},createdAt:at,updatedAt:at,...patch};
}
function fixture(calendarEnabled=false){
 const repository=new MemoryPort(),calendarRows=new CalendarMemoryPort(),calendar=calendarEnabled?new CalendarService(calendarRows):undefined;
 let principal:Principal|null={userId:owner.id,email:owner.email};
 const handler=createPlatformHandler({legacyUnboundedReadsEnabled:true,repository,calendar,sessions:{read:async()=>principal},owner,baseURL,now:()=>new Date('2027-02-01T00:00:00.000Z')});
 return{repository,calendarRows,setPrincipal:(value:Principal|null)=>{principal=value;},async send(query='',method='GET',body?:unknown,path='/api/platform/timeline/compare'){
  const response=await handler(new Request(baseURL+path+query,{method,headers:{host:'127.0.0.1:3190',origin:baseURL,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  return{status:response.status,headers:response.headers,body:await response.json()};
 }};
}
const ranges='aFrom=2026-12-31&aTo=2027-01-02&bFrom=2027-01-02&bTo=2027-01-06';
const view='?'+ranges+'&includeSynthetic=true';

test('comparison is unread by default and uses shared owner gates before either snapshot',async()=>{
 const f=fixture(true);f.repository.exportSnapshot=async()=>{throw Error('unexpected core read');};f.calendarRows.exportSnapshot=async()=>{throw Error('unexpected calendar read');};
 const result=await f.send('?'+ranges);assert.equal(result.status,200);assert.equal(result.body.syntheticIncluded,false);assert.equal(result.body.comparison,null);assert.equal(result.body.coverage.currentRecords,null);
 assert.equal(result.body.query.limit,10);assert.equal(result.headers.get('Cache-Control'),'private, no-store');assert.equal(result.headers.get('Vary'),'Cookie');
 f.setPrincipal(null);assert.equal((await f.send(view)).status,401);f.setPrincipal({userId:'another-owner',email:owner.email});assert.equal((await f.send(view)).status,403);
});

test('inclusive unequal periods separate counts, recorded dates and denominators; overlap counts in both',async()=>{
 const f=fixture();for(const entry of [row(1,'2026-12-31T01:00:00.000Z'),row(2),row(3),row(4,'2027-01-06T01:00:00.000Z')])f.repository.rows.set(entry.id,entry);
 const result=await f.send(view+'&limit=1');assert.equal(result.status,200);
 const {a,b,overlap}=result.body.comparison;
 assert.deepEqual([a.calendarDays,a.recordCount,a.recordedDays,a.recordedDayRatio],[3,3,2,2/3]);
 assert.deepEqual([b.calendarDays,b.recordCount,b.recordedDays,b.recordedDayRatio],[5,3,2,2/5]);
 assert.deepEqual(overlap,{from:'2027-01-02',to:'2027-01-02',calendarDays:1,recordCount:2});
 assert.equal(a.items.length,1);assert.equal(a.itemsTruncated,true);assert.equal(b.items.length,1);assert.equal(b.itemsTruncated,true);
 assert.equal(a.items[0].id,id(2));assert.equal(b.items[0].id,id(4));assert.equal(result.body.coverage.currentRecords,4);
 assert.equal(result.body.coverage.summaryScope,'all-current-snapshot-records');
});

test('both periods classify recording instants in the same timezone across year boundaries',async()=>{
 const f=fixture();for(const entry of [row(1,'2026-12-31T16:00:00.000Z'),row(2,'2027-01-01T07:59:00.000Z')])f.repository.rows.set(entry.id,entry);
 const query='?aFrom=2026-12-31&aTo=2026-12-31&bFrom=2027-01-01&bTo=2027-01-01&includeSynthetic=true';
 for(const[zone,counts]of [['Asia/Shanghai',[0,2]],['UTC',[1,1]],['-08:00',[2,0]],['+08:00',[0,2]]]as const){
  const result=await f.send(query+'&timeZone='+encodeURIComponent(zone));assert.equal(result.status,200,zone);assert.deepEqual([result.body.comparison.a.recordCount,result.body.comparison.b.recordCount],counts,zone);
  for(const period of [result.body.comparison.a,result.body.comparison.b])for(const item of period.items){assert.equal(item.timeRole,'recorded');assert.equal(item.dateKind,'instant');assert.equal(item.sourceTimeZone,'UTC');}
 }
});

test('calendar day denominators include leap day and are independent of DST hours and years below 100',async()=>{
 const f=fixture();
 for(const[dates,zone,want]of [
  ['aFrom=2024-02-28&aTo=2024-03-01&bFrom=2025-02-28&bTo=2025-03-01','UTC',[3,2]],
  ['aFrom=2026-03-07&aTo=2026-03-09&bFrom=2026-10-31&bTo=2026-11-02','America/New_York',[3,3]],
  ['aFrom=0001-01-01&aTo=0001-12-31&bFrom=0099-12-31&bTo=0100-01-01','UTC',[365,2]],
 ]as const){const result=await f.send('?'+dates+'&includeSynthetic=true&timeZone='+encodeURIComponent(zone));assert.equal(result.status,200);assert.deepEqual([result.body.comparison.a.calendarDays,result.body.comparison.b.calendarDays],want);assert.equal(result.body.comparison.a.recordedDayRatio,0);}
});

test('current revision counts once by its original recording date and sources preserve original versus current',async()=>{
 const f=fixture(),initial=row(1,'2027-01-01T01:00:00.000Z'),second={...initial,revision:2,updatedAt:'2027-01-03T01:00:00.000Z',draft:{...initial.draft,title:'Synthetic corrected second'}},current={...second,revision:3,updatedAt:'2027-01-05T01:00:00.000Z',draft:{...second.draft,title:'Synthetic corrected current'}};
 f.repository.rows.set(current.id,current);f.repository.historyRows.push(initial,second,current,structuredClone(current));const frozen=JSON.stringify(f.repository.rows.get(current.id)?.source.original);
 const result=await f.send(view);assert.equal(result.status,200);const {a,b}=result.body.comparison;assert.equal(a.recordCount,1);assert.equal(b.recordCount,0);assert.deepEqual(result.body.comparison.overlap,{from:'2027-01-02',to:'2027-01-02',calendarDays:1,recordCount:0});
 assert.deepEqual([a.items[0].id,a.items[0].sourceId,a.items[0].revision,a.items[0].currentRevision,a.items[0].title,a.items[0].at,a.items[0].isHistorical],[current.id,current.source.id,3,3,'Synthetic corrected current',initial.createdAt,false]);
 const source=await f.send('?includeSynthetic=true','GET',undefined,'/api/platform/search/source/inbox/'+current.id);assert.equal(source.status,200);assert.equal(source.body.current.title,'Synthetic corrected current');assert.ok('title' in initial.draft);assert.equal(source.body.original.title,initial.draft.title);
 assert.equal(JSON.stringify(f.repository.rows.get(current.id)?.source.original),frozen);assert.equal(f.repository.events.length,0);
});

test('one owner-filtered snapshot per adapter supplies both periods without point reads or writes',async()=>{
 const f=fixture(true);for(const entry of [row(1),row(2,undefined,{ownerId:'another-owner',draft:{title:'FOREIGN_SENTINEL',text:'FOREIGN_SENTINEL',occurredOn:null,disposition:'reference'}})])f.repository.rows.set(entry.id,entry);
 for(const entry of [calendarRow(3),calendarRow(4,undefined,{ownerId:'another-owner',title:'FOREIGN_SENTINEL'})])f.calendarRows.rows.set(entry.id,entry);
 let coreReads=0,calendarReads=0;const core=f.repository.exportSnapshot.bind(f.repository),calendar=f.calendarRows.exportSnapshot.bind(f.calendarRows);
 f.repository.exportSnapshot=async owner=>{coreReads++;return core(owner);};f.calendarRows.exportSnapshot=async owner=>{calendarReads++;return calendar(owner);};
 f.repository.get=async()=>{throw Error('unexpected point read');};f.repository.list=async()=>{throw Error('unexpected list read');};
 const result=await f.send(view);assert.equal(result.status,200);assert.deepEqual([coreReads,calendarReads],[1,1]);assert.equal(result.body.coverage.currentRecords,2);assert.equal(result.body.comparison.a.recordCount,2);assert.equal(result.body.comparison.b.recordCount,2);assert.equal(result.body.coverage.snapshotConsistency,'per-adapter-snapshots');
 assert.doesNotMatch(JSON.stringify(result.body),/FOREIGN_SENTINEL|ownerId/);assert.equal(f.repository.events.length,0);assert.equal(f.repository.receipts.size,0);assert.equal(f.calendarRows.receipts.size,0);
 assert.equal(result.body.comparison.a.items.find((item:any)=>item.kind==='calendar').date,'2027-01-02');
});

test('identical current duplicate rows collapse but the same ID in different kinds remains two records',async()=>{
 const f=fixture(),entry=row(1),todo={...entry,kind:'todo' as const,draft:{title:'Synthetic task',notes:'',dueOn:null,status:'open' as const}};
 f.repository.exportSnapshot=async()=>({entries:[entry,structuredClone(entry),todo],history:[]});
 const result=await f.send(view);assert.equal(result.status,200);assert.equal(result.body.comparison.a.recordCount,2);assert.deepEqual(result.body.comparison.a.items.map((item:any)=>item.kind),['inbox','todo']);
 const identical=await f.send('?aFrom=2027-01-02&aTo=2027-01-02&bFrom=2027-01-02&bTo=2027-01-02&includeSynthetic=true');assert.equal(identical.status,200);assert.deepEqual(identical.body.comparison.a,identical.body.comparison.b);assert.equal(identical.body.comparison.overlap.recordCount,2);
});

test('conflicting current identities fail closed even when one subtype is excluded by the requested filter',async()=>{
 const f=fixture(),entry=row(1),other={...entry,draft:{title:'Synthetic resource',text:'Synthetic resource',occurredOn:null,disposition:'reference' as const,record:{type:'resource' as const,syntheticOnly:true as const,url:'https://example.invalid/synthetic',author:null}}};
 for(const entries of [[entry,other],[other,entry],[entry,{...entry,revision:2}]]){f.repository.exportSnapshot=async()=>({entries,history:[]});const result=await f.send(view+'&type=resource');assert.equal(result.status,503);assert.equal(result.body.error.code,'TIMELINE_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(result.body),/Synthetic resource/);}
});

test('type scope and nonoverlap describe existing recording coverage without treating due dates as activity',async()=>{
 const f=fixture(),resource=row(1,undefined,{draft:{title:'Synthetic resource',text:'Synthetic resource',occurredOn:'2040-01-01',disposition:'reference',record:{type:'resource',syntheticOnly:true,url:'https://example.invalid/synthetic',author:null}}}),todo=row(2,undefined,{kind:'todo',draft:{title:'Synthetic finished task',notes:'',dueOn:'2041-01-01',status:'done'}});
 f.repository.rows.set(resource.id,resource);f.repository.rows.set(todo.id,todo);
 const query='?aFrom=2027-01-02&aTo=2027-01-02&bFrom=2041-01-01&bTo=2041-01-01&includeSynthetic=true&type=todo';const result=await f.send(query);assert.equal(result.status,200);assert.equal(result.body.coverage.currentRecords,1);assert.equal(result.body.comparison.a.recordCount,1);assert.equal(result.body.comparison.b.recordCount,0);assert.equal(result.body.comparison.a.items[0].timeRole,'recorded');assert.deepEqual(result.body.comparison.overlap,{from:null,to:null,calendarDays:0,recordCount:0});
 assert.equal((await f.send(view+'&type=resource')).body.comparison.a.items[0].type,'resource');assert.equal((await f.send(view+'&type=inbox')).body.comparison.a.recordCount,1);
});

test('full current statistics remain exact beyond the timeline event scan cap and sample cap',async()=>{
 const f=fixture();for(let n=1;n<=2002;n++){const entry=row(n);f.repository.rows.set(entry.id,entry);}for(const n of [3001,3002]){const entry=row(n,'2026-12-31T01:00:00.000Z');f.repository.rows.set(entry.id,entry);}
 const query='?aFrom=2026-12-31&aTo=2026-12-31&bFrom=2027-01-02&bTo=2027-01-02&includeSynthetic=true&limit=1';
 const first=await f.send(query);assert.equal(first.status,200);assert.equal(first.body.coverage.currentRecords,2004);assert.equal(first.body.comparison.a.recordCount,2);assert.equal(first.body.comparison.b.recordCount,2002);assert.equal(first.body.comparison.a.recordedDayRatio,1);assert.equal(first.body.comparison.b.recordedDayRatio,1);assert.deepEqual(first.body.comparison.a.items.map((item:any)=>item.id),[id(3001)]);assert.deepEqual(first.body.comparison.b.items.map((item:any)=>item.id),[id(1)]);
 f.repository.rows=new Map([...f.repository.rows].reverse());assert.deepEqual((await f.send(query)).body,first.body);
});

test('query rejects incomplete dates, injection, duplicate fields, axis, invalid zones and sample limits',async()=>{
 const f=fixture();for(const query of ['', '?aFrom=2027-01-01', '?aFrom=2027-01-01&aTo=2026-12-31&bFrom=2027-01-01&bTo=2027-01-01', '?aFrom=2026-02-30&aTo=2026-03-01&bFrom=2027-01-01&bTo=2027-01-01', ...['owner=another-owner','ownerId=another-owner','axis=occurred','aFrom=2027-01-01','timeZone=Moon/Sea','timeZone=-00:00','type=secret','limit=51','limit=0','limit=1.5','includeSynthetic=1','limit=10&limit=10'].map(extra=>'?'+ranges+'&'+extra)])assert.equal((await f.send(query)).status,400,query);
 assert.equal((await f.send(view,'POST',{owner:'another-owner'})).status,405);assert.equal((await f.send(view+'&limit=50')).status,200);
});

test('storage failures and malformed recording dates are unavailable with no raw data in errors',async()=>{
 const f=fixture();f.repository.exportSnapshot=async()=>{throw Error('SYNTHETIC_PRIVATE_ERROR_SENTINEL');};const result=await f.send(view);assert.equal(result.status,503);assert.doesNotMatch(JSON.stringify(result.body),/SYNTHETIC_PRIVATE_ERROR_SENTINEL/);
 f.repository.exportSnapshot=async()=>({entries:[row(1,'2026-02-30T00:00:00.000Z')],history:[]});assert.equal((await f.send(view)).status,503);
});
