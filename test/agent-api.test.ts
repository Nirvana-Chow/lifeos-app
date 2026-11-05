import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryPort} from './helpers/platform.ts';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';

const baseURL = 'http://127.0.0.1:3190';
const ownerId = 'synthetic-owner-a';
const spaceId = 'synthetic-space';
const config = {
  ownerId, ownerEmail: 'fixture@example.invalid', spaceId, baseURL,
  databaseName: 'fixture', allowedTypes: ['todo'], approval: 'personal-manual-v1',
} as const;
const fields = {title: 'Synthetic task', notes: 'Retain me', dueOn: null, status: 'open'};

function fixture(enabled = true) {
  const repository = new MemoryPort();
  let authenticated = 0;
  let permit = true;
  const handler = createAgentHandler({
    config, repository, enabled,
    verify: async key => {
      authenticated++;
      if (key === 'invalid') return null;
      return {
        grantId: 'synthetic-' + key,
        ownerId: key === 'foreign' ? 'synthetic-owner-b' : ownerId,
        spaceId: key === 'wrong-space' ? 'other-space' : spaceId,
        scopes: key === 'org' ? ['organization:read'] : key === 'writer' ? ['todo:read', 'todo:write'] : ['todo:read'],
      };
    },
    operationAvailable: () => true,
    readCurrentGrant: async id => ({grantId:id,ownerId:id === 'synthetic-foreign' ? 'synthetic-owner-b' : ownerId,spaceId:id === 'synthetic-wrong-space' ? 'other-space' : spaceId,scopes:id === 'synthetic-org' ? ['organization:read'] : id === 'synthetic-writer' ? ['todo:read','todo:write'] : ['todo:read']}),
    assertWritable: async () => { if (!permit) throw Error('synthetic permit denied'); },
  });
  const send = async (path: string, method = 'GET', key = 'reader', body?: unknown, commandKey?: string) => {
    const response = await handler(new Request(baseURL + path, {method, headers: {
      host: '127.0.0.1:3190',
      ...(key ? {authorization: 'Bearer ' + key} : {}),
      ...(commandKey ? {'idempotency-key': commandKey} : {}),
      ...(body === undefined ? {} : {'content-type': 'application/json'}),
    }, ...(body === undefined ? {} : {body: JSON.stringify(body)})}));
    return {status: response.status, cache: response.headers.get('cache-control'), body: await response.json()};
  };
  return {send, repository, authenticated: () => authenticated, denyWrite: () => {permit = false;}};
}

test('disabled, missing, foreign and wrong-space grants disclose no capabilities', async () => {
  const disabled = fixture(false);
  assert.equal((await disabled.send('/v1/capabilities')).status, 404);
  assert.equal(disabled.authenticated(), 0);
  const {send, repository} = fixture();
  assert.equal((await send('/v1/capabilities', 'GET', '')).status, 401);
  assert.equal((await send('/v1/capabilities', 'GET', 'invalid')).status, 401);
  for (const key of ['foreign', 'wrong-space']) assert.equal((await send('/v1/capabilities', 'GET', key)).status, 403);
  assert.equal(repository.reads, 0);
});

test('versioned discovery exposes exactly the operations authorized by the grant', async () => {
  const {send} = fixture();
  const reader = await send('/v1/capabilities');
  assert.equal(reader.cache, 'private, no-store');
  assert.equal(reader.body.apiVersion, '1');
  assert.deepEqual(reader.body.operations.map((item: {method: string}) => item.method), ['GET', 'GET', 'GET', 'GET']);
  const writer = await send('/v1/capabilities', 'GET', 'writer');
  assert.deepEqual(writer.body.operations.map((item: {method: string}) => item.method), ['GET', 'GET', 'GET', 'GET', 'POST', 'PATCH']);
  const legacySix = [['discover','todo:read'],['listTodos','todo:read'],['snapshotTodos','todo:read'],['getTodo','todo:read'],['createTodo','todo:write'],['updateTodo','todo:write']];
  assert.deepEqual(writer.body.operations.map((x: {id:string;scope:string}) => [x.id,x.scope]), legacySix);
  assert.deepEqual(reader.body.operations.map((x: {id:string;scope:string}) => [x.id,x.scope]), legacySix.slice(0,4));
  assert.equal((await send('/v2/capabilities')).body.apiVersion, '2');
});

