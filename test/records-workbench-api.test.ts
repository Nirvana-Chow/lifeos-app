import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformHandler} from '../src/platform/http.ts';
import {MemoryPort} from './helpers/platform.ts';
import {RecordsClient,createRecordCommand} from '../src/records-workbench/client.ts';
import {RecordsSaveSession} from '../src/records-workbench/session.ts';
import type {RecordFields,RecordMetadata} from '../src/records-candidate/contracts.ts';
const owner={id:'synthetic-records-ui-owner',email:'synthetic-records-ui@example.invalid'},base='http://127.0.0.1:3111';
const all:RecordMetadata[]=[{type:'learning',syntheticOnly:true,topic:' Synthetic topic ',status:'active',nextStep:null,resourceURL:null},{type:'career',syntheticOnly:true,evidence:'Synthetic evidence',nextStep:null},{type:'mood',syntheticOnly:true,label:'Synthetic calm',intensity:null},{type:'article',syntheticOnly:true,author:null,attribution:'summary',sourceURL:null},{type:'resource',syntheticOnly:true,url:'https://example.invalid/synthetic',author:null}];
function setup(){const repository=new MemoryPort(),handler=createPlatformHandler({repository,sessions:{read:async()=>({userId:owner.id,email:owner.email})},owner,baseURL:base});
 const transport:typeof fetch=async(input,init)=>String(input)==='/api/platform/auth/get-session'?Response.json({user:{id:owner.id},session:{userId:owner.id}}):handler(new Request(new URL(String(input),base),{...init,headers:{...Object.fromEntries(new Headers(init?.headers)),origin:base,host:'127.0.0.1:3111'}}));
 return {repository,transport,client:new RecordsClient(transport)};}

test('client integrates all five types with the real in-process owner-gated handler and shared source history',async()=>{
 const h=setup();for(const record of all){const fields:RecordFields={title:'  Synthetic '+record.type+'  ',text:'Synthetic full body\n<script>alert("text only")</script>',occurredOn:null,record};
 assert.deepEqual(await h.client.list(record.type),[]);const created=await h.client.send(createRecordCommand(fields,null,'records-real-create-'+record.type,true,owner.id));assert.equal(created.entry.revision,1);assert.equal(created.entry.draft.title,fields.title.trim());assert.equal(created.entry.draft.text,fields.text);assert.deepEqual(created.entry.source.original,{...fields,disposition:'reference'});
 const edited=await h.client.send(createRecordCommand({...fields,text:'Synthetic revised full body'}, {id:created.entry.id,revision:1,type:record.type},'records-real-edit-'+record.type,true,owner.id));assert.equal(edited.entry.revision,2);assert.equal(edited.entry.source.version,1);assert.deepEqual(edited.entry.source,created.entry.source);
 assert.equal((await h.client.detail(record.type,created.entry.id)).draft.text,'Synthetic revised full body');assert.deepEqual((await h.client.history(record.type,created.entry.id)).map(entry=>entry.revision),[2,1]);assert.equal((await h.client.list(record.type)).length,1);
 }assert.equal(h.repository.rows.size,5);assert.equal(h.repository.historyRows.length,10);
});

test('lost handler response retries exact create without duplicate row or source history',async()=>{
 const h=setup();let lost=true;const client=new RecordsClient(async(input,init)=>{const response=await h.transport(input,init);if(init?.method==='POST'&&lost){lost=false;throw Error('Synthetic response loss after commit');}return response;});const session=new RecordsSaveSession(client,()=> 'records-real-lost');
 const fields:RecordFields={title:'Synthetic lost response',text:'Synthetic body',occurredOn:null,record:all[0]};await session.save(fields,null,true);assert.equal(session.getSnapshot().phase,'uncertain');assert.equal(h.repository.rows.size,1);await session.retry();assert.equal(session.getSnapshot().phase,'saved');assert.equal(session.getSnapshot().result?.duplicate,true);assert.equal(h.repository.rows.size,1);assert.equal(h.repository.historyRows.length,1);
});

test('cancel or invalid/unconfirmed form makes no row, receipt or history',async()=>{
 const h=setup(),session=new RecordsSaveSession(h.client,()=> 'records-real-not-sent');session.reset();await assert.rejects(()=>session.save({title:'Synthetic',text:'',occurredOn:null,record:all[0]},null,false));assert.equal(h.repository.rows.size,0);assert.equal(h.repository.receipts.size,0);assert.equal(h.repository.historyRows.length,0);
});

test('valid raw originals may omit optional content or date without losing source evidence',async()=>{
 const h=setup(),raw={title:'Synthetic optional original',record:{type:'mood',syntheticOnly:true,label:'Synthetic calm'},confirmed:true,syntheticOnly:true};
 const response=await h.transport('/api/platform/records/mood',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'records-optional-raw'},body:JSON.stringify(raw)});assert.equal(response.status,201);const payload=await response.json();
 const entry=await h.client.detail('mood',payload.entry.id);assert.equal(entry.draft.text,'');assert.equal(entry.draft.occurredOn,null);assert.equal(entry.draft.record.type,'mood');assert.equal(Object.hasOwn(entry.source.original as object,'text'),false);assert.equal(Object.hasOwn(entry.source.original as object,'occurredOn'),false);
});
