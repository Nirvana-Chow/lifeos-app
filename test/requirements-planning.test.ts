import test from 'node:test';
import assert from 'node:assert/strict';
import {requirementSchedule} from '../src/requirements-candidate/planning.ts';
const rows=[{id:'start-only'},{id:'range'},{id:'no-date'},{id:'end-only'}];
test('Gantt uses only actual dates, keeps one-sided dates as points and retains unscheduled rows',()=>{
 const result=requirementSchedule(rows,new Map([['start-only',{plannedStartOn:'2026-11-05',plannedEndOn:null}],['range',{plannedStartOn:'2026-11-06',plannedEndOn:'2026-11-10'}],['end-only',{plannedStartOn:null,plannedEndOn:'2026-11-08'}]]));
 assert.deepEqual(result.scheduled.map(row=>row.item.id),['start-only','range','end-only']);assert.deepEqual(result.unscheduled.map(row=>row.id),['no-date']);assert.equal(result.minOn,'2026-11-05');assert.equal(result.maxOn,'2026-11-10');
 assert.equal(result.scheduled[0].kind,'start');assert.equal(result.scheduled[0].startOn,'2026-11-05');assert.equal(result.scheduled[0].endOn,null);
 assert.equal(result.scheduled[1].kind,'range');assert.equal(result.scheduled[1].width,80);assert.equal(result.scheduled[2].kind,'end');assert.equal(result.scheduled[2].startOn,null);
 const empty=requirementSchedule(rows,new Map());assert.equal(empty.scheduled.length,0);assert.equal(empty.minOn,null);assert.equal(empty.maxOn,null);assert.equal(empty.unscheduled.length,4);
});
