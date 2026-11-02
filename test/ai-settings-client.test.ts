import test from'node:test';import assert from'node:assert/strict';import{aiSettingsRequest,AISettingsRequestError}from'../src/workbench/ai-settings-client.ts';
test('client does not automatically retry a failed paid test and distinguishes uncertain writes from login rejection',async()=>{
 let calls=0;await assert.rejects(()=>aiSettingsRequest(async()=>{calls++;throw Error('network');},'connection-test','POST',{expectedRevision:2,confirmCost:true}),e=>e instanceof AISettingsRequestError&&e.uncertain);assert.equal(calls,1);
 await assert.rejects(()=>aiSettingsRequest(async()=>new Response(null,{status:401}),'settings'),e=>e instanceof AISettingsRequestError&&e.status===401&&e.message.includes('登录'));
});
test('client refuses malformed or secret-bearing successful responses instead of putting them in form state',async()=>{
 await assert.rejects(()=>aiSettingsRequest(async()=>Response.json({revision:1,apiKey:'fixture-not-real-secret'}),'settings'),e=>e instanceof AISettingsRequestError&&!e.message.includes('fixture-not-real-secret'));
});
test('untrusted error messages cannot echo a submitted secret in the UI',async()=>{
 await assert.rejects(()=>aiSettingsRequest(async()=>Response.json({error:{code:'AI_CONNECTION_TEST_FAILED',message:'fixture-secret-upstream-error'}},{status:503}),'connection-test','POST',{}),e=>e instanceof Error&&!e.message.includes('fixture-secret'));
});
