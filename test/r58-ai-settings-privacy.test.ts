import test from'node:test';import assert from'node:assert/strict';
import{AISettingsClient,AISettingsRequestError}from'../src/workbench/ai-settings-client.ts';
import type{PublicAISettings}from'../src/platform/ai-settings-contract.ts';
const owner='synthetic-settings-owner-a';
const view:PublicAISettings={storage:'ready',revision:3,config:{provider:'volcengine-ark',baseURL:'https://ark.cn-beijing.volces.com/api/v3',model:'synthetic-model-a',dataScope:'current-message-only',monthlyBudgetMinor:null},secretState:'stored',secretMask:'••••••••',enabled:false,realModelActive:false,mode:'synthetic-sdk-test',testState:'passed',testedAt:'2026-10-23T10:00:00.000Z',capabilities:{configurationWritable:true,secretWritable:true,connectionTestAvailable:true,activationAvailable:true},notice:'Synthetic settings'};
function session(id:string|null){return Response.json(id?{user:{id},session:{userId:id}}:null);}

test('settings client binds its first owner and rejects an account switch before reading or writing',async()=>{
 let account:string|null=owner,requests=0;const client=new AISettingsClient(async path=>String(path).endsWith('/get-session')?session(account):(requests++,Response.json(view)));
 assert.equal((await client.request('settings')).config?.model,'synthetic-model-a');assert.equal(requests,1);account='synthetic-settings-owner-b';
 await assert.rejects(client.request('settings'),e=>e instanceof AISettingsRequestError&&e.status===403);
 await assert.rejects(client.request('secret','PUT',{expectedRevision:3,secret:'synthetic-not-a-real-secret'}),e=>e instanceof AISettingsRequestError&&e.status===403&&!e.uncertain);assert.equal(requests,1);
 account=owner;assert.equal((await client.request('settings')).revision,3);
});

test('a successful settings response cannot be returned after post-read identity changes',async()=>{
 let identities=0;const client=new AISettingsClient(async path=>String(path).endsWith('/get-session')?session(++identities===1?owner:'synthetic-settings-owner-b'):Response.json(view));
 await assert.rejects(client.request('settings'),e=>e instanceof AISettingsRequestError&&e.status===403&&!e.uncertain);assert.equal(identities,2);
});

test('identity failure after a committed mutation stays uncertain and never repeats the write',async()=>{
 let identities=0,writes=0;const client=new AISettingsClient(async(path,init)=>{if(String(path).endsWith('/get-session'))return++identities===1?session(owner):Response.json({}, {status:503});if(init?.method==='POST')writes++;return Response.json({...view,revision:4});});
 await assert.rejects(client.request('connection-test','POST',{expectedRevision:3,confirmCost:true}),e=>e instanceof AISettingsRequestError&&e.uncertain&&!e.message.includes('synthetic-model-a'));assert.equal(writes,1);
});

test('hidden view during identity preflight cancels unsent secret before mutation dispatch',async()=>{
 let complete!:(response:Response)=>void,writes=0,visible=true;const identity=new Promise<Response>(resolve=>{complete=resolve;});
 const client=new AISettingsClient(async(path,init)=>{if(String(path).endsWith('/get-session'))return identity;if(init?.method==='PUT')writes++;return Response.json(view);});
 const operation=client.request('secret','PUT',{expectedRevision:3,secret:'synthetic-not-a-real-secret'},()=>visible);visible=false;complete(session(owner));
 await assert.rejects(operation,e=>e instanceof AISettingsRequestError&&!e.uncertain);assert.equal(writes,0);
});

test('malformed or failed identity blocks settings and never exposes untrusted identity errors',async()=>{
 for(const identity of [Response.json(null),Response.json({user:{id:owner},session:{userId:'wrong'}}),Response.json({error:{message:'synthetic-private-marker'}},{status:503})]){
  let reads=0;const client=new AISettingsClient(async path=>String(path).endsWith('/get-session')?identity:(reads++,Response.json(view)));
  await assert.rejects(client.request('settings'),e=>e instanceof AISettingsRequestError&&!e.message.includes('synthetic-private-marker'));assert.equal(reads,0);
 }
});

test('unknown mutation responses and post-test CAS conflicts remain uncertain without a retry',async()=>{
 for(const [status,code]of [[408,'REQUEST_TIMEOUT'],[409,'UNKNOWN_CONFLICT'],[409,'AI_SETTINGS_CONFLICT'],[409,'INVALID_AI_SETTINGS'],[401,'UNKNOWN_AUTH'],[503,'AI_CONNECTION_TEST_FAILED']]as const){
  let writes=0;const client=new AISettingsClient(async(path,init)=>{if(String(path).endsWith('/get-session'))return session(owner);if(init?.method==='POST')writes++;return Response.json({error:{code,message:'synthetic-private-error'}},{status});});
  await assert.rejects(client.request('connection-test','POST',{expectedRevision:3,confirmCost:true}),e=>e instanceof AISettingsRequestError&&e.uncertain&&!e.message.includes('synthetic-private-error'),`${status} ${code} must require readback`);assert.equal(writes,1);
 }
});

test('only matching known pre-write rejection codes are definitive',async()=>{
 for(const [path,status,code]of [['connection-test',400,'INVALID_AI_SETTINGS'],['connection-test',403,'ORIGIN_DENIED'],['settings',409,'AI_SETTINGS_CONFLICT'],['connection-test',409,'AI_SECRET_REQUIRED'],['connection-test',503,'AI_CALLS_NOT_APPROVED']]as const){
  const client=new AISettingsClient(async input=>String(input).endsWith('/get-session')?session(owner):Response.json({error:{code,message:'synthetic-private-error'}},{status}));
  await assert.rejects(client.request(path,path==='settings'?'PUT':'POST',{}),e=>e instanceof AISettingsRequestError&&!e.uncertain&&!e.message.includes('synthetic-private-error'));
 }
});
