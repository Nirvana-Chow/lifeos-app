import test from 'node:test';import assert from 'node:assert/strict';
import {createPlatformHandler} from '../src/platform/http.ts';import {DraftService} from '../src/platform/service.ts';import {MemoryPort} from './helpers/platform.ts';
const baseURL='http://127.0.0.1:3190',owner={id:'fixture-preview-owner',email:'fixture-preview@example.invalid'};
function fixture(){const repo=new MemoryPort(),handler=createPlatformHandler({repository:repo,baseURL,owner,sessions:{read:async h=>h.get('x-test-login')==='yes'?{userId:owner.id,email:owner.email}:null}});
 const call=(body:unknown,extra:Record<string,string>={})=>handler(new Request(baseURL+'/api/platform/import/preview',{method:'POST',headers:{host:'127.0.0.1:3190',origin:baseURL,'content-type':'application/json','x-test-login':'yes',...extra},body:JSON.stringify(body)}));return{repo,handler,call};}
test('preview shared route enforces login, Origin, explicit synthetic scope and no writes',async()=>{
 const {repo,call}=fixture(),body={syntheticOnly:true,document:{format:'lifeos.review.export.v2',scope:'isolated-synthetic',entries:[],history:[]}};
 assert.equal((await call(body,{'x-test-login':'no'})).status,401);
 assert.equal((await call(body,{origin:'https://foreign.invalid'})).status,403);
 assert.equal((await call({...body,syntheticOnly:false})).status,400);
 const response=await call(body);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal((await response.json()).preview.writesPerformed,0);
 assert.equal(repo.rows.size,0);assert.equal(repo.receipts.size,0);assert.equal(repo.events.length,0);
});
test('duplicate detection uses only this owner snapshot; foreign-owner records are never disclosed',async()=>{
 const {repo,call}=fixture(),service=new DraftService(repo),{entry}=await service.mutate('fixture-foreign-owner','todo',null,{title:'synthetic foreign',notes:'',dueOn:null,status:'open'},'fixture-preview-foreign');
 const before=structuredClone({rows:[...repo.rows],events:repo.events,receipts:[...repo.receipts]});
 const response=await call({syntheticOnly:true,document:{format:'lifeos.review.export.v2',scope:'isolated-synthetic',entries:[entry],history:[]}});assert.equal(response.status,200);
 const result=await response.json();assert.equal(result.preview.counts.candidate,1);assert.equal(result.preview.counts.duplicate,0);
 assert.deepEqual({rows:[...repo.rows],events:repo.events,receipts:[...repo.receipts]},before);
});
