import assert from 'node:assert/strict';
import test from 'node:test';
import {calendarFormBody,freezeCalendarCommand,keepCalendarPending,readCalendarPending,clearCalendarPending,calendarRequest,calendarStorageAccess,CalendarClientError,type CalendarForm} from '../src/calendar-candidate/client-model.ts';
const form:CalendarForm={title:'合成安排',notes:'合成原文',kind:'all-day',startDate:'2026-10-23',endDate:'2026-10-24',startAt:'',endAt:'',timeZone:'UTC'};
function store(){const values=new Map<string,string>();return{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};}
const key='8339aa0c-c3b6-4cca-aa4c-cb3413d14c3e';
test('unconfigured calendar adapter disables new operations but retains a previously frozen recovery command',()=>{
 const storage=store(),command=freezeCalendarCommand('fixed-synthetic-owner',key,form);keepCalendarPending(storage,'fixed-synthetic-owner',command);
 assert.equal(calendarStorageAccess('developer-review','fixed-synthetic-owner',false),false);
 assert.equal(readCalendarPending(storage,'fixed-synthetic-owner')?.key,key);
 assert.equal(calendarStorageAccess('unavailable','fixed-synthetic-owner',true),false);
 assert.equal(calendarStorageAccess('developer-review','',true),false);
 assert.equal(calendarStorageAccess('developer-review','fixed-synthetic-owner',true),true);
});
test('all-day form preserves literal calendar dates and exclusive end',()=>{
 assert.deepEqual(calendarFormBody(form),{title:'合成安排',notes:'合成原文',schedule:{kind:'all-day',startDate:'2026-10-23',endDate:'2026-10-24'}});
 assert.throws(()=>calendarFormBody({...form,startDate:'2026-02-30'}));
 assert.throws(()=>calendarFormBody({...form,endDate:'2026-10-23'}));
});
test('timed form requires explicit instants and validates end without guessing DST',()=>{
 assert.deepEqual(calendarFormBody({...form,kind:'timed',startAt:'2026-11-01T01:30:00-04:00',endAt:'2026-11-01T01:30:00-05:00',timeZone:'America/New_York'}).schedule,{kind:'timed',startAt:'2026-11-01T01:30:00-04:00',endAt:'2026-11-01T01:30:00-05:00',timeZone:'America/New_York'});
 assert.throws(()=>calendarFormBody({...form,kind:'timed',startAt:'2026-11-01T01:30:00',endAt:'2026-11-01T03:30:00',timeZone:'America/New_York'}));
 assert.throws(()=>calendarFormBody({...form,kind:'timed',startAt:'2026-02-30T01:30:00Z',endAt:'2026-03-01T03:30:00Z'}));
 assert.throws(()=>calendarFormBody({...form,kind:'timed',startAt:'2026-10-23T10:00:00Z',endAt:'2026-10-23T09:00:00Z'}));
});
test('frozen command retains exact form and revision across edits and owner-scoped navigation',()=>{
 const input={...form};const pending=freezeCalendarCommand('owner-a',key,input,{id:'a708c0b1-a9cb-41b4-aaee-3b0e0db1a822',revision:3});
 input.title='later edit';assert.equal(pending.form.title,'合成安排');assert.equal(pending.body.expectedRevision,3);
 const storage=store();keepCalendarPending(storage,'owner-a',pending);assert.deepEqual(readCalendarPending(storage,'owner-a'),pending);assert.equal(readCalendarPending(storage,'owner-b'),null);
 assert.throws(()=>keepCalendarPending(storage,'owner-a',freezeCalendarCommand('owner-a','792f4121-e29b-45a7-8145-b663436248ac',form)));
 assert.throws(()=>keepCalendarPending(storage,'owner-b',pending));clearCalendarPending(storage,'owner-a','other-key');assert.ok(readCalendarPending(storage,'owner-a'));clearCalendarPending(storage,'owner-a',key);assert.equal(readCalendarPending(storage,'owner-a'),null);
});
test('same frozen command cannot be replaced with changed content under the same key',()=>{
 const storage=store();const pending=freezeCalendarCommand('owner-a',key,form);keepCalendarPending(storage,'owner-a',pending);
 assert.throws(()=>keepCalendarPending(storage,'owner-a',freezeCalendarCommand('owner-a',key,{...form,title:'changed'})));
});
test('cancel freezes revision without claiming event completion',()=>{
 const command=freezeCalendarCommand('owner-a',key,form,{id:'a708c0b1-a9cb-41b4-aaee-3b0e0db1a822',revision:9},true);
 assert.equal(command.method,'POST');assert.equal(command.path,'/a708c0b1-a9cb-41b4-aaee-3b0e0db1a822/cancel');assert.deepEqual(command.body,{expectedRevision:9});
});
test('request uses frozen payload and exposes authenticated errors and uncertainty',async()=>{
 const command=freezeCalendarCommand('owner-a',key,form);
 const calls:Array<{url:unknown;options:RequestInit|undefined}>=[];
 const denied=(async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({error:{code:'UNAUTHENTICATED'}}),{status:401});}) as typeof fetch;
 await assert.rejects(()=>calendarRequest(denied,command.path,command.method,command.body,command.key),e=>e instanceof CalendarClientError&&e.status===401&&!e.uncertain);
 assert.equal(calls[0].url,'/api/platform/calendar');assert.equal(calls[0].options?.credentials,'same-origin');assert.equal(new Headers(calls[0].options?.headers).get('Idempotency-Key'),key);assert.equal(calls[0].options?.body,JSON.stringify(command.body));
 await assert.rejects(()=>calendarRequest((async()=>{throw Error('network');}) as typeof fetch,'','POST',{},key),e=>e instanceof CalendarClientError&&e.uncertain);
 await assert.rejects(()=>calendarRequest((async()=>new Response('bad',{status:200})) as typeof fetch,'','POST',{},key),e=>e instanceof CalendarClientError&&e.uncertain);
 await assert.rejects(()=>calendarRequest((async()=>new Response(JSON.stringify({ok:true}),{status:200})) as typeof fetch,'','POST',{},key),e=>e instanceof CalendarClientError&&e.uncertain);
 await assert.rejects(()=>calendarRequest((async()=>new Response(JSON.stringify({error:{code:'REVISION_CONFLICT'}}),{status:409})) as typeof fetch,'','PATCH',{},key),e=>e instanceof CalendarClientError&&e.status===409&&!e.uncertain);
});

