import test from 'node:test';
import assert from 'node:assert/strict';

const domain = await import('../src/personal-health/domain.ts').catch(() => null);
const circumference = {waist:null,chest:null,hip:null,upperArm:null,thigh:null,calf:null};
const body = (patch:Record<string,unknown> = {}) => ({
  title:'  内部合成测量  ',text:'保留原始记录',occurredOn:'2026-11-05',
  personal:{type:'health',schemaVersion:1,timeZone:'Asia/Shanghai',source:{kind:'manual',label:null},healthKind:'body',measuredAt:null,weight:null,bodyFatPercent:null,circumference,...patch},
});
const normalize = (value:unknown) => {assert.ok(domain,'health domain is not implemented');return domain.normalizeHealthPersonalFields(value);};

test('health keeps entered units and null unknowns instead of fabricating measurements', () => {
  const value = normalize(body({weight:{value:180,unit:'lb'},circumference:{...circumference,waist:{value:33,unit:'in'}}}));
  assert.equal(value.title,'内部合成测量');
  assert.equal(value.personal.healthKind,'body');
  if (value.personal.healthKind !== 'body') throw Error('body expected');
  assert.deepEqual(value.personal.weight,{value:180,unit:'lb'});
  assert.deepEqual(value.personal.circumference.waist,{value:33,unit:'in'});
  assert.equal(value.personal.bodyFatPercent,null);
  assert.equal(value.personal.measuredAt,null);
  for (const patch of [
    {weight:{value:0,unit:'kg'}},{weight:{value:NaN,unit:'kg'}},{weight:{value:1,unit:'g'}},
    {bodyFatPercent:101},{bodyFatPercent:-1},{circumference:{waist:null}},
    {source:{kind:'xunji',label:null}},{source:{kind:'apple-health',label:null}},
  ]) assert.throws(() => normalize(body(patch)));
});

test('health requires complete fields and rejects forged authority or mixed record kinds', () => {
  for (const key of ['title','text','occurredOn','personal']) {
    const input = structuredClone(body());delete (input as Record<string,unknown>)[key];
    assert.throws(() => normalize(input),key);
  }
  for (const key of Object.keys(body().personal)) {
    const input = structuredClone(body());delete (input.personal as Record<string,unknown>)[key];
    assert.throws(() => normalize(input),key);
  }
  assert.throws(() => normalize({...body(),ownerId:'other'}));
  assert.throws(() => normalize(body({state:'completed'})));
  assert.throws(() => normalize({...body(),text:'x'.repeat(16385)}));
});

test('health validates real dates, explicit instants and the date in the selected zone', () => {
  const value = normalize(body({measuredAt:'2026-11-05T00:30:00+08:00'}));
  assert.equal(value.personal.healthKind,'body');
  if (value.personal.healthKind !== 'body') throw Error('body expected');
  assert.equal(value.personal.measuredAt,'2026-11-05T00:30:00+08:00');
  assert.throws(() => normalize(body({measuredAt:'2026-11-05T00:30:00'})));
  assert.throws(() => normalize(body({measuredAt:'2026-11-04T10:00:00Z'})));
  assert.throws(() => normalize({...body(),occurredOn:'2026-02-30'}));
  assert.throws(() => normalize(body({measuredAt:'2026-02-30T00:00:00+08:00'})));
  assert.throws(() => normalize(body({timeZone:'bad/zone'})));
  assert.equal(normalize({...body({measuredAt:'2028-02-29T23:00:00+08:00'}),occurredOn:'2028-02-29'}).occurredOn,'2028-02-29');
});

test('sleep distinguishes elapsed interval from actual sleep across DST', () => {
  const input = {...body(),occurredOn:'2026-11-01',personal:{type:'health',schemaVersion:1,timeZone:'America/New_York',source:{kind:'manual',label:null},healthKind:'sleep',startedAt:'2026-11-01T00:30:00-04:00',endedAt:'2026-11-01T02:30:00-05:00',asleepMinutes:150,quality:null}};
  assert.equal(domain?.sleepElapsedMinutes(normalize(input).personal),180);
  assert.throws(() => normalize({...input,personal:{...input.personal,asleepMinutes:181}}));
  assert.throws(() => normalize({...input,personal:{...input.personal,endedAt:'2026-11-01T00:00:00-04:00'}}));
  assert.throws(() => normalize({...input,occurredOn:'2026-03-08',personal:{...input.personal,startedAt:'2026-03-08T02:30:00-05:00',endedAt:'2026-03-08T04:00:00-04:00'}}));
  const unknown = normalize({...input,occurredOn:null,personal:{...input.personal,startedAt:null,endedAt:null,asleepMinutes:null}});
  assert.equal(domain?.sleepElapsedMinutes(unknown.personal),null);
  if (unknown.personal.healthKind !== 'sleep') throw Error('sleep expected');
  assert.equal(unknown.personal.asleepMinutes,null);
});

test('training preserves plan versus completion, original distance and missing duration', () => {
  const input = {...body(),occurredOn:null,personal:{type:'health',schemaVersion:1,timeZone:'UTC',source:{kind:'manual',label:null},healthKind:'training',activity:'cardio',state:'planned',startedAt:null,durationMinutes:null,distance:{value:3,unit:'mi'}}};
  const value = normalize(input);
  if (value.personal.healthKind !== 'training') throw Error('training expected');
  assert.equal(value.personal.state,'planned');
  assert.equal(value.personal.durationMinutes,null);
  assert.deepEqual(value.personal.distance,{value:3,unit:'mi'});
  assert.throws(() => normalize({...input,personal:{...input.personal,state:'done'}}));
  assert.throws(() => normalize({...input,personal:{...input.personal,durationMinutes:-1}}));
});
