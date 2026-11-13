import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCookingHistory, readCookingRecord } from '../src/cooking/log-client.ts';
import { CookingScopeLost, cookingStatusPath, readCookingAccess, verifyCookingMutationAccess } from '../src/cooking/log-access.ts';

const access = {
  scope:'personal-manual-candidate',
  ownerId:'synthetic-owner',
  spaceId:'synthetic-space',
  storageVerified:true,
  cookingEnabled:true,
  writable:true,
};
const blank = {scope:'full-current-snapshot',items:[],total:0,truncated:false,observedAt:'2026-11-10T10:00:00.000Z'};
const abort = new AbortController().signal;

test('history reads no business data unless the storage and cooking flags are both verified', async () => {
  for (const status of [{...access,cookingEnabled:false}, {...access,storageVerified:false}, {...access,cookingEnabled:undefined}]) {
    const calls: string[] = [];
    await assert.rejects(loadCookingHistory(async input => {
      calls.push(String(input));
      return Response.json(status);
    }, abort));
    assert.deepEqual(calls, ['/api/platform/personal/status']);
  }
});

test('history rejects a changed owner, revoked capability and incomplete snapshots', async () => {
  for (const [snapshot, after] of [[blank,{...access,ownerId:'second-synthetic-owner'}],
    [blank,{...access,cookingEnabled:false}],
    [{...blank,truncated:true},access],
    [{...blank,total:1},access]]) {
    const payloads = [access,snapshot,after];
    await assert.rejects(loadCookingHistory(async () => Response.json(payloads.shift()), abort));
  }
});

test('a verified read-only owner can read history but cannot create a record', async () => {
  const readonly = {...access,writable:false};
  const payloads = [readonly,blank,readonly];
  assert.deepEqual(await loadCookingHistory(async () => Response.json(payloads.shift()), abort),
    {access:{ownerId:access.ownerId,spaceId:access.spaceId,writable:false},rows:[]});
  assert.equal(await readCookingAccess(async () => Response.json({error:{}},{status:403}), abort), null);
});

test('mutation authorization loss is distinguished from an ordinary retryable response', async () => {
  const recordPath = '/api/platform/personal/cooking';
  for (const response of [new Response(null,{status:401}), new Response(null,{status:403}),
    Response.json({error:{code:'PERSONAL_MODULE_UNAVAILABLE'}},{status:404})]) {
    await assert.rejects(verifyCookingMutationAccess(response, recordPath, access), CookingScopeLost);
  }
  for (const status of [{...access,ownerId:'second-synthetic-owner'},{...access,spaceId:'second-synthetic-space'},
    {...access,cookingEnabled:false},{...access,storageVerified:false}]) {
    await assert.rejects(verifyCookingMutationAccess(Response.json(status), cookingStatusPath, access), CookingScopeLost);
  }
  await assert.rejects(verifyCookingMutationAccess(Response.json({...access,cookingEnabled:undefined}), cookingStatusPath, access),
    failure => failure instanceof Error && !(failure instanceof CookingScopeLost));
  await verifyCookingMutationAccess(new Response(null,{status:503}), recordPath, access);
  await verifyCookingMutationAccess(Response.json({...access,writable:false}), cookingStatusPath, access);
});

const id = '7c020000-0000-4000-8000-000000000001';
const sourceId = '7c020000-0000-4000-8000-000000000002';
const fields = {
  title:'合成豆腐菜',
  text:'',
  occurredOn:'2026-11-10',
  personal:{type:'cooking',schemaVersion:1,recipe:null},
} as const;
const entry = {
  id, kind:'inbox', draft:{...fields,disposition:'reference'},
  source:{id:sourceId,system:'website',externalId:id,version:1,original:{
    marker:'personal-manual-v1',spaceId:access.spaceId,type:'cooking',
    input:{spaceId:access.spaceId,confirmed:true,fields},
  }},
  revision:1, createdAt:blank.observedAt, updatedAt:blank.observedAt,
  syncState:'draft', externalStatus:null,
};

test('editing binds the individually read record to the listed source and current owner', async () => {
  const payloads = [access,{...blank,items:[entry],total:1},access];
  const loaded = await loadCookingHistory(async () => Response.json(payloads.shift()), abort);
  const expected = loaded.rows[0];
  assert.deepEqual(expected.fields,fields);
  const fresh = {...entry,revision:2,draft:{...entry.draft,text:'第二次读回'}};
  const replies = [{entry:fresh},access];
  const current = await readCookingRecord(async () => Response.json(replies.shift()), loaded.access, expected, abort);
  assert.equal(current.row.revision,2);
  assert.equal(current.row.fields.text,'第二次读回');
  const wrongSource = {...fresh,source:{...fresh.source,id:'7c020000-0000-4000-8000-000000000003'}};
  await assert.rejects(readCookingRecord(async () => Response.json({entry:wrongSource}), loaded.access, expected, abort),
    /做饭记录无法核对/);
});
