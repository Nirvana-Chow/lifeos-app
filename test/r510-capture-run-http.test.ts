import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformHandler} from '../src/platform/http.ts';
import {MemoryPort} from './helpers/platform.ts';
import type {CaptureRun,CaptureRunRepository} from '../src/capture-runs-candidate/contracts.ts';
import type {CaptureExtractor} from '../src/platform/capture.ts';
const baseURL='http://127.0.0.1:3111',owner={id:'synthetic-run-owner',email:'synthetic-run@example.invalid'},principal={userId:owner.id,email:owner.email};
const id='53300000-0000-4000-8000-000000000001';
const input={text:'Explicit synthetic input, never real personal content.',kind:'life',adapter:'manual',timeZone:'Asia/Shanghai'};
class Runs implements CaptureRunRepository{
 rows=new Map<string,CaptureRun>();tail:Promise<unknown>=Promise.resolve();failRecord=false;
 async get(owner:string,id:string){return structuredClone(this.rows.get(owner+':'+id)??null);}
 async change(owner:string,id:string,fn:(prior:CaptureRun|null)=>CaptureRun){const next=this.tail.then(async()=>{const row=fn(await this.get(owner,id));if(this.failRecord&&row.state==='confirmed')throw Error('Synthetic metadata storage failure');this.rows.set(owner+':'+id,structuredClone(row));return structuredClone(row);});this.tail=next.catch(()=>{});return next;}
}
function request(path:string,body?:unknown,key='synthetic-run-confirm-001',method?:string,signal?:AbortSignal){return new Request(baseURL+'/api/platform/capture/'+path,{method:method??(body===undefined?'GET':'POST'),signal,headers:{host:new URL(baseURL).host,origin:baseURL,'content-type':'application/json','idempotency-key':key},...(body===undefined?{}:{body:JSON.stringify(body)})});}
test('run-enabled preview persists private minimal metadata, no business record or original input',async()=>{
 const repository=new MemoryPort(),captureRuns=new Runs();
 const handler=createPlatformHandler({repository,captureRuns,owner,baseURL,sessions:{read:async()=>principal}} as Parameters<typeof createPlatformHandler>[0]);
 const response=await handler(request('preview',{...input,runId:id}));assert.equal(response.status,200);
 const value=await response.json();assert.equal(value.preview.run.id,id);assert.equal(value.preview.run.state,'ready');assert.equal(repository.rows.size,0);
 const run=await captureRuns.get(owner.id,id);assert.equal(run?.state,'ready');assert.match(run?.sourceHash??'',/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(run),/Explicit synthetic input|fields|headers|secret/i);
 const read=await handler(request('runs/'+id));assert.equal(read.status,200);const receipt=await read.json();assert.equal(receipt.run.id,id);assert.equal('sourceHash' in receipt.run,false);assert.equal('ownerId' in receipt.run,false);
 const repeated=await handler(request('preview',{...input,runId:id}));assert.equal(repeated.status,409);assert.equal(captureRuns.rows.size,1);
});
const command=(runId=id)=>({...input,runId,fields:{title:'Human edited synthetic title',body:'Human final synthetic body',date:null},confirmed:true,singleItem:true,syntheticOnly:true});
const provenance={provider:'volcengine-ark' as const,model:'synthetic-model',configurationRevision:3,materialRevision:2,mode:'synthetic-sdk-test' as const};
const output={adapter:'ai-sdk-synthetic-test-v1' as const,fields:{title:'Synthetic candidate title',body:'Synthetic candidate body',date:null}};
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>resolve=done);return{promise,resolve};};
test('confirmation binds final human fields and server receipt; cancellation and forged input never write',async()=>{
 const repository=new MemoryPort(),captureRuns=new Runs(),handler=createPlatformHandler({repository,captureRuns,owner,baseURL,sessions:{read:async()=>principal}} as Parameters<typeof createPlatformHandler>[0]);
 await handler(request('preview',{...input,runId:id}));
 assert.equal((await handler(request('confirm',{...command(),confirmed:false}))).status,400);
 assert.equal((await handler(request('confirm',{...command(),text:'Different synthetic original'}))).status,409);assert.equal(repository.rows.size,0);
 const response=await handler(request('confirm',command()));assert.equal(response.status,201);const result=await response.json();
 assert.equal(result.entry.draft.title,command().fields.title);assert.equal(result.entry.source.original.inputText,input.text);assert.equal(result.entry.source.original.capture.runReceipt.id,id);assert.equal(result.entry.source.original.capture.modelRunVerified,false);
 assert.equal((await captureRuns.get(owner.id,id))?.record?.id,result.entry.id);
 assert.equal((await handler(request('runs/'+id+'/cancel',{}))).status,409);assert.equal(repository.rows.size,1);
 assert.equal((await handler(request('confirm',command()))).status,200);assert.equal(repository.rows.size,1);
});
test('pending cancellation is durable metadata only and a late provider cannot resurrect the run',async()=>{
 const repository=new MemoryPort(),captureRuns=new Runs(),entered=deferred<void>(),finish=deferred<typeof output>();let calls=0;
 const captureExtractor={aiMode:'synthetic-sdk-test',provenance,async extract(){calls++;entered.resolve();return finish.promise;}} as CaptureExtractor;
 const handler=createPlatformHandler({repository,captureRuns,owner,baseURL,captureExtractor,sessions:{read:async()=>principal}} as Parameters<typeof createPlatformHandler>[0]),controller=new AbortController();
 const pending=handler(request('preview',{...input,adapter:'ai',runId:id},undefined,undefined,controller.signal));await Promise.race([entered.promise,pending.then(()=>assert.fail("Preview settled before entering the provider"))]);
 assert.equal((await handler(request('preview',{...input,adapter:'ai',runId:id}))).status,409);assert.equal(calls,1);
 controller.abort();const cancelled=await pending;assert.equal(cancelled.status,499);finish.resolve(output);assert.equal((await captureRuns.get(owner.id,id))?.state,'cancelled');assert.equal(repository.rows.size,0);
 assert.equal((await handler(request('confirm',{...command(),adapter:'ai'}))).status,409);assert.equal(repository.rows.size,0);
});
test('ready cancellation is owner scoped and configuration changes reject an unconfirmed AI run',async()=>{
 const repository=new MemoryPort(),captureRuns=new Runs();let revision=3;
 const handler=()=>createPlatformHandler({repository,captureRuns,owner,baseURL,captureExtractor:{aiMode:'synthetic-sdk-test',provenance:{...provenance,configurationRevision:revision},async extract(){return output;}},sessions:{read:async()=>principal}} as Parameters<typeof createPlatformHandler>[0]);
 await handler()(request('preview',{...input,adapter:'ai',runId:id}));revision++;
 const rejected=await handler()(request('confirm',{...command(),adapter:'ai'}));assert.equal(rejected.status,409);assert.equal((await rejected.json()).error.code,'CAPTURE_CONFIGURATION_CHANGED');assert.equal(repository.rows.size,0);assert.equal((await captureRuns.get(owner.id,id))?.state,'configuration-changed');
 const other='53300000-0000-4000-8000-000000000002';await handler()(request('preview',{...input,runId:other}));
 assert.equal((await handler()(request('runs/'+other+'/cancel',{}))).status,200);assert.equal((await captureRuns.get(owner.id,other))?.state,'cancelled');
 const foreign=createPlatformHandler({repository,captureRuns,owner:{id:'synthetic-other-owner',email:'other@example.invalid'},baseURL,sessions:{read:async()=>({userId:'synthetic-other-owner',email:'other@example.invalid'})}} as Parameters<typeof createPlatformHandler>[0]);
 assert.equal((await foreign(request('runs/'+other))).status,404);assert.equal((await foreign(request('runs/'+other+'/cancel',{}))).status,404);
});
test('business commit before metadata failure stays uncertain; exact command recovers after config removal without a second model call',async()=>{
 const repository=new MemoryPort(),captureRuns=new Runs();let calls=0,configured=true;
 const handler=()=>createPlatformHandler({repository,captureRuns,owner,baseURL,...(configured?{captureExtractor:{aiMode:'synthetic-sdk-test' as const,provenance,async extract(){calls++;return output;}}}:{}),sessions:{read:async()=>principal}} as Parameters<typeof createPlatformHandler>[0]);
 await handler()(request('preview',{...input,adapter:'ai',runId:id}));captureRuns.failRecord=true;
 const frozen={...command(),adapter:'ai'},failed=await handler()(request('confirm',frozen));assert.equal(failed.status,503);assert.equal(repository.rows.size,1);assert.equal((await captureRuns.get(owner.id,id))?.state,'confirmation-pending');
 configured=false;captureRuns.failRecord=false;
 assert.equal((await handler()(request('confirm',{...frozen,fields:{...frozen.fields,title:'Changed after uncertainty'}}))).status,409);
 const retried=await handler()(request('confirm',frozen));assert.equal(retried.status,200);const result=await retried.json();assert.equal(result.duplicate,true);assert.equal(result.entry.source.original.capture.runReceipt.provenance.mode,'synthetic-sdk-test');assert.equal(result.entry.source.original.capture.realModelConfigured,false);assert.equal(result.entry.source.original.capture.modelRunVerified,true);assert.equal(calls,1);assert.equal(repository.rows.size,1);assert.equal((await captureRuns.get(owner.id,id))?.state,'confirmed');
});
test('final owner failure after ready metadata invalidates ready without exposing generated fields',async()=>{
 const repository=new MemoryPort(),captureRuns=new Runs();
 const handler=createPlatformHandler({repository,captureRuns,owner,baseURL,sessions:{read:async()=>[...captureRuns.rows.values()].some(row=>row.state==='ready')?null:principal}} as Parameters<typeof createPlatformHandler>[0]);
 const result=await handler(request('preview',{...input,runId:id}));assert.equal(result.status,401);assert.equal((await captureRuns.get(owner.id,id))?.state,'failed');assert.equal(repository.rows.size,0);
});
test('session revoked while reserving run metadata prevents provider dispatch',async()=>{
 const repository=new MemoryPort(),captureRuns=new Runs();let calls=0;
 const handler=createPlatformHandler({repository,captureRuns,owner,baseURL,captureExtractor:{aiMode:'synthetic-sdk-test',provenance,async extract(){calls++;return output;}},sessions:{read:async()=>captureRuns.rows.size?null:principal}});
 const response=await handler(request('preview',{...input,adapter:'ai',runId:id}));assert.equal(response.status,401);assert.equal(calls,0);assert.equal(repository.rows.size,0);assert.equal((await captureRuns.get(owner.id,id))?.state,'failed');
});
test('run reads recheck the original session after awaiting metadata storage',async()=>{
 const repository=new MemoryPort(),captureRuns=new Runs();let revoked=false,revokeOnRead=false;const original=captureRuns.get.bind(captureRuns);
 captureRuns.get=async(owner,id)=>{const row=await original(owner,id);if(revokeOnRead)revoked=true;return row;};
 const handler=createPlatformHandler({repository,captureRuns,owner,baseURL,sessions:{read:async()=>revoked?null:principal}});
 await handler(request('preview',{...input,runId:id}));revokeOnRead=true;
 const response=await handler(request('runs/'+id));assert.equal(response.status,401);assert.doesNotMatch(await response.text(),new RegExp(id));
});
test('run routes reject query/body ambiguity and malformed identifiers without mutation',async()=>{
 const repository=new MemoryPort(),captureRuns=new Runs(),handler=createPlatformHandler({repository,captureRuns,owner,baseURL,sessions:{read:async()=>principal}} as Parameters<typeof createPlatformHandler>[0]);
 await handler(request('preview',{...input,runId:id}));
 assert.equal((await handler(request('runs/'+id+'?owner=synthetic-other'))).status,400);
 assert.equal((await handler(request('runs/'+id+'/cancel?unused=true',{}))).status,400);
 assert.equal((await handler(request('confirm',command('-'.repeat(36))))).status,400);
 assert.equal((await captureRuns.get(owner.id,id))?.state,'ready');
});
test('cancellation during final confirmation configuration lookup cannot later bind or write',async()=>{
 const repository=new MemoryPort(),captureRuns=new Runs(),entered=deferred<void>(),finish=deferred<void>();let blocked=false;
 const captureExtractor:CaptureExtractor={aiMode:'synthetic-sdk-test',provenance,async extract(){return output;},async assertCurrent(){if(blocked){entered.resolve();await finish.promise;}}};
 const handler=createPlatformHandler({repository,captureRuns,owner,baseURL,captureExtractor,sessions:{read:async()=>principal}} as Parameters<typeof createPlatformHandler>[0]);
 await handler(request('preview',{...input,adapter:'ai',runId:id}));blocked=true;const controller=new AbortController(),pending=handler(request('confirm',{...command(),adapter:'ai'},undefined,undefined,controller.signal));
 await Promise.race([entered.promise,pending.then(()=>assert.fail('Configuration check was skipped'))]);controller.abort();finish.resolve();const response=await pending;assert.equal(response.status,499);assert.equal(repository.rows.size,0);assert.equal((await captureRuns.get(owner.id,id))?.confirmationHash,null);
});
