import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import type {PersonalConfig} from '../src/personal-candidate/config.ts';
import {createArkTaskTagSuggestionProvider} from '../src/personal-task-tag-suggestion/ark-provider.ts';
import {taskTagBindingHeader,taskTagSuggestionPath,taskTagSuggestionScope} from '../src/personal-task-tag-suggestion/contract.ts';
import {handleTaskTagSuggestion} from '../src/personal-task-tag-suggestion/http.ts';
import {MemoryPort} from './helpers/platform.ts';

const config={provider:'volcengine-ark',baseURL:'https://ark.cn-beijing.volces.com/api/v3',model:'synthetic-tag-model',
  dataScope:'current-message-only',monthlyBudgetMinor:null} as const;
const baseURL='https://tag-sdk.example.invalid';
const secret='fixture-secret-tag-suggestion';
const topic={id:'22222222-2222-4222-8222-222222222222',revision:6,title:'合成已选标签'};
const todoText='合成待办文字';
const completion=(value:unknown)=>Response.json({id:'synthetic-response',object:'chat.completion',created:1,model:config.model,
  choices:[{index:0,message:{role:'assistant',content:JSON.stringify(value)},finish_reason:'stop'}],
  usage:{prompt_tokens:20,completion_tokens:5,total_tokens:25}});

test('locked SDK transport emits only the selected names and current todo and sanitizes results and upstream failure',async()=>{
  let calls=0;
  let modelOutput:unknown={matches:[1]};
  const provider=createArkTaskTagSuggestionProvider(config,{mode:'synthetic-sdk-test',getSecret:async()=>secret,assertCurrent:async()=>{},
    fetch:async (url,init)=>{
      calls++;
      assert.equal(String(url),config.baseURL+'/chat/completions');
      assert.equal(init?.redirect,'error');
      const body=JSON.parse(String(init?.body));
      assert.equal(body.max_tokens,128);
      assert.equal('tools' in body,false);
      assert.equal(new Headers(init?.headers).get('authorization'),'Bearer '+secret);
      assert.deepEqual(JSON.parse(body.messages.find((message:{role:string})=>message.role==='user').content),
        {todoText,candidates:[{number:1,name:topic.title}]});
      assert.equal(JSON.stringify(body).includes(topic.id),false);
      assert.equal(JSON.stringify(body).includes(secret),false);
      return modelOutput===null?Response.json({error:{message:secret}},{status:429}):completion(modelOutput);
    }});
  const send=()=>handleTaskTagSuggestion(new Request(baseURL+taskTagSuggestionPath,{method:'POST',
    headers:{'Content-Type':'application/json',Origin:baseURL},body:JSON.stringify({scope:taskTagSuggestionScope,todoText,candidates:[topic]})}),
  {baseURL,provider,assertOwner:async()=>{},canReadTopics:true,getTopic:async()=>topic});
  assert.deepEqual(await (await send())?.json(),{topicIds:[topic.id]});
  modelOutput={matches:[]};
  assert.deepEqual(await (await send())?.json(),{topicIds:[]});
  for(const bad of [{matches:[2]},{matches:[1],write:true},null]){
    modelOutput=bad;
    await assert.rejects(send(),{code:'TASK_TAG_SUGGESTION_UNAVAILABLE'});
  }
  assert.equal(calls,5);
});

