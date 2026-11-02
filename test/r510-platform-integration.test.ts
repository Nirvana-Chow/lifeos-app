import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformHandler} from '../src/platform/http.ts';
import {AISettingsService} from '../src/platform/ai-settings-service.ts';
import {createAISecretVault} from '../src/platform/ai-secret-vault.ts';
import {MemoryAISettings} from './helpers/ai-settings.ts';
import {MemoryPort} from './helpers/platform.ts';
const owner={id:'synthetic-r510-integration-owner',email:'synthetic-owner@example.invalid'},baseURL='https://synthetic-r510.example.invalid';
const config={provider:'volcengine-ark',baseURL:'https://ark.cn-beijing.volces.com/api/v3',model:'synthetic-r510-integration',dataScope:'current-message-only',monthlyBudgetMinor:null} as const;
function request(origin=baseURL,signal?:AbortSignal){return new Request(baseURL+'/api/platform/ai/connection-test',{method:'POST',signal,headers:{host:new URL(baseURL).host,origin,'content-type':'application/json'},body:JSON.stringify({expectedRevision:2,confirmCost:true})});}
const completion=()=>Response.json({id:'synthetic-only',object:'chat.completion',created:1,model:config.model,choices:[{index:0,message:{role:'assistant',content:JSON.stringify({title:'Synthetic connection',body:'Synthetic',date:null})},finish_reason:'stop'}]});
async function setup(transport:typeof fetch){const repository=new MemoryAISettings(),service=new AISettingsService(repository,createAISecretVault({keyId:'synthetic-master-only',key:Buffer.alloc(32,27)}),{baseURL,externalCallsApproved:false,dataTransmissionApproved:false,callBudgetApproved:false,syntheticTransport:transport});await service.saveConfig(owner.id,{expectedRevision:0,config});await service.saveSecret(owner.id,{expectedRevision:1,secret:'synthetic-test-key-not-real'});return service;}
test('integrated connection route rechecks its original owner after asynchronous SDK work',async()=>{
 for(const mode of ['revoked','changed','unavailable'] as const){let live=true,calls=0;const aiSettings=await setup(async()=>{calls++;live=false;return completion();});
  const handler=createPlatformHandler({baseURL,owner,repository:new MemoryPort(),aiSettings,sessions:{read:async()=>{if(live)return{userId:owner.id,email:owner.email};if(mode==='unavailable')throw Error('Synthetic private auth detail');return mode==='revoked'?null:{userId:'synthetic-other',email:'synthetic-other@example.invalid'};}}});
  const response=await handler(request());assert.equal(response.status,mode==='revoked'?401:mode==='changed'?403:503);assert.equal(calls,1);const body=await response.text();assert.doesNotMatch(body,/synthetic-test-key|Synthetic private|"testState":"passed"/);
 }
});
test('integrated connection route rejects a changed origin without config writes or SDK dispatch',async()=>{
 let calls=0;const aiSettings=await setup(async()=>{calls++;return completion();}),repository=new MemoryPort(),handler=createPlatformHandler({baseURL,owner,repository,aiSettings,sessions:{read:async()=>({userId:owner.id,email:owner.email})}});
 const response=await handler(request('https://other.example.invalid'));assert.equal(response.status,403);assert.equal(calls,0);assert.equal((await aiSettings.view(owner.id)).revision,2);assert.equal(repository.events.length,0);
});

test('integrated chat export denies unauthenticated and other-owner requests before reading rows',async()=>{
 const {ChatService}=await import('../src/chat-candidate/service.ts'),{MemoryChatRepository}=await import('./helpers/chat.ts');
 for(const mode of ['none','other'] as const){const repository=new MemoryChatRepository();let reads=0;repository.list=async()=>{reads++;return[];};
  const handler=createPlatformHandler({baseURL,owner,repository:new MemoryPort(),chat:new ChatService(repository),sessions:{read:async()=>mode==='none'?null:{userId:'synthetic-other',email:'synthetic-other@example.invalid'}}});
  const response=await handler(new Request(baseURL+'/api/platform/ai/chat/export?includeSynthetic=true',{headers:{host:new URL(baseURL).host}}));assert.equal(response.status,mode==='none'?401:403);assert.equal(reads,0);
 }
});
test('integrated chat export rechecks original credentials after storage read',async()=>{
 const {ChatService}=await import('../src/chat-candidate/service.ts'),{MemoryChatRepository}=await import('./helpers/chat.ts');
 for(const mode of ['revoked','changed','unavailable'] as const){const repository=new MemoryChatRepository();let live=true;repository.list=async()=>{live=false;return[];};
  const handler=createPlatformHandler({baseURL,owner,repository:new MemoryPort(),chat:new ChatService(repository),sessions:{read:async()=>{if(live)return{userId:owner.id,email:owner.email};if(mode==='unavailable')throw Error('Synthetic private auth detail');return mode==='revoked'?null:{userId:'synthetic-other',email:'synthetic-other@example.invalid'};}}});
  const response=await handler(new Request(baseURL+'/api/platform/ai/chat/export?includeSynthetic=true',{headers:{host:new URL(baseURL).host}}));assert.equal(response.status,mode==='revoked'?401:mode==='changed'?403:503);assert.doesNotMatch(await response.text(),/Synthetic private|lifeos.chat.export/);
 }
});
