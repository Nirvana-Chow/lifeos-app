import assert from 'node:assert/strict';
import test from 'node:test';
import {requirements} from '../src/platform/requirements.ts';
import {readLifeOSDevelopmentProgress} from '../src/ui-review/development-project-progress.ts';

const baseline = requirements();
const fields = {title:'合成需求', body:'', phaseId:'foundation', priority:'P2', plannedStartOn:null, plannedEndOn:null};
const items = baseline.requirements.map(requirement => ({
  id:requirement.id,
  revision:0,
  sourceId:null,
  fields,
  baselineBinding:{baselineVersion:baseline.baselineVersion, itemVersion:requirement.version, digest:'a'.repeat(64)},
  baselineConflict:false,
  requirement,
}));
const privateId = '7daa6d39-0fac-4b5d-b571-ed25cc357cb9';
const unlinked = {
  ...items[0],
  id:privateId,
  revision:1,
  sourceId:privateId,
  requirement:{...items[0].requirement, id:privateId, title:'LifeOS 网站合成未关联需求'},
  baselineBinding:null,
};
const snapshot = {scope:'full-current-requirements-snapshot', truncated:false, observedAt:'2030-11-05T00:00:00Z'};

test('website progress counts only the known LifeOS engineering baseline', () => {
  const expected = readLifeOSDevelopmentProgress({...snapshot, items, total:items.length});
  assert.equal(Object.values(expected.counts).reduce((sum, count) => sum + count, 0), items.length);
  assert.deepEqual(readLifeOSDevelopmentProgress({...snapshot, items:[...items, unlinked], total:items.length + 1}), expected);
});

test('website progress keeps changed bindings unknown and rejects incomplete or repeated snapshots', () => {
  const stale = [{...items[0], baselineConflict:true}, ...items.slice(1)];
  const result = readLifeOSDevelopmentProgress({...snapshot, items:stale, total:stale.length});
  assert.ok(result.counts.unverified >= 1);
  const foreign = [{...items[0], baselineBinding:{...items[0].baselineBinding, baselineVersion:'foreign-baseline'}}, ...items.slice(1)];
  assert.deepEqual(readLifeOSDevelopmentProgress({...snapshot, items:foreign, total:foreign.length}), result);
  const wrongVersion = [{...items[0], baselineBinding:{...items[0].baselineBinding, itemVersion:items[0].requirement.version+1}}, ...items.slice(1)];
  assert.deepEqual(readLifeOSDevelopmentProgress({...snapshot, items:wrongVersion, total:wrongVersion.length}), result);
  assert.throws(() => readLifeOSDevelopmentProgress({...snapshot, items:items.slice(1), total:items.length - 1}), /基线不完整/);
  assert.throws(() => readLifeOSDevelopmentProgress({...snapshot, items:[items[0], ...items], total:items.length + 1}), /标识无效/);
  assert.throws(() => readLifeOSDevelopmentProgress({...snapshot, items, total:items.length, truncated:true}), /快照不完整/);
});

test('the owner snapshot cannot promote edited requirement evidence to deployment', () => {
  const ref='https://github.com/Nirvana-Chow/lifeos-app/commit/'+'a'.repeat(40);
  const evidence=[{scope:'delivery-merged',ref},{scope:'delivery-production-verified',ref,
    resultHref:'https://lifeos.nirvanachow.com/personal',
    verificationHref:'https://github.com/Nirvana-Chow/lifeos-app/blob/'+'a'.repeat(40)+'/docs/verification/synthetic.md'}];
  const altered=[{...items[0],requirement:{...items[0].requirement,evidence}},...items.slice(1)];
  assert.deepEqual(readLifeOSDevelopmentProgress({...snapshot,items:altered,total:altered.length}),
    readLifeOSDevelopmentProgress({...snapshot,items,total:items.length}));
});
