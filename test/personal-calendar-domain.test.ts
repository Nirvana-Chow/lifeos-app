import test from 'node:test';import assert from 'node:assert/strict';
const module=await import('../src/calendar-candidate/personal-domain.ts').catch(()=>null);
const normalize=(value:unknown)=>{assert.ok(module,'calendar personal domain is not implemented');return module.normalizeCalendarPersonalFields(value);};
const ref={id:'11111111-1111-4111-8111-111111111111',sourceId:'22222222-2222-4222-8222-222222222222',revision:2};
const fields=(personal:unknown)=>({title:'  合成日程  ',text:'保留原文',occurredOn:null,personal:{type:'calendar',schemaVersion:1,links:{project:null,domain:null,people:[]},...personal as object}});
test('calendar records have typed kinds, strict dates and preserved unknowns without synthesizing birthdays',()=>{
 const anniversary=normalize(fields({calendarKind:'anniversary',occasion:'birthday',originOn:null,monthDay:'02-29',repeat:'yearly',calendarSystem:'gregorian',timeZone:'Asia/Shanghai'}));
 assert.equal(anniversary.title,'合成日程');assert.equal(anniversary.personal.calendarKind,'anniversary');assert.equal((anniversary.personal as any).originOn,null);
 assert.equal(normalize(fields({calendarKind:'event',schedule:null})).personal.calendarKind,'event');
 assert.equal(normalize(fields({calendarKind:'life-stage',startOn:null,endOn:null})).personal.calendarKind,'life-stage');
 for(const change of [{calendarKind:'life-stage',startOn:'2026-02-30',endOn:null},{calendarKind:'life-stage',startOn:'2026-11-06',endOn:'2026-11-05'},{calendarKind:'countdown',targetOn:'2026-02-29',timeZone:'UTC'},{calendarKind:'anniversary',occasion:'birthday',originOn:null,monthDay:'02-30',repeat:'yearly',calendarSystem:'gregorian',timeZone:'UTC'},{calendarKind:'anniversary',occasion:'birthday',originOn:'2000-02-29',monthDay:'02-29',repeat:'yearly',calendarSystem:'gregorian',timeZone:'UTC'},{calendarKind:'anniversary',occasion:'birthday',originOn:null,monthDay:'03-01',repeat:'yearly',calendarSystem:'lunar',timeZone:'UTC'}])assert.throws(()=>normalize(fields(change)));
});
test('events retain the existing DST and exclusive all-day contracts, and reject forged source/authority fields',()=>{
 const base=fields({calendarKind:'event',schedule:{kind:'all-day',startDate:'2028-02-29',endDate:'2028-03-01'}});assert.equal((normalize(base).personal as any).schedule.endDate,'2028-03-01');
 for(const extra of [{ownerId:'other'},{source:{system:'apple'}},{completed:true}])assert.throws(()=>normalize({...base,...extra}));
 assert.throws(()=>normalize(fields({calendarKind:'event',schedule:{kind:'timed',startAt:'2026-03-08T02:30:00-05:00',endAt:'2026-03-08T04:00:00-04:00',timeZone:'America/New_York'}})));
 assert.throws(()=>normalize({...base,text:'x'.repeat(16385)}));
});
test('calendar refs are exact source/revision pins and duplicate or over-limit people fail',()=>{
 const value=fields({calendarKind:'countdown',targetOn:null,timeZone:'UTC',links:{project:ref,domain:null,people:[{...ref,id:'33333333-3333-4333-8333-333333333333'}]}});const normalized=normalize(value);
 assert.deepEqual(module!.calendarPersonalReferences(normalized.personal).map(r=>r.type),['project','person']);
 assert.throws(()=>normalize(fields({...value.personal,links:{project:null,domain:null,people:[ref,ref]}})));
 assert.throws(()=>normalize(fields({...value.personal,links:{project:null,domain:null,people:Array.from({length:21},()=>ref)}})));
});
