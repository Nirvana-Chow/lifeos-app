import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PlatformError} from '../src/platform/domain.ts';
import {handleStorageReviewRequest} from '../src/storage-review/http.ts';

const origin = 'https://lifeos.example.test';
const path = '/api/platform/personal/storage-review';
const key = 'synthetic-storage-review-command';
const checklist = {schema:1 as const,revision:'fixture-1',context:{summary:''},items:[]};
const snapshot = {revision:2,checklist,decisions:[]};

function request(method = 'GET', headers:Record<string,string> = {}, body?:unknown, suffix = '') {
  return new Request(origin+path+suffix, {method, headers:{host:new URL(origin).host, ...headers},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
}

function fixture() {
  const calls:string[] = [];
  const service = {
    get:async(owner:string)=>{calls.push('get:'+owner);return snapshot;},
    saveChecklist:async(owner:string,input:unknown,command:string,guard?:()=>Promise<void>)=>{
      assert.deepEqual(input,{expectedRevision:null,checklist});
      calls.push('checklist:'+owner+':'+command);
      await guard?.();
      return snapshot;
    },
    saveDecision:async(owner:string,input:unknown,command:string,guard?:()=>Promise<void>)=>{
      assert.deepEqual(input,{expectedRevision:1,checklistRevision:'fixture-1',id:'A01',decision:'keep'});
      calls.push('decision:'+owner+':'+command);
      await guard?.();
      return snapshot;
    },
  };
  const guards = {
    assertOwner:async()=>{calls.push('owner');},
    assertWritable:async()=>{calls.push('writable');},
  };
  return {calls,guards,run:(req:Request,ready=true)=>handleStorageReviewRequest(req,{
    ownerId:'owner',baseURL:origin,service:ready?service:undefined,...guards,
  })};
}

const rejected = (code:string) => (error:unknown)=>error instanceof PlatformError&&error.code===code;
const writeHeaders = {origin,'Content-Type':'application/json','Idempotency-Key':key};

test('storage review reads through the owner guard and returns private snapshot only',async()=>{
  const f=fixture();
  const response=await f.run(request());
  assert.equal(response?.status,200);
  assert.equal(response?.headers.get('cache-control'),'private, no-store');
  assert.equal(response?.headers.get('vary'),'Cookie');
  assert.deepEqual(await response?.json(),{review:snapshot});
  assert.deepEqual(f.calls,['owner','get:owner','owner']);
});

test('storage review rejects a missing store, machine header and other origin before repository access',async()=>{
  const f=fixture();
  await assert.rejects(f.run(request(),false),rejected('STORAGE_REVIEW_UNAVAILABLE'));
  await assert.rejects(f.run(request('GET',{authorization:'Bearer fixture-only'})),rejected('OWNER_ONLY'));
  await assert.rejects(f.run(request('POST',{...writeHeaders,origin:'https://other.example.test'},{expectedRevision:null,checklist})),rejected('ORIGIN_DENIED'));
  assert.ok(f.calls.every(call=>call==='owner'));
});

test('storage review uses independent owner and write guards before and within writes',async()=>{
  const f=fixture();
  assert.deepEqual(await (await f.run(request('POST',writeHeaders,{expectedRevision:null,checklist})))?.json(),{review:snapshot});
  assert.deepEqual(await (await f.run(request('PATCH',writeHeaders,{expectedRevision:1,checklistRevision:'fixture-1',id:'A01',decision:'keep'})))?.json(),{review:snapshot});
  assert.deepEqual(f.calls,[
    'owner','owner','writable','checklist:owner:'+key,'owner','writable',
    'owner','owner','writable','decision:owner:'+key,'owner','writable',
  ]);
  const denied=fixture();
  denied.guards.assertWritable=async()=>{throw new PlatformError(503,'WRITE_PERMIT_REQUIRED','locked');};
  await assert.rejects(denied.run(request('POST',writeHeaders,{expectedRevision:null,checklist})),rejected('WRITE_PERMIT_REQUIRED'));
  assert.ok(denied.calls.every(call=>call==='owner'));
});

test('storage review has one exact route and rejects unexpected query and methods',async()=>{
  const f=fixture();
  assert.equal(await f.run(request('GET',{},undefined,'/extra')),null);
  await assert.rejects(f.run(request('GET',{},undefined,'?revision=1')),rejected('INVALID_QUERY'));
  const response=await f.run(request('DELETE'));
  assert.equal(response?.status,405);
  assert.equal(response?.headers.get('allow'),'GET, POST, PATCH');
});
