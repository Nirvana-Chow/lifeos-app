import test from 'node:test';
import assert from 'node:assert/strict';
import {DraftService} from '../src/platform/service.ts';
import {JournalService} from '../src/journal-candidate/service.ts';
import {MemoryPort} from './helpers/platform.ts';
import {PlatformError} from '../src/platform/domain.ts';

const owner='fixture-owner-a';
const confirmation=()=>({text:'【虚构】保留的原始生活文字。',kind:'life',timeZone:'Asia/Shanghai',adapter:'manual',fields:{title:'虚构日记标题',body:'虚构日记正文。',date:null},confirmed:true,singleItem:true,syntheticOnly:true});
function setup(){const repository=new MemoryPort(),drafts=new DraftService(repository);return {repository,drafts,journal:new JournalService(drafts)};}

test('journal inclusion requires a life capture marker and the authenticated owner, excluding ordinary inbox and todo',async()=>{
 const f=setup(),life=await f.drafts.captureConfirmed(owner,confirmation(),'journal-life-001');
 await f.drafts.mutate(owner,'inbox',null,{title:'普通收件箱',text:'不是日记'},'journal-inbox-001');
 await f.drafts.captureConfirmed(owner,{...confirmation(),kind:'todo'},'journal-todo-001');
 await f.drafts.captureConfirmed('fixture-owner-b',confirmation(),'journal-other-001');
 assert.deepEqual((await f.journal.list(owner,{includeSynthetic:true})).map(e=>e.id),[life.entry.id]);
 assert.deepEqual(await f.journal.list(owner),[]);
 assert.equal('ownerId' in (await f.journal.list(owner,{includeSynthetic:true}))[0],false);
});

test('journal creation keeps one existing inbox record, original text, history and idempotency receipt',async()=>{
 const f=setup();assert.equal(typeof f.journal.create,'function');
 const input=confirmation(),first=await f.journal.create(owner,input,'journal-create-001'),retry=await f.journal.create(owner,input,'journal-create-001');
 assert.equal(first.entry.kind,'inbox');assert.equal(retry.entry.id,first.entry.id);assert.equal(retry.duplicate,true);
 assert.deepEqual(first.entry.draft,{title:'虚构日记标题',text:'虚构日记正文。',occurredOn:null,disposition:'reference'});
 assert.equal((first.entry.source.original as {inputText:string}).inputText,'【虚构】保留的原始生活文字。');
 assert.equal(f.repository.rows.size,1);assert.equal(f.repository.historyRows.length,1);assert.equal(f.repository.receipts.size,1);
 await assert.rejects(f.journal.create(owner,{...input,fields:{...input.fields,title:'新标题'}},'journal-create-001'),(e:unknown)=>e instanceof PlatformError&&e.code==='COMMAND_CONFLICT');
});

test('journal rejects forged kind, owner, invalid date, missing confirmation and non-synthetic create without writes',async()=>{
 for(const patch of [{kind:'todo'},{ownerId:'fixture-owner-b'},{fields:{title:'日记',body:'正文',date:'2026-02-30'}},{fields:{title:'日记',body:'正文',date:'2026-13-01'}},{fields:{title:'日记',body:'',date:null}},{confirmed:false},{syntheticOnly:false}]){
  const f=setup();assert.equal(typeof f.journal.create,'function');
  await assert.rejects(f.journal.create(owner,{...confirmation(),...patch},'journal-invalid-001'),(e:unknown)=>e instanceof PlatformError&&e.status===400);
  assert.equal(f.repository.rows.size,0);assert.equal(f.repository.receipts.size,0);
 }
});

test('journal get and history exclude ordinary inbox, other owners and hidden review records',async()=>{
 const f=setup();assert.equal(typeof f.journal.get,'function');assert.equal(typeof f.journal.history,'function');
 const life=await f.drafts.captureConfirmed(owner,confirmation(),'journal-life-001'),plain=await f.drafts.mutate(owner,'inbox',null,{title:'普通收件箱',text:'普通正文'},'journal-plain-001');
 const denied=(e:unknown)=>e instanceof PlatformError&&e.status===404;
 assert.equal((await f.journal.get(owner,life.entry.id,{includeSynthetic:true})).id,life.entry.id);
 for(const id of [life.entry.id,plain.entry.id])await assert.rejects(f.journal.get(owner,id),denied);
 await assert.rejects(f.journal.get(owner,plain.entry.id,{includeSynthetic:true}),denied);
 await assert.rejects(f.journal.get('fixture-owner-b',life.entry.id,{includeSynthetic:true}),denied);
 await assert.rejects(f.journal.history(owner,plain.entry.id,{includeSynthetic:true}),denied);
 assert.deepEqual((await f.journal.history(owner,life.entry.id,{includeSynthetic:true})).map(e=>e.revision),[1]);
});

test('journal edits preserve source, record identity and history, enforce revisions, and replay an unchanged command',async()=>{
 const f=setup();assert.equal(typeof f.journal.update,'function');
 const first=await f.drafts.captureConfirmed(owner,confirmation(),'journal-life-001');
 const body={expectedRevision:1,title:'人工修订',text:'修改后的正文',occurredOn:'2024-02-29'};
 const changed=await f.journal.update(owner,first.entry.id,body,'journal-edit-001');
 assert.equal(changed.entry.id,first.entry.id);assert.equal(changed.entry.revision,2);assert.deepEqual(changed.entry.source,first.entry.source);
 assert.deepEqual(changed.entry.draft,{title:'人工修订',text:'修改后的正文',occurredOn:'2024-02-29',disposition:'reference'});
 assert.equal((await f.journal.update(owner,first.entry.id,body,'journal-edit-001')).duplicate,true);
 await assert.rejects(f.journal.update(owner,first.entry.id,{...body,text:'另一次编辑'},'journal-edit-002'),(e:unknown)=>e instanceof PlatformError&&e.code==='REVISION_CONFLICT');
 const history=await f.journal.history(owner,first.entry.id,{includeSynthetic:true});
 assert.deepEqual(history.map(e=>e.revision),[2,1]);assert.equal('text' in history[1].draft&&history[1].draft.text,'虚构日记正文。');
 assert.equal(f.repository.rows.size,1);assert.equal(f.repository.historyRows.length,2);
});

test('journal edit cannot target plain inbox or another owner, erase text, change disposition or write impossible dates',async()=>{
 const f=setup();assert.equal(typeof f.journal.update,'function');
 const first=await f.drafts.captureConfirmed(owner,confirmation(),'journal-life-001'),plain=await f.drafts.mutate(owner,'inbox',null,{title:'普通收件箱',text:'正文'},'journal-plain-001');
 await assert.rejects(f.journal.update(owner,plain.entry.id,{expectedRevision:1,text:'wrong'},'journal-wrong-001'),(e:unknown)=>e instanceof PlatformError&&e.status===404);
 await assert.rejects(f.journal.update('fixture-owner-b',first.entry.id,{expectedRevision:1,text:'wrong'},'journal-wrong-002'),(e:unknown)=>e instanceof PlatformError&&e.status===404);
 for(const patch of [{text:''},{text:'  '},{occurredOn:'2026-02-29'},{disposition:'pending'},{ownerId:'fixture-owner-b'},{source:{}}])await assert.rejects(f.journal.update(owner,first.entry.id,{expectedRevision:1,...patch},'journal-invalid-edit-001'),(e:unknown)=>e instanceof PlatformError&&e.status===400);
 assert.equal(f.repository.rows.size,2);assert.equal(f.repository.historyRows.length,2);assert.equal(f.repository.receipts.size,2);
});
