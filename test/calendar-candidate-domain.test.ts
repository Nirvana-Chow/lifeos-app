import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCalendarDraft,validateDayQuery,occursOnDay} from '../src/calendar-candidate/domain.ts';

const timed=(startAt:string,endAt:string,timeZone='America/New_York')=>({title:'合成日程',schedule:{kind:'timed',startAt,endAt,timeZone}});
test('all-day dates are explicit, real and use an exclusive end',()=>{
 assert.deepEqual(validateCalendarDraft({title:' 全天 ',schedule:{kind:'all-day',startDate:'2028-02-29',endDate:'2028-03-01'}}),{title:'全天',notes:'',schedule:{kind:'all-day',startDate:'2028-02-29',endDate:'2028-03-01'}});
 for(const [startDate,endDate] of [['2026-02-29','2026-03-02'],['0000-01-01','0001-01-01'],['2026-10-23','2026-10-23'],['2026-10-24','2026-10-23']])assert.throws(()=>validateCalendarDraft({title:'x',schedule:{kind:'all-day',startDate,endDate}}));
});
test('timed events normalize explicit instants and reject ambiguous wall times',()=>{
 assert.deepEqual(validateCalendarDraft(timed('2026-11-01T01:30:00-04:00','2026-11-01T01:30:00-05:00')).schedule,{kind:'timed',startAt:'2026-11-01T05:30:00.000Z',endAt:'2026-11-01T06:30:00.000Z',timeZone:'America/New_York'});
 assert.equal(validateCalendarDraft(timed('2026-10-23T10:00:00+08:00','2026-10-23T11:00:00+08:00','+08:00')).schedule.kind,'timed');
 for(const input of [timed('2026-10-23T10:00','2026-10-23T11:00'),timed('2026-03-08T02:30:00-05:00','2026-03-08T04:00:00-04:00'),timed('2026-02-30T10:00:00Z','2026-03-01T11:00:00Z'),timed('2026-10-23T11:00:00Z','2026-10-23T10:00:00Z'),timed('2026-10-23T11:00:00Z','2026-10-23T12:00:00Z','no/such-zone'),timed('2026-10-23T11:00:00-00:00','2026-10-23T12:00:00Z')])assert.throws(()=>validateCalendarDraft(input));
});
test('owner, source, SQL and completion status cannot be supplied through input',()=>{
 const base={title:'synthetic',schedule:{kind:'all-day',startDate:'2026-10-23',endDate:'2026-10-24'}};
 for(const key of ['ownerId','sql','source','status'])assert.throws(()=>validateCalendarDraft({...base,[key]:'injected'}));
 assert.throws(()=>validateCalendarDraft({...base,schedule:{...base.schedule,timeZone:'UTC'}}));
});
test('day list uses selected calendar zone and excludes events ending at midnight',()=>{
 const day=validateDayQuery({date:'2026-10-23',timeZone:'Asia/Shanghai'});
 assert.equal(occursOnDay(validateCalendarDraft(timed('2026-10-22T16:00:00Z','2026-10-22T17:00:00Z','UTC')).schedule,day),true);
 assert.equal(occursOnDay(validateCalendarDraft(timed('2026-10-22T15:00:00Z','2026-10-22T16:00:00Z','UTC')).schedule,day),false);
 assert.equal(occursOnDay({kind:'all-day',startDate:'2026-10-22',endDate:'2026-10-23'},day),false);
 assert.throws(()=>validateDayQuery({date:'2026-10-23'}));
 assert.throws(()=>validateDayQuery({date:'2026-10-32',timeZone:'UTC'}));
});
test('explicit offsets cannot normalize outside supported UTC years',()=>{
 for(const input of [timed('0001-01-01T00:00:00+01:00','0001-01-01T01:00:00+01:00','+01:00'),timed('9999-12-31T23:00:00-01:00','9999-12-31T23:30:00-01:00','-01:00')])assert.throws(()=>validateCalendarDraft(input));
});