test('policy flag absent preserves the exact legacy v2 todo method/path/requiredScopes tuples',async()=>{
  const {send}=fixture();const response=await send('/v2/capabilities','GET','writer');
  assert.equal(response.status,200);assert.equal(response.body.authorization,undefined);
  const known=[
    ['discoverV2','GET','/v2/capabilities',[]],['discover','GET','/v1/capabilities',['todo:read']],
    ['listTodos','GET','/v1/todos',['todo:read']],['snapshotTodos','GET','/v1/todos/snapshot',['todo:read']],
    ['getTodo','GET','/v1/todos/{id}',['todo:read']],['createTodo','POST','/v1/todos',['todo:write']],
    ['updateTodo','PATCH','/v1/todos/{id}',['todo:write']],
  ];
  assert.deepEqual(response.body.operations.map((op:{id:string;method:string;path:string;requiredScopes:string[]})=>[op.id,op.method,op.path,op.requiredScopes]),known);
});

test('all-data discovery shows actual policy and refuses an unregistered operation sharing the same scopes',async()=>{
  const grant={grantId:'synthetic-all-policy',ownerId,spaceId,scopes:['todo:read','todo:write'] as const,businessDataPolicy:'all-personal-business-v1' as const,allowedOperationIds:['listTodos']};
  const handler=createAgentHandler({config,repository:new MemoryPort(),enabled:true,verify:async()=>grant,readCurrentGrant:async()=>grant,operationAvailable:()=>true,assertWritable:async()=>{}});
  const send=(path:string)=>handler(new Request(baseURL+path,{headers:{host:'127.0.0.1:3190',authorization:'Bearer synthetic-policy'}}));
  const response=await send('/v2/capabilities'),body=await response.json();assert.equal(response.status,200);
  assert.deepEqual(body.authorization,{businessDataPolicy:grant.businessDataPolicy,scopes:grant.scopes});
  assert.deepEqual(body.operations.map((op:{id:string})=>op.id),['discoverV2','listTodos']);
  assert.equal((await send('/v1/todos/snapshot')).status,403);
});

test('full todo snapshot returns complete fields beyond the bounded list without disclosing other types or owners', async () => {
  const {send, repository} = fixture();
  for (let n = 0; n < 55; n++) {
    assert.equal((await send('/v1/todos', 'POST', 'writer', {fields: {...fields, title: `Synthetic ${n}`}}, `synthetic-snapshot-${n.toString().padStart(4, '0')}`)).status, 201);
  }
  repository.readCurrentSnapshot = async owner => structuredClone([...repository.rows.values()].filter(row => row.ownerId === owner));
  const records = new PersonalService(repository, {...config, allowedTypes: ['todo', 'journal']});
  await records.mutate(ownerId, 'journal', null,
    {spaceId, confirmed: true, fields: {title: 'Private other type', text: 'Never include this journal', occurredOn: null}},
    'synthetic-other-type-0001');
  assert.equal((await send('/v1/todos')).body.truncated, true);
  const snapshot = await send('/v1/todos/snapshot');
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.cache, 'private, no-store');
  assert.equal(snapshot.body.scope, 'full-current-todo-snapshot');
  assert.equal(snapshot.body.truncated, false);
  assert.equal(snapshot.body.total, 55);
  assert.equal(snapshot.body.items.length, 55);
  assert.equal(new Set(snapshot.body.items.map((item: {id: string}) => item.id)).size, 55);
  assert.equal(snapshot.body.items[0].fields.notes, 'Retain me');
  assert.equal(snapshot.body.items[0].fields.personal, null);
  const first = snapshot.body.items[0];
  assert.equal(first.sourceId, repository.rows.get(first.id)!.source.id);
  assert.equal((await send('/v1/todos/' + first.id)).body.sourceId, first.sourceId);
  assert.equal(typeof snapshot.body.observedAt, 'string');
  assert.equal(JSON.stringify(snapshot.body).includes('ownerId'), false);
  assert.equal(JSON.stringify(snapshot.body).includes('Private other type'), false);
  assert.equal(JSON.stringify(snapshot.body).includes('Never include this journal'), false);
  assert.equal((await send('/v1/todos/snapshot', 'GET', '')).status, 401);
  assert.equal((await send('/v1/todos/snapshot', 'GET', 'foreign')).status, 403);
  assert.equal((await send('/v1/todos/snapshot?ownerId=synthetic-owner-b')).status, 404);
  assert.equal((await send('/v1/todos/snapshot', 'POST', 'writer')).status, 404);
});

