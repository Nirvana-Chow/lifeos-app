import test from 'node:test';
import assert from 'node:assert/strict';
import {TimelineClient,TimelineRequestError,formatTimelineTime,validateTimelineSource} from '../src/timeline-workbench/client.ts';
import type {TimelineItem,TimelineResponse} from '../src/timeline-candidate/contracts.ts';
import type {SourceResponse} from '../src/search-candidate/contracts.ts';
const owner='synthetic-timeline-owner',id='11111111-1111-4111-8111-111111111111',sourceId='22222222-2222-4222-8222-222222222222',now='2026-12-31T16:00:00.000Z';
function item():TimelineItem{return {eventKey:'occurred:todo:'+id,id,kind:'todo',type:'todo',sourceId,revision:1,currentRevision:1,title:'Synthetic task',summary:'Synthetic original notes',date:'2026-12-31',at:null,dateKind:'date',sourceTimeZone:null,timeRole:'due',status:'open',isHistorical:false};}
function response():TimelineResponse{return {items:[item()],query:{axis:'occurred',timeZone:'Asia/Shanghai',includeSynthetic:true,limit:50},limit:50,truncated:false,observedAt:now,dataStatus:'isolated-test-drafts',syntheticIncluded:true,coverage:{currentRecords:1,firstRecordedAt:now,lastRecordedAt:now,recordedDateCount:1,recordedFrom:'2027-01-01',recordedTo:'2027-01-01',unknownOccurredRecords:0,matchedEvents:1,scannedEvents:1,scanLimit:2000,scanTruncated:false,calendarAvailable:true,snapshotConsistency:'owner-snapshot',meaning:'existing-record-coverage-only'}};}
function source():SourceResponse{const document={id,sourceId,kind:'todo' as const,type:'todo',title:'Synthetic task',date:'2026-12-31',sourceSystem:'website',snippet:'Synthetic original notes',revision:1,fields:[{label:'备注',value:'Synthetic original notes'}]};return {current:document,original:structuredClone(document),history:[structuredClone(document)],historyLimit:20,historyTruncated:false,dataStatus:'isolated-test-drafts',syntheticIncluded:true};}
const query={axis:'occurred' as const,timeZone:'Asia/Shanghai',includeSynthetic:true,limit:50};
function setup(){let account:string|null=owner,status=200,value:unknown=response();const calls:string[]=[];const client=new TimelineClient(async input=>{if(String(input).endsWith('/auth/get-session'))return Response.json(account?{user:{id:account},session:{userId:account}}:null);calls.push(String(input));return Response.json(value,{status});});return {client,calls,setAccount(next:string|null){account=next;},setResponse(next:unknown,code=200){value=next;status=code;}};}

test('timeline explicit synthetic read binds owner, normalized query and same-owner source reads',async()=>{
 const h=setup();assert.deepEqual(await h.client.read(query),response());assert.equal(h.calls[0],'/api/platform/timeline?axis=occurred&timeZone=Asia%2FShanghai&includeSynthetic=true&limit=50');h.setResponse(source());assert.deepEqual(await h.client.source(item()),source());assert.match(h.calls[1],/search\/source\/todo/);h.setAccount('other-owner');await assert.rejects(()=>h.client.read(query),cause=>cause instanceof TimelineRequestError&&cause.code==='ACCOUNT_CHANGED');assert.equal(h.calls.length,2);
});

test('timeline rejects forged shape, query mismatch, inconsistent precision, range and event identity',async()=>{
 for(const mutate of [(r:TimelineResponse)=>{r.query.axis='changed';},(r:TimelineResponse)=>{r.items[0].dateKind='instant';},(r:TimelineResponse)=>{r.items[0].currentRevision=0;},(r:TimelineResponse)=>{r.items[0].eventKey='forged';},(r:TimelineResponse)=>{r.items[0].timeRole='occurred';},(r:TimelineResponse)=>{r.items[0].isHistorical=true;},(r:TimelineResponse)=>{r.coverage.currentRecords=-1;},(r:TimelineResponse)=>{(r.items[0] as unknown as Record<string,unknown>).ownerId='private';}]){const value=response();mutate(value);const h=setup();h.setResponse(value);await assert.rejects(()=>h.client.read(query),TimelineRequestError);}
 const h=setup();await assert.rejects(()=>h.client.read({...query,includeSynthetic:false}),TimelineRequestError);assert.equal(h.calls.length,0);
});

test('date-only stays a date, unknown stays unknown and instant formats use chosen Beijing timezone',()=>{
 assert.equal(formatTimelineTime(item(),'Asia/Shanghai'),'2026-12-31（仅日期）');assert.equal(formatTimelineTime({...item(),date:null,dateKind:'unknown'},'Asia/Shanghai'),'日期未知');const instant={...item(),date:'2027-01-01',at:now,dateKind:'instant' as const,sourceTimeZone:'UTC'};assert.equal(formatTimelineTime(instant,'Asia/Shanghai'),'2027-01-01 00:00:00（Asia/Shanghai）');assert.equal(formatTimelineTime(instant,'UTC'),'2026-12-31 16:00:00（UTC）');
});

test('source identity and revisions are strict while newer current contents and missing historical windows stay distinct',()=>{
 const selected={...item(),revision:2,currentRevision:25,isHistorical:true,title:'Synthetic revision 2'},value=source();value.current={...value.current,revision:25,title:'Synthetic current'};value.history=[value.current];value.historyTruncated=true;
 const checked=validateTimelineSource(selected,value);assert.equal(checked.selected,null);assert.equal(checked.currentChanged,false);assert.equal(checked.selectedOutsideHistory,true);value.current.revision=26;value.history=[value.current];assert.equal(validateTimelineSource(selected,value).currentChanged,true);
 for(const change of [{id:sourceId},{sourceId:id},{type:'article'},{revision:24}]){const bad=structuredClone(value);Object.assign(bad.current,change);assert.throws(()=>validateTimelineSource(selected,bad));}
 const same=source();same.current.title='Different same revision';assert.throws(()=>validateTimelineSource(item(),same));
});

test('identity failures on successful or failed reads never return payloads, including source wrapper failures',async()=>{
 let account=owner;const client=new TimelineClient(async input=>String(input).endsWith('/auth/get-session')?Response.json({user:{id:account},session:{userId:account}}):(account='another',Response.json(response())));await assert.rejects(()=>client.read(query),cause=>cause instanceof TimelineRequestError&&cause.code==='ACCOUNT_CHANGED');
 let phase='timeline';const failed=new TimelineClient(async input=>{if(String(input).endsWith('/auth/get-session'))return phase==='identity-failed'?Response.json({error:{code:'DOWN',message:'safe'}},{status:503}):Response.json({user:{id:owner},session:{userId:owner}});if(phase==='timeline')return Response.json(response());phase='identity-failed';return Response.json({error:{code:'NOT_FOUND',message:'safe'}},{status:404});});await failed.read(query);phase='source';await assert.rejects(()=>failed.source(item()),cause=>cause instanceof TimelineRequestError&&cause.code==='IDENTITY_UNAVAILABLE');
});