test('day request stays closed by default and requires an explicit review scope',async()=>{
 const {calendarDayRequest}=await import('../src/calendar-candidate/client-model.ts');
 let requests=0;const fetcher=(async()=>{requests++;return new Response(JSON.stringify({entries:[]}));}) as typeof fetch;
 assert.equal(await calendarDayRequest(fetcher,{ownerScope:'owner-a'},'2026-10-23','UTC'),null);
 assert.equal(await calendarDayRequest(fetcher,{access:'developer-review',ownerScope:''},'2026-10-23','UTC'),null);
 assert.equal(requests,0);
 assert.deepEqual(await calendarDayRequest(fetcher,{access:'developer-review',ownerScope:'owner-a'},'2026-10-23','UTC'),[]);
 assert.equal(requests,1);
 await assert.rejects(()=>calendarDayRequest(fetcher,{access:'developer-review',ownerScope:'owner-a'},'2026-02-30','UTC'));
 assert.equal(requests,1);
});
test('storage write failure prevents obtaining a retained request',()=>{
 const storage={getItem:()=>null,setItem:()=>{throw Error('unavailable');},removeItem:()=>{}};
 assert.throws(()=>keepCalendarPending(storage,'owner-a',freezeCalendarCommand('owner-a',key,form)));
 assert.equal(readCalendarPending(storage,'owner-a'),null);
});

test('history preserves each revision entry and the submitted raw patch',async()=>{
 const entry={id:'a708c0b1-a9cb-41b4-aaee-3b0e0db1a822',title:'合成安排',notes:'合成原文',schedule:{kind:'all-day',startDate:'2026-10-23',endDate:'2026-10-24'},status:'planned',revision:2,source:{id:'c1a1ac07-f8f0-4096-8878-2b1b694ff44e',system:'website',externalId:'a708c0b1-a9cb-41b4-aaee-3b0e0db1a822',version:1,asOf:'2026-10-23T00:00:00Z',original:{title:'original'}},createdAt:'2026-10-23T00:00:00Z',updatedAt:'2026-10-23T01:00:00Z'};
 const body={history:[{entry,raw:{expectedRevision:1,title:'合成安排'}}]};
 assert.deepEqual(await calendarRequest((async()=>new Response(JSON.stringify(body))) as typeof fetch,'/a708c0b1-a9cb-41b4-aaee-3b0e0db1a822/history'),body);
});

test('cancel can retain an unfinished edit while sending only the saved revision',()=>{
 const storage=store();const pending=freezeCalendarCommand('owner-a',key,{...form,title:''},{id:'a708c0b1-a9cb-41b4-aaee-3b0e0db1a822',revision:9},true);
 keepCalendarPending(storage,'owner-a',pending);assert.equal(readCalendarPending(storage,'owner-a')?.form.title,'');assert.deepEqual(pending.body,{expectedRevision:9});
});
test('invalid command is rejected before poisoning recovery storage',()=>{
 const storage=store();const command=freezeCalendarCommand('owner-a',key,form);
 assert.throws(()=>keepCalendarPending(storage,'owner-a',{...command,path:'/wrong-path'}));assert.equal(readCalendarPending(storage,'owner-a'),null);
});

