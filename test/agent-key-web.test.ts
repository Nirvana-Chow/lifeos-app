import assert from 'node:assert/strict';
import test from 'node:test';
import {createKeyManagementHandler, handleKeyManagementRequest} from '../src/agent-api/key-web.ts';

const origin = 'https://lifeos.example.test';
const path = '/api/platform/account/api-keys';
function call(method = 'GET', extra: Record<string, string> = {}, suffix = '', body?: unknown) {
  return new Request(origin + path + suffix, {
    method,
    headers: {Host: new URL(origin).host, ...extra, ...(body ? {'Content-Type': 'application/json'} : {})},
    ...(body ? {body: JSON.stringify(body)} : {}),
  });
}

test('management is closed by default and never accepts bearer-only or cross-origin requests', async () => {
  const saved = process.env.LIFEOS_AGENT_KEY_MANAGEMENT;
  delete process.env.LIFEOS_AGENT_KEY_MANAGEMENT;
  try {
    assert.equal((await handleKeyManagementRequest(call())).status, 404);
  } finally {
    if (saved !== undefined) process.env.LIFEOS_AGENT_KEY_MANAGEMENT = saved;
  }
  const handle = createKeyManagementHandler(origin, async () => assert.fail('issuer should not be contacted'));
  assert.equal((await handle(call())).status, 401);
  assert.equal((await handle(call('GET', {Cookie: 'fixture=test', Authorization: 'Bearer fixture'}))).status, 401);
  assert.equal((await handle(call('POST', {Cookie: 'fixture=test'}, '', {name: 'synthetic'}))).status, 403);
  assert.equal((await handle(call('DELETE', {Cookie: 'fixture=test', Origin: 'https://foreign.example.test'}, '/fixture'))).status, 403);
  assert.equal((await handle(call('GET', {Cookie: 'fixture=test', Host: 'foreign.example.test'}))).status, 403);
});

test('same-origin requests use fixed private operations and responses stay uncached', async () => {
  const received: unknown[] = [];
  const handle = createKeyManagementHandler(origin, async (operation, cookie, input) => {
    received.push({operation, cookie, input});
    if (operation === 'list') return Response.json({keys: []});
    if (operation === 'create') return Response.json({key: 'synthetic-once', grant: {}}, {status: 201});
    return new Response(null, {status: 204});
  });
  const browser = {Cookie: 'fixture=test', Origin: origin};
  const payload = {name: 'synthetic', scopes: ['todo:read'], expiresAt: '2030-01-01T00:00:00.000Z'};
  const list = await handle(call('GET', browser));
  assert.deepEqual(await list.json(), {keys: []});
  const created = await handle(call('POST', browser, '', payload));
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), {key: 'synthetic-once', grant: {}});
  const revoked = await handle(call('DELETE', browser, '/fixture'));
  assert.equal(revoked.status, 204);
  for (const result of [list, created, revoked]) {
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
    assert.equal(result.headers.get('vary'), 'Cookie');
  }
  assert.deepEqual(received, [
    {operation: 'list', cookie: 'fixture=test', input: {}},
    {operation: 'create', cookie: 'fixture=test', input: payload},
    {operation: 'revoke', cookie: 'fixture=test', input: {id: 'fixture'}},
  ]);
});
