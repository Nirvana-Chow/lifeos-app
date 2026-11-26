import assert from 'node:assert/strict';
import test from 'node:test';
import {PersonalService} from '../src/personal-candidate/service.ts';
import {fileIndexPath} from '../src/personal-file-index/contract.ts';
import {fileIndexFixture} from './helpers/personal-file-index-fixture.ts';

test('file index returns only exact same-space project pins and rechecks the link before opening', async () => {
  const f = await fileIndexFixture();
  const handler = f.handler(JSON.stringify(f.manifest));
  const read = (path: string) => handler(new Request(f.config.baseURL + path, {headers: {host: '127.0.0.1:3111'}}));
  const before = f.repository.events.length;
  const response = await read(fileIndexPath);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const value = await response.json();
  assert.equal(value.state, 'ready');
  assert.deepEqual(value.rows.map((row: {project: {state: string}}) => row.project.state), ['current','changed','unavailable','unlinked','unavailable']);
  assert.deepEqual(value.rows[0].project.pin, f.exact);
  assert.deepEqual(value.rows[2].project, {state: 'unavailable'});
  assert.equal(JSON.stringify(value).includes(f.entries[2].project.id), false);
  const link = (i: number) => fileIndexPath + '/' + f.entries[i].id + '/project';
  const opened = await read(link(0));
  assert.equal(opened.status, 200);
  assert.deepEqual((await opened.json()).project, f.exact);
  assert.equal((await read(link(1))).status, 409);
  assert.equal((await read(link(2))).status, 409);
  assert.equal((await read(link(3))).status, 404);
  assert.equal(f.repository.events.length, before);
  assert.equal(f.writableChecks(), 0);
  const service = new PersonalService(f.repository, f.config);
  await service.mutate(f.config.ownerId, 'project', f.exact.id, {spaceId: f.config.spaceId, confirmed: true, expectedRevision: 1,
    fields: {...f.fields, text: 'Synthetic changed target'}}, 'fixture-index-advance');
  assert.equal((await read(link(0))).status, 409);
});

test('file index distinguishes unavailable, empty, malformed, forbidden and revoked reads', async () => {
  const f = await fileIndexFixture(), url = f.config.baseURL + fileIndexPath;
  const request = (method = 'GET', auth?: string) => new Request(url, {method,
    headers: {host: '127.0.0.1:3111', ...(auth ? {authorization: auth} : {})}});
  assert.deepEqual(await (await f.handler()(request())).json(), {state: 'unconnected'});
  assert.deepEqual(await (await f.handler(JSON.stringify({...f.manifest, entries: []}))(request())).json(), {state: 'ready', rows: []});
  assert.equal((await f.handler('{')(request())).status, 503);
  assert.equal((await f.handler(JSON.stringify(f.manifest), false)(request())).status, 503);
  assert.equal((await f.handler(JSON.stringify({...f.manifest, spaceId: 'other-space'}))(request())).status, 403);
  assert.equal((await f.handler(JSON.stringify({...f.manifest, entries: [f.entries[0],f.entries[0]]}))(request())).status, 503);
  const handler = f.handler(JSON.stringify(f.manifest));
  assert.equal((await handler(request('GET','Bearer synthetic'))).status, 403);
  assert.equal((await handler(request('POST'))).status, 405);
  f.setPrincipal({userId: 'different-user', email: 'other@example.invalid'});
  assert.equal((await handler(request())).status, 403);
  f.setPrincipal({userId: f.config.ownerId, email: f.config.ownerEmail});
  const get = f.repository.get.bind(f.repository);
  f.repository.get = async (...args) => {
    const row = await get(...args);
    f.setPrincipal(null);
    return row;
  };
  const lost = await handler(request());
  assert.equal(lost.status, 401);
  assert.equal(JSON.stringify(await lost.json()).includes(f.entries[0].title), false);
  assert.equal(f.writableChecks(), 0);
});