test('full todo snapshot fails closed when the complete-read adapter is unavailable or invalid', async () => {
  const {send, repository} = fixture();
  assert.equal((await send('/v1/todos/snapshot')).status, 503);
  repository.readCurrentSnapshot = async () => Array.from({length: 10001}, () => ({})) as never;
  assert.equal((await send('/v1/todos/snapshot')).status, 503);
  await send('/v1/todos', 'POST', 'writer', {fields}, 'synthetic-snapshot-foreign');
  const entry = [...repository.rows.values()][0];
  repository.readCurrentSnapshot = async () => [{...entry, ownerId: 'foreign-owner'}];
  const rejected = await send('/v1/todos/snapshot');
  assert.equal(rejected.status, 503);
  assert.equal(JSON.stringify(rejected.body).includes(fields.title), false);
});

test('shared todo service handles write scope, field rejection, replay, version and readback', async () => {
  const {send, repository, denyWrite} = fixture();
  const post = (body: unknown, key = 'writer') => send('/v1/todos', 'POST', key, body, 'synthetic-agent-create-001');
  assert.equal((await post({fields}, 'reader')).status, 403);
  assert.equal((await post({fields, ownerId}, 'writer')).status, 400);
  const created = await post({fields});
  assert.equal(created.status, 201);
  const replay = await post({fields});
  assert.equal(replay.status, 200);
  assert.equal(replay.body.duplicate, true);
  assert.equal(replay.body.entry.id, created.body.entry.id);
  assert.equal((await post({fields: {...fields, title: 'Changed'}})).status, 409);
  const path = '/v1/todos/' + created.body.entry.id;
  const partial = await send(path, 'PATCH', 'writer', {expectedRevision: 1, fields: {title: 'Incomplete'}}, 'synthetic-agent-partial-001');
  assert.equal(partial.status, 400);
  assert.equal((await send(path)).body.fields.notes, 'Retain me');
  assert.equal((await send(path)).body.revision, 1);
  const patch = (revision: number, key: string) => send(path, 'PATCH', 'writer', {expectedRevision: revision, fields: {...fields, status: 'done', personal: null}}, key);
  assert.equal((await patch(2, 'synthetic-agent-stale-0001')).status, 409);
  assert.equal((await patch(1, 'synthetic-agent-update-001')).status, 200);
  assert.equal((await send(path)).body.fields.notes, 'Retain me');
  assert.equal((await send(path)).body.fields.status, 'done');
  assert.equal((await send('/v1/todos')).body.items.length, 1);
  denyWrite();
  assert.equal((await patch(2, 'synthetic-agent-denied-001')).status, 503);
  assert.equal(repository.rows.size, 1);
});

test('organization-only discovery uses v2 without legacy todo permission', async () => {
  const {send,repository} = fixture();
  assert.equal((await send('/v2/capabilities','GET','org')).status, 200);
  assert.equal((await send('/v2/capabilities','GET','')).status, 401);
  assert.equal((await send('/v2/capabilities','GET','foreign')).status, 403);
  assert.equal((await send('/v2/capabilities','GET','wrong-space')).status, 403);
  assert.equal((await send('/v1/capabilities','GET','org')).status, 403);
  assert.equal((await send('/v1/todos','GET','org')).status, 403);
  assert.equal((await send('/v1/organization/projects','GET','org')).status, 404);
  assert.equal(repository.reads, 0);
});

test('each request verifies its bearer once and rechecks the current grant by ID', async () => {
  let calls = 0;
  const grant: {grantId:string;ownerId:string;spaceId:string;scopes:readonly import('../src/agent-api/scopes.ts').AgentScope[]} = {grantId:'fixture-grant',ownerId,spaceId,scopes:['todo:read']};
  let current: typeof grant | null = grant;
  const handler = createAgentHandler({config,repository:new MemoryPort(),enabled:true,
    verify:async () => {calls++; return grant;},
    readCurrentGrant:async (id:string) => id === grant.grantId ? current : null,
    assertWritable:async()=>{}} as Parameters<typeof createAgentHandler>[0]);
  const send = () => handler(new Request(baseURL+'/v1/capabilities',{headers:{host:'127.0.0.1:3190',authorization:'Bearer fixture'}}));
  assert.equal((await send()).status,200);
  assert.equal(calls,1);
  current = null;
  assert.equal((await send()).status,403);
  current = {...grant,ownerId:'foreign'};
  assert.equal((await send()).status,403);
  current = {...grant,spaceId:'foreign'};
  assert.equal((await send()).status,403);
  current = {...grant,scopes:['organization:read']};
  assert.equal((await send()).status,403);
  assert.equal(calls,5);
});

