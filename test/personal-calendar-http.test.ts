import test from 'node:test';import assert from 'node:assert/strict';
import {PersonalCalendarService} from '../src/calendar-candidate/personal-service.ts';
import {personalCalendarPort,calendarFields,calendarOwner,calendarSpace} from './helpers/personal-calendar-port.ts';
import * as m from '../src/calendar-candidate/personal-http.ts';
const base='http://127.0.0.1:3190';
const request=(path:string,method='GET',body?:unknown,origin=base)=>new Request(base+'/api/platform/personal/calendar'+path,{method,headers:{origin,'content-type':'application/json','idempotency-key':'synthetic-calendar-http-key'},...(body?{body:JSON.stringify(body)}:{})});
const handler=()=>{assert.ok(m,'owner calendar HTTP adapter is missing');return m.handlePersonalCalendar;};
test('calendar status stays closed without an injected qualified service and writes never fall through',async()=>{
 const result=await handler()(request('/status'),{ownerId:calendarOwner,baseURL:base});assert.equal((await result!.json()).configured,false);assert.match(result!.headers.get('cache-control')!,/private.*no-store/);
 await assert.rejects(handler()(request('','POST',{spaceId:calendarSpace,confirmed:true,fields:calendarFields}),{ownerId:calendarOwner,baseURL:base}));
});
test('owner calendar uses same-origin JSON writes and strict bounded list with no client-selected authority',async()=>{
 const port=personalCalendarPort(),service=new PersonalCalendarService(port,{ownerId:calendarOwner,spaceId:calendarSpace,enabled:true,writable:true}),ctx={ownerId:calendarOwner,baseURL:base,service};
 const input={spaceId:calendarSpace,confirmed:true,fields:calendarFields};await assert.rejects(handler()(request('','POST',input,'https://foreign.invalid'),ctx));assert.equal(port.calls.length,0);
 const result=await handler()(request('','POST',input),ctx);assert.equal(result!.status,201);const saved=await result!.json();assert.equal(saved.entry.fields.title,calendarFields.title);
 const response=await handler()(request('?from=2030-11-01&to=2030-12-01&timeZone=Asia%2FShanghai'),ctx);assert.equal((await response!.json()).total,1);
 await assert.rejects(handler()(request('?from=2030-11-01&from=2030-11-02&to=2030-12-01&timeZone=UTC'),ctx));
 await assert.rejects(handler()(request('?from=2030-11-01&to=2030-12-01&timeZone=UTC&ownerId=foreign'),ctx));
});
