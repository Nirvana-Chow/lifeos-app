import test from 'node:test';
import assert from 'node:assert/strict';
import {requirements,validateRequirementBaseline} from '../src/platform/requirements.ts';

test('requirements baseline has stable unique IDs, sources and explicit acceptance criteria',()=>{
 const b=requirements();assert.equal(b.baselineVersion,'lifeos-public-v1');
 assert.equal(new Set(b.requirements.map(r=>r.id)).size,b.requirements.length);
 assert.ok(b.requirements.every(r=>r.sourceRefs.length>0&&r.acceptanceCriteria.length>0));
 assert.equal(b.requirements.find(r=>r.id==='LO-UI-001')?.status,'in_progress');
 assert.equal(b.requirements.find(r=>r.id==='LO-AUTH-001')?.status,'in_progress');
 assert.ok(!b.requirements.some(r=>r.status==='accepted'));
});
test('code or test evidence cannot manufacture user acceptance',()=>{
 const b=structuredClone(requirements());b.requirements[0].status='accepted';
 assert.throws(()=>validateRequirementBaseline(b),/acceptance/i);
 b.requirements[0].acceptance={by:'user',baselineVersion:'lifeos-public-v1',ref:'fixture:explicit-user-review'};
 assert.doesNotThrow(()=>validateRequirementBaseline(b));
 b.requirements[0].acceptance.baselineVersion='old-version';assert.throws(()=>validateRequirementBaseline(b),/acceptance/i);
});
test('duplicate requirement IDs and missing sources fail instead of silently dropping scope',()=>{
 const b=structuredClone(requirements());b.requirements.push(b.requirements[0]);assert.throws(()=>validateRequirementBaseline(b),/duplicate/i);
 const c=structuredClone(requirements());c.requirements[0].sourceRefs=[];assert.throws(()=>validateRequirementBaseline(c),/source/i);
});
test('callers cannot mutate the shared fixed baseline',()=>{
 const b=requirements();assert.throws(()=>{b.requirements[0].title='changed';},TypeError);
 assert.notEqual(requirements().requirements[0].title,'changed');
});
