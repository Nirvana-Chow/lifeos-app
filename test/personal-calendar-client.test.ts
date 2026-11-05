import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PersonalCalendarService} from '../src/calendar-candidate/personal-service.ts';import {handlePersonalCalendar} from '../src/calendar-candidate/personal-http.ts';
import {personalCalendarPort,calendarFields,calendarOwner,calendarSpace} from './helpers/personal-calendar-port.ts';
import * as m from '../src/calendar-candidate/personal-client.ts';
function fixture(){const port=personalCalendarPort(),service=new PersonalCalendarService(port,{ownerId:calendarOwner,spaceId:calendarSpace,enabled:true,writable:true});let lose=false,wrong=false;
 const fetcher:typeof fetch=async(input,init)=>{const request=new Request('http://127.0.0.1:3190'+String(input),{...init,headers:{...Object.fromEntries(new Headers(init?.headers)),origin:'http://127.0.0.1:3190'}});const response=(await handlePersonalCalendar(request,{ownerId:calendarOwner,baseURL:'http://127.0.0.1:3190',service}))!;if(init?.method==='POST'&&lose){lose=false;throw Error('synthetic lost after commit');}if(init?.method==='POST'&&wrong){const body=await response.json();body.entry.fields.title='unrelated receipt';return Response.json(body);}return response;};
 const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};return{port,fetcher,storage,values,lose(){lose=true;},wrong(){wrong=true;}};}
test('calendar unknown result retains the exact command and retry reads the one authoritative result',async()=>{
 assert.ok(m,'calendar owner client is missing');const f=fixture(),binding={ownerId:calendarOwner,spaceId:calendarSpace},command=m.freezePersonalCalendarCommand(binding,calendarFields,null,randomUUID());f.lose();
 await assert.rejects(m.sendPersonalCalendarCommand(f.fetcher,f.storage,command));assert.deepEqual(m.readPersonalCalendarCommand(f.storage,binding),command);assert.equal(f.port.revisions.length,1);
 const saved=await m.sendPersonalCalendarCommand(f.fetcher,f.storage,command);assert.equal(saved.receipt.id,saved.current.id);assert.equal(f.port.revisions.length,1);assert.equal(f.values.size,0);
});
test('calendar matching rejects unrelated receipts, scope changes and storage denial before claiming a save',async()=>{
 assert.ok(m,'calendar owner client is missing');const f=fixture(),binding={ownerId:calendarOwner,spaceId:calendarSpace},command=m.freezePersonalCalendarCommand(binding,calendarFields,null,randomUUID());f.wrong();
 await assert.rejects(m.sendPersonalCalendarCommand(f.fetcher,f.storage,command));assert.equal(f.values.size,1);
 assert.equal(m.readPersonalCalendarCommand(f.storage,{...binding,ownerId:'other-owner'}),null);
 const denied={...f.storage,setItem:()=>{throw Error('denied');}};await assert.rejects(m.sendPersonalCalendarCommand(f.fetcher,denied,m.freezePersonalCalendarCommand(binding,calendarFields,null,randomUUID())));assert.equal(f.port.revisions.length,1);
});
