import test from 'node:test';
import assert from 'node:assert/strict';
import {handleJournal} from '../src/journal-candidate/http.ts';
import {JournalService} from '../src/journal-candidate/service.ts';
import {DraftService} from '../src/platform/service.ts';
import {PlatformError} from '../src/platform/domain.ts';
import {createPlatformHandler} from '../src/platform/http.ts';
import {MemoryPort} from './helpers/platform.ts';

const owner={id:'fixture-owner-a',email:'fixture@example.invalid'},baseURL='http://127.0.0.1:3190';
const confirmation=()=>({text:'【虚构】日记的原始文字',kind:'life',timeZone:'Asia/Shanghai',adapter:'manual',fields:{title:'虚构日记标题',body:'虚构日记正文',date:null},confirmed:true,singleItem:true,syntheticOnly:true});
function setup(){
 const repository=new MemoryPort(),drafts=new DraftService(repository),journal=new JournalService(drafts);
 const request=(path:string,method='GET',body?:unknown,origin=baseURL,key='journal-http-key-001')=>new Request(baseURL+'/api/platform/'+path,{method,headers:{host:new URL(baseURL).host,origin,'content-type':'application/json','idempotency-key':key},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const send=(path:string,method='GET',body?:unknown,origin=baseURL,key='journal-http-key-001')=>handleJournal(request(path,method,body,origin,key),owner.id,baseURL,journal);
 return {repository,drafts,journal,request,send};
}

test('journal route returns only journal envelopes, with no-store headers and explicit review scope',async()=>{
 const f=setup();await f.drafts.captureConfirmed(owner.id,confirmation(),'journal-http-life-001');
 await f.drafts.mutate(owner.id,'inbox',null,{title:'普通收件箱',text:'不是日记'},'journal-http-inbox-001');
 const defaults=await f.send('journal');assert.ok(defaults);assert.equal(defaults.status,200);assert.deepEqual((await defaults.json()).items,[]);
 const review=await f.send('journal?includeSynthetic=1');assert.ok(review);assert.equal(review.headers.get('Cache-Control'),'private, no-store');assert.equal(review.headers.get('X-Content-Type-Options'),'nosniff');
 const body=await review.json();assert.equal(body.items.length,1);assert.equal(body.dataStatus,'isolated-test-drafts');assert.equal(body.syntheticIncluded,true);
 assert.equal(await f.send('inbox'),null);
});

test('journal create detail edit history share the core record and report duplicate receipts honestly',async()=>{
 const f=setup(),post=await f.send('journal','POST',confirmation());assert.ok(post);assert.equal(post.status,201);
 const created=await post.json(),id=created.entry.id;
 const duplicate=await f.send('journal','POST',confirmation());assert.ok(duplicate);assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);
 await assert.rejects(f.send('journal/'+id),(e:unknown)=>e instanceof PlatformError&&e.status===404);
 const detail=await f.send('journal/'+id+'?includeSynthetic=1');assert.ok(detail);assert.equal((await detail.json()).entry.id,id);
 const patch=await f.send('journal/'+id+'?includeSynthetic=1','PATCH',{expectedRevision:1,text:'人工编辑正文'},baseURL,'journal-http-edit-001');assert.ok(patch);assert.equal(patch.status,200);assert.equal((await patch.json()).entry.revision,2);
 const history=await f.send('journal/'+id+'/history?includeSynthetic=1');assert.ok(history);const h=await history.json();assert.equal(h.limit,100);assert.deepEqual(h.history.map((e:{revision:number})=>e.revision),[2,1]);
 assert.equal(f.repository.rows.size,1);assert.equal(f.repository.historyRows.length,2);
});

test('journal origin, JSON and method boundaries reject mutations without storage writes',async()=>{
 const f=setup();
 await assert.rejects(f.send('journal','POST',confirmation(),'https://example.invalid'),(e:unknown)=>e instanceof PlatformError&&e.status===403);
 const request=new Request(baseURL+'/api/platform/journal',{method:'POST',headers:{origin:baseURL,'content-type':'text/plain'},body:'{}'});
 await assert.rejects(handleJournal(request,owner.id,baseURL,f.journal),(e:unknown)=>e instanceof PlatformError&&e.status===415);
 const badMethod=await f.send('journal','DELETE');assert.ok(badMethod);assert.equal(badMethod.status,405);assert.equal(badMethod.headers.get('Allow'),'GET, POST');assert.equal((await badMethod.json()).error.code,'METHOD_NOT_ALLOWED');
 assert.equal(f.repository.rows.size,0);assert.equal(f.repository.reads,0);
});

test('journal history is read-only and invalid detail ids and revisions retain core validation',async()=>{
 const f=setup(),life=await f.drafts.captureConfirmed(owner.id,confirmation(),'journal-http-life-001');
 const readOnly=await f.send('journal/'+life.entry.id+'/history','POST',{});assert.ok(readOnly);assert.equal(readOnly.status,405);assert.equal(readOnly.headers.get('Allow'),'GET');
 await assert.rejects(f.send('journal/not-a-uuid?includeSynthetic=1'),(e:unknown)=>e instanceof PlatformError&&e.code==='INVALID_ID');
 await assert.rejects(f.send('journal/'+life.entry.id,'PATCH',{expectedRevision:2,text:'冲突正文'}),(e:unknown)=>e instanceof PlatformError&&e.code==='REVISION_CONFLICT');
 assert.equal(f.repository.historyRows.length,1);
});

test('shared platform authorization blocks journal paths before any business storage access',async()=>{
 const f=setup();
 for(const principal of [null,{userId:'fixture-owner-b',email:'other@example.invalid'}]){
  const handler=createPlatformHandler({repository:f.repository,sessions:{read:async()=>principal},owner,baseURL});
  const response=await handler(f.request('journal?includeSynthetic=1','POST',confirmation()));
  assert.equal(response.status,principal?403:401);assert.equal((await response.json()).error.code,principal?'ACCOUNT_NOT_ALLOWED':'LOGIN_REQUIRED');
 }
 assert.equal(f.repository.reads,0);assert.equal(f.repository.rows.size,0);
});
