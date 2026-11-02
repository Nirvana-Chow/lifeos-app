import test from 'node:test';import assert from 'node:assert/strict';
import {handleCalendar} from '../src/calendar-candidate/http.ts';
import {CalendarService} from '../src/calendar-candidate/service.ts';
import {CalendarMemoryPort,calendarInput} from './calendar-candidate-helpers.test.ts';
import {PlatformError} from '../src/platform/domain.ts';
const base='http://127.0.0.1:3002';
function fixture(){const repository=new CalendarMemoryPort(),service=new CalendarService(repository);const request=async(path='',method='GET',body?:unknown,options:{origin?:string;key?:string;enabled?:boolean;owner?:string}={})=>{
 const req=new Request(base+'/api/platform/calendar'+path,{method,headers:{origin:options.origin??base,'content-type':'application/json','idempotency-key':options.key??'calendar-http-key'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 try{return await handleCalendar(req,options.owner??'owner-a',base,options.enabled===false?undefined:service);}catch(error){if(error instanceof PlatformError)return Response.json({error:{code:error.code,message:error.message}},{status:error.status});throw error;}
 };return{repository,request};}
test('calendar route is disabled until service supplied and does not claim successful storage',async()=>{
 const f=fixture(),res=await f.request('?date=2026-10-23&timeZone=UTC','GET',undefined,{enabled:false});assert.equal(res?.status,503);assert.equal((await res!.json()).error.code,'CALENDAR_UNAVAILABLE');assert.equal(f.repository.rows.size,0);
 assert.equal(await handleCalendar(new Request(base+'/api/platform/todos'),'owner-a',base),null);
});
test('HTTP create day list detail edit history cancel use service and no-store responses',async()=>{
 const f=fixture(),created=await f.request('','POST',calendarInput);assert.equal(created?.status,201);assert.match(created!.headers.get('cache-control')! ,/no-store/);
 const entry=(await created!.json()).entry;assert.equal((await f.request('','POST',calendarInput))?.status,200);
 const listed=await f.request('?date=2026-10-23&timeZone=UTC');assert.equal((await listed!.json()).entries.length,1);
 assert.equal((await (await f.request('/'+entry.id))!.json()).entry.id,entry.id);
 const edited=await f.request('/'+entry.id,'PATCH',{title:'edited',expectedRevision:1},{key:'calendar-http-edit'});assert.equal(edited?.status,200);
 assert.equal((await f.request('/'+entry.id,'PATCH',{title:'stale',expectedRevision:1},{key:'calendar-http-stale'}))?.status,409);
 assert.equal((await f.request('/'+entry.id+'/cancel','POST',{expectedRevision:2},{key:'calendar-http-cancel'}))?.status,200);
 assert.equal((await (await f.request('/'+entry.id+'/history'))!.json()).history.length,3);
 assert.equal((await f.request('/'+entry.id,'DELETE'))?.status,405);
});
test('router rejects wrong origin, untrusted owner fields, oversized body and invalid queries',async()=>{
 const f=fixture();assert.equal((await f.request('','POST',calendarInput,{origin:'https://evil.invalid'}))?.status,403);
 assert.equal((await f.request('','POST',{...calendarInput,ownerId:'victim'}))?.status,400);
 assert.equal((await f.request('','POST',{...calendarInput,notes:'x'.repeat(132000)}))?.status,413);
 assert.equal((await f.request('?date=2026-10-23&timeZone=UTC&ownerId=victim'))?.status,400);
 assert.equal((await f.request('?date=2026-10-23&date=2026-10-24&timeZone=UTC'))?.status,400);
 assert.equal(f.repository.rows.size,0);
});
