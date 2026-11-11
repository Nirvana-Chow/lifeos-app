import test from 'node:test';
import assert from 'node:assert/strict';
import {StorageReviewService,isStorageReviewEntry} from '../src/storage-review/service.ts';
import {MemoryPort} from './helpers/platform.ts';
import type {PlatformRepository,Transaction} from '../src/platform/contracts.ts';

const owner='fixture-owner-a',spaceId='lifeos-private';
const checklist=(revision='review-v1')=>({schema:1 as const,revision,context:{summary:'仅虚构审核上下文'},items:[
 {id:'F-001',title:'虚构文件',body:'虚构说明',question:'是否保留？',group:'虚构组',kind:'file' as const,status:'pending' as const},
 {id:'F-002',title:'受保护项',body:'不得处置',question:'只读？',group:'保护组',kind:'folder' as const,status:'protected' as const},
]});
function setup(){
 const memory=new MemoryPort();
 const repository=new Proxy(memory as PlatformRepository,{get(target,key,receiver){
  if(key!=='transaction')return Reflect.get(target,key,receiver);
  return <T>(recordOwner:string,commandKey:string,run:(tx:Transaction)=>Promise<T>)=>memory.transaction(recordOwner,commandKey,tx=>run({...tx,lockRecordIdentity:async()=>{}}));
 }});
 return {memory,repository,service:new StorageReviewService(repository,{ownerId:owner,spaceId})};
}

test('creates one owner-space review inbox record and reads its bounded snapshot back',async()=>{
 const f=setup(),result=await f.service.saveChecklist(owner,{expectedRevision:null,checklist:checklist()},'storage-review-create-001');
 assert.deepEqual(result,{revision:1,checklist:checklist(),decisions:[]});
 assert.equal(f.memory.rows.size,1);assert.equal(f.memory.historyRows.length,1);assert.equal(f.memory.receipts.size,1);
 const entry=[...f.memory.rows.values()][0];
 assert.equal(entry.kind,'inbox');assert.deepEqual(entry.source.original,{marker:'personal-storage-review-v1',spaceId});
 assert.equal(isStorageReviewEntry(entry),true);assert.equal((await f.service.get(owner))?.revision,1);
 assert.equal('ownerId' in entry,true);
});

test('same key replays identical writes and rejects changed payload',async()=>{
 const f=setup(),input={expectedRevision:null,checklist:checklist()};
 const first=await f.service.saveChecklist(owner,input,'storage-review-create-001');
 assert.deepEqual(await f.service.saveChecklist(owner,input,'storage-review-create-001'),first);
 await assert.rejects(f.service.saveChecklist(owner,{...input,checklist:checklist('other')},'storage-review-create-001'));
 assert.equal(f.memory.rows.size,1);assert.equal(f.memory.historyRows.length,1);
});

test('decision uses snapshot CAS, keeps checklist on read, and rejects protected IDs',async()=>{
 const f=setup();await f.service.saveChecklist(owner,{expectedRevision:null,checklist:checklist()},'storage-review-create-001');
 const kept=await f.service.saveDecision(owner,{expectedRevision:1,checklistRevision:'review-v1',id:'F-001',decision:'keep'},'storage-review-decision-001');
 assert.deepEqual(kept.decisions,[{id:'F-001',decision:'keep'}]);
 await assert.rejects(f.service.saveDecision(owner,{expectedRevision:2,checklistRevision:'review-v1',id:'F-002',decision:'trash'},'storage-review-protected-001'));
 await assert.rejects(f.service.saveDecision(owner,{expectedRevision:2,checklistRevision:'old',id:'F-001',decision:'trash'},'storage-review-stale-checklist-001'));
 await assert.rejects(f.service.saveDecision(owner,{expectedRevision:1,checklistRevision:'review-v1',id:'F-001',decision:'trash'},'storage-review-stale-snapshot-001'));
 assert.equal((await f.service.get(owner))?.decisions[0]?.decision,'keep');
});

