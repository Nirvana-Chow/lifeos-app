import assert from 'node:assert/strict';
import test from 'node:test';
import {PlatformError} from '../src/platform/domain.ts';
import {handleRequirementsRequest} from '../src/requirements-candidate/http.ts';
import type {RequirementsService} from '../src/requirements-candidate/service.ts';
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

test('development summary returns counts only, rechecks ownership after reading, and never caches',async()=>{
 const baseURL='https://requirements.example.test',owner='synthetic-owner';
 const route=baseURL+'/api/platform/personal/requirements/development-progress';
 const request=(path=route,method='GET',headers:Record<string,string>={})=>new Request(path,{method,headers:{host:'requirements.example.test',...headers}});
 let reads=0,checks=0,disallowAfter=false;
 const service={config:{baseURL,requirementsEnabled:true},snapshot:async(identity:string)=>{
  assert.equal(identity,owner);
  reads++;
  return {...snapshot,items:[...items,unlinked],total:items.length+1};
 }} as unknown as RequirementsService;
 const guards={storageVerified:true,assertOwner:async()=>{checks++;if(disallowAfter&&reads>=2)throw new PlatformError(403,'OWNER_ONLY','Owner changed');},
  assertWritable:async()=>{throw Error('Unexpected write permission check');}};
 const call=(req:Request)=>handleRequirementsRequest(req,owner,service,guards);
 const response=await call(request());
 assert.equal(response?.status,200);
 assert.equal(response?.headers.get('cache-control'),'private, no-store');
 assert.equal(response?.headers.get('vary'),'Cookie');
 assert.deepEqual(await response?.json(),readLifeOSDevelopmentProgress({...snapshot,items,total:items.length}));
 assert.equal(checks,2);
 assert.equal(reads,1);
 assert.equal((await call(request(route,'POST')))?.status,405);
 await assert.rejects(call(request(route,'GET',{authorization:'Bearer synthetic'})),/本人 MFA/);
 await assert.rejects(call(request(route+'?unscoped=1')),/读取参数|额外查询/);
 assert.equal(reads,1);
 disallowAfter=true;
 await assert.rejects(call(request()),/Owner changed/);
 assert.equal(reads,2);
});
