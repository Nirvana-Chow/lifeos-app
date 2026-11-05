import test from 'node:test';import assert from 'node:assert/strict';
import * as m from '../src/calendar-candidate/personal-projection.ts';
const query=(value:unknown)=>{assert.ok(m,'calendar projection is missing');return m.validateCalendarWindow(value);};
const record=(id:string,personal:unknown)=>({id,revision:2,fields:{title:'合成 '+id,text:'',occurredOn:null,personal:{type:'calendar',schemaVersion:1,links:{project:null,domain:null,people:[]},...personal as object}},source:{id:'source-'+id,system:'website',externalId:id,version:1,asOf:'2030-01-01T00:00:00Z',original:{}},createdAt:'2030-01-01T00:00:00Z',updatedAt:'2030-01-01T00:00:00Z'} as any);
test('calendar window is explicit, bounded to92 days, and malformed dates or source authority fail',()=>{
 assert.equal(query({from:'2028-02-01',to:'2028-03-01',timeZone:'Asia/Shanghai'}).limit,100);
 for(const value of [{from:'2026-01-01',to:'2026-05-01',timeZone:'UTC'},{from:'2026-02-29',to:'2026-03-01',timeZone:'UTC'},{from:'2026-01-01',to:'2026-01-02',timeZone:'UTC',limit:101},{from:'2026-01-01',to:'2026-01-02',timeZone:'UTC',ownerId:'other'}])assert.throws(()=>query(value));
});
test('all-day end and timed midnight remain exclusive in a timezone-aware calendar',()=>{
 const q=query({from:'2026-10-22',to:'2026-10-25',timeZone:'Asia/Shanghai'});
 const p=m!.projectCalendarRecords([record('a',{calendarKind:'event',schedule:{kind:'all-day',startDate:'2026-10-22',endDate:'2026-10-23'}}),record('b',{calendarKind:'event',schedule:{kind:'timed',startAt:'2026-10-22T15:00:00.000Z',endAt:'2026-10-22T16:00:00.000Z',timeZone:'UTC'}})],q,'2026-10-22T12:00:00Z');
 assert.deepEqual(p.occurrences.map(x=>x.days),[['2026-10-22'],['2026-10-22']]);
});
test('yearly leap birthdays skip nonexistent anniversaries, unknown dates stay unscheduled and countdown uses selected zone',()=>{
 const records=[record('leap',{calendarKind:'anniversary',occasion:'birthday',originOn:null,monthDay:'02-29',calendarSystem:'gregorian',repeat:'yearly',timeZone:'Asia/Shanghai'}),record('unknown',{calendarKind:'anniversary',occasion:'birthday',originOn:null,monthDay:null,calendarSystem:'gregorian',repeat:'yearly',timeZone:'UTC'}),record('count',{calendarKind:'countdown',targetOn:'2028-03-01',timeZone:'Asia/Shanghai'})];
 const p=m!.projectCalendarRecords(records,query({from:'2028-02-01',to:'2028-03-02',timeZone:'Asia/Shanghai'}),'2028-02-29T16:30:00Z');assert.ok(p.occurrences.some(x=>x.recordId==='leap'&&x.days[0]==='2028-02-29'));assert.deepEqual(p.unscheduled,['unknown']);assert.equal(p.countdowns[0].daysRemaining,0);
 const nonleap=m!.projectCalendarRecords(records,query({from:'2027-02-01',to:'2027-03-02',timeZone:'UTC'}),'2027-02-01T00:00:00Z');assert.equal(nonleap.occurrences.some(x=>x.recordId==='leap'),false);
});
