import test from 'node:test';import assert from 'node:assert/strict';
import {createPlatformHandler} from '../src/platform/http.ts';import {MemoryPort} from './helpers/platform.ts';
const origin='http://127.0.0.1:3190';
function setup(repo=new MemoryPort(),user='fixture-owner-a'){
 const handler=createPlatformHandler({repository:repo,baseURL:origin,owner:{id:user,email:user+'@example.invalid'},sessions:{read:async h=>h.get('x-test-session')==='expired'?null:h.get('x-test-session')==='fail'?Promise.reject(Error('fixture-private-auth-error')):h.get('x-test-session')===user?{userId:user,email:user+'@example.invalid'}:h.get('x-test-session')==='wrong-owner'?{userId:'other',email:'other@example.invalid'}:null}});
 const req=async(path:string,method='GET',body?:unknown,key?:string,extra:Record<string,string>={})=>{
  const headers:Record<string,string>={host:'127.0.0.1:3190','x-test-session':user,...(body===undefined?{}:{origin,'content-type':'application/json'}),...(key?{'idempotency-key':key}:{}),...extra};
  const r=await handler(new Request(origin+'/api/platform/'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}));return {status:r.status,headers:r.headers,body:await r.json()};
 };
 return {repo,req,handler};
}
const expense={kind:'expense',amountMinor:1200,currency:'CNY',occurredOn:'2026-10-22',fromAccountRef:'fixture-wallet'};
test('missing, expired and forged identities cannot reach storage, including requirements',async()=>{
 const {req,repo}=setup();
 for(const path of ['todos','finance','requirements','status']){
  assert.equal((await req(path,'GET',undefined,undefined,{'x-test-session':'expired','x-owner':'fixture-owner-a'})).status,401);
 }
 assert.equal(repo.reads,0);assert.equal(repo.rows.size,0);
 assert.equal((await req('todos','GET',undefined,undefined,{'x-test-session':'wrong-owner'})).status,403);
 const failure=await req('todos','GET',undefined,undefined,{'x-test-session':'fail'});assert.equal(failure.status,503);assert.doesNotMatch(JSON.stringify(failure.body),/fixture-private/);
});
test('configured empty storage stays empty rather than inventing real records',async()=>{
 const {req}=setup();const r=await req('todos');assert.equal(r.status,200);assert.deepEqual(r.body.items,[]);assert.equal(r.headers.get('cache-control'),'private, no-store');
 assert.equal((await req('requirements')).body.baseline.baselineVersion,'lifeos-public-v1');
});
test('Next direct-loopback forwarding metadata works while external chains and mismatches fail',async()=>{
 const {req}=setup(),local={'x-forwarded-host':'127.0.0.1:3190','x-forwarded-proto':'http','x-forwarded-port':'3190','x-forwarded-for':'::ffff:127.0.0.1'};
 assert.equal((await req('todos','GET',undefined,undefined,local)).status,200);
 const spoofs:Record<string,string>[]=[{'x-forwarded-host':'evil.invalid'},{'x-forwarded-proto':'https'},{'x-forwarded-port':'9999'},{'x-forwarded-for':'127.0.0.1, 203.0.113.9'},{forwarded:'for=203.0.113.9'},{host:''}];
 for(const extra of spoofs)assert.equal((await req('todos','GET',undefined,undefined,{...local,...extra})).status,403);
});
test('only the exact Next localhost normalization is accepted with the canonical Host and Origin',async()=>{
 const {handler}=setup(),headers={host:'127.0.0.1:3190','x-test-session':'fixture-owner-a'};
 for(const url of ['http://localhost:3190','http://127.0.0.1:3190'])assert.equal((await handler(new Request(url+'/api/platform/todos',{headers}))).status,200);
 for(const url of ['http://localhost:3191','https://localhost:3190','http://evil.invalid:3190'])assert.equal((await handler(new Request(url+'/api/platform/todos',{headers}))).status,403);
 const post=(originHeader:string)=>handler(new Request('http://localhost:3190/api/platform/todos',{method:'POST',headers:{...headers,origin:originHeader,'content-type':'application/json','idempotency-key':'fixture-normalize-001'},body:JSON.stringify({title:'合成规范化请求'})}));
 assert.equal((await post('http://localhost:3190')).status,403);assert.equal((await post(origin)).status,201);
});
test('case-normalized stable UUIDs can be read without changing object identity',async()=>{
 const {req,repo}=setup(),id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 repo.rows.set(id,{id,ownerId:'fixture-owner-a',kind:'todo',draft:{title:'合成大小写测试',notes:'',dueOn:null,status:'open'},source:{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',system:'website',externalId:id,version:1,asOf:'2026-10-22T00:00:00.000Z',original:{title:'合成大小写测试'}},revision:1,createdAt:'2026-10-22T00:00:00.000Z',updatedAt:'2026-10-22T00:00:00.000Z',syncState:'draft',externalStatus:null});
 const r=await req('todos/'+id.toUpperCase());assert.equal(r.status,200);assert.equal(r.body.entry.id,id);
});
test('create, edit and retry preserve one source, original input and immutable earlier response',async()=>{
 const {req}=setup();const create={title:'  合成待办  ',notes:'原文'};
 const a=await req('todos','POST',create,'fixture-create-001');assert.equal(a.status,201);assert.equal(a.body.entry.draft.title,'合成待办');
 const id=a.body.entry.id,sourceId=a.body.entry.source.id;
 assert.equal(a.body.entry.source.original.title,'  合成待办  ');assert.equal(a.body.entry.syncState,'draft');assert.equal(a.body.entry.externalStatus,null);assert.equal(a.body.entry.ownerId,undefined);
 const edit=await req('todos/'+id,'PATCH',{expectedRevision:1,notes:'修改预览'},'fixture-edit-001');assert.equal(edit.status,200);assert.equal(edit.body.entry.revision,2);assert.equal(edit.body.entry.source.id,sourceId);assert.equal(edit.body.entry.source.original.notes,'原文');
 const retry=await req('todos','POST',{notes:'原文',title:'  合成待办  '},'fixture-create-001');assert.equal(retry.status,200);assert.equal(retry.body.duplicate,true);assert.equal(retry.body.entry.revision,1);
 assert.equal((await req('todos/'+id)).body.entry.revision,2);assert.equal((await req('todos')).body.items.length,1);
 assert.equal((await req('todos','POST',{title:'不同内容'},'fixture-create-001')).status,409);
 assert.equal((await req('todos/'+id,'PATCH',{expectedRevision:1,notes:'过期版本'},'fixture-edit-stale')).status,409);
});
test('a repository accidentally returning unscoped rows still cannot leak another owner',async()=>{
 const repo=new MemoryPort(),a=setup(repo),b=setup(repo,'fixture-owner-b');
 const created=await b.req('todos','POST',{title:'合成另一用户私有事项'},'fixture-other-001');const id=created.body.entry.id;
 assert.equal((await a.req('todos/'+id)).status,404);assert.deepEqual((await a.req('todos')).body.items,[]);
 assert.equal((await a.req('todos/'+id,'PATCH',{expectedRevision:1,title:'越权'},'fixture-forged-001')).status,404);
 assert.equal((await b.req('todos/'+id)).body.entry.draft.title,'合成另一用户私有事项');
});
test('write origin, content type, command key and identity fields are enforced before mutation',async()=>{
 const {req,repo}=setup();
 assert.equal((await req('todos','POST',{title:'合成'},'fixture-create-001',{origin:'https://evil.invalid'})).status,403);
 assert.equal((await req('todos','POST',{title:'合成'},'fixture-create-001',{'content-type':'text/plain'})).status,415);
 assert.equal((await req('todos','POST',{title:'合成'})).status,400);
 assert.equal((await req('todos','POST',{title:'合成',ownerId:'other'},'fixture-create-001')).status,400);
 assert.equal((await req('todos','DELETE')).status,405);assert.equal(repo.rows.size,0);
});
test('finance refund links are owned and transfer remains distinct from expense',async()=>{
 const repo=new MemoryPort(),a=setup(repo),b=setup(repo,'fixture-owner-b');
 const e=await a.req('finance','POST',expense,'fixture-expense-001');assert.equal(e.status,201);
 const refund=await a.req('finance','POST',{...expense,kind:'refund',amountMinor:300,originalEntryId:e.body.entry.id},'fixture-refund-001');assert.equal(refund.status,201);
 assert.equal((await b.req('finance','POST',{...expense,kind:'refund',originalEntryId:e.body.entry.id},'fixture-foreign-001')).status,404);
 const transfer=await a.req('finance','POST',{...expense,kind:'transfer',toAccountRef:'fixture-savings'},'fixture-transfer-001');assert.equal(transfer.body.entry.draft.kind,'transfer');
 assert.equal((await a.req('finance')).body.items.length,3);
});
test('an expense with linked refunds cannot change meaning and strand later refund edits',async()=>{
 const {req}=setup();const a=await req('finance','POST',expense,'fixture-linked-expense');
 const b=await req('finance','POST',{...expense,kind:'refund',amountMinor:300,originalEntryId:a.body.entry.id},'fixture-linked-refund');
 const denied=await req('finance/'+a.body.entry.id,'PATCH',{expectedRevision:1,kind:'income'},'fixture-linked-change');
 assert.equal(denied.status,409);assert.equal(denied.body.error.code,'LINKED_REFUNDS');
 assert.equal((await req('finance/'+a.body.entry.id)).body.entry.revision,1);
 assert.equal((await req('finance/'+b.body.entry.id,'PATCH',{expectedRevision:1,notes:'合成退款备注'},'fixture-refund-notes')).status,200);
 assert.equal((await req('finance/'+a.body.entry.id,'PATCH',{expectedRevision:1,notes:'合成支出备注'},'fixture-expense-notes')).status,200);
 const c=await req('finance','POST',expense,'fixture-unlinked-expense');
 assert.equal((await req('finance/'+c.body.entry.id,'PATCH',{expectedRevision:1,kind:'income'},'fixture-unlinked-change')).status,200);
});
test('malformed, oversized and failed storage requests expose no private error text or partial write',async()=>{
 const {req,repo,handler}=setup();
 const make=(body:string)=>new Request(origin+'/api/platform/todos',{method:'POST',headers:{host:'127.0.0.1:3190',origin,'content-type':'application/json','x-test-session':'fixture-owner-a','idempotency-key':'fixture-error-001'},body});
 assert.equal((await handler(make('{broken'))).status,400);
 assert.equal((await handler(make('x'.repeat(131073)))).status,413);
 repo.fail=true;const failure=await req('todos','POST',{title:'合成'},'fixture-error-001');assert.equal(failure.status,503);assert.doesNotMatch(JSON.stringify(failure.body),/fixture-private/);assert.equal(repo.rows.size,0);
});
test('workbench status never promotes synthetic fixture authentication to a configured personal account',async()=>{const f=setup();const r=await f.req('status');assert.equal(r.status,200);assert.equal(r.body.scope,'isolated-synthetic-review');assert.equal(r.body.storage.restrictedRoleVerified,false);assert.equal(r.body.personalAccountReady,false);assert.equal(r.body.personalDataAuthorized,false);assert.equal(r.body.ai.configured,false);assert.equal(r.body.ai.settingsPersistable,false);assert.ok(!JSON.stringify(r.body).includes('fixture@example.invalid'));});
