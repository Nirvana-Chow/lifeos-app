import test from 'node:test';
import assert from 'node:assert/strict';
import type {HealthPersonalFields} from '../src/personal-health/domain.ts';
import {matchesHealthRecord} from '../src/personal-health/record-filter.ts';

const base = {type:'health',schemaVersion:1,timeZone:'Asia/Shanghai',source:{kind:'manual',label:null}} as const;
function training(title:string, activity:'strength'|'cardio'|'other', state:'planned'|'completed'):HealthPersonalFields {
  return {title,text:'飞盘',occurredOn:null,personal:{...base,healthKind:'training',activity,state,startedAt:null,durationMinutes:null,distance:null}};
}
const sleep:HealthPersonalFields = {title:'合成睡眠',text:'',occurredOn:null,
  personal:{...base,healthKind:'sleep',startedAt:null,endedAt:null,asleepMinutes:null,quality:null}};

test('health category filters preserve sleep and distinguish training from labeled frisbee', () => {
  const lift = training('合成力量', 'strength', 'completed');
  const other = training('合成其他运动', 'other', 'completed');
  const frisbee = training('合成飞盘', 'other', 'planned');
  assert.ok(matchesHealthRecord(sleep, 'all', 'all'));
  assert.ok(matchesHealthRecord(sleep, 'sleep', 'all'));
  assert.equal(matchesHealthRecord(lift, 'sleep', 'all'), false);
  assert.ok(matchesHealthRecord(lift, 'training', 'completed'));
  assert.ok(matchesHealthRecord(other, 'training', 'all'));
  assert.equal(matchesHealthRecord(other, 'frisbee', 'all'), false);
  assert.equal(matchesHealthRecord(frisbee, 'training', 'all'), false);
  assert.ok(matchesHealthRecord(frisbee, 'frisbee', 'planned'));
  assert.ok(matchesHealthRecord(training('Synthetic Frisbee', 'other', 'completed'), 'frisbee', 'completed'));
  assert.equal(matchesHealthRecord(frisbee, 'frisbee', 'completed'), false);
});
