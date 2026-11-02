import test from 'node:test';
import assert from 'node:assert/strict';
import {createArkChatProvider} from '../src/platform/ark-chat.ts';
import {AISettingsService} from '../src/platform/ai-settings-service.ts';
import {createAISecretVault} from '../src/platform/ai-secret-vault.ts';
import {MemoryAISettings} from './helpers/ai-settings.ts';
import {PlatformError} from '../src/platform/domain.ts';
const config={provider:'volcengine-ark',baseURL:'https://ark.cn-beijing.volces.com/api/v3',model:'synthetic-chat-model',dataScope:'current-message-only',monthlyBudgetMinor:null} as const;
const provenance={provider:'volcengine-ark',model:config.model,configurationRevision:5,materialRevision:2,mode:'synthetic-sdk-test',dataScope:'current-message-only',sources:'not-connected'} as const;
const secret='synthetic-chat-key-not-a-real-key';
function stream(parts=['Synthetic ','reply'],reason='stop'){
 const chunks=[...parts.map(content=>({id:'synthetic-provider-response',object:'chat.completion.chunk',created:1,model:config.model,choices:[{index:0,delta:{content},finish_reason:null}]})),{id:'synthetic-provider-response',object:'chat.completion.chunk',created:1,model:config.model,choices:[{index:0,delta:{},finish_reason:reason}]}];
 return new Response(chunks.map(chunk=>'data: '+JSON.stringify(chunk)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
async function collect(provider:ReturnType<typeof createArkChatProvider>,signal=new AbortController().signal){let text='';for await(const chunk of provider.stream('  Synthetic current message  ',signal))text+=chunk;return text;}
test('Ark chat uses the real SDK streaming parser with one current user text, fixed target and no tools or hidden history',async()=>{
 let calls=0;const provider=createArkChatProvider(config,provenance,{mode:'synthetic-sdk-test',getSecret:async()=>secret,assertCurrent:async()=>{},fetch:async(url,init)=>{calls++;assert.equal(String(url),config.baseURL+'/chat/completions');assert.equal(init?.redirect,'error');const body=JSON.parse(String(init?.body));assert.equal(body.stream,true);assert.equal(body.model,config.model);assert.equal(body.max_tokens,2048);assert.equal('tools'in body,false);const user=body.messages.filter((m:any)=>m.role==='user');assert.deepEqual(user,[{role:'user',content:'  Synthetic current message  '}]);assert.equal(body.messages.some((m:any)=>m.role==='assistant'),false);return stream();}});
 assert.equal(await collect(provider),'Synthetic reply');assert.equal(calls,1);assert.equal(provider.provenance.mode,'synthetic-sdk-test');
});
test('disabled and already aborted chat never resolve secrets or call an injected transport',async()=>{
 let reads=0,calls=0;const transport={getSecret:async()=>{reads++;return secret;},assertCurrent:async()=>{},fetch:async()=>{calls++;return stream();}};
 await assert.rejects(()=>collect(createArkChatProvider(config,provenance,{...transport,mode:'disabled'})));
 const aborted=new AbortController();aborted.abort();await assert.rejects(()=>collect(createArkChatProvider(config,provenance,{...transport,mode:'synthetic-sdk-test'}),aborted.signal));assert.equal(reads,0);assert.equal(calls,0);
});
test('aborting secret lookup stops promptly without a subsequent provider call',async()=>{
 let resolve!:(value:string)=>void,started!:()=>void,calls=0;const waiting=new Promise<void>(r=>started=r),controller=new AbortController();
 const provider=createArkChatProvider(config,provenance,{mode:'synthetic-sdk-test',assertCurrent:async()=>{},getSecret:async()=>{started();return new Promise<string>(r=>resolve=r);},fetch:async()=>{calls++;return stream();}}),pending=collect(provider,controller.signal);await waiting;controller.abort();await assert.rejects(()=>pending);resolve(secret);await new Promise<void>(r=>setImmediate(r));assert.equal(calls,0);
});
test('upstream failures and incomplete output never expose raw errors or retry',async()=>{
 for(const response of [()=>Response.json({error:{message:secret+' upstream'}},{status:429}),()=>stream(['partial'],'length'),()=>new Response('data: invalid\n\n',{headers:{'content-type':'text/event-stream'}})]){
  let calls=0;const provider=createArkChatProvider(config,provenance,{mode:'synthetic-sdk-test',assertCurrent:async()=>{},getSecret:async()=>secret,fetch:async()=>{calls++;return response();}});
  await assert.rejects(()=>collect(provider),cause=>cause instanceof Error&&!cause.message.includes(secret));assert.equal(calls,1);
 }
});
test('settings selection requires tested activation, exposes honest synthetic mode and invalidates a selected configuration',async()=>{
 const repository=new MemoryAISettings(),service=new AISettingsService(repository,createAISecretVault({keyId:'synthetic-chat-master',key:Buffer.alloc(32,3)}),{baseURL:'https://synthetic.example.invalid',externalCallsApproved:false,dataTransmissionApproved:false,callBudgetApproved:false,syntheticTransport:async()=>Response.json({id:'fixture',object:'chat.completion',created:1,model:config.model,choices:[{index:0,message:{role:'assistant',content:JSON.stringify({title:'Synthetic test',body:'Synthetic',date:null})},finish_reason:'stop'}]})});
 assert.equal((await service.chatStatus('owner')).available,false);await service.saveConfig('owner',{expectedRevision:0,config});await service.saveSecret('owner',{expectedRevision:1,secret});assert.equal(await service.chatProvider('owner'),undefined);
 const tested=await service.testConnection('owner',{expectedRevision:2,confirmCost:true});await service.activate('owner',{expectedRevision:tested.revision,enabled:true});const selected=await service.chatProvider('owner');assert.ok(selected);assert.equal((await service.chatStatus('owner')).mode,'synthetic-sdk-test');assert.equal((await service.chatStatus('other')).available,false);
 await service.saveConfig('owner',{expectedRevision:5,config:{...config,model:'synthetic-replaced-model'}});await assert.rejects(()=>selected.assertCurrent(new AbortController().signal));assert.equal((await service.chatStatus('owner')).available,false);
});
test('configuration change while the secret resolves prevents the later SDK request',async()=>{
 let current=true,calls=0;const provider=createArkChatProvider(config,provenance,{mode:'synthetic-sdk-test',assertCurrent:async()=>{if(!current)throw new PlatformError(409,'CHAT_CONFIGURATION_CHANGED','Changed');},getSecret:async()=>{current=false;return secret;},fetch:async()=>{calls++;return stream();}});
 await assert.rejects(()=>collect(provider));assert.equal(calls,0);
});
test('timeout while the secret remains unresolved stops with a bounded local error and no request',async()=>{
 let calls=0;const provider=createArkChatProvider(config,provenance,{mode:'synthetic-sdk-test',assertCurrent:async()=>{},getSecret:async()=>new Promise<string>(()=>{}),fetch:async()=>{calls++;return stream();}});
 const keepAlive=setTimeout(()=>{},100);try{await assert.rejects(()=>collect(provider,AbortSignal.timeout(5)),{code:'CHAT_TIMEOUT'});assert.equal(calls,0);}finally{clearTimeout(keepAlive);}
});
