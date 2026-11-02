import test from'node:test';import assert from'node:assert/strict';
import{createPlatformHandler}from'../src/platform/http.ts';import{AISettingsService}from'../src/platform/ai-settings-service.ts';import{createAISecretVault}from'../src/platform/ai-secret-vault.ts';import{MemoryAISettings}from'./helpers/ai-settings.ts';import{MemoryPort}from'./helpers/platform.ts';
const owner={id:'fixture-owner-a',email:'fixture@example.invalid'},config={provider:'volcengine-ark',baseURL:'https://ark.cn-beijing.volces.com/api/v3',model:'fixture-model',dataScope:'current-message-only',monthlyBudgetMinor:null};
function setup(baseURL='https://review.example.invalid',attached=true,syntheticTransport?:typeof fetch){const rows=new MemoryAISettings(),repository=new MemoryPort();let signed=true,foreign=false;
 const aiSettings=new AISettingsService(rows,createAISecretVault({keyId:'fixture-master',key:Buffer.alloc(32,7)}),{baseURL,externalCallsApproved:false,dataTransmissionApproved:false,callBudgetApproved:false,syntheticTransport});
 const handler=createPlatformHandler({repository,owner,baseURL,sessions:{read:async()=>signed?{userId:foreign?'fixture-owner-b':owner.id,email:owner.email}:null},...(attached?{aiSettings}:{})});
 return{rows,repository,handler,signOut:()=>signed=false,foreign:()=>foreign=true,send:async(path:string,method='GET',body?:unknown,origin=baseURL)=>{const r=await handler(new Request(baseURL+'/api/platform/ai/'+path,{method,headers:{host:new URL(baseURL).host,origin,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}));return{status:r.status,headers:r.headers,body:await r.json()};}};
}
test('settings API saves ordinary config then encrypted secret and reloads only a masked state',async()=>{
 const f=setup(),saved=await f.send('settings','PUT',{expectedRevision:0,config});assert.equal(saved.status,200);assert.deepEqual(saved.body.config,config);
 const key=await f.send('secret','PUT',{expectedRevision:1,secret:'fixture-key-not-real-for-HTTP-test'});assert.equal(key.status,200);assert.equal(key.body.secretState,'stored');
 const reloaded=await f.send('settings');assert.equal(reloaded.status,200);assert.equal(reloaded.body.revision,2);assert.equal(reloaded.body.secretMask,'••••••••');assert.equal(reloaded.headers.get('cache-control'),'private, no-store');assert.ok(!JSON.stringify(reloaded.body).includes('fixture-key-not-real'));
 assert.equal((await f.send('connection-test','POST',{expectedRevision:2,confirmCost:true})).status,503);
 assert.equal((await f.send('secret','DELETE',{expectedRevision:2})).body.secretState,'not-set');
});
test('auth, owner, Origin, HTTP secret and client injection fail before settings mutation',async()=>{
 const f=setup();f.signOut();assert.equal((await f.send('settings')).status,401);assert.equal(f.rows.rows.size,0);
 const other=setup();other.foreign();assert.equal((await other.send('settings','PUT',{expectedRevision:0,config})).status,403);assert.equal(other.rows.rows.size,0);
 const origin=setup();assert.equal((await origin.send('settings','PUT',{expectedRevision:0,config},'https://foreign.invalid')).status,403);
 assert.equal((await origin.send('settings','PUT',{expectedRevision:0,config,ownerId:'forged'})).status,400);
 assert.equal((await origin.send('settings','PUT',{expectedRevision:0,config:{...config,apiKey:'not-real'}})).status,400);
 const insecure=setup('http://127.0.0.1:3190');await insecure.send('settings','PUT',{expectedRevision:0,config});assert.equal((await insecure.send('secret','PUT',{expectedRevision:1,secret:'fixture-key-not-real-for-HTTP-test'})).status,503);assert.equal(insecure.rows.rows.get(owner.id)?.secret,null);
});
test('missing approved extension is explicit and does not pretend config/key are absent',async()=>{
 const f=setup(undefined,false),view=await f.send('settings');assert.equal(view.status,200);assert.equal(view.body.storage,'not-configured');assert.equal(view.body.secretState,'unknown');assert.equal(view.body.capabilities.configurationWritable,false);
 assert.equal((await f.send('settings','PUT',{expectedRevision:0,config})).status,503);assert.equal(f.rows.rows.size,0);
});
test('configuration to synthetic SDK prefill to human confirmation/readback uses one existing data owner',async()=>{
 let calls=0;const f=setup(undefined,true,async()=>{calls++;return Response.json({id:'fixture',object:'chat.completion',created:1,model:'fixture-model',choices:[{index:0,message:{role:'assistant',content:JSON.stringify({title:'示例预填',body:'示例正文',date:null})},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});});
 await f.send('settings','PUT',{expectedRevision:0,config});await f.send('secret','PUT',{expectedRevision:1,secret:'fixture-key-never-real-for-full-flow'});
 const tested=await f.send('connection-test','POST',{expectedRevision:2,confirmCost:true});assert.equal(tested.status,200);assert.equal(tested.body.enabled,false);
 const enabled=await f.send('activation','POST',{expectedRevision:tested.body.revision,enabled:true});assert.equal(enabled.status,200);assert.equal(enabled.body.realModelActive,false);
 const input={text:'【虚构】整理示例资料。',kind:'todo',timeZone:'Asia/Shanghai',adapter:'ai'};
 const request=async(path:string,body?:unknown)=>{const response=await f.handler(new Request('https://review.example.invalid/api/platform/'+path,{method:body?'POST':'GET',headers:{host:'review.example.invalid',origin:'https://review.example.invalid','content-type':'application/json','idempotency-key':'settings-full-flow-fixture-1'},...(body?{body:JSON.stringify(body)}:{})}));return{status:response.status,body:await response.json()};};
 const preview=await request('capture/preview',input);assert.equal(preview.status,200);assert.equal(f.repository.rows.size,0);assert.equal(calls,2);
 const command={...input,fields:{...preview.body.preview.fields,title:'人工改后的最终标题'},confirmed:true,singleItem:true,syntheticOnly:true};
 assert.equal((await request('capture/confirm',{...command,confirmed:false})).status,400);assert.equal(f.repository.rows.size,0);
 const saved=await request('capture/confirm',command);assert.equal(saved.status,201);assert.equal(saved.body.entry.draft.title,command.fields.title);assert.equal(saved.body.entry.source.original.inputText,input.text);
 assert.equal((await request('capture/confirm',command)).status,200);assert.equal((await request('todos')).body.items.length,1);assert.equal(calls,2);
});
test('workbench status reports attached settings capabilities without promoting chat or a personal account',async()=>{
 const f=setup();await f.send('settings','PUT',{expectedRevision:0,config});
 const r=await f.handler(new Request('https://review.example.invalid/api/platform/status',{headers:{host:'review.example.invalid'}}));
 const v=await r.json();assert.equal(v.ai.settingsPersistable,true);assert.equal(v.ai.secretStoreReady,true);assert.equal(v.ai.configured,false);assert.equal(v.ai.externalCallsEnabled,false);assert.equal(v.personalAccountReady,false);
 const chat=await f.send('status');assert.equal(chat.body.configured,false);
});
test('AI settings read failure cannot break the core status or enable any AI capability',async()=>{
 const f=setup();f.rows.get=async()=>{throw Error('fixture-private-storage-error');};
 const r=await f.handler(new Request('https://review.example.invalid/api/platform/status',{headers:{host:'review.example.invalid'}}));
 assert.equal(r.status,200);const v=await r.json();assert.equal(v.ai.settingsPersistable,false);assert.equal(v.ai.externalCallsEnabled,false);assert.ok(!JSON.stringify(v).includes('fixture-private'));
});
test('an unavailable optional AI store cannot block manual capture preview or status',async()=>{
 const f=setup();f.rows.get=async()=>{throw Error('fixture-private-ai-store-error');};
 const send=async(path:string,body?:unknown)=>{const r=await f.handler(new Request('https://review.example.invalid/api/platform/capture/'+path,{method:body?'POST':'GET',headers:{host:'review.example.invalid',origin:'https://review.example.invalid','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));return{status:r.status,body:await r.json()};};
 const status=await send('status');assert.equal(status.status,200);assert.equal(status.body.model.configurationStatus,'unavailable');
 const input={text:'【虚构】手工正文',kind:'life',timeZone:'UTC',adapter:'manual'};
 const manual=await send('preview',input);assert.equal(manual.status,200);assert.equal(manual.body.preview.fields.body,input.text);
 assert.equal((await send('preview',{...input,adapter:'ai'})).status,503);assert.equal(f.repository.rows.size,0);
});