test('initial verifier rate-limit response remains 429', async () => {
  const {PlatformError} = await import('../src/platform/domain.ts');
  const handler = createAgentHandler({config,repository:new MemoryPort(),enabled:true,
    verify:async()=>{throw new PlatformError(429,'RATE_LIMITED','fixture');},
    readCurrentGrant:async()=>null,assertWritable:async()=>{}} as Parameters<typeof createAgentHandler>[0]);
  assert.equal((await handler(new Request(baseURL+'/v1/capabilities',{headers:{host:'127.0.0.1:3190',authorization:'Bearer fixture'}}))).status,429);
});

test('v2 discovery and execution share current availability without invoking write guard', async () => {
  const grant={grantId:'fixture-grant',ownerId,spaceId,scopes:['todo:read','todo:write'] as const};
  let ready=false, guardCalls=0;
  const handler=createAgentHandler({config:{...config,businessWriteMode:'disabled'},repository:new MemoryPort(),enabled:true,
    verify:async()=>grant,readCurrentGrant:async()=>grant,
    operationAvailable:async (id:string)=> id !== 'createTodo' && id !== 'updateTodo' || ready,
    assertWritable:async()=>{guardCalls++;}} as Parameters<typeof createAgentHandler>[0]);
  const request=(path:string,method='GET',body?:unknown)=>handler(new Request(baseURL+path,{method,headers:{host:'127.0.0.1:3190',authorization:'Bearer fixture',...(body?{'content-type':'application/json','idempotency-key':'fixture-ready-test-0001'}:{})},...(body?{body:JSON.stringify(body)}:{})}));
  const ids=async(path:string)=>(await (await request(path)).json()).operations.map((item:{id:string})=>item.id);
  assert.deepEqual(await ids('/v2/capabilities'),['discoverV2','discover','listTodos','snapshotTodos','getTodo']);
  assert.equal(guardCalls,0);
  assert.equal((await request('/v1/todos','POST',{fields})).status,503);
  assert.equal(guardCalls,0);
  assert.equal((await ids('/v1/capabilities')).length,6);
  ready=true;
  assert.deepEqual(await ids('/v2/capabilities'),['discoverV2','discover','listTodos','snapshotTodos','getTodo','createTodo','updateTodo']);
  assert.equal((await request('/v1/todos','POST',{fields})).status,201);
  assert.ok(guardCalls > 0);
});

test('missing availability provider fails closed for business operations', async () => {
  const grant={grantId:'fixture-grant',ownerId,spaceId,scopes:['todo:read','todo:write'] as const};
  const handler=createAgentHandler({config,repository:new MemoryPort(),enabled:true,verify:async()=>grant,readCurrentGrant:async()=>grant,assertWritable:async()=>{}});
  const request=(path:string)=>handler(new Request(baseURL+path,{headers:{host:'127.0.0.1:3190',authorization:'Bearer fixture'}}));
  const body=await (await request('/v2/capabilities')).json();
  assert.deepEqual(body.operations.map((op:{id:string})=>op.id),['discoverV2','discover']);
  assert.equal((await request('/v1/todos')).status,503);
});

test('mounted handler never advertises writes without its transaction fence', async () => {
  const grant={grantId:'fixture-grant',ownerId,spaceId,scopes:['todo:read','todo:write'] as const};
  const handler=createAgentHandler({config,repository:new MemoryPort(),enabled:true,mountPath:'/api/platform/agent',
    verify:async()=>grant,readCurrentGrant:async()=>grant,operationAvailable:()=>true,assertWritable:async()=>{}});
  const response=await handler(new Request(baseURL+'/api/platform/agent/v2/capabilities',{headers:{host:'127.0.0.1:3190',authorization:'Bearer fixture'}}));
  const body=await response.json();
  assert.equal(body.operations.some((item:{id:string})=>item.id==='createTodo'),false);
});
