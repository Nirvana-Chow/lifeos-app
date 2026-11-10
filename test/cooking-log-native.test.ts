import assert from 'node:assert/strict';
import test from 'node:test';
import {readPersonalConfig, type PersonalConfig} from '../src/personal-candidate/config.ts';
import {createPersonalPlatformHandler, personalPermitBinding} from '../src/personal-candidate/runtime-http.ts';
import type {InboxDraft} from '../src/platform/domain.ts';
import {MemoryPort} from './helpers/platform.ts';

const config = {
  ownerId: 'synthetic-cooking-owner', ownerEmail: 'cooking@example.test',
  spaceId: 'synthetic-cooking-space', databaseName: 'lifeos_platform_test_local',
  allowedTypes: ['todo', 'journal'], approval: 'personal-manual-v1',
  baseURL: 'https://cooking.example.test',
} as const;
const recipe = {
  id: '2130948c0fd24404',
  sourceUrl: 'https://github.com/Anduin2017/HowToCook/blob/a0b14bd388ee996943173679c3a7c9db7da04a6c/dishes/vegetable_dish/%E8%A5%BF%E7%BA%A2%E6%9F%BF%E7%82%92%E9%B8%A1%E8%9B%8B.md',
};
const fields = {title: '合成菜名', text: '', occurredOn: '2024-02-29', personal: {type: 'cooking', schemaVersion: 1, recipe}};
const command = {spaceId: config.spaceId, confirmed: true, fields};

function fixture() {
  const repo = new MemoryPort();
  repo.readCurrentSnapshot = async owner => structuredClone([...repo.rows.values()].filter(entry => entry.ownerId === owner));
  let actor: {userId: string; email: string} | null = {userId: config.ownerId, email: config.ownerEmail};
  let writable = true;
  function start({enabled = true, storageVerified = true} = {}) {
    const handler = createPersonalPlatformHandler({
      repository: repo,
      config: {...config, ...(enabled ? {cookingEnabled: true} : {})} as PersonalConfig,
      storageVerified,
      sessions: {read: async () => actor},
      assertWritable: async () => { if (!writable) throw new Error('closed'); },
    });
    return async (path: string, method = 'GET', body?: unknown, options: {key?: string; origin?: string} = {}) => {
      const response = await handler(new Request(config.baseURL + '/api/platform/personal/' + path, {
        method, headers: {host: 'cooking.example.test', origin: options.origin ?? config.baseURL,
          'content-type': 'application/json', 'idempotency-key': options.key ?? crypto.randomUUID()},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      }));
      return {status: response.status, body: await response.json(), cache: response.headers.get('cache-control')};
    };
  }
  return {repo, start, setActor(value: typeof actor) { actor = value; }, closeWrites() { writable = false; }};
}

test('cooking uses its exact independent flag and keeps old write permit bindings when closed', () => {
  const platform = {...config, databaseURL: 'postgresql://lifeos_platform_candidate_runtime:synthetic@127.0.0.1:55432/lifeos_platform_test_local'};
  const env = {
    LIFEOS_PERSONAL_ENABLED: '1', LIFEOS_PERSONAL_APPROVED: 'personal-manual-v1',
    LIFEOS_PERSONAL_OWNER_ID: config.ownerId, LIFEOS_PERSONAL_OWNER_EMAIL: config.ownerEmail,
    LIFEOS_PERSONAL_SPACE_ID: config.spaceId, LIFEOS_PERSONAL_DATABASE_NAME: config.databaseName,
    LIFEOS_PERSONAL_ALLOWED_TYPES: 'todo,journal',
  };
  const closed = readPersonalConfig(env, platform)!;
  const enabled = readPersonalConfig({...env, LIFEOS_PERSONAL_COOKING: 'personal-cooking-v1'}, platform)!;
  assert.equal(closed.cookingEnabled, undefined);
  assert.equal(enabled.cookingEnabled, true);
  assert.deepEqual(enabled.allowedTypes, ['todo', 'journal']);
  assert.throws(() => readPersonalConfig({...env, LIFEOS_PERSONAL_COOKING: '1'}, platform));
  const sha = 'a'.repeat(40);
  assert.deepEqual(personalPermitBinding(closed, sha), personalPermitBinding(config, sha));
  assert.notEqual(personalPermitBinding(enabled, sha).configDigest, personalPermitBinding(closed, sha).configDigest);
});

