import test from 'node:test';import assert from 'node:assert/strict';
import {personalCalendarPort,calendarFields,calendarOwner,calendarSpace} from './helpers/personal-calendar-port.ts';
import * as module from '../src/calendar-candidate/personal-service.ts';
const setup=(enabled=true)=>{assert.ok(module,'calendar personal service is missing');const port=personalCalendarPort();return{port,service:new module.PersonalCalendarService(port,{ownerId:calendarOwner,spaceId:calendarSpace,enabled,writable:true})};};
const body=(fields:unknown=calendarFields,expectedRevision?:number)=>({spaceId:calendarSpace,confirmed:true,fields,...(expectedRevision?{expectedRevision}:{})});
const window={from:'2030-11-01',to:'2030-12-01',timeZone:'Asia/Shanghai',limit:1};
test('owner calendar facade is closed by default and foreign owner/space cannot reach its core writer',async()=>{
 const {port,service}=setup(false);await assert.rejects(service.snapshot(calendarOwner,window));assert.equal(port.calls.length,0);
 const ready=setup();await assert.rejects(ready.service.mutate('foreign',null,body(),'calendar-key-one'));await assert.rejects(ready.service.mutate(calendarOwner,null,{...body(),spaceId:'other-space'},'calendar-key-one'));assert.equal(ready.port.calls.length,0);
});
test('calendar creates and updates through the one PersonalService port, forwarding exact CAS and replay',async()=>{
 const {port,service}=setup();const created=await service.mutate(calendarOwner,null,body(),'calendar-key-one');assert.equal(created.entry.fields.title,calendarFields.title);assert.equal(port.calls[0][2],'calendar');
 const replay=await service.mutate(calendarOwner,null,body(),'calendar-key-one');assert.equal(replay.duplicate,true);assert.equal(replay.entry.id,created.entry.id);
 const updated=await service.mutate(calendarOwner,created.entry.id,body({...calendarFields,title:'合成修订'},1),'calendar-key-two');assert.equal(updated.entry.revision,2);assert.deepEqual(updated.entry.source,created.entry.source);
 await assert.rejects(service.mutate(calendarOwner,created.entry.id,body(calendarFields,1),'calendar-key-stale'));assert.equal(port.revisions.length,2);
});
test('snapshot cursors bind query/source versions and stale snapshots never pretend to be complete',async()=>{
 const {service}=setup();await service.mutate(calendarOwner,null,body(),'calendar-key-one');const other=await service.mutate(calendarOwner,null,body({...calendarFields,title:'另一个合成日程'}),'calendar-key-two');
 const first=await service.snapshot(calendarOwner,window);assert.equal(first.entries.length,1);assert.equal(first.truncated,true);assert.ok(first.nextCursor);
 const next=await service.snapshot(calendarOwner,{...window,cursor:first.nextCursor});assert.equal(next.entries.length,1);assert.notEqual(next.entries[0].id,first.entries[0].id);assert.equal(next.truncated,false);
 await service.mutate(calendarOwner,other.entry.id,body({...calendarFields,title:'新版本'},1),'calendar-key-three');await assert.rejects(service.snapshot(calendarOwner,{...window,cursor:first.nextCursor}));
});
test('owner relation picker returns exact authorized pins and excludes foreign-space contacts',async()=>{
 const {port,service}=setup();assert.equal(typeof service.references,'function','calendar reference picker is missing');
 const created=await service.mutate(calendarOwner,null,body(),'calendar-reference-seed');const original=port.rows.get(created.entry.id);
 for(const [type,id,title,spaceId] of [['person','11111111-1111-4111-8111-111111111111','合成人物',calendarSpace],['project','22222222-2222-4222-8222-222222222222','合成项目',calendarSpace],['person','33333333-3333-4333-8333-333333333333','不可见人物','foreign-space']]){const entry=structuredClone(original);entry.id=id;entry.draft.title=title;entry.draft.personal={type};entry.source.id=id;entry.source.externalId=id;entry.source.original.type=type;entry.source.original.spaceId=spaceId;port.rows.set(id,entry);}
 const options=await service.references(calendarOwner);assert.equal(options.people.length,1);assert.equal(options.people[0].title,'合成人物');assert.equal(options.projects.length,1);assert.equal(options.people[0].pin.revision,1);
});
