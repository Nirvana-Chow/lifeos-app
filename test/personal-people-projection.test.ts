import test from 'node:test';
import assert from 'node:assert/strict';

import * as module from '../src/personal-people/projection.ts';
const project = (entries: unknown[],search = '') => {
  assert.ok(module, 'person list projection is not implemented');
  return module.projectPeopleEntries(entries as any,'synthetic-space',search);
};
const id = '11111111-1111-4111-8111-111111111111';
const sourceId = '22222222-2222-4222-8222-222222222222';
function entry(changes: Record<string, unknown> = {}): any {
  const fields = {title:'合成同名',text:'仅用于内部验证',occurredOn:null,personal:{type:'person',schemaVersion:1,aliases:['Alias'],phone:null,email:'synthetic@example.test',birthdayOn:null,birthdayMonthDay:'02-29',company:'示例机构',relationship:null,links:{project:null,domain:null,topics:[]}}};
  return {id,revision:3,kind:'inbox',draft:{...fields,disposition:'reference'},source:{id:sourceId,system:'website',externalId:id,version:1,asOf:'2026-11-05T00:00:00Z',original:{marker:'personal-manual-v1',type:'person',spaceId:'synthetic-space',input:{spaceId:'synthetic-space',confirmed:true,fields}}},createdAt:'2026-11-05T00:00:00Z',updatedAt:'2026-11-05T00:00:00Z',syncState:'draft',externalStatus:null,...changes};
}
test('empty person lists stay empty rather than creating sample contacts', () => {
  assert.deepEqual(project([]),[]);
});
test('people search uses only saved metadata and preserves identity for same-name people', () => {
  const first = entry(),second = entry({id:'33333333-3333-4333-8333-333333333333'});
  second.source = {...second.source,externalId:second.id};
  const rows = project([first,second],' alias ');
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(row=>({id:row.id,sourceId:row.sourceId,revision:row.revision})),[{id,sourceId,revision:3},{id:second.id,sourceId,revision:3}]);
  assert.deepEqual(rows[0].summary,['示例机构','生日 02-29（公历，年份未知）']);
  assert.equal(project([first],'example.test').length,1);
  assert.equal(project([first],'没有的关系').length,0);
  assert.equal(rows[0].entry,first);
});
test('people projections exclude foreign spaces, unconfirmed origins and malformed record metadata', () => {
  const foreign = entry(); foreign.source.original.spaceId='other';
  const unconfirmed = entry(); unconfirmed.source.original.input.confirmed=false;
  const malformed = entry(); malformed.draft.personal.birthdayMonthDay='02-30';
  const forged = entry(); forged.source.externalId='33333333-3333-4333-8333-333333333333';
  assert.deepEqual(project([foreign,unconfirmed,malformed,forged]),[]);
});
