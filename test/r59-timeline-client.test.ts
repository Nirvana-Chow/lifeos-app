import test from 'node:test';
import assert from 'node:assert/strict';
import {TimelineClient,TimelineRequestError} from '../src/timeline-workbench/client.ts';

const owner='synthetic-comparison-owner',id='11111111-1111-4111-8111-111111111111',sourceId='22222222-2222-4222-8222-222222222222',now='2026-12-31T16:00:00.000Z';
const query={aFrom:'2027-01-01',aTo:'2027-01-02',bFrom:'2027-01-01',bTo:'2027-01-01',timeZone:'Asia/Shanghai',includeSynthetic:true,limit:10};
function response(){const row={eventKey:'recorded:todo:'+id,id,sourceId,kind:'todo',type:'todo',revision:1,currentRevision:1,title:'Synthetic comparison source',summary:'Synthetic summary',date:'2027-01-01',at:now,dateKind:'instant',sourceTimeZone:'UTC',timeRole:'recorded',status:'cancelled',isHistorical:false};return {query:{...query},observedAt:now,dataStatus:'isolated-test-drafts',syntheticIncluded:true,comparison:{a:{from:query.aFrom,to:query.aTo,calendarDays:2,recordCount:1,recordedDays:1,recordedDayRatio:0.5,items:[row],itemsTruncated:false},b:{from:query.bFrom,to:query.bTo,calendarDays:1,recordCount:1,recordedDays:1,recordedDayRatio:1,items:[row],itemsTruncated:false},overlap:{from:'2027-01-01',to:'2027-01-01',calendarDays:1,recordCount:1}},coverage:{currentRecords:1,calendarAvailable:true,snapshotConsistency:'per-adapter-snapshots',summaryScope:'all-current-snapshot-records',meaning:'existing-record-coverage-only'}};}
const identity=()=>Response.json({user:{id:owner},session:{userId:owner}});
function setup(value:unknown=response()){const paths:string[]=[];const client=new TimelineClient(async input=>{paths.push(String(input));return String(input).endsWith('/auth/get-session')?identity():Response.json(value);});return {client,paths};}

test('comparison normalizes exact two inclusive periods, defaults Beijing and checks owner before and after',async()=>{
 const h=setup();assert.deepEqual(await h.client.compare(query),response());assert.equal(h.paths.length,3);assert.equal(h.paths[0],'/api/platform/auth/get-session');assert.equal(h.paths[1],'/api/platform/timeline/compare?aFrom=2027-01-01&aTo=2027-01-02&bFrom=2027-01-01&bTo=2027-01-01&timeZone=Asia%2FShanghai&includeSynthetic=true&limit=10');assert.equal(h.paths[2],h.paths[0]);
 const defaults=setup();assert.deepEqual(await defaults.client.compare({aFrom:query.aFrom,aTo:query.aTo,bFrom:query.bFrom,bTo:query.bTo,includeSynthetic:true}),response());
});

test('invalid comparison inputs never request identity or data, including default-off and non-comparison axis',async()=>{
 for(const change of [{includeSynthetic:false},{aFrom:''},{aTo:'2026-12-31'},{bFrom:'2027-02-29'},{timeZone:'invalid-zone'},{limit:51},{axis:'occurred'}]){const h=setup();await assert.rejects(()=>h.client.compare({...query,...change}),TimelineRequestError);assert.equal(h.paths.length,0);}
});

test('comparison rejects fabricated metrics, date precision, truncation, overlap and query/source identity',async()=>{
 const mutations:Array<(r:ReturnType<typeof response>)=>void>=[r=>{r.query.aTo='2027-01-03';},r=>{r.comparison.a.calendarDays=3;},r=>{r.comparison.a.recordedDayRatio=1;},r=>{r.comparison.a.recordCount=0;},r=>{r.comparison.a.recordedDays=3;},r=>{r.comparison.a.itemsTruncated=true;},r=>{r.comparison.a.items.push({...r.comparison.a.items[0]});},r=>{r.comparison.a.items[0].date='2026-12-31';},r=>{r.comparison.a.items[0].timeRole='due';},r=>{r.comparison.a.items[0].revision=2;},r=>{r.comparison.overlap.recordCount=2;},r=>{r.comparison.overlap.calendarDays=0;},r=>{r.coverage.currentRecords=0;},r=>{r.coverage.summaryScope='sample-only';},r=>{(r.comparison.a as unknown as Record<string,unknown>).private='foreign';},r=>{r.comparison.b.items=[{...r.comparison.b.items[0],title:'Different same revision'}];}];
 for(const mutate of mutations){const value=response();mutate(value);await assert.rejects(()=>setup(value).client.compare(query),TimelineRequestError);}
});

