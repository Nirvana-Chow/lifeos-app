import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformHandler} from '../src/platform/http.ts';
import {CalendarService} from '../src/calendar-candidate/service.ts';
import {MemoryPort} from './helpers/platform.ts';
import {CalendarMemoryPort} from './calendar-candidate-helpers.test.ts';
import type {StoredEntry,Principal} from '../src/platform/contracts.ts';
import type {CalendarEntry} from '../src/calendar-candidate/contracts.ts';
const owner={id:'timeline-owner',email:'timeline@example.invalid'},baseURL='http://127.0.0.1:3190';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function row(n:number,patch:Partial<StoredEntry>={}):StoredEntry{
 const draft={title:'Synthetic record '+n,text:'Synthetic body '+n,occurredOn:'2026-10-01',disposition:'reference' as const},at='2026-10-24T01:00:00.000Z';
 return{id:id(n),ownerId:owner.id,kind:'inbox',draft,source:{id:id(n+10000),system:'website',externalId:id(n),version:1,asOf:at,original:{...draft}},revision:1,createdAt:at,updatedAt:at,syncState:'draft',externalStatus:null,...patch};
}
function calendarRow(n:number,patch:Partial<CalendarEntry>={}):CalendarEntry{
 const base=row(n),schedule={kind:'all-day' as const,startDate:'2026-12-31',endDate:'2027-01-03'};
 return{id:base.id,ownerId:owner.id,title:'Synthetic calendar '+n,notes:'Synthetic schedule only',schedule,status:'planned',revision:1,source:{...base.source,original:{title:'Synthetic calendar '+n,notes:'Synthetic schedule only',schedule}},createdAt:base.createdAt,updatedAt:base.updatedAt,...patch};
}
function fixture(calendarEnabled=false){
 const repository=new MemoryPort(),calendarRows=new CalendarMemoryPort(),calendar=calendarEnabled?new CalendarService(calendarRows):undefined;
 let principal:Principal|null={userId:owner.id,email:owner.email};
 const handler=createPlatformHandler({legacyUnboundedReadsEnabled:true,repository,calendar,sessions:{read:async()=>principal},owner,baseURL,now:()=>new Date('2027-01-05T00:00:00.000Z')});
 return{repository,calendarRows,setPrincipal:(value:Principal|null)=>{principal=value;},async send(query='',method='GET',body?:unknown){
  const response=await handler(new Request(baseURL+'/api/platform/timeline'+query,{method,headers:{host:'127.0.0.1:3190',origin:baseURL,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}));return{status:response.status,headers:response.headers,body:await response.json()};
 }};
}
const view='?includeSynthetic=true';

test('timeline is off by default, uses shared session owner gates and never reads without synthetic opt-in',async()=>{
 const f=fixture(true);f.repository.exportSnapshot=async()=>{throw Error('unexpected read');};f.calendarRows.exportSnapshot=async()=>{throw Error('unexpected read');};
 const hidden=await f.send();assert.equal(hidden.status,200);assert.deepEqual(hidden.body.items,[]);assert.equal(hidden.body.syntheticIncluded,false);assert.equal(hidden.body.coverage.currentRecords,0);
 f.setPrincipal(null);assert.equal((await f.send(view)).status,401);f.setPrincipal({userId:'other',email:owner.email});assert.equal((await f.send(view)).status,403);
});
test('occurred axis retains date-only precision and unknowns without inventing occurred times from creation',async()=>{
 const f=fixture(),known=row(1),unknown=row(2,{draft:{title:'Unknown date',text:'Unknown occurrence',occurredOn:null,disposition:'reference'}});
 f.repository.rows.set(known.id,known);f.repository.rows.set(unknown.id,unknown);
 const result=await f.send(view);assert.equal(result.status,200);assert.equal(result.body.query.axis,'occurred');assert.equal(result.body.query.timeZone,'Asia/Shanghai');
 assert.deepEqual(result.body.items.map((item:any)=>[item.id,item.date,item.at,item.dateKind,item.timeRole,item.sourceTimeZone]),[[known.id,'2026-10-01',null,'date','occurred',null],[unknown.id,null,null,'unknown','occurred',null]]);
 assert.equal(result.body.coverage.unknownOccurredRecords,1);
 const ranged=await f.send(view+'&from=2026-10-01&to=2026-10-01');assert.deepEqual(ranged.body.items.map((item:any)=>item.id),[known.id]);assert.equal(ranged.body.coverage.unknownOccurredRecords,1);
 assert.equal((await f.send(view+'&from=2026-10-24&to=2026-10-24')).body.items.length,0);
});
test('recorded dates use the requested timezone across midnight and year while date-only occurrence never shifts',async()=>{
 const f=fixture(),entry=row(1,{createdAt:'2026-12-31T16:00:00.000Z',updatedAt:'2026-12-31T16:00:00.000Z'});f.repository.rows.set(entry.id,entry);
 const beijing=await f.send(view+'&axis=recorded');assert.equal(beijing.status,200);assert.equal(beijing.body.items[0].date,'2027-01-01');assert.equal(beijing.body.items[0].at,'2026-12-31T16:00:00.000Z');assert.equal(beijing.body.items[0].sourceTimeZone,'UTC');
 const utc=await f.send(view+'&axis=recorded&timeZone=UTC');assert.equal(utc.body.items[0].date,'2026-12-31');
 const offset=await f.send(view+'&axis=recorded&timeZone=%2B08%3A00');assert.equal(offset.body.items[0].date,'2027-01-01');
 for(const zone of ['Asia/Shanghai','America/Los_Angeles','UTC']){const occurrence=await f.send(view+'&timeZone='+encodeURIComponent(zone));assert.equal(occurrence.body.items[0].date,'2026-10-01');assert.equal(occurrence.body.items[0].at,null);}
});
test('task deadlines remain due dates even after completion and calendar scheduled anchors remain plans',async()=>{
 const f=fixture(true),todo=row(1,{kind:'todo',draft:{title:'Synthetic completed task',notes:'Self-reported task status',dueOn:'2026-12-31',status:'done'}}),allDay=calendarRow(2),timed=calendarRow(3,{schedule:{kind:'timed',startAt:'2026-12-31T16:00:00.000Z',endAt:'2027-01-02T10:00:00.000Z',timeZone:'UTC'}});
 f.repository.rows.set(todo.id,todo);f.calendarRows.rows.set(allDay.id,allDay);f.calendarRows.rows.set(timed.id,timed);
 const result=await f.send(view);assert.equal(result.status,200);
 const task=result.body.items.find((item:any)=>item.id===todo.id);assert.equal(task.timeRole,'due');assert.equal(task.status,'done');assert.equal(task.date,'2026-12-31');assert.equal(task.at,null);
 const dateEvent=result.body.items.find((item:any)=>item.id===allDay.id);assert.equal(dateEvent.timeRole,'scheduled');assert.equal(dateEvent.status,'planned');assert.equal(dateEvent.date,'2026-12-31');assert.equal(dateEvent.dateKind,'date');assert.equal(dateEvent.sourceTimeZone,null);
 const timedEvent=result.body.items.find((item:any)=>item.id===timed.id);assert.equal(timedEvent.date,'2027-01-01');assert.equal(timedEvent.timeRole,'scheduled');assert.equal(timedEvent.sourceTimeZone,'UTC');assert.equal(timedEvent.dateKind,'instant');
 const interior=await f.send(view+'&from=2027-01-02&to=2027-01-02');assert.deepEqual(interior.body.items,[]);assert.equal(result.body.coverage.snapshotConsistency,'per-adapter-snapshots');
});
test('changed axis binds historical content to its own revision and update time without changing occurrence',async()=>{
 const f=fixture(),initial=row(1),second={...initial,revision:2,updatedAt:'2026-10-25T16:10:00.000Z',draft:{...initial.draft,title:'Synthetic corrected v2'}},current={...second,revision:3,updatedAt:'2026-10-27T02:00:00.000Z',draft:{...second.draft,title:'Synthetic corrected v3'}};
 f.repository.rows.set(current.id,current);f.repository.historyRows.push(initial,second,current);
 const changed=await f.send(view+'&axis=changed');assert.equal(changed.status,200);assert.deepEqual(changed.body.items.map((item:any)=>[item.revision,item.currentRevision,item.title,item.date,item.timeRole,item.isHistorical]),[[3,3,'Synthetic corrected v3','2026-10-27','changed',false],[2,3,'Synthetic corrected v2','2026-10-26','changed',true]]);
 assert.equal(new Set(changed.body.items.map((item:any)=>item.eventKey)).size,2);
 const occurred=await f.send(view);assert.equal(occurred.body.items.length,1);assert.equal(occurred.body.items[0].date,'2026-10-01');
 const recorded=await f.send(view+'&axis=recorded');assert.equal(recorded.body.items[0].date,'2026-10-24');assert.equal(recorded.body.items[0].title,'Synthetic corrected v3');
});
test('history requires a current same-owner kind/source identity and excludes missing foreign future and duplicate rows',async()=>{
 const f=fixture(),current=row(1,{revision:3,updatedAt:'2026-10-27T02:00:00.000Z'}),valid={...current,revision:2,updatedAt:'2026-10-26T02:00:00.000Z'};
 f.repository.rows.set(current.id,current);f.repository.historyRows.push(valid,structuredClone(valid),{...valid,ownerId:'other-owner'},{...valid,id:id(77)},{...valid,revision:4},{...valid,source:{...valid.source,id:id(88)}},{...valid,source:{...valid.source,original:{title:'different source'}}},{...valid,kind:'todo'});
 const result=await f.send(view+'&axis=changed');assert.equal(result.status,200);assert.deepEqual(result.body.items.map((item:any)=>[item.id,item.revision]),[[current.id,2]]);
 f.repository.rows.get(current.id)!.ownerId='other-owner';assert.deepEqual((await f.send(view+'&axis=changed')).body.items,[]);
 f.repository.rows.delete(current.id);assert.deepEqual((await f.send(view+'&axis=changed')).body.items,[]);
});
test('calendar cancellation is explicit and retains separately dated revision history',async()=>{
 const f=fixture(true),original=calendarRow(1),cancelled={...original,revision:2,status:'cancelled' as const,updatedAt:'2026-12-30T16:30:00.000Z'};
 f.calendarRows.rows.set(original.id,cancelled);f.calendarRows.revisions.push({entry:original,raw:{}},{entry:cancelled,raw:{}});
 const occurred=await f.send(view+'&type=calendar');assert.equal(occurred.status,200);assert.equal(occurred.body.items[0].status,'cancelled');assert.equal(occurred.body.items[0].timeRole,'scheduled');
 const changed=await f.send(view+'&axis=changed&type=calendar');assert.equal(changed.body.items[0].date,'2026-12-31');assert.equal(changed.body.items[0].timeRole,'changed');assert.equal(changed.body.items[0].status,'cancelled');assert.equal(changed.body.items[0].revision,2);
 f.calendarRows.rows.delete(original.id);assert.deepEqual((await f.send(view+'&axis=changed')).body.items,[]);
});
test('historical subtype mismatch cannot disclose content or shadow the matching revision',async()=>{
 const f=fixture(),current=row(1,{revision:3,draft:{title:'Synthetic resource',text:'Current resource body',occurredOn:null,disposition:'reference',record:{type:'resource',syntheticOnly:true,url:'https://example.invalid/synthetic',author:null}}});
 const valid={...current,revision:2,draft:{...current.draft,title:'Synthetic resource v2'}},wrong={...valid,draft:{title:'WRONG_SUBTYPE_SENTINEL',text:'WRONG_SUBTYPE_BODY',occurredOn:null,disposition:'reference' as const,record:{type:'article' as const,syntheticOnly:true as const,author:null,attribution:'original' as const,sourceURL:null}}};
 f.repository.rows.set(current.id,current);f.repository.historyRows.push(wrong,valid);
 const result=await f.send(view+'&axis=changed');assert.equal(result.status,200);assert.deepEqual(result.body.items.map((item:any)=>[item.revision,item.type,item.title]),[[2,'resource','Synthetic resource v2']]);assert.doesNotMatch(JSON.stringify(result.body),/WRONG_SUBTYPE/);
});
test('coverage describes only existing type-scoped recording dates independently of event range or limit',async()=>{
 const f=fixture(),a=row(1,{createdAt:'2026-12-31T15:59:00.000Z'}),b=row(2,{createdAt:'2026-12-31T16:00:00.000Z'}),c=row(3,{createdAt:'2027-01-01T03:00:00.000Z'});for(const item of [a,b,c])f.repository.rows.set(item.id,item);
 const result=await f.send(view+'&from=2030-01-01&limit=1');assert.equal(result.status,200);assert.deepEqual(result.body.items,[]);
 assert.deepEqual(result.body.coverage,{currentRecords:3,firstRecordedAt:'2026-12-31T15:59:00.000Z',lastRecordedAt:'2027-01-01T03:00:00.000Z',recordedDateCount:2,recordedFrom:'2026-12-31',recordedTo:'2027-01-01',unknownOccurredRecords:0,matchedEvents:0,scannedEvents:3,scanLimit:2000,scanTruncated:false,calendarAvailable:false,snapshotConsistency:'owner-snapshot',meaning:'existing-record-coverage-only'});
 assert.equal(result.body.observedAt,'2027-01-05T00:00:00.000Z');
 const empty=await f.send(view+'&type=todo');assert.equal(empty.body.coverage.currentRecords,0);assert.equal(empty.body.coverage.firstRecordedAt,null);assert.equal(empty.body.coverage.recordedDateCount,0);
});
test('one core snapshot supplies records and history without extra point reads, and response is read-only',async()=>{
 const f=fixture(),entry=row(1,{revision:2});f.repository.rows.set(entry.id,entry);f.repository.historyRows.push(entry);let snapshots=0;
 const snapshot=f.repository.exportSnapshot.bind(f.repository);f.repository.exportSnapshot=async owner=>{snapshots++;return snapshot(owner);};f.repository.get=async()=>{throw Error('unexpected point read');};f.repository.list=async()=>{throw Error('unexpected list read');};
 const result=await f.send(view+'&axis=changed');assert.equal(result.status,200);assert.equal(snapshots,1);assert.equal(f.repository.events.length,0);assert.equal(f.repository.receipts.size,0);
 assert.equal(result.headers.get('Cache-Control'),'private, no-store');assert.equal(result.headers.get('Vary'),'Cookie');assert.equal('ownerId' in result.body.items[0],false);
});
test('strict query rejects unknown axes owners invalid dates zones repeated fields and unbounded limits',async()=>{
 const f=fixture();
 for(const query of ['axis=other','axis=occurred&axis=changed','owner=x','from=2026-02-30','from=2027-01-01&to=2026-12-31','timeZone=Moon/Sea','timeZone=-00:00','type=secret','limit=101','limit=0','limit=1.2','includeSynthetic=1'])assert.equal((await f.send('?'+query)).status,400,query);
 assert.equal((await f.send(view,'POST',{})).status,405);
});
test('event output and history scan caps are explicit with deterministic ordering',async()=>{
 const f=fixture();for(let n=1;n<=2002;n++){const entry=row(n,{revision:2,updatedAt:'2027-01-01T00:00:00.000Z'});f.repository.rows.set(entry.id,entry);f.repository.historyRows.push(entry);}
 const result=await f.send(view+'&axis=changed&limit=3');assert.equal(result.status,200);assert.equal(result.body.items.length,3);assert.equal(result.body.truncated,true);assert.equal(result.body.coverage.scanTruncated,true);assert.equal(result.body.coverage.scannedEvents,2000);assert.equal(result.body.coverage.currentRecords,2002);
 assert.deepEqual(result.body.items.map((item:any)=>item.id),[id(1),id(2),id(3)]);
 const second=await f.send(view+'&axis=changed&limit=3');assert.deepEqual(second.body,result.body);
});
