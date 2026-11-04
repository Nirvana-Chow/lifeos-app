import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeAgentScopes, encodeAgentPermissions, decodeAgentPermissions} from '../src/agent-api/scopes.ts';
import {AuthorityService} from '../src/agent-authority/service.ts';

test('scope codec rejects empty, unknown, duplicate and write-only grants', () => {
  assert.deepEqual(normalizeAgentScopes(['organization:write','organization:read']), ['organization:read','organization:write']);
  for (const value of [[], ['todo:read','todo:read'], ['todo:admin'], ['todo:write'], 'todo:read']) assert.throws(() => normalizeAgentScopes(value));
  assert.deepEqual(encodeAgentPermissions(['todo:read','todo:write','organization:read']), {todo:['read','write'],organization:['read']});
  for (const value of [{}, {todo:['write']}, {todo:['read','read']}, {todo:['read','admin']}, {other:['read']}, {todo:['read'],other:['read']}]) assert.equal(decodeAgentPermissions(value), null);
  assert.deepEqual(decodeAgentPermissions({organization:['read','write']}), ['organization:read','organization:write']);
});

test('authority rechecks verified identity, grant and binding and rejects forged actors', async () => {
  let valid = true;
  const service = new AuthorityService({ownerId:'owner',spaceId:'space',
    verifyOwner: async () => valid ? {ownerId:'owner',spaceId:'space',sessionRef:'session'} : null,
    verifyAgent: async () => valid ? {ownerId:'owner',spaceId:'space',grantId:'grant',scopes:['todo:read']} : null,
    readCurrentAgent: async () => valid ? {ownerId:'owner',spaceId:'space',grantId:'grant',scopes:['todo:read']} : null});
  const actor = await service.resolveAgentActor('key');
  assert.ok(actor);
  await service.assertCurrentAuthority(actor, 'listTodos');
  await assert.rejects(service.assertCurrentAuthority({...actor} as typeof actor, 'listTodos'));
  valid = false;
  await assert.rejects(service.assertCurrentAuthority(actor, 'listTodos'));
  assert.equal(await service.resolveOwnerActor(new Headers()), null);
});

test('owner authority rechecks the verified session and rejects a changed binding', async () => {
  let sessionRef = 'session'; let ownerId = 'owner';
  const service = new AuthorityService({ownerId:'owner',spaceId:'space',
    verifyOwner:async () => ({ownerId,spaceId:'space',sessionRef}), verifyAgent:async () => null});
  const owner = await service.resolveOwnerActor(new Headers());
  assert.ok(owner);
  await service.assertCurrentAuthority(owner, 'listTodos');
  sessionRef = 'other';
  await assert.rejects(service.assertCurrentAuthority(owner, 'listTodos'));
  ownerId = 'other';
  assert.equal(await service.resolveOwnerActor(new Headers()), null);
});
