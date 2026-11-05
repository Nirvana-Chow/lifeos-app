import test from 'node:test';
import assert from 'node:assert/strict';

import * as module from '../src/personal-people/model.ts';
const normalize = (value: unknown) => {
  assert.ok(module, 'person personal fields are not implemented');
  return module.normalizePersonPersonalFields(value);
};
const ref = {id:'11111111-1111-4111-8111-111111111111',sourceId:'22222222-2222-4222-8222-222222222222',revision:2};
const person = (changes: Record<string, unknown> = {}) => ({type:'person',schemaVersion:1,aliases:[],phone:null,email:null,birthdayOn:null,birthdayMonthDay:null,company:null,relationship:null,links:{project:null,domain:null,topics:[]},...changes});
const fields = (changes: Record<string, unknown> = {}) => ({title:'  合成人物  ',text:'本人确认的说明',occurredOn:null,personal:person(changes)});

test('person fields retain unknown values, trim names and aliases, and preserve explicit record dates', () => {
  const result = normalize({...fields({aliases:['  示例别名  ', ''],phone:'  010-12345678  ',company:' 示例机构 '}),occurredOn:'2026-11-05'});
  assert.equal(result.title,'合成人物');
  assert.equal(result.text,'本人确认的说明');
  assert.equal(result.occurredOn,'2026-11-05');
  assert.deepEqual(result.personal.aliases,['示例别名']);
  assert.equal(result.personal.phone,'010-12345678');
  assert.equal(result.personal.company,'示例机构');
  assert.equal(result.personal.birthdayOn,null);
  assert.equal(result.personal.birthdayMonthDay,null);
  assert.equal(result.personal.relationship,null);
});

test('person birthdays keep unknown years unknown and accept only real Gregorian dates', () => {
  const partial = normalize(fields({birthdayMonthDay:'02-29'}));
  assert.equal(partial.personal.birthdayMonthDay,'02-29');
  assert.equal(partial.personal.birthdayOn,null);
  assert.equal(normalize(fields({birthdayOn:'2000-02-29'})).personal.birthdayOn,'2000-02-29');
  for (const changes of [{birthdayOn:'2026-02-29'},{birthdayOn:'0000-01-01'},{birthdayMonthDay:'02-30'},{birthdayMonthDay:'2-9'},{birthdayOn:'2000-02-29',birthdayMonthDay:'02-29'},{birthdayCalendar:'lunar'}]) {
    assert.throws(() => normalize(fields(changes)));
  }
  assert.throws(() => normalize({...fields(),occurredOn:'2026-02-30'}));
});

test('person updates require all fields so omitted values cannot silently clear saved contacts or links', () => {
  for (const key of ['title','text','occurredOn','personal']) {
    const value: Record<string, unknown> = fields(); delete value[key];
    assert.throws(() => normalize(value), key);
  }
  for (const key of Object.keys(person())) {
    const value = fields(); delete (value.personal as Record<string, unknown>)[key];
    assert.throws(() => normalize(value), key);
  }
  for (const key of ['project','domain','topics']) {
    const value = fields(); delete (value.personal.links as Record<string, unknown>)[key];
    assert.throws(() => normalize(value), key);
  }
});

test('person contact validation rejects malformed, oversized and authority-bearing fields', () => {
  assert.equal(normalize(fields({email:' example@example.test '})).personal.email,'example@example.test');
  for (const changes of [{email:'two@@example.test'},{email:'bad email@example.test'},{phone:'x'.repeat(81)},{aliases:[null]},{aliases:['same',' SAME ']},{aliases:Array.from({length:21},(_,i)=>String(i))},{relationship:'x\0y'},{schemaVersion:2},{ownerId:'other'}]) assert.throws(() => normalize(fields(changes)));
  for (const extra of [{ownerId:'other'},{sourceId:ref.sourceId},{revision:3},{text:'x'.repeat(16385)}]) assert.throws(() => normalize({...fields(),...extra}));
});

test('person relations preserve exact source and revision pins, and reject ambiguous target sets', () => {
  const topic = {...ref,id:'33333333-3333-4333-8333-333333333333'};
  const result = normalize(fields({links:{project:ref,domain:null,topics:[topic]}}));
  assert.ok(module);
  assert.deepEqual(module.personPersonalReferences(result.personal),[{type:'project',link:ref},{type:'topic',link:topic}]);
  for (const links of [{project:null,domain:null,topics:[topic,topic]},{project:null,domain:null,topics:Array.from({length:21},()=>topic)},{project:{...ref,revision:0},domain:null,topics:[]},{project:{...ref,ownerId:'other'},domain:null,topics:[]},{project:{...ref,sourceId:'not-an-id'},domain:null,topics:[]}]) assert.throws(() => normalize(fields({links})));
});
