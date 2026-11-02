import test from'node:test';import assert from'node:assert/strict';
import{createPlatformHandler}from'../src/platform/http.ts';import{MemoryPort}from'./helpers/platform.ts';
import{CalendarService}from'../src/calendar-candidate/service.ts';import{CalendarMemoryPort,calendarInput}from'./calendar-candidate-helpers.test.ts';
const baseURL='http://127.0.0.1:3190',owner={id:'fixture-owner-a',email:'fixture@example.invalid'};
test('journal routes reuse the trusted owner boundary and existing atomic capture writer',async()=>{
 const repository=new MemoryPort();let signed=true;const handler=createPlatformHandler({repository,baseURL,owner,sessions:{read:async()=>signed?{userId:owner.id,email:owner.email}:null}});
 const send=async(path:string,method='GET',body?:unknown)=>{const r=await handler(new Request(baseURL+'/api/platform/'+path,{method,headers:{host:'127.0.0.1:3190',origin:baseURL,'content-type':'application/json','idempotency-key':'journal-integration-fixture-1'},...(body?{body:JSON.stringify(body)}:{})}));return{status:r.status,body:await r.json()};};
 signed=false;assert.equal((await send('journal')).status,401);signed=true;
 const input={text:'【虚构】阅读示例。',kind:'life',adapter:'manual',timeZone:'Asia/Shanghai',fields:{title:'人工标题',body:'人工正文',date:null},confirmed:true,singleItem:true,syntheticOnly:true};
 const saved=await send('journal','POST',input);assert.equal(saved.status,201);assert.equal(saved.body.entry.kind,'inbox');assert.equal(saved.body.entry.source.original.inputText,input.text);
 const again=await send('journal','POST',input);assert.equal(again.status,200);assert.equal(again.body.entry.id,saved.body.entry.id);
 assert.deepEqual((await send('journal')).body.items,[]);assert.equal((await send('journal?includeSynthetic=1')).body.items.length,1);
 assert.equal((await send('journal/'+saved.body.entry.id)).status,404);
 assert.equal((await send('journal/'+saved.body.entry.id+'?includeSynthetic=1')).body.entry.id,saved.body.entry.id);
 assert.equal(repository.rows.size,1);
});
test('calendar stays closed without an opted-in extension; attached calendar shares auth, Origin and safe export boundaries',async()=>{
 const repository=new MemoryPort(),calendarRows=new CalendarMemoryPort(),calendar=new CalendarService(calendarRows);let signed=true,foreign=false;
 const options={repository,baseURL,owner,sessions:{read:async()=>signed?{userId:foreign?'fixture-owner-b':owner.id,email:owner.email}:null}};
 const closed=createPlatformHandler(options),handler=createPlatformHandler({...options,calendar});
 const req=(path:string,method='GET',body?:unknown,origin=baseURL)=>new Request(baseURL+'/api/platform/'+path,{method,headers:{host:'127.0.0.1:3190',origin,'content-type':'application/json','idempotency-key':'calendar-shared-integration-1'},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await closed(req('calendar?date=2026-10-23&timeZone=UTC'))).status,503);
 signed=false;assert.equal((await handler(req('calendar'))).status,401);signed=true;foreign=true;assert.equal((await handler(req('calendar'))).status,403);foreign=false;
 assert.equal((await handler(req('calendar','POST',calendarInput,'https://foreign.invalid'))).status,403);assert.equal(calendarRows.rows.size,0);
 const saved=await handler(req('calendar','POST',calendarInput));assert.equal(saved.status,201);const id=(await saved.json()).entry.id;
 const exported=await handler(req('export'));assert.equal(exported.status,200);const snapshot=await exported.json();assert.equal(snapshot.format,'lifeos.review.export.v2');assert.equal(snapshot.extensions.calendar.status,'included');assert.equal(snapshot.extensions.calendar.entries[0].id,id);assert.equal(snapshot.snapshotConsistency,'per-adapter-transactions');assert.equal(snapshot.extensions.calendar.entries[0].ownerId,undefined);assert.equal(snapshot.aiSecretsIncluded,false);
});