test('checklist replacement requires current revision and preserves unchanged decided items',async()=>{
 const f=setup();await f.service.saveChecklist(owner,{expectedRevision:null,checklist:checklist()},'storage-review-create-001');
 await f.service.saveDecision(owner,{expectedRevision:1,checklistRevision:'review-v1',id:'F-001',decision:'defer'},'storage-review-decision-001');
 const beforeNoop=f.memory.historyRows.length;
 const same=await f.service.saveChecklist(owner,{expectedRevision:2,checklist:checklist()},'storage-review-same-checklist-001');
 assert.deepEqual(same.decisions,[{id:'F-001',decision:'defer'}]);assert.equal(f.memory.historyRows.length,beforeNoop);
 const changedSameRevision={...checklist(),items:[{...checklist().items[0],title:'篡改同版本'},checklist().items[1]]};
 await assert.rejects(f.service.saveChecklist(owner,{expectedRevision:2,checklist:changedSameRevision},'storage-review-same-revision-change-001'));
 await assert.rejects(f.service.saveChecklist(owner,{expectedRevision:1,checklist:checklist('review-v2')},'storage-review-stale-replace-001'));
 const replaced=await f.service.saveChecklist(owner,{expectedRevision:2,checklist:checklist('review-v2')},'storage-review-replace-001');
 assert.equal(replaced.revision,3);assert.equal(f.memory.historyRows.length,3);
 assert.deepEqual((await f.service.get(owner))?.checklist,checklist('review-v2'));
 assert.deepEqual(replaced.decisions,[{id:'F-001',decision:'defer'}]);
});

test('a new checklist revision cannot silently remove or alter a previously decided object',async()=>{
 const f=setup();await f.service.saveChecklist(owner,{expectedRevision:null,checklist:checklist()},'storage-review-create-001');
 await f.service.saveDecision(owner,{expectedRevision:1,checklistRevision:'review-v1',id:'F-001',decision:'keep'},'storage-review-decision-001');
 const changed=checklist('review-v2');changed.items[0]={...changed.items[0],title:'Different object'};
 for(const next of [changed,{...checklist('review-v2'),items:[checklist().items[1]]}])
  await assert.rejects(f.service.saveChecklist(owner,{expectedRevision:2,checklist:next},'storage-review-changed-decided'),error=>!!error&&typeof error==='object'&&'code'in error&&error.code==='CHECKLIST_DECISION_CONFLICT');
 assert.equal((await f.service.get(owner))?.revision,2);assert.equal(f.memory.historyRows.length,2);
});

test('rejects malformed IDs, duplicate IDs, unknown fields, oversize payloads, and another owner without writes',async()=>{
 const f=setup();
 const bad=[
  {...checklist(),unknown:true},
  {...checklist(),items:[checklist().items[0],checklist().items[0]]},
  {...checklist(),items:[{...checklist().items[0],status:'mystery'}]},
  {...checklist(),items:[{...checklist().items[0],status:['pending']}]},
  {...checklist(),items:[{...checklist().items[0],kind:['file']}]},
  {...checklist(),items:[{...checklist().items[0],id:'../private'}]},
  {...checklist(),context:{summary:'x'.repeat(140_000)}},
 ];
 for(let index=0;index<bad.length;index++)await assert.rejects(f.service.saveChecklist(owner,{expectedRevision:null,checklist:bad[index] as never},`storage-review-invalid-${String(index).padStart(3,'0')}`));
 await assert.rejects(f.service.saveChecklist('fixture-owner-b',{expectedRevision:null,checklist:checklist()},'storage-review-other-owner-001'));
 assert.equal(f.memory.rows.size,0);assert.equal(f.memory.receipts.size,0);assert.equal(f.memory.historyRows.length,0);
});

test('accepts optional empty display text from the browser parser and imports a legitimate synthetic 101-row listing',async()=>{
 const f=setup(),items=Array.from({length:101},(_,index)=>({id:`M${String(index+1).padStart(3,'0')}`,title:`合成目录${index+1}`,body:'',question:'',group:'',kind:'file' as const,status:'pending' as const}));
 const input={schema:1 as const,revision:'synthetic-101-v1',context:{summary:''},items};
 const result=await f.service.saveChecklist(owner,{expectedRevision:null,checklist:input},'storage-review-101-rows-001');
 assert.equal(result.checklist.items.length,101);assert.equal(result.checklist.context.summary,'');assert.equal(result.checklist.items[0]?.body,'');
});

test('processed and protected items are read-only and parsed snapshots cannot assign them decisions',async()=>{
 const f=setup(),parsed={...checklist(),items:[
  {...checklist().items[0],status:'processed' as const},
  {...checklist().items[1],status:'protected' as const},
 ]};
 await f.service.saveChecklist(owner,{expectedRevision:null,checklist:parsed},'storage-review-readonly-001');
 for(const id of ['F-001','F-002'])await assert.rejects(f.service.saveDecision(owner,{expectedRevision:1,checklistRevision:'review-v1',id,decision:'keep'},`storage-review-readonly-${id}-001`));
 await assert.rejects(f.service.saveDecision(owner,{expectedRevision:1,checklistRevision:'review-v1',id:'F-001',decision:['keep'] as never},'storage-review-enum-array-001'));
 const row=[...f.memory.rows.values()][0] as typeof f.memory.rows extends Map<string,infer V>?V:never;
 (row.draft as unknown as {storageReview:{revision:number;checklist:typeof parsed;decisions:{id:string;decision:'keep'}[]}}).storageReview.decisions=[{id:'F-001',decision:'keep'}];
 await assert.rejects(f.service.get(owner));
});

