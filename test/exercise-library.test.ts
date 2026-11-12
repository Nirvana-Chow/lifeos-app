import assert from 'node:assert/strict';
import test from 'node:test';
import type {TrainingAnalyticsSnapshot} from '../src/personal-health/training-analytics/model.ts';
import {buildExerciseLibrary,filterExerciseLibrary} from '../src/personal-health/exercise-library/model.ts';

test('exercise references never invent training counts without an observed snapshot',() => {
  const rows = buildExerciseLibrary();
  assert.equal(rows.length,8);
  assert.ok(rows.every(row => row.observed === null && row.guide?.purpose && row.guide?.source.url.startsWith('https://')));
});

test('exercise guidance matches exact source names and retains unknown recorded exercises',() => {
  const source:TrainingAnalyticsSnapshot = {schemaVersion:1,source:'xunji',days:[
    {date:'2026-11-09',status:'complete',sets:[
      {exercise:'鸟狗式',muscle:'core',reps:8,load:null},
      {exercise:'合成未归类动作',muscle:null,reps:null,load:null},
    ]},
    {date:'2026-11-10',status:'partial',sets:[
      {exercise:'鸟狗式',muscle:'core',reps:8,load:null},
      {exercise:'鸟狗式 ',muscle:null,reps:8,load:null},
    ]},
  ]};
  const rows = buildExerciseLibrary(source);
  assert.deepEqual(rows.find(row => row.name === '鸟狗式')?.observed,{sets:2,lastDate:'2026-11-10',muscles:['core']});
  assert.ok(rows.find(row => row.name === '鸟狗式')?.guide);
  const unknown = rows.find(row => row.name === '合成未归类动作');
  assert.ok(unknown);
  assert.equal(unknown.guide,null);
  assert.deepEqual(unknown.observed,{sets:1,lastDate:'2026-11-09',muscles:[]});
  assert.equal(rows.find(row => row.name === '鸟狗式 ')?.guide,null,'a similar name must not silently inherit another exercise tutorial');
  assert.equal(rows.find(row => row.name === '杠铃卧推')?.observed,null,'absent from this file does not mean never trained');
});

test('exercise search includes verified purpose and keeps unrelated records out of the results',() => {
  const rows = buildExerciseLibrary();
  assert.deepEqual(filterExerciseLibrary(rows,' 腘绳肌 ').map(row => row.name),['杠铃罗马尼亚硬拉']);
  assert.deepEqual(filterExerciseLibrary(rows,'不存在的合成动作'),[]);
  assert.equal(filterExerciseLibrary(rows,'').length,8);
});