test('full snapshot counts stay independent of source cap and empty periods remain explicit zero',async()=>{
 const value=response();for(const period of [value.comparison.a,value.comparison.b]){period.recordCount=11;period.items=Array.from({length:10},(_,at)=>({...period.items[0],id:`11111111-1111-4111-8111-${String(at+1).padStart(12,'0')}`,eventKey:`recorded:todo:11111111-1111-4111-8111-${String(at+1).padStart(12,'0')}`}));period.itemsTruncated=true;}value.comparison.overlap.recordCount=11;value.coverage.currentRecords=11;assert.equal((await setup(value).client.compare(query)).comparison!.a.recordCount,11);
 const empty=response();for(const period of [empty.comparison.a,empty.comparison.b]){period.recordCount=0;period.recordedDays=0;period.recordedDayRatio=0;period.items=[];}empty.coverage.currentRecords=0;empty.comparison.overlap.recordCount=0;assert.deepEqual(await setup(empty).client.compare(query),empty);
});

test('complete overlap records must contain the other period overlap samples by exact identity',async()=>{
 const value=response(),other='33333333-3333-4333-8333-333333333333';value.comparison.b.items=[{...value.comparison.b.items[0],id:other,eventKey:'recorded:todo:'+other}];await assert.rejects(()=>setup(value).client.compare(query),TimelineRequestError);
 const capped=response();capped.coverage.currentRecords=11;capped.comparison.a.recordCount=11;capped.comparison.a.itemsTruncated=true;capped.comparison.a.items=Array.from({length:10},(_,at)=>({...capped.comparison.a.items[0],id:`11111111-1111-4111-8111-${String(at+1).padStart(12,'0')}`,eventKey:`recorded:todo:11111111-1111-4111-8111-${String(at+1).padStart(12,'0')}`,date:'2027-01-02',at:'2027-01-01T16:00:00.000Z'}));capped.comparison.a.recordedDays=2;capped.comparison.a.recordedDayRatio=1;
 // The complete B period can legitimately contain an overlap row omitted from A's bounded sample.
 assert.equal((await setup(capped).client.compare(query)).comparison!.a.recordCount,11);
});

test('comparison cannot claim a single snapshot while the separate calendar adapter is included',async()=>{
 for(const available of [true,false]){const value=response();value.coverage.calendarAvailable=available;value.coverage.snapshotConsistency=available?'owner-snapshot':'per-adapter-snapshots';await assert.rejects(()=>setup(value).client.compare(query),TimelineRequestError);}
});

test('coverage ratio has strict zero and one bounds even within arithmetic tolerance',async()=>{
 const high=response();high.comparison.b.recordedDayRatio=1+Number.EPSILON;await assert.rejects(()=>setup(high).client.compare(query),TimelineRequestError);
 const low=response();low.coverage.currentRecords=0;low.comparison.overlap.recordCount=0;for(const period of [low.comparison.a,low.comparison.b]){period.items=[];period.recordCount=0;period.recordedDays=0;period.recordedDayRatio=-1e-13;}await assert.rejects(()=>setup(low).client.compare(query),TimelineRequestError);
});

test('comparison postflight protects successful and failed reads and keeps the original owner binding',async()=>{
 for(const status of [200,404,503]){let account=owner;const client=new TimelineClient(async input=>String(input).endsWith('/auth/get-session')?Response.json({user:{id:account},session:{userId:account}}):(account='foreign-owner',Response.json(status===200?response():{error:{code:'UNAVAILABLE'}},{status})));await assert.rejects(()=>client.compare(query),cause=>cause instanceof TimelineRequestError&&cause.code==='ACCOUNT_CHANGED');}
 let failIdentity=false;const client=new TimelineClient(async input=>String(input).endsWith('/auth/get-session')?(failIdentity?Response.json({}, {status:503}):identity()):(failIdentity=true,Promise.reject(Error('synthetic transport failure'))));await assert.rejects(()=>client.compare(query),cause=>cause instanceof TimelineRequestError&&cause.code==='IDENTITY_UNAVAILABLE');
});

test('comparison source read preserves selected revision after source correction and rejects wrong source ID',async()=>{
 const selected=response().comparison.a.items[0];const original={id,sourceId,kind:'todo',type:'todo',title:selected.title,date:'2027-01-01',sourceSystem:'website',snippet:'Synthetic summary',revision:1,fields:[{label:'正文',value:'Synthetic original full body'}]};const current={...original,revision:2,title:'Synthetic corrected title'};let value:unknown=response();const client=new TimelineClient(async input=>String(input).endsWith('/auth/get-session')?identity():Response.json(value));const result=await client.compare(query);value={current,original,history:[current,original],historyLimit:20,historyTruncated:false,dataStatus:'isolated-test-drafts',syntheticIncluded:true};assert.equal((await client.source(result.comparison!.a.items[0])).current.revision,2);(value as any).current.sourceId=id;await assert.rejects(()=>client.source(result.comparison!.a.items[0]),TimelineRequestError);
});
