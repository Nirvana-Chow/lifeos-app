import test from 'node:test';import assert from 'node:assert/strict';
import {handleAISettings} from '../src/platform/ai-settings-http.ts';
import {AISettingsService} from '../src/platform/ai-settings-service.ts';
import {createAISecretVault} from '../src/platform/ai-secret-vault.ts';
import {PlatformError} from '../src/platform/domain.ts';
import {MemoryAISettings} from './helpers/ai-settings.ts';
const owner='synthetic-r510-owner',base='https://synthetic-r510.example.invalid',config={provider:'volcengine-ark',baseURL:'https://ark.cn-beijing.volces.com/api/v3',model:'synthetic-r510-model',dataScope:'current-message-only',monthlyBudgetMinor:null} as const;
const completion=()=>Response.json({id:'synthetic-response',object:'chat.completion',created:1,model:config.model,choices:[{index:0,message:{role:'assistant',content:JSON.stringify({title:'Synthetic',body:'Synthetic',date:null})},finish_reason:'stop'}]});
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};};
async function bounded<T>(work:Promise<T>){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Synthetic wait expired')),300);})]);}finally{clearTimeout(timer);}}
async function setup(fetcher:typeof fetch){const repository=new MemoryAISettings(),service=new AISettingsService(repository,createAISecretVault({keyId:'synthetic-r510-master',key:Buffer.alloc(32,10)}),{baseURL:base,externalCallsApproved:false,dataTransmissionApproved:false,callBudgetApproved:false,syntheticTransport:fetcher});await service.saveConfig(owner,{expectedRevision:0,config});await service.saveSecret(owner,{expectedRevision:1,secret:'synthetic-r510-key-not-real'});return{repository,service};}
function request(signal?:AbortSignal){return new Request(base+'/api/platform/ai/connection-test',{method:'POST',signal,headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({expectedRevision:2,confirmCost:true})});}
test('already aborted connection HTTP request neither reserves a test nor dispatches SDK',async()=>{
 let calls=0;const f=await setup(async()=>{calls++;return completion();}),abort=new AbortController();abort.abort();await assert.rejects(()=>handleAISettings(request(abort.signal),owner,base,f.service),{code:'AI_CONNECTION_TEST_CANCELLED'});assert.equal(calls,0);assert.equal((await f.service.view(owner)).revision,2);
});
test('HTTP cancellation reaches an ignored transport, closes pending safely and discards late success',async()=>{
 const started=deferred<void>(),late=deferred<Response>();let upstream:AbortSignal|undefined;const f=await setup(async(_url,init)=>{upstream=init?.signal??undefined;started.resolve();return late.promise;}),abort=new AbortController(),work=handleAISettings(request(abort.signal),owner,base,f.service);await started.promise;abort.abort();await assert.rejects(()=>bounded(work),{code:'AI_CONNECTION_TEST_CANCELLED'});assert.equal(upstream?.aborted,true);await new Promise<void>(r=>setImmediate(r));assert.equal((await f.service.view(owner)).testState,'failed');late.resolve(completion());await new Promise<void>(r=>setImmediate(r));assert.equal((await f.service.view(owner)).testState,'failed');
});
test('final owner failure suppresses an already committed test result without rewriting persisted state',async()=>{
 const f=await setup(async()=>completion());let reads=0;await assert.rejects(()=>handleAISettings(request(),owner,base,f.service,undefined,{assertOwner:async()=>{if(++reads===2)throw new PlatformError(403,'ACCOUNT_NOT_ALLOWED','Synthetic identity rejection');}}),{status:403});assert.equal((await f.service.view(owner)).testState,'passed');assert.equal((await f.service.view(owner)).enabled,false);
});
test('configuration changed during final owner recheck cannot return old test success',async()=>{
 const f=await setup(async()=>completion());let reads=0;await assert.rejects(()=>handleAISettings(request(),owner,base,f.service,undefined,{assertOwner:async()=>{if(++reads===2)await f.service.saveConfig(owner,{expectedRevision:4,config:{...config,model:'synthetic-r510-new-model'}});}}),{code:'AI_SETTINGS_CONFLICT'});assert.equal((await f.service.view(owner)).testState,'never');
});
test('abort while the final CAS is queued cannot persist a late passed result',async()=>{
 const f=await setup(async()=>completion()),started=deferred<void>(),release=deferred<void>(),abort=new AbortController(),original=f.repository.change.bind(f.repository);f.repository.change=async(who,revision,update)=>{if(revision===3){started.resolve();await release.promise;}return original(who,revision,update);};const work=f.service.testConnection(owner,{expectedRevision:2,confirmCost:true},{signal:abort.signal});await started.promise;abort.abort();release.resolve();await assert.rejects(()=>work);assert.notEqual((await f.service.view(owner)).testState,'passed');assert.equal((await f.service.view(owner)).enabled,false);
});
test('aborting an unfinished JSON body cancels its reader without reserving or calling the provider',async()=>{
 let cancelled=false,calls=0;const f=await setup(async()=>{calls++;return completion();}),abort=new AbortController(),body=new ReadableStream<Uint8Array>({start(output){output.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}}),req=new Request(base+'/api/platform/ai/connection-test',{method:'POST',signal:abort.signal,headers:{origin:base,'content-type':'application/json'},body,duplex:'half'} as RequestInit);
 const work=handleAISettings(req,owner,base,f.service);await new Promise<void>(r=>setImmediate(r));abort.abort();await assert.rejects(()=>bounded(work),{code:'AI_CONNECTION_TEST_CANCELLED'});assert.equal(cancelled,true);assert.equal(calls,0);assert.equal((await f.service.view(owner)).revision,2);
});
test('identity rejection after an upstream failure takes priority over its generic test error',async()=>{
 const f=await setup(async()=>{throw Error('Synthetic upstream failure');});let reads=0;await assert.rejects(()=>handleAISettings(request(),owner,base,f.service,undefined,{assertOwner:async()=>{if(++reads===2)throw new PlatformError(401,'LOGIN_REQUIRED','Synthetic signed out');}}),{status:401});assert.equal((await f.service.view(owner)).testState,'failed');
});
test('the connection HTTP deadline includes a stalled owner callback before any reservation',async t=>{
 const deadline=new AbortController(),started=deferred<void>();let calls=0;t.mock.method(AbortSignal,'timeout',(ms:number)=>{assert.equal(ms,20000);return deadline.signal;});const f=await setup(async()=>{calls++;return completion();}),work=handleAISettings(request(),owner,base,f.service,undefined,{assertOwner:async()=>{started.resolve();return new Promise<void>(()=>{});}});await started.promise;deadline.abort(new DOMException('Synthetic deadline','TimeoutError'));await assert.rejects(()=>bounded(work),{code:'AI_CONNECTION_TEST_TIMEOUT'});assert.equal(calls,0);assert.equal((await f.service.view(owner)).revision,2);
});
test('connection HTTP identity rejection after persisted success remains an uncertain client outcome',async()=>{
 const {AISettingsClient,AISettingsRequestError}=await import('../src/workbench/ai-settings-client.ts');
 for(const status of [401,403]){let calls=0,checks=0;const f=await setup(async()=>{calls++;return completion();}),client=new AISettingsClient(async input=>{if(String(input).endsWith('/get-session'))return Response.json({user:{id:owner},session:{userId:owner}});try{return (await handleAISettings(request(),owner,base,f.service,undefined,{assertOwner:async()=>{if(++checks===2)throw new PlatformError(status,status===401?'LOGIN_REQUIRED':'ACCOUNT_NOT_ALLOWED','Synthetic postflight failure');}}))!;}catch(cause){if(!(cause instanceof PlatformError))throw cause;return Response.json({error:{code:cause.code}},{status:cause.status});}});
  await assert.rejects(()=>client.request('connection-test','POST',{expectedRevision:2,confirmCost:true}),cause=>cause instanceof AISettingsRequestError&&cause.status===status&&cause.uncertain);assert.equal(calls,1);assert.equal((await f.service.view(owner)).testState,'passed');
  const ordinary=new AISettingsClient(async input=>String(input).endsWith('/get-session')?Response.json({user:{id:owner},session:{userId:owner}}):Response.json({error:{code:status===401?'LOGIN_REQUIRED':'ACCOUNT_NOT_ALLOWED'}},{status}));await assert.rejects(()=>ordinary.request('settings','PUT',{}),cause=>cause instanceof AISettingsRequestError&&cause.status===status&&!cause.uncertain);
 }
});