test('chat-only data scope and cancellation before dispatch resolve no secret and send nothing',async()=>{
  let secretReads=0,reservations=0,calls=0;
  const common={getSecret:async()=>{secretReads++;return secret;},assertCurrent:async()=>{}};
  const wrongScope=createArkTaskTagSuggestionProvider(config,{...common,mode:'approved-live',
    approval:{dataScope:'current-message-only' as never,externalCallsApproved:true,dataTransmissionApproved:true,callBudgetApproved:true},
    reserveCall:async()=>{reservations++;throw Error('Fixture denies budget');}});
  const input={todoText,candidateTitles:[topic.title]};
  const context={signal:new AbortController().signal,assertCurrent:async()=>{}};
  assert.equal(await wrongScope.available(context.signal),false);
  await assert.rejects(wrongScope.suggest(input,context),{code:'TASK_TAG_SUGGESTION_UNAVAILABLE'});

  const stopped=new AbortController();
  const synthetic=createArkTaskTagSuggestionProvider(config,{...common,mode:'synthetic-sdk-test',
    fetch:async()=>{calls++;return completion({matches:[1]});}});
  stopped.abort();
  await assert.rejects(synthetic.suggest(input,{...context,signal:stopped.signal}),{code:'TASK_TAG_SUGGESTION_STOPPED'});
  assert.deepEqual([secretReads,reservations,calls],[0,0,0]);
});

test('personal router verifies topic ownership and keeps successful, rejected and cancelled suggestions write-free',async()=>{
  const personal:PersonalConfig={ownerId:'synthetic-owner',ownerEmail:'synthetic@example.invalid',spaceId:'synthetic-space',
    databaseName:'fixture',approval:'personal-manual-v1',baseURL,allowedTypes:['todo','topic']};
  const repository=new MemoryPort();
  const fields={title:topic.title,text:'SYNTHETIC_PRIVATE_TOPIC_BODY',occurredOn:null,personal:{type:'topic' as const}};
  const at='2026-11-26T00:00:00Z';
  repository.rows.set(topic.id,{id:topic.id,ownerId:personal.ownerId,kind:'inbox',revision:topic.revision,
    draft:{...fields,disposition:'reference'},syncState:'draft',externalStatus:null,createdAt:at,updatedAt:at,
    source:{id:'22222222-2222-4222-8222-333333333333',externalId:topic.id,system:'website',version:1,asOf:at,
      original:{marker:'personal-manual-v1',type:'topic',spaceId:personal.spaceId,input:{spaceId:personal.spaceId,confirmed:true,fields}}}});
  let calls=0,authorized=true;
  const provider=createArkTaskTagSuggestionProvider(config,{mode:'synthetic-sdk-test',getSecret:async()=>secret,assertCurrent:async()=>{},
    fetch:async (_url,init)=>{
      calls++;
      assert.equal(String(init?.body).includes(fields.text),false);
      return completion({matches:[1]});
    }});
  const handler=createPersonalPlatformHandler({repository,config:personal,storageVerified:true,taskTagSuggestion:provider,
    sessions:{read:async()=>authorized?{userId:personal.ownerId,email:personal.ownerEmail}:null},
    assertWritable:async()=>assert.fail('Suggestion must never require write access')});
  const binding=JSON.stringify([personal.ownerId,personal.spaceId]);
  const send=(candidate=topic,signal?:AbortSignal,ownerScope:string|null=binding)=>handler(new Request(baseURL+taskTagSuggestionPath,{method:'POST',signal,
    headers:{Host:new URL(baseURL).host,Origin:baseURL,'Content-Type':'application/json',...(ownerScope?{[taskTagBindingHeader]:ownerScope}:{})},
    body:JSON.stringify({scope:taskTagSuggestionScope,todoText,candidates:[candidate]})}));
  const wrongSpace=JSON.stringify([personal.ownerId,'synthetic-other-space']);
  assert.equal((await send(topic,undefined,wrongSpace)).status,403);
  assert.equal((await send(topic,undefined,null)).status,403);
  assert.equal(calls,0);
  assert.deepEqual(await (await send()).json(),{topicIds:[topic.id]});
  assert.equal((await send({...topic,revision:topic.revision-1})).status,409);
  const stopped=new AbortController();stopped.abort();
  assert.equal((await send(topic,stopped.signal)).status,499);
  authorized=false;
  assert.equal((await send()).status,401);
  assert.equal(calls,1);
  assert.deepEqual([repository.rows.size,repository.events.length,repository.receipts.size],[1,0,0]);
});
