import test from 'node:test';
import assert from 'node:assert/strict';
import {createArkCaptureExtractor} from '../src/platform/ark-capture.ts';
import {previewCapture,validateCaptureConfirmation} from '../src/platform/capture.ts';
import {createPlatformHandler} from '../src/platform/http.ts';
import {MemoryPort} from './helpers/platform.ts';
const config={provider:'volcengine-ark',baseURL:'https://ark.cn-beijing.volces.com/api/v3',model:'fixture-model-not-a-real-deployment',dataScope:'current-message-only',monthlyBudgetMinor:null} as const;
const input={text:'【虚构】明天整理书桌。',kind:'todo',timeZone:'Asia/Shanghai',adapter:'ai'} as const;
const generated={title:'整理书桌',body:'整理书桌。',date:null};
function completion(fields:unknown){return Response.json({id:'synthetic-response',object:'chat.completion',created:1,model:config.model,choices:[{index:0,message:{role:'assistant',content:JSON.stringify(fields)},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}});}
test('real SDK parses a synthetic response with strict fields; fixed endpoint, bounded request, no secret in result',async()=>{
 let calls=0;const extractor=createArkCaptureExtractor(config,{mode:'synthetic-sdk-test',getSecret:async()=>'fixture-secret-only-not-real',fetch:async(url,init)=>{
  calls++;assert.equal(String(url),config.baseURL+'/chat/completions');assert.equal(init?.redirect,'error');
  assert.equal(new Headers(init?.headers).get('authorization'),'Bearer fixture-secret-only-not-real');
  const body=JSON.parse(String(init?.body));assert.equal(body.model,config.model);assert.equal(body.max_tokens,512);assert.ok(!('tools'in body));
  assert.ok(JSON.stringify(body.messages).includes('2026-10-24'));assert.ok(!JSON.stringify(body.messages).includes('fixture-secret'));
  return completion(generated);
 }});
 const result=await previewCapture(input,new Date('2026-10-23T16:30:00Z'),extractor);
 assert.deepEqual(result.fields,generated);assert.equal(result.adapter,'ai-sdk-synthetic-test-v1');assert.equal(result.model.configured,false);
 assert.equal(calls,1);assert.ok(!JSON.stringify(result).includes('fixture-secret'));assert.ok(result.issues.some(i=>i.code==='UNKNOWN_DATE'));
});
test('unapproved live mode and invalid endpoint fail before resolving any secret or sending data',async()=>{
 let secrets=0,calls=0;
 const disabled=createArkCaptureExtractor(config,{mode:'disabled',getSecret:async()=>{secrets++;return'fixture';},fetch:async()=>{calls++;return completion(generated);}});
 await assert.rejects(()=>previewCapture(input,new Date(),disabled),{code:'AI_NOT_CONFIGURED'});
 assert.equal(secrets,0);assert.equal(calls,0);
 assert.throws(()=>createArkCaptureExtractor({...config,baseURL:'http://127.0.0.1:55432'} as never,{mode:'synthetic-sdk-test',getSecret:async()=>'fixture',fetch:async()=>completion(generated)}));
});
test('SDK rejects malformed or injected model fields without business writes or raw upstream error leakage',async()=>{
 for(const fields of [{...generated,ownerId:'foreign'}, {...generated,date:'2026-02-30'},{...generated,title:19}, {title:'x'}]){
  const extractor=createArkCaptureExtractor(config,{mode:'synthetic-sdk-test',getSecret:async()=>'fixture-secret-only-not-real',fetch:async()=>completion(fields)});
  await assert.rejects(()=>previewCapture(input,new Date(),extractor),error=>error instanceof Error&&!error.message.includes('fixture-secret'));
 }
 let calls=0;const extractor=createArkCaptureExtractor(config,{mode:'synthetic-sdk-test',getSecret:async()=>'fixture-secret-only-not-real',fetch:async()=>{calls++;return Response.json({error:{message:'fixture-secret-only-not-real upstream'}},{status:429});}});
 await assert.rejects(()=>previewCapture(input,new Date(),extractor));assert.equal(calls,1);
});
test('SDK prefill to human edit to existing owner-scoped save/readback is idempotent and cancel is write-free',async()=>{
 const repository=new MemoryPort(),owner={id:'fixture-owner-a',email:'fixture@example.invalid'},baseURL='http://127.0.0.1:3190';let calls=0;
 const extractor=createArkCaptureExtractor(config,{mode:'synthetic-sdk-test',getSecret:async()=>'fixture-secret-only-not-real',fetch:async()=>{calls++;return completion(generated);}});
 const handler=createPlatformHandler({repository,owner,baseURL,sessions:{read:async()=>({userId:owner.id,email:owner.email})},captureExtractor:extractor});
 async function send(path:string,body?:unknown){const response=await handler(new Request(baseURL+'/api/platform/'+path,{method:body?'POST':'GET',headers:{host:'127.0.0.1:3190',origin:baseURL,'content-type':'application/json','idempotency-key':'sdk-human-confirm-key-1'},...(body?{body:JSON.stringify(body)}:{})}));return{status:response.status,body:await response.json()};}
 const status=await send('capture/status');assert.equal(status.body.model.mode,'synthetic-sdk-test');assert.equal(status.body.model.configured,false);
 const preview=await send('capture/preview',input);assert.equal(preview.status,200);assert.equal(repository.rows.size,0);assert.equal(repository.receipts.size,0);
 const confirmed={...input,fields:{...preview.body.preview.fields,title:'人工修改后的标题'},confirmed:true,singleItem:true,syntheticOnly:true};
 assert.throws(()=>validateCaptureConfirmation({...confirmed,confirmed:false}));assert.equal(repository.rows.size,0);
 const saved=await send('capture/confirm',confirmed);assert.equal(saved.status,201);assert.equal(saved.body.entry.draft.title,'人工修改后的标题');
 assert.equal(saved.body.entry.source.original.inputText,input.text);assert.equal(saved.body.entry.source.original.capture.modelRunVerified,false);
 assert.equal((await send('capture/confirm',confirmed)).body.entry.id,saved.body.entry.id);
 const list=await send('todos');assert.equal(list.body.items.length,1);assert.equal(calls,1);assert.equal(repository.rows.size,1);assert.equal(repository.receipts.size,1);
 const afterConfigurationRemoved=createPlatformHandler({repository,owner,baseURL,sessions:{read:async()=>({userId:owner.id,email:owner.email})}});
 const replay=await afterConfigurationRemoved(new Request(baseURL+'/api/platform/capture/confirm',{method:'POST',headers:{host:'127.0.0.1:3190',origin:baseURL,'content-type':'application/json','idempotency-key':'sdk-human-confirm-key-1'},body:JSON.stringify(confirmed)}));
 assert.equal(replay.status,200);assert.equal((await replay.json()).entry.id,saved.body.entry.id);assert.equal(calls,1);
});
test('authentication, ownership, origin and input checks precede SDK secret resolution',async()=>{
 let secrets=0,calls=0;const repository=new MemoryPort(),owner={id:'fixture-owner-a',email:'fixture@example.invalid'},baseURL='http://127.0.0.1:3190';
 const extractor=createArkCaptureExtractor(config,{mode:'synthetic-sdk-test',getSecret:async()=>{secrets++;return'fixture-secret-only-not-real';},fetch:async()=>{calls++;return completion(generated);}});
 for(const [principal,origin,body,expected] of [[null,baseURL,input,401],[{userId:'other-owner',email:'other@example.invalid'},baseURL,input,403],[{userId:owner.id,email:owner.email},'https://foreign.invalid',input,403],[{userId:owner.id,email:owner.email},baseURL,{...input,ownerId:'forged'},400]] as const){
  const handler=createPlatformHandler({repository,owner,baseURL,sessions:{read:async()=>principal},captureExtractor:extractor});
  const response=await handler(new Request(baseURL+'/api/platform/capture/preview',{method:'POST',headers:{host:'127.0.0.1:3190',origin,'content-type':'application/json'},body:JSON.stringify(body)}));
  assert.equal(response.status,expected);
 }
 assert.equal(secrets,0);assert.equal(calls,0);assert.equal(repository.rows.size,0);
});
