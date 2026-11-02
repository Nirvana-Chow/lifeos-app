import test from 'node:test';import assert from 'node:assert/strict';
import {CalendarService} from '../src/calendar-candidate/service.ts';
import {CalendarMemoryPort,calendarInput} from './calendar-candidate-helpers.test.ts';
const fixture=()=>{const repository=new CalendarMemoryPort();return{repository,service:new CalendarService(repository)};};
const failure=(code:string)=>(error:unknown)=>!!error&&typeof error==='object'&&'code' in error&&error.code===code;
test('create read edit cancel keeps source identity, exact original and history without marking completed',async()=>{
 const {service}=fixture(),created=await service.create('owner-a',calendarInput,'calendar-create-1'),entry=created.entry;
 assert.equal(entry.title,'合成日历计划');assert.equal(entry.status,'planned');assert.equal('ownerId' in entry,false);assert.deepEqual(entry.source.original,calendarInput);
 assert.deepEqual(await service.get('owner-a',entry.id),entry);
 assert.equal((await service.list('owner-a',{date:'2026-10-23',timeZone:'UTC'})).length,1);
 const edited=await service.update('owner-a',entry.id,{title:'人工改题',expectedRevision:1},'calendar-edit-001');
 assert.equal(edited.entry.revision,2);assert.deepEqual(edited.entry.source,entry.source);
 const cancelled=await service.cancel('owner-a',entry.id,{expectedRevision:2},'calendar-cancel-1');
 assert.equal(cancelled.entry.status,'cancelled');assert.equal(cancelled.entry.revision,3);assert.deepEqual(cancelled.entry.source,entry.source);
 const history=await service.history('owner-a',entry.id);assert.equal(history.length,3);assert.equal(history[0].entry.status,'planned');assert.equal(history[2].entry.status,'cancelled');assert.deepEqual(history[1].raw,{title:'人工改题',expectedRevision:1});assert.equal('ownerId' in history[0].entry,false);
 await assert.rejects(service.update('owner-a',entry.id,{title:'after cancel',expectedRevision:3},'calendar-edit-002'),failure('EVENT_CANCELLED'));
});
test('idempotency returns original result after updates and rejects reuse for changed content',async()=>{
 const {service,repository}=fixture(),first=await service.create('owner-a',calendarInput,'calendar-create-1');
 await service.update('owner-a',first.entry.id,{title:'changed',expectedRevision:1},'calendar-edit-001');
 const duplicate=await service.create('owner-a',calendarInput,'calendar-create-1');assert.equal(duplicate.duplicate,true);assert.deepEqual(duplicate.entry,first.entry);assert.equal(repository.rows.size,1);assert.equal(repository.revisions.length,2);
 await assert.rejects(service.create('owner-a',{...calendarInput,title:'different'},'calendar-create-1'),failure('COMMAND_CONFLICT'));
});
test('cross-owner get list history update cancel stay isolated even with a leaky port',async()=>{
 const {service}=fixture(),{entry}=await service.create('owner-a',calendarInput,'calendar-create-1');
 assert.deepEqual(await service.list('owner-b',{date:'2026-10-23',timeZone:'UTC'}),[]);
 for(const op of [()=>service.get('owner-b',entry.id),()=>service.history('owner-b',entry.id),()=>service.update('owner-b',entry.id,{title:'stolen',expectedRevision:1},'calendar-edit-001'),()=>service.cancel('owner-b',entry.id,{expectedRevision:1},'calendar-cancel-1')])await assert.rejects(op,failure('NOT_FOUND'));
});
test('concurrent edits permit one revision and failed writes roll back source snapshot and receipt',async()=>{
 const {service,repository}=fixture(),{entry}=await service.create('owner-a',calendarInput,'calendar-create-1');
 const outcomes=await Promise.allSettled([service.update('owner-a',entry.id,{title:'A',expectedRevision:1},'calendar-edit-001'),service.update('owner-a',entry.id,{title:'B',expectedRevision:1},'calendar-edit-002')]);
 assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);const rejected=outcomes.find(o=>o.status==='rejected');assert.equal(rejected?.status==='rejected'&&rejected.reason.code,'REVISION_CONFLICT');
 repository.failWrite=true;await assert.rejects(service.create('owner-a',calendarInput,'calendar-failed-1'));assert.equal(repository.rows.size,1);assert.equal(repository.receipts.size,2);assert.equal(repository.revisions.length,2);
});
test('write boundary rejects injected fields and empty patches before touching storage',async()=>{
 const {service,repository}=fixture();await assert.rejects(service.create('owner-a',{...calendarInput,ownerId:'owner-b'},'calendar-create-1'),failure('UNKNOWN_FIELD'));assert.equal(repository.rows.size,0);
 const {entry}=await service.create('owner-a',calendarInput,'calendar-create-1');
 await assert.rejects(service.update('owner-a',entry.id,{expectedRevision:1},'calendar-edit-001'),failure('EMPTY_PATCH'));
 await assert.rejects(service.cancel('owner-a',entry.id,{expectedRevision:1,status:'done'},'calendar-cancel-1'),failure('UNKNOWN_FIELD'));
});
test('full export retains original, all revisions and cancelled events while stripping owner',async()=>{
 const {service}=fixture(),{entry}=await service.create('owner-a',calendarInput,'calendar-create-1');
 await service.cancel('owner-a',entry.id,{expectedRevision:1},'calendar-cancel-1');
 await service.create('owner-b',calendarInput,'calendar-create-1');
 const snapshot=await service.exportSnapshot('owner-a');assert.equal(snapshot.entries.length,1);assert.equal(snapshot.entries[0].status,'cancelled');assert.deepEqual(snapshot.entries[0].source.original,calendarInput);assert.equal(snapshot.history.length,2);assert.equal(snapshot.history[0].entry.revision,1);assert.equal('ownerId' in snapshot.entries[0],false);assert.equal('ownerId' in snapshot.history[0].entry,false);
});