test('owner cooking records support native create, replay, readback, edit and historical revisions', async () => {
  const {repo, start} = fixture();
  const send = start(), key = 'synthetic-first-cooking';
  const first = await send('cooking', 'POST', command, {key});
  assert.equal(first.status, 201);
  const entry = first.body.entry, path = 'cooking/' + entry.id;
  assert.equal(repo.rows.get(entry.id)?.kind, 'inbox');
  assert.deepEqual(entry.draft, {...fields, disposition: 'reference'});
  assert.equal(first.cache, 'private, no-store');
  const replay = await send('cooking', 'POST', command, {key});
  assert.equal(replay.status, 200);
  assert.equal(replay.body.duplicate, true);
  assert.deepEqual(replay.body.entry, entry);
  const update = {...command, expectedRevision: 1, fields: {...fields, text: '合成复盘'}};
  assert.equal((await send(path, 'PATCH', update)).status, 200);
  const restarted = start();
  assert.equal((await restarted(path)).body.entry.draft.text, '合成复盘');
  assert.deepEqual((await restarted(path)).body.entry.source, entry.source);
  assert.equal((await restarted('cooking')).body.items[0].id, entry.id);
  assert.equal((await restarted('cooking/snapshot')).body.total, 1);
  assert.deepEqual((await restarted(path + '/history')).body.items.map((row: {revision: number}) => row.revision), [2, 1]);
  assert.equal((await restarted(path, 'PATCH', update)).body.error.code, 'REVISION_CONFLICT');
  assert.equal(repo.historyRows.length, 2);
});

test('missing date, wrong recipe pins and unsupported fields reject without persistence', async () => {
  const {repo, start} = fixture(), send = start();
  for (const candidate of [
    {...fields, occurredOn: undefined}, {...fields, occurredOn: null}, {...fields, occurredOn: '2023-02-29'},
    {...fields, title: ' '}, {...fields, text: undefined},
    {...fields, personal: {...fields.personal, recipe: {...recipe, id: '0000000000000000'}}},
    {...fields, personal: {...fields.personal, recipe: {...recipe, sourceUrl: 'https://example.test/recipe'}}},
    {...fields, personal: {...fields.personal, recipe: {...recipe, sourceUrl: recipe.sourceUrl.replace('a0b14bd388ee996943173679c3a7c9db7da04a6c', 'b'.repeat(40))}}},
    {...fields, personal: {...fields.personal, attachment: 'synthetic-photo'}},
  ]) assert.equal((await send('cooking', 'POST', {...command, fields: candidate})).status, 400);
  assert.equal(repo.rows.size, 0);
  assert.equal(repo.receipts.size, 0);
  assert.equal((await send('cooking', 'POST', {...command, fields: {...fields, personal: {...fields.personal, recipe: null}}})).status, 201);
});

test('an existing fixed historical recipe pin remains readable and editable after the catalog changes', async () => {
  const {repo, start} = fixture(), send = start();
  const first = await send('cooking', 'POST', command);
  assert.equal(first.status, 201);
  const {id} = first.body.entry, path = 'cooking/' + id;
  const stored = repo.rows.get(id)!;
  const previousPin = {...recipe, sourceUrl: recipe.sourceUrl.replace('a0b14bd388ee996943173679c3a7c9db7da04a6c', 'b'.repeat(40))};
  const historicalFields = {...fields, personal: {...fields.personal, recipe: previousPin}};
  const origin = stored.source.original as {input: typeof command};
  const previous = {...stored, draft: {...stored.draft, personal: historicalFields.personal} as InboxDraft,
    source: {...stored.source, original: {...origin, input: {...command, fields: historicalFields}}}};
  repo.rows.set(id, previous);
  repo.historyRows[0] = previous;
  assert.deepEqual((await send(path)).body.entry.draft.personal.recipe, previousPin);
  const updated = await send(path, 'PATCH', {...command, expectedRevision: 1, fields: {...historicalFields, text: '合成更新'}});
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.entry.draft.personal.recipe, previousPin);
  assert.equal((await send(path + '/history')).body.items.length, 2);
});

test('closed or unverified cooking stays out of native and aggregate reads, and stale authority blocks writes', async () => {
  const f = fixture();
  const send = f.start();
  const first = await send('cooking', 'POST', command);
  assert.equal(first.status, 201);
  const id = first.body.entry.id;
  assert.equal((await send('status')).body.cookingEnabled, true);
  for (const options of [{enabled: false}, {storageVerified: false}]) {
    const closed = f.start(options);
    assert.equal((await closed('status')).body.cookingEnabled, false);
    assert.equal((await closed('cooking/' + id)).status, options.enabled === false ? 404 : 503);
    assert.equal((await closed('cooking', 'POST', command)).status, options.enabled === false ? 404 : 503);
    for (const path of ['overview?today=2024-02-29', 'search?q=合成菜名', 'export']) {
      const read = await closed(path);
      assert.equal(read.status, 200);
      assert.equal(JSON.stringify(read.body).includes(id), false);
    }
  }
  assert.equal((await send('cooking', 'POST', command, {origin: 'https://foreign.example.test'})).status, 403);
  f.closeWrites();
  assert.equal((await send('cooking', 'POST', command)).status, 503);
  f.setActor({userId: 'other-synthetic-owner', email: 'other@example.test'});
  assert.equal((await send('cooking/' + id)).status, 403);
  f.setActor(null);
  assert.equal((await send('cooking/' + id)).status, 401);
  assert.equal(f.repo.rows.size, 1);
});
