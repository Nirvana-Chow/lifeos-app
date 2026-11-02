import test from 'node:test';
import assert from 'node:assert/strict';
import {ChatService} from '../src/chat-candidate/service.ts';
import {handleChatRequest} from '../src/chat-candidate/http.ts';
import {PlatformError} from '../src/platform/domain.ts';
import type {ChatRepository,ChatTurn,ChatTransition,ChatProviderSelector,ChatStreamEvent} from '../src/chat-candidate/contracts.ts';
const owner='synthetic-chat-owner',id='11111111-1111-4111-8111-111111111111',now='2026-10-23T12:00:00.000Z',input={turnId:id,userText:'  Synthetic current text  ',syntheticOnly:true,confirmSend:true};
const provenance={provider:'volcengine-ark',model:'synthetic-chat-model',configurationRevision:5,materialRevision:2,mode:'synthetic-sdk-test',dataScope:'current-message-only',sources:'not-connected'} as const;
class Rows implements ChatRepository{
 rows=new Map<string,ChatTurn>();digests=new Map<string,string>();writes=0;failFinish=false;
 async get(who:string,id:string){const row=this.rows.get(who+':'+id);return row?structuredClone(row):null;}
 async list(who:string,limit:number){return structuredClone([...this.rows.values()].filter(r=>r.ownerId===who).slice(0,limit));}
 async reserve(who:string,row:ChatTurn,digest:string){const key=who+':'+row.id,prior=this.rows.get(key);if(prior){if(this.digests.get(key)!==digest)throw new PlatformError(409,'CHAT_TURN_CONFLICT','Synthetic conflict');return{created:false,turn:structuredClone(prior)};}this.rows.set(key,structuredClone(row));this.digests.set(key,digest);this.writes++;return{created:true,turn:structuredClone(row)};}
 async transition(who:string,id:string,revision:number,change:ChatTransition){if(this.failFinish)throw Error('synthetic-private-storage-error');const key=who+':'+id,row=this.rows.get(key);if(!row)throw new PlatformError(404,'CHAT_TURN_NOT_FOUND','Missing');if(row.state!=='pending')return structuredClone(row);if(row.revision!==revision)throw new PlatformError(409,'CHAT_REVISION_CONFLICT','Conflict');const next={...row,...change,revision:row.revision+1};this.rows.set(key,next);this.writes++;return structuredClone(next);}
}
function setup(chunks:()=>AsyncIterable<string>=async function*(){yield 'Synthetic ';yield 'answer';}){const repository=new Rows();let calls=0,enabled=true;const providers:ChatProviderSelector={chatStatus:async()=>({available:enabled,mode:enabled?'synthetic-sdk-test':'unconfigured',provider:'volcengine-ark',model:enabled?provenance.model:null,configurationRevision:enabled?5:null,reason:enabled?'ready':'disabled'}),chatProvider:async()=>enabled?{provenance,assertCurrent:async()=>{if(!enabled)throw new PlatformError(409,'CHAT_CONFIGURATION_CHANGED','Changed');},stream:async function*(text,signal){assert.equal(text,input.userText);calls++;for await(const piece of chunks()){signal.throwIfAborted();yield piece;}}}:undefined};return{repository,service:new ChatService(repository,providers,()=>new Date(now)),calls:()=>calls,disable:()=>{enabled=false;}};}
const collect=async(stream:AsyncIterable<ChatStreamEvent>)=>{const events:ChatStreamEvent[]=[];for await(const event of stream)events.push(event);return events;};
test('chat persists pending before SDK, delivers typed ordered deltas and saves a terminal turn without business records',async()=>{
 const f=setup(async function*(){assert.equal(f.repository.rows.get(owner+':'+id)?.state,'pending');yield 'Synthetic ';yield 'answer';});const events=await collect(await f.service.send(owner,input));assert.deepEqual(events.map(e=>e.type),['start','delta','delta','done']);assert.deepEqual(events.map(e=>e.sequence),[0,1,2,3]);const turn=await f.service.get(owner,id,true);assert.equal(turn.state,'completed');assert.equal(turn.revision,2);assert.equal(turn.userText,input.userText);assert.equal(turn.assistantText,'Synthetic answer');assert.equal('ownerId'in turn,false);assert.equal(f.calls(),1);
});
test('terminal exact replay survives disabled settings while changed input and concurrent pending never recost',async()=>{
 let release!:()=>void;const waiting=new Promise<void>(r=>release=r),f=setup(async function*(){await waiting;yield 'Synthetic answer';});const first=await f.service.send(owner,input),one=collect(first);await new Promise<void>(r=>setImmediate(r));const duplicate=await collect(await f.service.send(owner,input));assert.equal(duplicate.at(-1)?.type,'error');assert.equal(f.calls(),1);release();await one;f.disable();const replay=await collect(await f.service.send(owner,input));assert.deepEqual(replay.map(e=>e.type),['start','done']);assert.equal(f.calls(),1);await assert.rejects(()=>f.service.send(owner,{...input,userText:'Changed synthetic text'}),{code:'CHAT_TURN_CONFLICT'});
});
test('cancelled terminal wins against a late model completion and is replayed without another call',async()=>{
 let release!:()=>void;const waiting=new Promise<void>(r=>release=r),f=setup(async function*(){yield 'partial';await waiting;yield ' late';});const result=collect(await f.service.send(owner,input));await new Promise<void>(r=>setImmediate(r));const cancelled=await f.service.cancel(owner,id,{expectedRevision:1,syntheticOnly:true});assert.equal(cancelled.state,'cancelled');release();await result;assert.equal((await f.service.get(owner,id,true)).state,'cancelled');assert.equal(f.calls(),1);assert.equal((await collect(await f.service.send(owner,input))).at(-1)?.type,'done');
});
test('owner/default visibility and forged command gates reject before provider or storage writes',async()=>{
 const f=setup();assert.deepEqual((await f.service.list(owner,false,20)).items,[]);assert.equal(f.repository.writes,0);for(const patch of [{syntheticOnly:false},{confirmSend:false},{ownerId:'other'},{userText:' '},{userText:'x'.repeat(16001)},{messages:[]}])await assert.rejects(()=>f.service.send(owner,{...input,...patch}));assert.equal(f.calls(),0);assert.equal(f.repository.writes,0);await collect(await f.service.send(owner,input));await assert.rejects(()=>f.service.get('foreign',id,true),{status:404});await assert.rejects(()=>f.service.get(owner,id,false),{status:404});await assert.rejects(()=>f.service.cancel('foreign',id,{expectedRevision:1,syntheticOnly:true}),{status:404});
});
test('provider error stores only bounded local failure and unavailable terminal storage stays unconfirmed',async()=>{
 const f=setup(async function*(){yield 'partial';throw Error('synthetic-secret-provider-error');});const failed=await collect(await f.service.send(owner,input));assert.equal(failed.at(-1)?.type,'error');assert.equal((await f.service.get(owner,id,true)).state,'failed');assert.doesNotMatch(JSON.stringify(failed),/synthetic-secret/);
 const unknown=setup();unknown.repository.failFinish=true;const result=await collect(await unknown.service.send(owner,input)),last=result.at(-1);assert.equal(last?.type,'error');if(last?.type==='error')assert.equal(last.turn,null);assert.equal(unknown.repository.rows.get(owner+':'+id)?.state,'pending');assert.equal(unknown.calls(),1);
});
test('HTTP produces NDJSON and cancellation/history routes use strict query and body gates',async()=>{
 const f=setup(),base='https://synthetic.example.invalid';const send=async(path:string,method='GET',body?:unknown)=>handleChatRequest(new Request(base+'/api/platform/ai/chat'+path,{method,headers:{origin:base,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),owner,base,f.service);
 const response=await send('','POST',input);assert.equal(response?.status,200);assert.match(response!.headers.get('content-type')!,/application\/x-ndjson/);const events=(await response!.text()).trim().split('\n').map(line=>JSON.parse(line));assert.equal(events.at(-1).type,'done');assert.equal((await(await send('/turns?includeSynthetic=true'))!.json()).items.length,1);assert.equal((await send('/turns?owner=other'))?.status,400);assert.equal((await send('/turns/'+id+'?includeSynthetic=true&includeSynthetic=true'))?.status,400);assert.equal((await send('/turns/'+id+'/cancel','POST',{expectedRevision:2,syntheticOnly:true}))?.status,200);
});
test('ending an iterator immediately after start saves cancellation and releases the active request',async()=>{
 const f=setup(),iterator=(await f.service.send(owner,input))[Symbol.asyncIterator]();assert.equal((await iterator.next()).value.type,'start');await iterator.return?.();
 await new Promise<void>(r=>setImmediate(r));assert.equal((await f.service.get(owner,id,true)).state,'cancelled');assert.equal(f.calls(),0);assert.equal((f.service as unknown as {active:Map<string,unknown>}).active.size,0);
});
test('HTTP reader cancellation immediately after start releases the active request',async()=>{
 const f=setup(),base='https://synthetic.example.invalid';const response=await handleChatRequest(new Request(base+'/api/platform/ai/chat',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify(input)}),owner,base,f.service);
 const reader=response!.body!.getReader();assert.equal(JSON.parse(new TextDecoder().decode((await reader.read()).value)).type,'start');await reader.cancel();
 assert.equal((await f.service.get(owner,id,true)).state,'cancelled');assert.equal((f.service as unknown as {active:Map<string,unknown>}).active.size,0);
});
test('request abort before the stream is consumed finalizes pending and releases the controller',async()=>{
 const f=setup(),controller=new AbortController();await f.service.send(owner,input,controller.signal);controller.abort();await new Promise<void>(r=>setImmediate(r));
 assert.equal((await f.service.get(owner,id,true)).state,'cancelled');assert.equal(f.calls(),0);assert.equal((f.service as unknown as {active:Map<string,unknown>}).active.size,0);
});
test('mutated terminal receipt is never presented as the saved original turn',async()=>{
 const f=setup(),original=f.repository.transition.bind(f.repository);f.repository.transition=async(...args)=>({...await original(...args),userText:'Different synthetic input'});
 const result=await collect(await f.service.send(owner,input)),last=result.at(-1);assert.equal(last?.type,'error');if(last?.type==='error'){assert.equal(last.code,'CHAT_FINALIZATION_UNCONFIRMED');assert.equal(last.turn,null);}
});
test('empty and over-limit output fail durably while every emitted delta remains bounded',async()=>{
 for(const pieces of [[''],['x'.repeat(32001)],Array.from({length:4097},()=>'.')]){
  const f=setup(async function*(){yield*pieces;});const events=await collect(await f.service.send(owner,input)),last=events.at(-1);assert.equal(last?.type,'error');if(last?.type==='error')assert.equal(last.code,pieces[0]===''?'CHAT_EMPTY_RESPONSE':'CHAT_OUTPUT_LIMIT');
  const deltas=events.filter(e=>e.type==='delta');assert.ok(deltas.length<=4096);assert.ok(deltas.every(e=>e.text.length<=4096));assert.ok((await f.service.get(owner,id,true)).assistantText.length<=32000);assert.equal((await f.service.get(owner,id,true)).state,'failed');
 }
 const f=setup(async function*(){yield 'x'.repeat(10000);});const events=await collect(await f.service.send(owner,input));assert.deepEqual(events.filter(e=>e.type==='delta').map(e=>e.text.length),[4096,4096,1808]);assert.equal(events.at(-1)?.type,'done');
});
test('configuration changed after emitted text prevents completion and pending restart never regenerates',async()=>{
 const f=setup(async function*(){yield 'partial';f.disable();});const events=await collect(await f.service.send(owner,input)),last=events.at(-1);assert.equal(last?.type,'error');if(last?.type==='error')assert.equal(last.code,'CHAT_CONFIGURATION_CHANGED');assert.equal((await f.service.get(owner,id,true)).state,'failed');
 const restart=setup(),reserved=await restart.service.send(owner,input);void reserved;const replacement=new ChatService(restart.repository);const replay=await collect(await replacement.send(owner,input));assert.equal(replay.at(-1)?.type,'error');assert.equal(restart.calls(),0);await restart.service.cancel(owner,id,{expectedRevision:1,syntheticOnly:true});
});
test('uppercase UUIDs normalize before reservation, digest and owner lookup',async()=>{
 const f=setup(),canonical='abcdefab-abcd-4bcd-abcd-abcdefabcdef',body={...input,turnId:canonical.toUpperCase()};await collect(await f.service.send(owner,body));await collect(await f.service.send(owner,{...body,turnId:canonical}));assert.equal(f.calls(),1);assert.equal((await f.service.get(owner,canonical.toUpperCase(),true)).id,canonical);
});
