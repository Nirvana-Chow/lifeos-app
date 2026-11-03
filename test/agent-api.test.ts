import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryPort} from './helpers/platform.ts';
import {createAgentHandler} from '../src/agent-api/http.ts';

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
        scopes: key === 'writer' ? ['todo:read', 'todo:write'] : ['todo:read'],
      };
    },
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
  assert.deepEqual(reader.body.operations.map((item: {method: string}) => item.method), ['GET', 'GET', 'GET']);
  const writer = await send('/v1/capabilities', 'GET', 'writer');
  assert.deepEqual(writer.body.operations.map((item: {method: string}) => item.method), ['GET', 'GET', 'GET', 'POST', 'PATCH']);
  assert.equal((await send('/v2/capabilities')).status, 404);
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
