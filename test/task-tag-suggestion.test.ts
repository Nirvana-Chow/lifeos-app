import test from 'node:test';
import assert from 'node:assert/strict';
import {PlatformError} from '../src/platform/domain.ts';
import {taskTagSuggestionPath,taskTagSuggestionScope} from '../src/personal-task-tag-suggestion/contract.ts';
import {handleTaskTagSuggestion,type TaskTagSuggestionProvider} from '../src/personal-task-tag-suggestion/http.ts';

const baseURL='https://tag-suggestion.example.invalid';
const topic={id:'11111111-2222-4333-8444-555555555555',revision:3,title:'合成候选标签'};
const input={scope:taskTagSuggestionScope,todoText:'合成待办整理',candidates:[topic]};
function fixture(provider?:TaskTagSuggestionProvider) {
  const state={authorized:true,readable:true,lookup:0,topic:{...topic}};
  const send=async (body?:unknown,extra?:{headers?:HeadersInit; signal?:AbortSignal})=>{
    const headers=new Headers({'Content-Type':'application/json',Origin:baseURL});
    new Headers(extra?.headers).forEach((value,key)=>headers.set(key,value));
    const request=new Request(baseURL+taskTagSuggestionPath,{method:body===undefined?'GET':'POST',headers,
      body:body===undefined?undefined:JSON.stringify(body),signal:extra?.signal});
    const response=await handleTaskTagSuggestion(request,{baseURL,provider,canReadTopics:state.readable,
      assertOwner:async()=>{
        if(!state.authorized)throw new PlatformError(401,'LOGIN_REQUIRED','No session');
        if(request.signal.aborted)throw new PlatformError(499,'REQUEST_CANCELLED','Cancelled');
      },getTopic:async id=>{
        state.lookup++;
        if(id!==state.topic.id)throw new PlatformError(404,'NOT_FOUND','No topic');
        return state.topic;
      }});
    assert.ok(response);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    return response.json();
  };
  return {send,state};
}

test('default closed capability and unauthorized requests never resolve a candidate or call a model',async()=>{
  const closed=fixture();
  assert.deepEqual(await closed.send(),{available:false,scope:taskTagSuggestionScope});
  await assert.rejects(closed.send(input),{status:503});
  let called=0;
  const active=fixture({available:async()=>true,suggest:async()=>{called++;return [1];}});
  await assert.rejects(active.send(input,{headers:{authorization:'synthetic-token'}}),{status:403});
  await assert.rejects(active.send(input,{headers:{origin:'https://elsewhere.invalid'}}),{status:403});
  active.state.authorized=false;
  await assert.rejects(active.send(input),{status:401});
  active.state.authorized=true;
  active.state.readable=false;
  assert.deepEqual(await active.send(),{available:false,scope:taskTagSuggestionScope});
  await assert.rejects(active.send(input),{status:503});
  assert.equal(active.state.lookup,0);
  assert.equal(closed.state.lookup,0);
  assert.equal(called,0);
});

test('sends only the exact confirmed text and current explicit names and returns only scoped IDs',async()=>{
  let indices:readonly number[]=[1];
  const {send,state}=fixture({available:async()=>true,suggest:async(value,context)=>{
    assert.deepEqual(value,{todoText:input.todoText,candidateTitles:[topic.title]});
    await context.assertCurrent();
    return indices;
  }});
  assert.deepEqual(await send(),{available:true,scope:taskTagSuggestionScope});
  assert.equal(state.lookup,0);
  assert.deepEqual(await send(input),{topicIds:[topic.id]});
  indices=[];
  assert.deepEqual(await send(input),{topicIds:[]});
  for(const invalid of [[0],[2],[1,1]]){
    indices=invalid;
    await assert.rejects(send(input),{status:503});
  }
});

test('rejects forged selectors, a changed revision or title and extra request fields before starting',async()=>{
  let called=0;
  const {send}=fixture({available:async()=>true,suggest:async()=>{called++;return [1];}});
  for(const candidate of [{...topic,revision:2},{...topic,title:'changed'},
    {...topic,id:'11111111-2222-4333-8444-666666666666'}])
    await assert.rejects(send({...input,candidates:[candidate]}),{status:409});
  for(const invalid of [{...input,scope:'current-message-only'},{...input,ownerId:'forged'},
    {...input,candidates:[topic,topic]},{...input,candidates:[{...topic,text:'private extra field'}]}])
    await assert.rejects(send(invalid),{status:400});
  assert.equal(called,0);
});

test('discards results after candidate changes, session loss or cancellation',async()=>{
  for(const mode of ['revision','session','cancel']){
    const controller=new AbortController();
    const {send,state}=fixture({available:async()=>true,suggest:async()=>{
      if(mode==='revision')state.topic.revision++;
      if(mode==='session')state.authorized=false;
      if(mode==='cancel')controller.abort();
      return [1];
    }});
    await assert.rejects(send(input,{signal:controller.signal}),{status:mode==='revision'?409:mode==='session'?401:499});
  }
});
