import test from 'node:test';
import assert from 'node:assert/strict';

const presentation = await import('../src/personal-health/presentation.ts').catch(() => null);
const projection = await import('../src/personal-health/projection.ts').catch(() => null);

test('health summaries retain original units and do not infer actual sleep from the interval', () => {
  assert.ok(presentation,'health presentation is not implemented');
  const body = presentation.emptyHealthFields('body','UTC');
  assert.equal(body.occurredOn,null);
  assert.equal(body.personal.healthKind,'body');
  if (body.personal.healthKind !== 'body') throw Error('body expected');
  body.personal.weight = {value:180,unit:'lb'};
  assert.match(presentation.healthSummary(body),/180 lb/);
  assert.equal(body.personal.bodyFatPercent,null);
  const sleep = presentation.emptyHealthFields('sleep','UTC');
  if (sleep.personal.healthKind !== 'sleep') throw Error('sleep expected');
  sleep.personal.startedAt = '2026-11-05T22:00:00Z';
  sleep.personal.endedAt = '2026-11-06T06:00:00Z';
  assert.match(presentation.healthSummary(sleep),/实睡未知/);
  assert.match(presentation.healthSummary(sleep),/480 min/);
  assert.equal(sleep.personal.asleepMinutes,null);
});

test('health trends separate source units, retain explicit zero and never backfill missing values', () => {
  assert.ok(presentation);assert.ok(projection,'health projection is not implemented');
  const record = (id:string,date:string|null,weight:{value:number;unit:'kg'|'lb'}|null) => {
    const fields = presentation.emptyHealthFields('body','UTC');
    if (fields.personal.healthKind !== 'body') throw Error('body expected');
    fields.occurredOn = date;fields.personal.weight = weight;
    return {id,revision:2,fields};
  };
  const trend = projection.projectHealthTrend([
    record('later','2026-11-05',{value:80,unit:'kg'}),
    record('earlier','2026-11-01',{value:81,unit:'kg'}),
    record('pounds','2026-11-04',{value:180,unit:'lb'}),
    record('missing','2026-11-03',null),
    record('undated',null,{value:79,unit:'kg'}),
  ],'weight');
  assert.deepEqual(trend.series,[
    {unit:'kg',points:[{id:'earlier',revision:2,date:'2026-11-01',value:81},{id:'later',revision:2,date:'2026-11-05',value:80}]},
    {unit:'lb',points:[{id:'pounds',revision:2,date:'2026-11-04',value:180}]},
  ]);
  assert.equal(trend.missing,1);assert.equal(trend.undated,1);
  assert.deepEqual(projection.projectHealthTrend([],'weight').series,[]);
  const zero = record('zero','2026-11-05',null);
  if (zero.fields.personal.healthKind !== 'body') throw Error('body expected');
  zero.fields.personal.bodyFatPercent = 0;
  assert.equal(projection.projectHealthTrend([zero],'bodyFat').series[0].points[0].value,0);
});

test('planned training is excluded from completed trends and unknown duration is not zero', () => {
  assert.ok(presentation);assert.ok(projection);
  const planned = presentation.emptyHealthFields('training','UTC');
  const completed = presentation.emptyHealthFields('training','UTC');
  const unknown = presentation.emptyHealthFields('training','UTC');
  if (planned.personal.healthKind !== 'training'||completed.personal.healthKind !== 'training'||unknown.personal.healthKind !== 'training') throw Error('training expected');
  planned.occurredOn = completed.occurredOn = unknown.occurredOn = '2026-11-05';
  planned.personal.state = 'planned';planned.personal.durationMinutes = 90;
  completed.personal.state = 'completed';completed.personal.durationMinutes = 30;
  unknown.personal.state = 'completed';unknown.personal.durationMinutes = null;
  const trend = projection.projectHealthTrend([
    {id:'plan',revision:1,fields:planned},
    {id:'actual',revision:3,fields:completed},
    {id:'unknown',revision:1,fields:unknown},
  ],'trainingMinutes');
  assert.deepEqual(trend.series,[{unit:'min',points:[{id:'actual',revision:3,date:'2026-11-05',value:30}]}]);
  assert.equal(trend.plannedExcluded,1);assert.equal(trend.missing,1);
  assert.match(presentation.healthSummary(planned),/计划/);
});
