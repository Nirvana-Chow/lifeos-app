import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {StoredEntry} from '../src/platform/contracts.ts';
import {DraftService} from '../src/platform/service.ts';
import {RecordWindowService} from '../src/platform/window-service.ts';
import {MemoryPort} from './helpers/platform.ts';

const owner='synthetic-storage-owner';
const at='2026-11-10T10:00:00.000Z';

function row(suffix:number, original:unknown):StoredEntry {
  const id=`10000000-0000-4000-8000-00000000000${suffix}`;
  return {id,ownerId:owner,kind:'inbox',draft:{title:'Synthetic review fixture '+suffix,text:'',occurredOn:null,disposition:'pending'},
    source:{id:`20000000-0000-4000-8000-00000000000${suffix}`,system:'website',externalId:id,version:1,asOf:at,original},
    revision:1,createdAt:at,updatedAt:at,syncState:'draft',externalStatus:null};
}

function fixture(){
  const repository=new MemoryPort();
  const review=row(1,{marker:'personal-storage-review-v1',spaceId:'synthetic-space'});
  const regular=row(2,{title:'Synthetic regular entry'});
  for(const entry of [review,regular]){
    repository.rows.set(entry.id,entry);
    repository.historyRows.push(structuredClone(entry));
  }
  return {repository,review,regular};
}

test('generic Inbox and export omit dedicated storage review records while returning ordinary rows',async()=>{
  const {repository,review,regular}=fixture();
  const service=new DraftService(repository);
  assert.deepEqual((await service.list(owner,'inbox')).map(entry=>entry.id),[regular.id]);
  assert.deepEqual((await service.history(owner,'inbox',regular.id)).map(entry=>entry.id),[regular.id]);
  await assert.rejects(service.get(owner,'inbox',review.id),{code:'NOT_FOUND'});
  await assert.rejects(service.history(owner,'inbox',review.id),{code:'NOT_FOUND'});
  const exported=await service.exportSnapshot(owner);
  assert.deepEqual(exported.entries.map(entry=>entry.id),[regular.id]);
  assert.deepEqual(exported.history.map(entry=>entry.id),[regular.id]);
});

test('generic Inbox writer and conversion cannot alter the dedicated review row',async()=>{
  const {repository,review}=fixture();
  const service=new DraftService(repository);
  await assert.rejects(service.mutate(owner,'inbox',review.id,{expectedRevision:1,title:'Unexpected change'},'synthetic-review-guard-patch'),{code:'NOT_FOUND'});
  await assert.rejects(service.createTodoFromInbox(owner,review.id,{expectedRevision:1,title:'Unexpected todo'},'synthetic-review-guard-convert'),{code:'NOT_FOUND'});
  assert.deepEqual(repository.rows.get(review.id),review);
  assert.deepEqual(repository.events,[]);
});

test('generic search and change timeline omit dedicated review rows from their bounded projections',async()=>{
  const {repository,review}=fixture();
  const service=new RecordWindowService(repository);
  const search=await service.page(owner,'search',new URLSearchParams({includeSynthetic:'true',q:'Synthetic review fixture'}));
  assert.ok(!search.items.some(item=>item.id===review.id));
  const timeline=await service.page(owner,'timeline',new URLSearchParams({includeSynthetic:'true',axis:'changed',timeZone:'Asia/Shanghai'}));
  assert.ok(!timeline.items.some(item=>item.id===review.id));
});
