import test from'node:test';import assert from'node:assert/strict';
import{AISettingsService}from'../src/platform/ai-settings-service.ts';import{createAISecretVault}from'../src/platform/ai-secret-vault.ts';import{MemoryAISettings}from'./helpers/ai-settings.ts';
const owner='fixture-owner-a',config={provider:'volcengine-ark',baseURL:'https://ark.cn-beijing.volces.com/api/v3',model:'fixture-model',dataScope:'current-message-only',monthlyBudgetMinor:1000},secret='fixture-provider-secret-never-real';
function completion(){return Response.json({id:'fixture',object:'chat.completion',created:1,model:'fixture-model',choices:[{index:0,message:{role:'assistant',content:JSON.stringify({title:'连接测试',body:'测试',date:null})},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});}
function setup(fetcher:typeof fetch=async()=>completion(),secure=true){const repository=new MemoryAISettings(),vault=createAISecretVault({keyId:'fixture-master',key:Buffer.alloc(32,7)}),options={baseURL:secure?'https://review.example.invalid':'http://127.0.0.1:3190',externalCallsApproved:false,dataTransmissionApproved:false,callBudgetApproved:false,syntheticTransport:fetcher};return{repository,vault,options,service:new AISettingsService(repository,vault,options)};}
async function configured(f:ReturnType<typeof setup>){await f.service.saveConfig(owner,{expectedRevision:0,config});await f.service.saveSecret(owner,{expectedRevision:1,secret});}
test('ordinary config persists/readbacks, secret is encrypted and public replies never contain secret/envelope/owner',async()=>{
 const f=setup();await configured(f);const value=await new AISettingsService(f.repository,f.vault,f.options).view(owner);
 assert.equal(value.revision,2);assert.deepEqual(value.config,config);assert.equal(value.secretState,'stored');assert.equal(value.enabled,false);assert.equal(value.testState,'never');
 assert.ok(!JSON.stringify(f.repository.rows).includes(secret));assert.ok(!JSON.stringify([...f.repository.rows.values()]).includes(secret));
 const body=JSON.stringify(value);for(const forbidden of [secret,'ciphertext','fixture-master',owner])assert.ok(!body.includes(forbidden));
 assert.equal((await f.service.view('fixture-owner-b')).config,null);
 await assert.rejects(()=>f.service.saveConfig(owner,{expectedRevision:0,config}),{code:'AI_SETTINGS_CONFLICT'});
});
test('saving and testing are separate, explicit cost confirmation is required and key change disables activation',async()=>{
 let calls=0;const f=setup(async()=>{calls++;return completion();});await configured(f);assert.equal(calls,0);
 await assert.rejects(()=>f.service.activate(owner,{expectedRevision:2,enabled:true}));await assert.rejects(()=>f.service.testConnection(owner,{expectedRevision:2,confirmCost:false}));assert.equal(calls,0);
 const tested=await f.service.testConnection(owner,{expectedRevision:2,confirmCost:true});assert.equal(tested.testState,'passed');assert.equal(tested.mode,'synthetic-sdk-test');assert.equal(tested.enabled,false);assert.equal(calls,1);
 const enabled=await f.service.activate(owner,{expectedRevision:tested.revision,enabled:true});assert.equal(enabled.enabled,true);assert.equal(enabled.realModelActive,false);
 const replaced=await f.service.saveSecret(owner,{expectedRevision:enabled.revision,secret:secret+'-replacement'});assert.equal(replaced.enabled,false);assert.equal(replaced.testState,'never');
 await assert.rejects(()=>f.service.activate(owner,{expectedRevision:replaced.revision,enabled:true}));assert.equal(calls,1);
});
test('HTTP or missing vault cannot accept a secret and default live policy cannot call a model',async()=>{
 const f=setup(undefined,false);await f.service.saveConfig(owner,{expectedRevision:0,config});await assert.rejects(()=>f.service.saveSecret(owner,{expectedRevision:1,secret}),{code:'AI_SECRET_ENTRY_UNAVAILABLE'});assert.equal(f.repository.rows.get(owner)?.secret,null);
 const missing=new AISettingsService(f.repository,null,{...f.options,baseURL:'https://review.example.invalid'});assert.equal((await missing.view(owner)).capabilities.secretWritable,false);
 const closed=setup();await configured(closed);const service=new AISettingsService(closed.repository,closed.vault,{baseURL:closed.options.baseURL,externalCallsApproved:false,dataTransmissionApproved:false,callBudgetApproved:false});await assert.rejects(()=>service.testConnection(owner,{expectedRevision:2,confirmCost:true}),{code:'AI_CALLS_NOT_APPROVED'});
});
test('pending connection cannot be duplicated and a changed config makes its completion stale',async()=>{
 let complete!:(r:Response)=>void;let called!:()=>void;const started=new Promise<void>(r=>called=r);let calls=0;
 const f=setup(async()=>{calls++;called();return new Promise<Response>(r=>complete=r);});await configured(f);
 const pending=f.service.testConnection(owner,{expectedRevision:2,confirmCost:true});await started;
 const during=await f.service.view(owner);assert.equal(during.testState,'pending');
 await assert.rejects(()=>f.service.testConnection(owner,{expectedRevision:during.revision,confirmCost:true}),{code:'AI_TEST_BUSY'});
 await f.service.saveConfig(owner,{expectedRevision:during.revision,config:{...config,model:'changed-fixture-model'}});complete(completion());await assert.rejects(()=>pending,{code:'AI_SETTINGS_CONFLICT'});
 const after=await f.service.view(owner);assert.equal(after.testState,'never');assert.equal(after.enabled,false);assert.equal(calls,1);
});
test('failed connection remains disabled, removes old success and hides upstream secret-bearing errors',async()=>{
 const f=setup(async()=>{throw Error(secret+' upstream');});await configured(f);await assert.rejects(()=>f.service.testConnection(owner,{expectedRevision:2,confirmCost:true}),e=>e instanceof Error&&!e.message.includes(secret));
 const view=await f.service.view(owner);assert.equal(view.testState,'failed');assert.equal(view.enabled,false);assert.equal(view.realModelActive,false);
});
