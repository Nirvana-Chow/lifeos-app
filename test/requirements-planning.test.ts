import test from 'node:test';
import assert from 'node:assert/strict';
import {requirementSchedule} from '../src/requirements-candidate/planning.ts';

test('Gantt draws only complete real intervals; partial dates remain unscheduled',()=>{
 const rows=[{id:'start-only'},{id:'range'},{id:'no-date'},{id:'end-only'},{id:'same-day'}];
 const result=requirementSchedule(rows,new Map([['start-only',{plannedStartOn:'2026-11-05',plannedEndOn:null}],['range',{plannedStartOn:'2026-11-06',plannedEndOn:'2026-11-10'}],['end-only',{plannedStartOn:null,plannedEndOn:'2026-11-08'}],['same-day',{plannedStartOn:'2026-11-08',plannedEndOn:'2026-11-08'}]]));
 assert.deepEqual(result.scheduled.map(row=>row.item.id),['range','same-day']);
 assert.deepEqual(result.unscheduled.map(row=>row.id),['start-only','no-date','end-only']);
 assert.equal(result.minOn,'2026-11-06');assert.equal(result.maxOn,'2026-11-10');
 assert.equal(result.scheduled[0].kind,'range');assert.equal(result.scheduled[0].width,100);
 assert.equal(result.scheduled[1].left,50);assert.equal(result.scheduled[1].width,0);
});
test('invalid calendar dates and reversed intervals never create bars or corrupt the scale',()=>{
 const entries=[['rollover','2026-02-29','2026-03-02'],['reversed','2026-11-10','2026-11-06'],['not-date','tomorrow','2026-11-06'],['datetime','2026-11-05T00:00:00Z','2026-11-06'],['leap','2028-02-29','2028-03-01']] as const;
 const result=requirementSchedule(entries.map(([id])=>({id})),new Map(entries.map(([id,plannedStartOn,plannedEndOn])=>[id,{plannedStartOn,plannedEndOn}])));
 assert.deepEqual(result.scheduled.map(row=>row.item.id),['leap']);assert.equal(result.minOn,'2028-02-29');assert.equal(result.maxOn,'2028-03-01');assert.equal(result.unscheduled.length,4);
});
test('without complete schedules there is no inferred date scale, even for due dates',()=>{
 const rows=[{id:'due-only',dueOn:'2026-11-05'}];const result=requirementSchedule(rows,new Map());
 assert.equal(result.scheduled.length,0);assert.equal(result.minOn,null);assert.equal(result.maxOn,null);assert.deepEqual(result.unscheduled,rows);
});
