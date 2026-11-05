import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyHealthFields} from '../src/personal-health/presentation.ts';
const adapter = await import('../src/personal-health/xunji-log/adapter.ts').catch(() => null);

function record(id:string,date:string|null,patch:Record<string,unknown>={}) {
  const fields = emptyHealthFields('training','UTC');
  if (fields.personal.healthKind !== 'training') throw Error('training expected');
  fields.title = id === 'frisbee' ? '飞盘投掷与对抗' : '内部合成运动 '+id;
  fields.occurredOn = date;
  fields.personal = {...fields.personal,state:'completed',...patch};
  return {id,revision:2,fields};
}

test('xunji adapter retains sport titles and original distance units while excluding plans and other health kinds', () => {
  assert.ok(adapter,'xunji-log adapter is not implemented');
  const body = {id:'body',revision:1,fields:emptyHealthFields('body','UTC')};
  const data = adapter.adaptTrainingRecords([
    record('frisbee','2026-11-05',{activity:'other',durationMinutes:60,distance:{value:2,unit:'mi'}}),
    record('run','2026-11-05',{activity:'cardio',durationMinutes:30,distance:{value:3,unit:'km'}}),
    record('plan','2026-11-06',{state:'planned',durationMinutes:90}),body,
  ]);
  assert.equal(data.n_sessions,2);assert.equal(data.n_days,1);assert.equal(data.planned.length,1);
  assert.equal(data.daily[0].duration_min,90);
  assert.deepEqual(data.daily[0].distances,{km:3,mi:2});
  assert.equal(data.completed.find(row => row.id === 'frisbee')?.title,'飞盘投掷与对抗');
  assert.deepEqual(data.daily[0].records.map(row => row.id),['frisbee','run']);
});

test('xunji calendar never fills absent dates or missing duration and distance with zero', () => {
  assert.ok(adapter);
  const data = adapter.adaptTrainingRecords([
    record('known','2026-11-03',{durationMinutes:0,distance:{value:0,unit:'km'}}),
    record('unknown','2026-11-05'),record('undated',null),
  ]);
  assert.equal(data.undated.length,1);
  const cells = adapter.trainingCalendarCells(data.daily,'duration_min');
  assert.deepEqual(cells.map(cell => [cell.date,cell.value]),[['2026-11-03',0],['2026-11-05',null]]);
  assert.equal(cells.some(cell => cell.date === '2026-11-04'),false);
  assert.equal(adapter.trainingMetricValue(data.daily[1],'distance_km'),null);
  const partial = adapter.adaptTrainingRecords([record('known','2026-11-05',{durationMinutes:30,distance:{value:3,unit:'km'}}),record('unknown','2026-11-05')]);
  assert.equal(partial.daily[0].duration_min,null);
  assert.equal(partial.daily[0].distances.km,null);
});

test('xunji date windows preserve leap days without locale/DST shifts and reject invalid dates', () => {
  assert.ok(adapter);
  const data = adapter.adaptTrainingRecords([record('leap','2028-02-29'),record('later','2028-03-01')]);
  assert.deepEqual(adapter.trainingCalendarRange(data,'recent'),{start:'2027-12-03',end:'2028-03-01'});
  assert.deepEqual(adapter.trainingCalendarRange(data,'2028'),{start:'2028-01-01',end:'2028-12-31'});
  assert.equal(adapter.trainingCalendarRange(adapter.adaptTrainingRecords([]),'recent'),null);
  assert.throws(() => adapter.adaptTrainingRecords([record('invalid','2026-02-30')]));
});

test('calendar and record mapping only resolve actual completed records, including multiple records per date', () => {
  assert.ok(adapter);
  const data = adapter.adaptTrainingRecords([record('frisbee','2026-11-05'),record('run','2026-11-05'),record('plan','2026-11-06',{state:'planned'})]);
  assert.deepEqual(adapter.trainingDayRecordIds(data,'2026-11-05'),['frisbee','run']);
  assert.deepEqual(adapter.trainingDayRecordIds(data,'2026-11-06'),[]);
  assert.deepEqual(adapter.trainingDayRecordIds(data,'2026-11-04'),[]);
  assert.equal(adapter.trainingCalendarClickDate({data:{value:['2026-11-05',2,null]}}),'2026-11-05');
  assert.equal(adapter.trainingCalendarClickDate({data:['2026-11-05',2,60]}),'2026-11-05');
  assert.equal(adapter.trainingCalendarClickDate({data:{value:['not-a-date',2]}}),null);
});
