import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformHandler} from '../src/platform/http.ts';
import {DraftService} from '../src/platform/service.ts';
import {MemoryPort} from './helpers/platform.ts';
const owner={id:'synthetic-timeline-integration-owner',email:'synthetic-timeline@example.invalid'},base='http://127.0.0.1:3111';
function transport(repository:MemoryPort,userId:string|null=owner.id){const handler=createPlatformHandler({legacyUnboundedReadsEnabled:true,repository,sessions:{read:async()=>userId?{userId,email:owner.email}:null},owner,baseURL:base});return(path:string)=>handler(new Request(base+path,{headers:{host:'127.0.0.1:3111'}}));}
const url=(axis:string,from?:string)=>'/api/platform/timeline?includeSynthetic=true&axis='+axis+(from?'&from='+from+'&to='+from:'');

test('timeline shared handler separates occurrence, recording and correction across Beijing year boundary without writing',async()=>{
 const repository=new MemoryPort(),drafts=new DraftService(repository),created=await drafts.mutate(owner.id,'inbox',null,{title:'Synthetic original timeline',text:'Synthetic original body',occurredOn:'2025-12-30',disposition:'reference'},'timeline-root-create');
 const first=repository.rows.get(created.entry.id)!;first.createdAt=first.updatedAt=first.source.asOf='2025-12-31T15:59:59.999Z';repository.historyRows=[structuredClone(first)];const original=structuredClone(first.source);
 await drafts.mutate(owner.id,'inbox',first.id,{expectedRevision:1,title:'Synthetic corrected timeline',occurredOn:null},'timeline-root-correct');const second=repository.rows.get(first.id)!;second.updatedAt='2025-12-31T16:00:00.000Z';repository.historyRows[1]=structuredClone(second);
 const before=JSON.stringify({rows:[...repository.rows],history:repository.historyRows,receipts:[...repository.receipts],events:repository.events}),read=transport(repository);
 const changedResponse=await read(url('changed','2026-01-01'));assert.equal(changedResponse.status,200);const changed=await changedResponse.json();assert.equal(changed.items.length,1);assert.equal(changed.items[0].id,first.id);assert.equal(changed.items[0].sourceId,first.source.id);assert.equal(changed.items[0].revision,2);assert.equal(changed.items[0].date,'2026-01-01');assert.equal(changed.items[0].at,'2025-12-31T16:00:00.000Z');assert.equal(changed.items[0].timeRole,'changed');
 const recorded=await(await read(url('recorded','2025-12-31'))).json();assert.equal(recorded.items.length,1);assert.equal(recorded.items[0].date,'2025-12-31');assert.equal(recorded.items[0].timeRole,'recorded');assert.equal(recorded.coverage.recordedDateCount,1);
 const current=await(await read(url('occurred'))).json();assert.equal(current.items.length,1);assert.equal(current.items[0].date,null);assert.equal(current.items[0].at,null);assert.equal(current.coverage.unknownOccurredRecords,1);
 assert.equal((await(await read(url('occurred','2025-12-31'))).json()).items.length,0);
 assert.deepEqual(second.source,original);assert.equal(JSON.stringify({rows:[...repository.rows],history:repository.historyRows,receipts:[...repository.receipts],events:repository.events}),before);
});

test('timeline opt-in and owner gates prevent old foreign or removed source history disclosure',async()=>{
 const repository=new MemoryPort(),drafts=new DraftService(repository),owned=await drafts.mutate(owner.id,'todo',null,{title:'Synthetic own task',notes:'Synthetic',status:'open',dueOn:'2026-01-01'},'timeline-root-task');
 const foreign=await drafts.mutate('synthetic-other-owner','todo',null,{title:'FOREIGN_TIMELINE_SENTINEL',notes:'Synthetic other owner',status:'open',dueOn:'2026-01-01'},'timeline-root-foreign');
 await drafts.mutate('synthetic-other-owner','todo',foreign.entry.id,{expectedRevision:1,notes:'FOREIGN_HISTORY_SENTINEL'},'timeline-root-foreign-edit');
 const orphan=await drafts.mutate(owner.id,'todo',null,{title:'ORPHAN_TIMELINE_SENTINEL',notes:'Synthetic removed fixture',status:'open',dueOn:null},'timeline-root-orphan');await drafts.mutate(owner.id,'todo',orphan.entry.id,{expectedRevision:1,notes:'ORPHAN_HISTORY_SENTINEL'},'timeline-root-orphan-edit');repository.rows.delete(orphan.entry.id);
 const read=transport(repository),off=await read('/api/platform/timeline');assert.equal(off.status,200);assert.deepEqual((await off.json()).items,[]);
 const response=await read(url('occurred'));assert.equal(response.status,200);const data=await response.json();assert.deepEqual(data.items.map((item:{id:string})=>item.id),[owned.entry.id]);assert.equal(data.items[0].timeRole,'due');assert.equal(data.items[0].sourceTimeZone,null);
 for(const axis of ['occurred','recorded','changed']){const text=await(await read(url(axis))).text();assert.doesNotMatch(text,/FOREIGN_|ORPHAN_/);}
 assert.equal((await transport(repository,null)(url('changed'))).status,401);assert.equal((await transport(repository,'synthetic-other-owner')(url('changed'))).status,403);
 for(const suffix of ['&owner=synthetic-other-owner','&timeZone=UTC&timeZone=Asia/Shanghai','&from=2026-02-30'])assert.equal((await read(url('occurred')+suffix)).status,400);
});
