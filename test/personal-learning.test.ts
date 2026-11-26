import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LearningSQLiteFixture} from './helpers/learning-sqlite.ts';
import {handleLearningRequest} from '../src/personal-learning/http.ts';
import {projectSchedule} from '../src/personal-learning/domain.ts';
import {LearningService} from '../src/personal-learning/service.ts';

test('word cards and immutable events are isolated and replay from durable, contiguous history', async t => {
  const root = await mkdtemp(join(tmpdir(),'lifeos-learning-unit-'));
  const filename = join(root,'learning.sqlite');
  let repo = new LearningSQLiteFixture(filename);
  t.after(async()=>{repo.close(); await rm(root,{recursive:true,force:true});});
  const binding = {ownerId:'synthetic-owner',spaceId:'synthetic-space'};
  const other = {ownerId:'another-owner',spaceId:binding.spaceId};
  const otherSpace = {...binding,spaceId:'another-space'};
  const baseURL = 'http://127.0.0.1:31212';
  let clock = new Date('2027-03-13T17:30:00.000Z');
  let service = new LearningService(repo,()=>clock);
  let active = binding;
  let writable = true;
  const runtime = () => ({baseURL,service,authorize:async()=>({binding:active,writable})});
  const req = (query='',command?:unknown,key='synthetic-cmd-1',scope?:string) => new Request(baseURL+'/personal/learning/data'+query,{
    method:command?'POST':'GET',headers:{host:'127.0.0.1:31212',origin:baseURL,'content-type':'application/json',
      'idempotency-key':key,...(scope?{'x-learning-scope':scope}:{})},...(command?{body:JSON.stringify(command)}:{}),
  });
  assert.equal((await handleLearningRequest(req(),null)).status,404);
  const scope = (await (await handleLearningRequest(req(),runtime())).json()).scope;
  const make = {kind:'create',confirmed:true,front:'synthetic word',back:'synthetic definition'};
  assert.equal((await handleLearningRequest(req('',make),runtime())).status,403);
  assert.equal((await handleLearningRequest(req('',{...make,confirmed:false},'synthetic-create',scope),runtime())).status,400);
  const initial = await handleLearningRequest(req('',make,'synthetic-create',scope),runtime());
  assert.equal(initial.status,200);
  const created = await initial.json();
  const untouched = await service.detail(binding,created.id,null);
  assert.equal(untouched.schedule,null);
  assert.deepEqual(untouched.history,[]);
  assert.deepEqual((await service.snapshot(binding)).dueCardIds,[]);
  const review = {kind:'review',confirmed:true,cardId:created.id,cardRevision:1,previousId:null,rating:'recalled'};
  const [first,competing] = await Promise.all([
    handleLearningRequest(req('',review,'synthetic-first',scope),runtime()),
    handleLearningRequest(req('',review,'synthetic-competing',scope),runtime()),
  ]);
  assert.equal(first.status,200);
  assert.equal(competing.status,409);
  const firstReceipt = await first.json();
  assert.notEqual(firstReceipt.id,created.id);
  assert.deepEqual(await (await handleLearningRequest(req('',review,'synthetic-first',scope),runtime())).json(),firstReceipt);
  assert.equal((await handleLearningRequest(req('',{...review,rating:'again'},'synthetic-first',scope),runtime())).status,409);
  const firstDue = '2027-03-16T17:30:00.000Z';
  const firstRead = await service.detail(binding,created.id,firstReceipt.id);
  assert.equal(firstRead.schedule?.nextDueAt,firstDue);
  assert.throws(()=>projectSchedule(firstRead.card,[{...firstRead.history[0],sequence:2}]),/Incomplete/);
  for (const [at,due] of [['2027-03-16T17:29:59.999Z',false],[firstDue,true]] as const) {
    clock = new Date(at);
    assert.deepEqual((await service.snapshot(binding)).dueCardIds,due?[created.id]:[]);
  }
  for (const foreign of [other,otherSpace]) {
    active = foreign;
    const result = await (await handleLearningRequest(req(),runtime())).json();
    assert.deepEqual(result.cards,[]);
    assert.notEqual(result.scope,scope);
    assert.equal((await handleLearningRequest(req('?card='+created.id+'&review='+firstReceipt.id),runtime())).status,404);
    assert.equal((await handleLearningRequest(req('',review,'synthetic-first',scope),runtime())).status,403);
    assert.equal((await handleLearningRequest(req('',review,'synthetic-first',result.scope),runtime())).status,404);
  }
  active = binding;
  writable = false;
  assert.equal((await handleLearningRequest(req('',review,'synthetic-first',scope),runtime())).status,403);
  writable = true;
  repo.close();
  repo = new LearningSQLiteFixture(filename);
  service = new LearningService(repo,()=>clock);
  const next = {...review,previousId:firstReceipt.id};
  let guardCalls = 0;
  await assert.rejects(service.mutate(binding,next,'synthetic-aborted',async ()=>{
    if (++guardCalls === 2) throw new Error('revoked during transaction');
  }), /revoked/);
  assert.equal((await service.detail(binding,created.id,null)).history.length,1);
  const second = await service.mutate(binding,next,'synthetic-second',async()=>{});
  const after = await service.detail(binding,created.id,second.id);
  assert.equal(after.schedule?.nextDueAt,'2027-03-22T17:30:00.000Z');
  assert.equal(after.history.length,2);
  assert.deepEqual(after.history[0],firstRead.review);
  clock = new Date('2027-03-22T17:30:00.000Z');
  const lapse = await service.mutate(binding,{...review,previousId:second.id,rating:'again'},'synthetic-lapse',async()=>{});
  assert.deepEqual((await service.detail(binding,created.id,lapse.id)).schedule,{
    nextDueAt:'2027-03-23T17:30:00.000Z',consecutiveRecalls:0,
  });
  assert.equal((await service.detail(binding,created.id,null)).card.revision,1);
});

test('a pending browser command keeps exact bytes across reload, scoped to one verified workspace', async()=>{
  const {retainPending,readPending,clearPending}=await import('../src/personal-learning/pending.ts');
  const map=new Map<string,string>();
  const storage={
    getItem:(key:string)=>map.get(key)??null,
    setItem:(key:string,value:string)=>{map.set(key,value);},
    removeItem:(key:string)=>{map.delete(key);},
  };
  const scope='a'.repeat(64);
  const command={kind:'create',confirmed:true,front:'Word',back:'Meaning'} as const;
  const pending={scope,command,key:'learning-99edc2d0-46ba-435c-98fc-26dc16a4d195',
    body:'{ "kind":"create","confirmed":true,"front":"Word","back":"Meaning" }'};
  retainPending(storage,pending);
  assert.deepEqual(readPending(storage,scope),pending);
  assert.equal(readPending(storage,'b'.repeat(64)),null);
  const mismatch={...pending,body:JSON.stringify({...command,front:'Other'})};
  assert.throws(()=>retainPending(storage,mismatch),/待确认/);
  assert.equal(clearPending(storage,mismatch),false);
  assert.equal(clearPending(storage,pending),true);
  assert.equal(readPending(storage,scope),null);
  assert.throws(()=>retainPending({...storage,setItem:()=>{}},pending),/未保留/);
});