test('rejects an entry whose persisted snapshot revision differs from its platform revision',async()=>{
 const f=setup();await f.service.saveChecklist(owner,{expectedRevision:null,checklist:checklist()},'storage-review-create-001');
 const row=[...f.memory.rows.values()][0] as typeof f.memory.rows extends Map<string,infer V>?V:never;
 (row.draft as unknown as {storageReview:{revision:number}}).storageReview.revision=8;
 await assert.rejects(f.service.get(owner));
});

test('rejects a persisted decision whose enum value is an array instead of a string',async()=>{
 const f=setup();await f.service.saveChecklist(owner,{expectedRevision:null,checklist:checklist()},'storage-review-create-001');
 const row=[...f.memory.rows.values()][0]!;
 (row.draft as unknown as {storageReview:{decisions:unknown[]}}).storageReview.decisions=[{id:'F-001',decision:['keep']}];
 await assert.rejects(f.service.get(owner));
});

test('same-checklist no-op receipt replays the current entry without changing its timestamp or losing a guard',async()=>{
 const f=setup();await f.service.saveChecklist(owner,{expectedRevision:null,checklist:checklist()},'storage-review-create-001');
 await f.service.saveDecision(owner,{expectedRevision:1,checklistRevision:'review-v1',id:'F-001',decision:'keep'},'storage-review-decision-001');
 const current=[...f.memory.rows.values()][0]!,calls:number[]=[];
 const input={expectedRevision:2,checklist:checklist()};
 const first=await f.service.saveChecklist(owner,input,'storage-review-same-checklist-001',async()=>{calls.push(1);});
 const receipt=f.memory.receipts.get(JSON.stringify([owner,'storage-review-same-checklist-001']))!;
 const {ownerId,...currentPublic}=current;void ownerId;assert.deepEqual(receipt.result.entry,currentPublic);
 assert.deepEqual(await f.service.saveChecklist(owner,input,'storage-review-same-checklist-001',async()=>{calls.push(2);}),first);
 assert.deepEqual(calls,[1,1,2,2]);assert.equal(f.memory.historyRows.length,2);assert.equal(f.memory.rows.get(current.id)?.updatedAt,current.updatedAt);
});

test('refuses a decision write that would make the durable snapshot exceed its validated size limit',async()=>{
 const f=setup(),items=Array.from({length:500},(_,index)=>({id:`I${index}`,title:`Item ${index}`,body:'x'.repeat(130),question:'?',group:'g',kind:'file' as const,status:'pending' as const}));
 const sourceChecklist={schema:1 as const,revision:'large-v1',context:{summary:''},items};
 const currentDecisionCount=462,decisions=items.slice(0,currentDecisionCount).map(item=>({id:item.id,decision:'keep' as const}));
 const state={revision:currentDecisionCount+1,checklist:sourceChecklist,decisions};
 await f.service.saveChecklist(owner,{expectedRevision:null,checklist:sourceChecklist},'storage-review-large-create-001');
 const entry=[...f.memory.rows.values()][0]!;
 const draft={...entry.draft,storageReview:state};
 const patched:typeof entry={...entry,revision:state.revision,draft};
 f.memory.rows.set(entry.id,patched);f.memory.historyRows.push(patched);
 assert.equal((await f.service.get(owner))?.revision,state.revision);
 const previousHistory=f.memory.historyRows.length,previousReceipts=f.memory.receipts.size;
 await assert.rejects(f.service.saveDecision(owner,{expectedRevision:state.revision,checklistRevision:'large-v1',id:items[currentDecisionCount]!.id,decision:'keep'},'storage-review-large-decision-001'),error=>!!error&&typeof error==='object'&&'code'in error&&error.code==='STORAGE_REVIEW_TOO_LARGE');
 assert.equal(f.memory.historyRows.length,previousHistory);assert.equal(f.memory.receipts.size,previousReceipts);assert.equal((await f.service.get(owner))?.revision,state.revision);
});
