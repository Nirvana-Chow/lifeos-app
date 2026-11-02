import test from 'node:test';
import assert from 'node:assert/strict';
import {createArkCaptureExtractor} from '../src/platform/ark-capture.ts';
import {previewCapture,waitForCaptureSignal} from '../src/platform/capture.ts';
import {AISettingsService} from '../src/platform/ai-settings-service.ts';
import {createAISecretVault} from '../src/platform/ai-secret-vault.ts';
import {MemoryAISettings} from './helpers/ai-settings.ts';
const config={provider:'volcengine-ark',baseURL:'https://ark.cn-beijing.volces.com/api/v3',model:'synthetic-r59-model',dataScope:'current-message-only',monthlyBudgetMinor:null} as const;
const owner='synthetic-r59-owner',secret='synthetic-r59-key-never-real',input={text:'【虚构】整理示例笔记。',kind:'todo',timeZone:'Asia/Shanghai',adapter:'ai'} as const;
const fields={title:'虚构笔记',body:'示例正文',date:null},context={referenceDate:'2026-10-24'},now=new Date('2026-10-24T00:00:00.000Z');
const response=()=>Response.json({id:'synthetic-r59-response',object:'chat.completion',created:1,model:config.model,choices:[{index:0,message:{role:'assistant',content:JSON.stringify(fields)},finish_reason:'stop'}]});
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};};
async function promptly<T>(work:Promise<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('synthetic bounded wait expired')),300);})]);}finally{clearTimeout(timer);}}
async function setup(fetcher:typeof fetch=async()=>response()){
 const repository=new MemoryAISettings(),service=new AISettingsService(repository,createAISecretVault({keyId:'synthetic-r59-master',key:Buffer.alloc(32,19)}),{baseURL:'https://synthetic-r59.example.invalid',externalCallsApproved:false,dataTransmissionApproved:false,callBudgetApproved:false,syntheticTransport:fetcher});
 await service.saveConfig(owner,{expectedRevision:0,config});await service.saveSecret(owner,{expectedRevision:1,secret});return{repository,service};
}
test('already aborted caller prevents preview secret resolution and transport',async()=>{
 let reads=0,calls=0;const controller=new AbortController();controller.abort();const extractor=createArkCaptureExtractor(config,{mode:'synthetic-sdk-test',getSecret:async()=>{reads++;return secret;},fetch:async()=>{calls++;return response();}});
 await assert.rejects(()=>previewCapture(input,now,extractor,{signal:controller.signal}),{code:'CAPTURE_PREVIEW_CANCELLED'});assert.equal(reads,0);assert.equal(calls,0);
});
test('aborting a delayed secret lookup rejects promptly and late secret resolution never sends',async()=>{
 const secretWait=deferred<string>(),started=deferred<void>(),controller=new AbortController();let calls=0;const extractor=createArkCaptureExtractor(config,{mode:'synthetic-sdk-test',getSecret:async()=>{started.resolve();return secretWait.promise;},fetch:async()=>{calls++;return response();}});
 const work=previewCapture(input,now,extractor,{signal:controller.signal});await started.promise;controller.abort();await assert.rejects(()=>promptly(work),{code:'CAPTURE_PREVIEW_CANCELLED'});secretWait.resolve(secret);await new Promise<void>(r=>setImmediate(r));assert.equal(calls,0);
});
test('caller cancellation rejects an ignored transport and never returns its later valid output',async()=>{
 const transport=deferred<Response>(),started=deferred<void>(),controller=new AbortController();let sentSignal:AbortSignal|undefined;const extractor=createArkCaptureExtractor(config,{mode:'synthetic-sdk-test',getSecret:async()=>secret,fetch:async(_url,init)=>{sentSignal=init?.signal??undefined;started.resolve();return transport.promise;}});
 const work=previewCapture(input,now,extractor,{signal:controller.signal});await started.promise;controller.abort();await assert.rejects(()=>promptly(work),{code:'CAPTURE_PREVIEW_CANCELLED'});assert.equal(sentSignal?.aborted,true);transport.resolve(response());await new Promise<void>(r=>setImmediate(r));
});
test('the 15-second deadline covers a secret lookup that ignores cancellation',async t=>{
 const deadline=new AbortController(),started=deferred<void>();let timeout:number|undefined,calls=0;t.mock.method(AbortSignal,'timeout',(ms:number)=>{timeout=ms;return deadline.signal;});
 const extractor=createArkCaptureExtractor(config,{mode:'synthetic-sdk-test',getSecret:async()=>{started.resolve();return new Promise<string>(()=>{});},fetch:async()=>{calls++;return response();}}),work=previewCapture(input,now,extractor);
 await started.promise;deadline.abort(new DOMException('Synthetic deadline','TimeoutError'));await assert.rejects(()=>promptly(work),{code:'CAPTURE_PREVIEW_TIMEOUT'});assert.equal(timeout,15000);assert.equal(calls,0);
});
test('model replacement, key replacement and disable while a request is pending invalidate its result',async()=>{
 for(const change of ['model','key','disabled'] as const){
  let hold=false;const transport=deferred<Response>(),started=deferred<void>(),f=await setup(async()=>{if(hold){started.resolve();return transport.promise;}return response();});const tested=await f.service.testConnection(owner,{expectedRevision:2,confirmCost:true}),enabled=await f.service.activate(owner,{expectedRevision:tested.revision,enabled:true});const extractor=await f.service.captureExtractor(owner);assert.ok(extractor);hold=true;
  const work=previewCapture(input,now,extractor);await started.promise;
  if(change==='model')await f.service.saveConfig(owner,{expectedRevision:enabled.revision,config:{...config,model:'synthetic-r59-replaced'}});else if(change==='key')await f.service.saveSecret(owner,{expectedRevision:enabled.revision,secret:secret+'-replaced'});else await f.service.activate(owner,{expectedRevision:enabled.revision,enabled:false});
  transport.resolve(response());await assert.rejects(()=>work,{code:'CAPTURE_CONFIGURATION_CHANGED'});assert.equal((await f.service.view(owner)).enabled,false);
 }
});
test('connection-test cancellation closes only its pending revision and does not enable the provider',async()=>{
 const transport=deferred<Response>(),started=deferred<void>(),controller=new AbortController(),f=await setup(async()=>{started.resolve();return transport.promise;});const work=f.service.testConnection(owner,{expectedRevision:2,confirmCost:true},{signal:controller.signal});await started.promise;controller.abort();await assert.rejects(()=>promptly(work),{code:'AI_CONNECTION_TEST_FAILED'});const saved=await f.service.view(owner);assert.equal(saved.testState,'failed');assert.equal(saved.enabled,false);transport.resolve(response());await new Promise<void>(r=>setImmediate(r));assert.equal((await f.service.view(owner)).testState,'failed');
});
test('a completed preview can be rechecked after a later owner read and rejects changed configuration',async()=>{
 const f=await setup(),tested=await f.service.testConnection(owner,{expectedRevision:2,confirmCost:true}),enabled=await f.service.activate(owner,{expectedRevision:tested.revision,enabled:true}),extractor=await f.service.captureExtractor(owner);assert.ok(extractor);assert.deepEqual((await previewCapture(input,now,extractor)).fields,fields);
 await f.service.activate(owner,{expectedRevision:enabled.revision,enabled:false});assert.equal(typeof extractor.assertCurrent,'function');await assert.rejects(()=>extractor.assertCurrent!({signal:new AbortController().signal}),{code:'CAPTURE_CONFIGURATION_CHANGED'});
});
test('an adapter that resolves after cancellation cannot return a valid preview',async()=>{
 const wait=deferred<{fields:typeof fields;adapter:'ai-sdk-synthetic-test-v1'}>(),started=deferred<void>(),controller=new AbortController();const work=previewCapture(input,now,{aiMode:'synthetic-sdk-test',async extract(){started.resolve();return wait.promise;}},{signal:controller.signal});await started.promise;controller.abort();await assert.rejects(()=>promptly(work),{code:'CAPTURE_PREVIEW_CANCELLED'});wait.resolve({fields,adapter:'ai-sdk-synthetic-test-v1'});
});
test('configuration invalidation during secret lookup prevents fetch and redacts its error',async()=>{
 let current=true,calls=0;const extractor=createArkCaptureExtractor(config,{mode:'synthetic-sdk-test',assertCurrent:async()=>{if(!current)throw Object.assign(new Error('synthetic private detail'),{status:409,code:'CAPTURE_CONFIGURATION_CHANGED'});},getSecret:async()=>{current=false;return secret;},fetch:async()=>{calls++;return response();}});
 await assert.rejects(()=>previewCapture(input,now,extractor),error=>error instanceof Error&&!error.message.includes('synthetic private detail'));assert.equal(calls,0);
});
test('the deadline rejects an ignored transport and its eventual response stays discarded',async t=>{
 const deadline=new AbortController(),started=deferred<void>(),transport=deferred<Response>();let sentSignal:AbortSignal|undefined;t.mock.method(AbortSignal,'timeout',(ms:number)=>{assert.equal(ms,15000);return deadline.signal;});
 const extractor=createArkCaptureExtractor(config,{mode:'synthetic-sdk-test',getSecret:async()=>secret,fetch:async(_url,init)=>{sentSignal=init?.signal??undefined;started.resolve();return transport.promise;}}),work=previewCapture(input,now,extractor);await started.promise;deadline.abort(new DOMException('Synthetic deadline','TimeoutError'));await assert.rejects(()=>promptly(work),{code:'CAPTURE_PREVIEW_TIMEOUT'});assert.equal(sentSignal?.aborted,true);transport.resolve(response());await new Promise<void>(r=>setImmediate(r));
});
test('an already cancelled wait still observes a previously started rejected operation',async()=>{
 const controller=new AbortController();controller.abort();await assert.rejects(()=>waitForCaptureSignal(Promise.reject(Error('synthetic late private error')),controller.signal),{code:'CAPTURE_PREVIEW_CANCELLED'});await new Promise<void>(r=>setImmediate(r));
});