test('unknown negative-zero offsets cannot stand in for an explicit time zone',()=>{
 assert.throws(()=>calendarFormBody({...form,kind:'timed',startAt:'2026-10-23T09:00:00-00:00',endAt:'2026-10-23T10:00:00Z',timeZone:'UTC'}));
 assert.throws(()=>calendarFormBody({...form,kind:'timed',startAt:'2026-10-23T09:00:00Z',endAt:'2026-10-23T10:00:00Z',timeZone:'-00:00'}));
});

const savedEntry={id:'a708c0b1-a9cb-41b4-aaee-3b0e0db1a822',title:'合成安排',notes:'合成原文',schedule:{kind:'all-day' as const,startDate:'2026-10-23',endDate:'2026-10-24'},status:'planned' as const,revision:2,source:{id:'c1a1ac07-f8f0-4096-8878-2b1b694ff44e',system:'website' as const,externalId:'a708c0b1-a9cb-41b4-aaee-3b0e0db1a822',version:1,asOf:'2026-10-23T00:00:00Z',original:{title:'original'}},createdAt:'2026-10-23T00:00:00Z',updatedAt:'2026-10-23T01:00:00Z'};
test('successful mutation with failed readback keeps the same frozen key for retry',async()=>{
 const {sendCalendarCommand}=await import('../src/calendar-candidate/client-model.ts');
 const failedReads=[async()=>{throw Error('network');},async()=>new Response('{}',{status:503}),async()=>new Response('invalid JSON'),async()=>new Response('{}'),async()=>new Response('{}',{status:404}),async()=>new Response('{}',{status:409})];
 for(const method of ['POST','PATCH'] as const)for(const failedRead of failedReads){
  const storage=store();const command=freezeCalendarCommand('owner-a',key,form,method==='PATCH'?{id:savedEntry.id,revision:1}:undefined);let writes=0;const keys:string[]=[];let firstRead=true;
  const fetcher=(async(_url,options)=>{if(options?.method===method){writes++;keys.push(new Headers(options.headers).get('Idempotency-Key')!);return new Response(JSON.stringify({entry:savedEntry,duplicate:writes>1}));}if(firstRead){firstRead=false;return failedRead();}return new Response(JSON.stringify({entry:savedEntry}));}) as typeof fetch;
  await assert.rejects(()=>sendCalendarCommand(fetcher,storage,command),e=>e instanceof CalendarClientError&&e.uncertain);
  assert.deepEqual(readCalendarPending(storage,'owner-a'),command);
  assert.throws(()=>keepCalendarPending(storage,'owner-a',freezeCalendarCommand('owner-a','792f4121-e29b-45a7-8145-b663436248ac',form)));
  assert.deepEqual(await sendCalendarCommand(fetcher,storage,readCalendarPending(storage,'owner-a')!),savedEntry);
  assert.deepEqual(keys,[key,key]);assert.equal(readCalendarPending(storage,'owner-a'),null);
 }
});
test('a definite mutation rejection can release its retained command without any readback',async()=>{
 const {sendCalendarCommand}=await import('../src/calendar-candidate/client-model.ts');const storage=store();const command=freezeCalendarCommand('owner-a',key,form);let requests=0;
 await assert.rejects(()=>sendCalendarCommand((async()=>{requests++;return new Response('{}',{status:400});}) as typeof fetch,storage,command),e=>e instanceof CalendarClientError&&e.status===400&&!e.uncertain);
 assert.equal(requests,1);assert.equal(readCalendarPending(storage,'owner-a'),null);
});

test('starting a new draft invalidates a late detail response without replacing that draft',async()=>{
 const {createCalendarDetailReader}=await import('../src/calendar-candidate/client-model.ts');
 let resolveRead!:(value:Response)=>void;const response=new Promise<Response>(resolve=>{resolveRead=resolve;});
 const reader=createCalendarDetailReader((async()=>response) as typeof fetch);
 let draft={title:'old selection',notes:''};
 const opening=reader.read(savedEntry.id).then(entry=>{if(entry)draft={title:entry.title,notes:entry.notes};});
 reader.invalidate();draft={title:'new unsaved draft',notes:'keep this text'};
 resolveRead(new Response(JSON.stringify({entry:savedEntry})));await opening;
 assert.deepEqual(draft,{title:'new unsaved draft',notes:'keep this text'});
});
