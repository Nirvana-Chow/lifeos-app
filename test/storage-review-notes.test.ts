import test from 'node:test';
import assert from 'node:assert/strict';
import {StorageReviewService} from '../src/storage-review/service.ts';
import {validateReviewSnapshot,validateNoteCommand} from '../src/storage-review/domain.ts';
import {handleStorageReviewRequest} from '../src/storage-review/http.ts';
import {expectedStorageReviewFields,validateStorageReviewFields} from '../src/storage-review/agent-fields.ts';
import {MemoryPort} from './helpers/platform.ts';
import type {Transaction} from '../src/platform/contracts.ts';

const owner='synthetic-notes-owner',spaceId='synthetic-notes-space';
const checklist={schema:1 as const,revision:'synthetic-notes-v1',context:{summary:''},items:['pending','protected','processed'].map((status,index)=>({id:'N-'+index,title:'Synthetic '+status,body:'Original synthetic body',question:'',group:'Synthetic',kind:'file' as const,status:status as 'pending'|'protected'|'processed'}))};
function fixture(){
 const memory=new MemoryPort(),transaction=memory.transaction.bind(memory);
 memory.transaction=(owner,key,run)=>transaction(owner,key,tx=>run({...tx,lockRecordIdentity:async()=>{}}));
 return{memory,service:new StorageReviewService(memory,{ownerId:owner,spaceId})};
}
const command=(expectedRevision=1,id='N-0',note='  原文用途\n处理要求：先核对，不删除。  ')=>( {expectedRevision,checklistRevision:checklist.revision,id,note} );
const code=(expected:string)=>(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code===expected;

test('notes preserve exact text, stable identity and independent decisions/status across service instances',async()=>{
 const f=fixture();await f.service.saveChecklist(owner,{expectedRevision:null,checklist},'synthetic-notes-create');
 let rev=1;for(const item of checklist.items){const saved=await f.service.saveNote(owner,command(rev++,item.id),'synthetic-note-'+item.id);assert.equal(saved.notes!.find(n=>n.id===item.id)!.note,command().note);}
 const second=new StorageReviewService(f.memory,{ownerId:owner,spaceId}),snapshot=(await second.get(owner))!;
 assert.deepEqual(snapshot.checklist,checklist);assert.deepEqual(snapshot.decisions,[]);assert.equal(snapshot.notes!.length,3);
 const decided=await f.service.saveDecision(owner,{expectedRevision:4,checklistRevision:checklist.revision,id:'N-0',decision:'keep'},'synthetic-note-independent-decision');
 assert.deepEqual(decided.notes,snapshot.notes);assert.deepEqual((await second.getEntry(owner))!.fields.notes,snapshot.notes);
});

test('note receipts replay original result after later changes, no-op does not bump version, empty clears explicitly',async()=>{
 const f=fixture();await f.service.saveChecklist(owner,{expectedRevision:null,checklist},'synthetic-notes-create');
 const first=await f.service.saveNote(owner,command(),'synthetic-note-original');
 const noop=await f.service.saveNote(owner,command(2),'synthetic-note-noop');assert.equal(noop.revision,2);assert.equal(f.memory.historyRows.length,2);
 await f.service.saveNote(owner,command(2,'N-0','updated'),'synthetic-note-later');
 assert.deepEqual(await f.service.saveNote(owner,command(),'synthetic-note-original'),first);
 assert.equal((await f.service.get(owner))!.notes![0]!.note,'updated');
 await assert.rejects(f.service.saveNote(owner,command(3,'N-0','different'),'synthetic-note-original'),code('COMMAND_CONFLICT'));
 const clear=await f.service.saveNote(owner,command(3,'N-0',''),'synthetic-note-clear');assert.deepEqual(clear.notes,[]);assert.equal(clear.revision,4);
});
test('whitespace-only note remains original text and is distinct from explicit empty clear',async()=>{
 const f=fixture();await f.service.saveChecklist(owner,{expectedRevision:null,checklist},'synthetic-notes-create');
 assert.deepEqual((await f.service.saveNote(owner,command(1,'N-0','  \n  '),'synthetic-note-whitespace')).notes,[{id:'N-0',note:'  \n  '}]);
});

test('old snapshots remain readable; malformed/oversize notes and absent/foreign/stale inputs never write',async()=>{
 const f=fixture();await f.service.saveChecklist(owner,{expectedRevision:null,checklist},'synthetic-notes-create');
 assert.equal(validateReviewSnapshot({revision:1,checklist,decisions:[]}).notes,undefined);
 for(const note of [undefined,null,3,'x'.repeat(8001),'nul\0value'])assert.throws(()=>validateNoteCommand({...command(),note}));
 for(const [index,change] of [{expectedRevision:2},{checklistRevision:'stale'},{id:'not-present'}].entries())await assert.rejects(f.service.saveNote(owner,{...command(),...change},'synthetic-note-invalid-'+index),code(index<2?'REVISION_CONFLICT':'NOT_FOUND'));
 await assert.rejects(f.service.saveNote('foreign-owner',command(),'synthetic-note-foreign'));
 await assert.rejects(f.service.saveNote(owner,{...command(),decision:'trash'},'synthetic-note-extra'));
 for(const notes of [[{id:'N-0',note:''}],[{id:'N-0',note:'x'},{id:'N-0',note:'y'}],[{id:'missing',note:'x'}],[{id:'N-0',note:'x',extra:1}]])assert.throws(()=>validateReviewSnapshot({revision:1,checklist,decisions:[],notes}));
 assert.equal(f.memory.historyRows.length,1);
});

test('new checklist cannot remove or replace a noted object; retaining and explicit clearing preserve control',async()=>{
 const f=fixture();await f.service.saveChecklist(owner,{expectedRevision:null,checklist},'synthetic-notes-create');
 await f.service.saveNote(owner,command(),'synthetic-note-original');
 const next={...checklist,revision:'synthetic-notes-v2'};
 for(const items of [next.items.slice(1),next.items.map((i,index)=>index?i:{...i,title:'Different object'})])await assert.rejects(f.service.saveChecklist(owner,{expectedRevision:2,checklist:{...next,items}},'synthetic-note-replace-'+items.length),code('CHECKLIST_NOTE_CONFLICT'));
 const saved=await f.service.saveChecklist(owner,{expectedRevision:2,checklist:next},'synthetic-note-retain');assert.deepEqual(saved.notes,[{id:'N-0',note:command().note}]);
 await f.service.saveNote(owner,{...command(3,'N-0',''),checklistRevision:next.revision},'synthetic-note-clear-before-remove');
 assert.equal((await f.service.saveChecklist(owner,{expectedRevision:4,checklist:{...next,revision:'synthetic-notes-v3',items:next.items.slice(1)}},'synthetic-note-remove-cleared')).revision,5);
});

test('note writes execute current and transaction guards before receipt replay or data writes',async()=>{
 const f=fixture();await f.service.saveChecklist(owner,{expectedRevision:null,checklist},'synthetic-notes-create');
 let live=true,fenced=true;
 const guard=async()=>{if(!live)throw Error('synthetic grant revoked');},fence=async(_tx:Transaction)=>{if(!fenced)throw Error('synthetic fence revoked');};
 await f.service.saveNoteResult(owner,command(),'synthetic-note-fenced',guard,fence,{kind:'agent-grant',grantId:'synthetic-grant',operationId:'updateStorageReviewNote'});
 fenced=false;await assert.rejects(f.service.saveNoteResult(owner,command(),'synthetic-note-fenced',guard,fence));
 live=false;await assert.rejects(f.service.saveNote(owner,command(2),'synthetic-note-revoked',guard));assert.equal(f.memory.historyRows.length,2);
});

test('owner note HTTP saves through the same guards and independently reads exact note; closed origin and method',async()=>{
 const f=fixture();await f.service.saveChecklist(owner,{expectedRevision:null,checklist},'synthetic-notes-create');
 const origin='https://lifeos.example.test',path='/api/platform/personal/storage-review';
 const options={ownerId:owner,baseURL:origin,service:f.service,assertOwner:async()=>{},assertWritable:async()=>{}};
 const req=(method:string,suffix:string,body?:unknown,other={})=>new Request(origin+path+suffix,{method,headers:{host:'lifeos.example.test',origin,'content-type':'application/json','idempotency-key':'synthetic-note-http',...other},...(body===undefined?{}:{body:JSON.stringify(body)})});
 assert.equal((await handleStorageReviewRequest(req('PATCH','/notes',command()),options))!.status,200);
 const read=await(await handleStorageReviewRequest(req('GET',''),options))!.json();assert.equal(read.review.notes[0].note,command().note);
 await assert.rejects(handleStorageReviewRequest(req('PATCH','/notes',command(2),{origin:'https://foreign.invalid'}),options),code('ORIGIN_DENIED'));
 await assert.rejects(handleStorageReviewRequest(req('PATCH','/notes',command(2),{authorization:'Bearer synthetic'}),options),code('OWNER_ONLY'));
 assert.equal((await handleStorageReviewRequest(req('GET','/notes'),options))!.status,405);
});
test('UTF8 durable state limit rejects a note without changing records, history or receipts',async()=>{
 const f=fixture(),large={...checklist,items:Array.from({length:9},(_,i)=>({...checklist.items[0]!,id:'B'+i,body:'x'.repeat(13000)}))};
 await f.service.saveChecklist(owner,{expectedRevision:null,checklist:large},'synthetic-notes-large-create');
 await assert.rejects(f.service.saveNote(owner,command(1,'B0','字'.repeat(8000)),'synthetic-notes-large-note'),code('STORAGE_REVIEW_TOO_LARGE'));
 assert.equal(f.memory.historyRows.length,1);assert.equal(f.memory.receipts.size,1);assert.equal((await f.service.get(owner))!.revision,1);
});
test('Agent expected-field contract preserves raw notes through note, decision and checklist projections',()=>{
 const fields={checklistRevision:checklist.revision,itemId:'N-1',note:command().note};
 assert.deepEqual(validateStorageReviewFields('updateStorageReviewNote',fields),fields);
 const before={checklist,decisions:[]},expected=expectedStorageReviewFields('updateStorageReviewNote',fields,before);
 assert.deepEqual(expected.notes,[{id:'N-1',note:command().note}]);assert.deepEqual(expected.decisions,[]);
 const decided=expectedStorageReviewFields('updateStorageReviewDecision',{checklistRevision:checklist.revision,itemId:'N-0',decision:'keep'},expected);
 assert.deepEqual(decided.notes,expected.notes);
 const next=expectedStorageReviewFields('updateStorageReviewChecklist',{checklist:{...checklist,revision:'v2'}},decided);assert.deepEqual(next.notes,expected.notes);
 assert.deepEqual(expectedStorageReviewFields('updateStorageReviewNote',{...fields,note:''},expected).notes,[]);
 assert.throws(()=>validateStorageReviewFields('updateStorageReviewNote',{...fields,decision:'trash'}));
 assert.throws(()=>expectedStorageReviewFields('updateStorageReviewChecklist',{checklist:{...checklist,revision:'v2',items:[]}},expected),code('CHECKLIST_NOTE_CONFLICT'));
});
