import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import test from 'node:test';
import {apiKey} from '@better-auth/api-key';
import {betterAuth} from 'better-auth';
import {Pool, type QueryResult} from 'pg';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {handleAgentRequest} from '../src/agent-api/runtime.ts';
import {assertAgentTodoWriteGrant} from '../src/agent-api/grant-fence.ts';
import type {AgentScope} from '../src/agent-api/capabilities.ts';
import {PlatformError} from '../src/platform/domain.ts';
import {PostgresPlatformRepository, verifyRestrictedPool, type SqlPool} from '../src/platform/postgres.ts';
import {syntheticIdentities} from '../src/platform/synthetic-bootstrap.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import {acceptancePool, validateAcceptanceEnvironment} from './helpers/platform-pg.ts';

const table = 'lifeos_agent.apikey';
const roles = {issuer: 'lifeos_agent_issuer', verifier: 'lifeos_agent_verifier'};
const databaseName = 'lifeos_platform_test_local';
const spaceId = 'synthetic-agent-api-space';

function keyPool(raw: string | undefined, role: string, runtime: URL): Pool {
  if (!raw) throw Error('Missing isolated Agent key database configuration');
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' ||
      url.username !== role || url.port !== runtime.port || url.pathname !== '/' + databaseName ||
      !url.password || url.search || url.hash) throw Error('Unexpected Agent key database target');
  return new Pool({connectionString: raw, max: 2, connectionTimeoutMillis: 2000, statement_timeout: 5000,
    options: '-c search_path=lifeos_agent,pg_catalog'});
}

async function checkKeyRole(pool: Pool, role: string, issuer: boolean) {
  const {rows: [row]} = await pool.query(`SELECT
    current_database() AS database, current_user AS role,
    NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolinherit) AS restricted,
    NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid) AS no_memberships,
    NOT has_database_privilege(current_user,current_database(),'CREATE') AS cannot_create_database_objects,
    NOT has_schema_privilege(current_user,'lifeos_agent','CREATE') AS cannot_create_in_key_schema,
    NOT has_schema_privilege(current_user,'lifeos_platform','USAGE') AS no_business_schema_access,
    NOT has_table_privilege(current_user,'${table}','TRUNCATE,REFERENCES,TRIGGER') AS no_table_admin,
    has_table_privilege(current_user,'${table}','INSERT') AS can_issue,
    has_column_privilege(current_user,'${table}','enabled','UPDATE') AS can_revoke,
    has_column_privilege(current_user,'${table}','metadata','UPDATE') AS can_rebind
    FROM pg_roles r WHERE r.rolname = current_user`);
  assert.deepEqual(row, {database: databaseName, role, restricted: true, no_memberships: true,
    cannot_create_database_objects: true, cannot_create_in_key_schema: true, no_business_schema_access: true,
    no_table_admin: true, can_issue: issuer, can_revoke: issuer, can_rebind: issuer});
}

test('OPT-IN isolated PostgreSQL Agent grants, revocation and todo write/readback', {
  skip: process.env.RUN_AGENT_API_POSTGRES_TESTS !== '1' && 'No approved isolated Agent PostgreSQL target',
  timeout: 30000,
}, async () => {
  const fixture = validateAcceptanceEnvironment(process.env, process.execArgv);
  const database = new URL(fixture.databaseURL);
  if (database.pathname !== '/' + databaseName || database.port !== '55432' ||
      fixture.baseURL !== 'http://127.0.0.1:3190') throw Error('Expected the disposable Agent fixture');
  const runtime = acceptancePool(fixture.databaseURL);
  const issuer = keyPool(process.env.LIFEOS_AGENT_TEST_ISSUER_DATABASE_URL, roles.issuer, database);
  const verifier = keyPool(process.env.LIFEOS_AGENT_TEST_KEY_DATABASE_URL, roles.verifier, database);
  const auth = (pool: Pool) => betterAuth({
    baseURL: fixture.baseURL, secret: fixture.secret, database: pool,
    logger: {disabled: true}, telemetry: {enabled: false},
    plugins: [apiKey({enableSessionForAPIKeys: false, enableMetadata: true, startingCharactersConfig: {shouldStore: false}})],
  });

  try {
    await verifyRestrictedPool(runtime as SqlPool);
    await checkKeyRole(issuer, roles.issuer, true);
    await checkKeyRole(verifier, roles.verifier, false);
    const {rows: [runtimeGrants]} = await runtime.query(
      "SELECT NOT has_table_privilege(current_user,'lifeos_agent.apikey','SELECT,INSERT,UPDATE,DELETE') AS no_key_access");
    assert.equal(runtimeGrants.no_key_access, true);
    for (const pool of [issuer, verifier]) {
      const {rows: [core]} = await pool.query(`SELECT
        (SELECT count(*)::int FROM lifeos_agent."user") AS users,
        NOT has_table_privilege(current_user,'lifeos_agent.session','INSERT,UPDATE,DELETE') AS cannot_manage_sessions`);
      assert.deepEqual(core, {users: 0, cannot_manage_sessions: true});
    }
    const issuance = auth(issuer);
    const verification = auth(verifier);
    const [owner, other] = syntheticIdentities;
    const issue = async (userId: string, boundSpace: string, actions: string[], rateLimitMax = 100) =>
      issuance.api.createApiKey({body: {userId, expiresIn: 86400, metadata: {spaceId: boundSpace},
        permissions: {todo: actions}, rateLimitTimeWindow: 60000, rateLimitMax}});
    const writer = await issue(owner.id, spaceId, ['read', 'write']);
    const reader = await issue(owner.id, spaceId, ['read']);
    const foreign = await issue(other.id, spaceId, ['read', 'write']);
    const otherSpace = await issue(owner.id, 'synthetic-other-space', ['read', 'write']);
    const {rows: [stored]} = await issuer.query(`SELECT key, start FROM ${table} WHERE id = $1`, [writer.id]);
    assert.ok(stored.key === createHash('sha256').update(writer.key).digest('base64url'), 'Key storage must retain only a digest');
    assert.equal(stored.start, null);
    assert.equal((await verifier.query(`DELETE FROM ${table} WHERE id = $1`, [writer.id])).rowCount, 0);

    const repository = new PostgresPlatformRepository(runtime as SqlPool, true, true);
    const config = {ownerId: owner.id, ownerEmail: owner.email, databaseName, spaceId, baseURL: fixture.baseURL,
      approval: 'personal-manual-v1', allowedTypes: ['todo']} as const;
    const business = new PersonalService(repository, config);
    const keyForRevocation = await issue(owner.id, spaceId, ['read', 'write']);
    let revocationChecks = 0;
    const revoke = (id: string) => issuance.api.updateApiKey({body: {keyId: id, userId: owner.id, enabled: false}});
    const handler = createAgentHandler({
      enabled: true, config, repository, fenceWrites: true,
      verify: async token => {
        const result = await verification.api.verifyApiKey({body: {key: token}});
        if (!result.valid || !result.key) {
          if (result.error?.code === 'RATE_LIMITED') throw new PlatformError(429, 'RATE_LIMITED', 'Fixture limit reached');
          return null;
        }
        const key = result.key;
        if (typeof key.metadata?.spaceId !== 'string') return null;
        const scopes: AgentScope[] = [];
        if (key.permissions?.todo?.includes('read')) scopes.push('todo:read');
        if (key.permissions?.todo?.includes('write')) scopes.push('todo:write');
        return {grantId: key.id, ownerId: key.referenceId, spaceId: key.metadata.spaceId, scopes};
      },
      assertWritable: async grant => {
        if (grant.grantId === keyForRevocation.id && ++revocationChecks === 2) await revoke(grant.grantId);
        const result = await verifier.query(`SELECT 1 FROM ${table} WHERE id = $1 AND "referenceId" = $2 AND
          metadata::jsonb->>'spaceId' = $3 AND permissions::jsonb->'todo' ? 'write' AND enabled = true
          AND "expiresAt" > clock_timestamp()`, [grant.grantId, grant.ownerId, grant.spaceId]);
        if (result.rowCount !== 1) throw new PlatformError(403, 'WRITE_GRANT_REVOKED', 'Fixture grant is unavailable');
      },
    });
    const send = async (path: string, token?: string, method = 'GET', body?: unknown, command?: string) => {
      const response = await handler(new Request(fixture.baseURL + path, {method, headers: {
        host: new URL(fixture.baseURL).host,
        ...(token ? {authorization: 'Bearer ' + token} : {}),
        ...(body === undefined ? {} : {'content-type': 'application/json'}),
        ...(command ? {'idempotency-key': command} : {}),
      }, ...(body === undefined ? {} : {body: JSON.stringify(body)})}));
      return {status: response.status, body: await response.json()};
    };

    assert.equal((await send('/v1/capabilities')).status, 401);
    assert.equal((await send('/v1/capabilities', foreign.key)).status, 403);
    assert.equal((await send('/v1/capabilities', otherSpace.key)).status, 403);
    const allowed = await send('/v1/capabilities', reader.key);
    assert.equal(allowed.status, 200);
    assert.deepEqual(allowed.body.operations.map((operation: {method: string}) => operation.method), ['GET', 'GET', 'GET']);

    const idempotencyKey = 'fixture-agent-create-' + randomUUID();
    const fields = {title: 'Synthetic Agent PostgreSQL todo', notes: 'Retained', dueOn: null, status: 'open'};
    assert.equal((await send('/v1/todos', reader.key, 'POST', {fields}, idempotencyKey)).status, 403);
    const created = await send('/v1/todos', writer.key, 'POST', {fields}, idempotencyKey);
    assert.equal(created.status, 201);
    const path = '/v1/todos/' + created.body.entry.id;
    const replay = await send('/v1/todos', writer.key, 'POST', {fields}, idempotencyKey);
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body, {...created.body, duplicate: true});
    const done = {fields: {...fields, status: 'done', personal: null}, expectedRevision: 1};
    const updated = await send(path, writer.key, 'PATCH', done, 'fixture-agent-update-' + randomUUID());
    assert.equal(updated.status, 200);
    assert.equal(updated.body.entry.revision, 2);
    assert.equal((await send(path, writer.key, 'PATCH', done, 'fixture-agent-stale-' + randomUUID())).status, 409);
    assert.equal((await send(path, reader.key)).body.fields.status, 'done');

    const blocked = await send(path, keyForRevocation.key, 'PATCH', {...done, expectedRevision: 2},
      'fixture-agent-revoked-' + randomUUID());
    assert.equal(blocked.status, 403);
    assert.equal(revocationChecks, 2);
    assert.equal((await send(path, keyForRevocation.key)).status, 401);
    const persisted = await business.get(owner.id, 'todo', created.body.entry.id);
    assert.equal(persisted.revision, 2);
    assert.deepEqual(persisted.draft, {...fields, status: 'done'});
    assert.equal(await repository.get(other.id, 'todo', persisted.id), null);

    const pendingWrite = {fields: {...fields, status: 'done', notes: 'Concurrent writer committed'},
      spaceId, confirmed: true};
    const write = (grantId: string, command: string, expectedRevision: number, afterFence: () => Promise<void> = async () => {}) =>
      business.mutate(owner.id, 'todo', persisted.id, {...pendingWrite, expectedRevision}, command, undefined, async tx => {
        await assertAgentTodoWriteGrant(tx, {grantId, ownerId: owner.id, spaceId});
        await afterFence();
      });
    const waitForBlocked = async (sql: string, parameters: unknown[]) => {
      const deadline = Date.now() + 1500;
      do {
        const {rows: [row]} = await runtime.query(sql, parameters);
        if (row.blocked === true) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      } while (Date.now() < deadline);
      assert.fail('Expected PostgreSQL to observe the competing row lock');
    };

    // The write holds its grant lock through the business commit. The issuer's
    // ordinary revoke UPDATE must wait rather than become visible mid-write.
    const writerFirst = await issue(owner.id, spaceId, ['read', 'write']);
    const revokeClient = await issuer.connect();
    const revokeState: {query?: Promise<QueryResult>} = {};
    try {
      const {rows: [{pid}]} = await revokeClient.query('SELECT pg_backend_pid() AS pid');
      const saved = await write(writerFirst.id, 'fixture-agent-writer-first-' + randomUUID(), 2, async () => {
        revokeState.query = revokeClient.query(`UPDATE ${table} SET enabled = false WHERE id = $1`, [writerFirst.id]);
        // Attach a handler immediately in case fixture cleanup is needed.
        void revokeState.query.catch(() => {});
        await waitForBlocked('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [pid]);
      });
      assert.equal(saved.entry.revision, 3);
      assert.equal((await revokeState.query)?.rowCount, 1);
      await assert.rejects(
        write(writerFirst.id, 'fixture-agent-after-revoke-' + randomUUID(), 3),
        {status: 403, code: 'WRITE_GRANT_REVOKED'},
      );
    } finally {
      await revokeState.query?.catch(() => {});
      revokeClient.release();
    }

    // If revoke locks the row first, a writer that already authenticated
    // waits for the issuer commit and then observes the disabled grant.
    const revokerFirst = await issue(owner.id, spaceId, ['read', 'write']);
    const issuerTransaction = await issuer.connect();
    let rejected;
    try {
      await issuerTransaction.query('BEGIN');
      const {rows: [{pid}]} = await issuerTransaction.query('SELECT pg_backend_pid() AS pid');
      await issuerTransaction.query(`UPDATE ${table} SET enabled = false WHERE id = $1`, [revokerFirst.id]);
      rejected = assert.rejects(
        write(revokerFirst.id, 'fixture-agent-revoker-first-' + randomUUID(), 3),
        {status: 403, code: 'WRITE_GRANT_REVOKED'},
      );
      void rejected.catch(() => {});
      await waitForBlocked(`SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity WHERE usename = $1 AND $2::int = ANY(pg_blocking_pids(pid))
      ) AS blocked`, ['lifeos_platform_candidate_runtime', pid]);
      await issuerTransaction.query('COMMIT');
      await rejected;
    } finally {
      await issuerTransaction.query('ROLLBACK').catch(() => {});
      issuerTransaction.release();
      await rejected?.catch(() => {});
    }
    const fenced = await business.get(owner.id, 'todo', persisted.id);
    assert.equal(fenced.revision, 3);
    assert.deepEqual(fenced.draft, pendingWrite.fields);

    const expiring = await issue(owner.id, spaceId, ['read']);
    await issuer.query(`UPDATE ${table} SET "expiresAt" = clock_timestamp() - interval '1 minute' WHERE id = $1`,
      [expiring.id]);
    assert.equal((await send(path, expiring.key)).status, 401);
    const limited = await issue(owner.id, spaceId, ['read'], 1);
    assert.equal((await send(path, limited.key)).status, 200);
    assert.equal((await send(path, limited.key)).status, 429);
    assert.equal(await verification.api.getSession({headers: new Headers({'x-api-key': reader.key})}), null);
  } finally {
    await Promise.all([runtime.end(), issuer.end(), verifier.end()]);
  }
});


test('OPT-IN mounted HTTPS Agent runtime completes and reads back an authorized todo', {
  skip: process.env.RUN_AGENT_API_POSTGRES_TESTS !== '1' && 'No approved isolated Agent PostgreSQL target',
  timeout: 30000,
}, async () => {
  const fixture = validateAcceptanceEnvironment(process.env, process.execArgv);
  const database = new URL(fixture.databaseURL);
  if (database.pathname !== '/' + databaseName || database.port !== '55432' ||
      fixture.baseURL !== 'http://127.0.0.1:3190') throw Error('Expected the disposable Agent fixture');

  const ownerId = 'agent-runtime-owner';
  const ownerEmail = 'agent-runtime@example.test';
  const origin = 'https://agent-review.example.test';
  const issuer = keyPool(process.env.LIFEOS_AGENT_TEST_ISSUER_DATABASE_URL, roles.issuer, database);
  const runtime = acceptancePool(fixture.databaseURL);
  const binding = {
    LIFEOS_PLATFORM_BASE_URL: origin,
    LIFEOS_PLATFORM_TRANSPORT: 'https-origin',
    LIFEOS_PLATFORM_HTTPS_HOST: new URL(origin).hostname,
    LIFEOS_PLATFORM_OWNER_ID: ownerId,
    LIFEOS_PLATFORM_OWNER_EMAIL: ownerEmail,
    LIFEOS_PERSONAL_ENABLED: '1',
    LIFEOS_PERSONAL_APPROVED: 'personal-manual-v1',
    LIFEOS_PERSONAL_OWNER_ID: ownerId,
    LIFEOS_PERSONAL_OWNER_EMAIL: ownerEmail,
    LIFEOS_PERSONAL_DATABASE_NAME: databaseName,
    LIFEOS_PERSONAL_SPACE_ID: spaceId,
    LIFEOS_PERSONAL_ALLOWED_TYPES: 'todo,journal',
    LIFEOS_PERSONAL_READONLY_LOGIN: 'owner-session-v1',
    LIFEOS_PERSONAL_BUSINESS_WRITES: 'owner-managed-v1',
    LIFEOS_AGENT_API_ENABLED: '1',
    LIFEOS_AGENT_API_DATABASE_URL: process.env.LIFEOS_AGENT_TEST_KEY_DATABASE_URL!,
    LIFEOS_AGENT_API_SECRET: 'synthetic-agent-runtime-secret-for-disposable-fixture',
  };
  const previous = Object.fromEntries(Object.keys(binding).map(key => [key, process.env[key]]));
  const auth = betterAuth({
    baseURL: origin, secret: binding.LIFEOS_AGENT_API_SECRET, database: issuer,
    logger: {disabled: true}, telemetry: {enabled: false},
    plugins: [apiKey({enableSessionForAPIKeys: false, enableMetadata: true, startingCharactersConfig: {shouldStore: false}})],
  });
  try {
    assert.equal((await runtime.query('SELECT 1 FROM lifeos_platform.platform_user WHERE id=$1 AND email=$2',
      [ownerId, ownerEmail])).rowCount, 1);
    const grant = await auth.api.createApiKey({body: {
      userId: ownerId, expiresIn: 86400, metadata: {spaceId}, permissions: {todo: ['read', 'write']},
    }});
    const base = 'http://localhost:3002/api/platform/agent';
    const send = async (path: string, method = 'GET', body?: unknown) => {
      const response = await handleAgentRequest(new Request(base + path, {method, headers: {
        host: new URL(origin).host,
        'x-forwarded-host': new URL(origin).host,
        'x-forwarded-proto': 'https',
        'x-forwarded-port': '443',
        authorization: 'Bearer ' + grant.key,
        ...(body === undefined ? {} : {'content-type': 'application/json', 'idempotency-key': 'fixture-agent-runtime-' + randomUUID()}),
      }, ...(body === undefined ? {} : {body: JSON.stringify(body)})}));
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      return {status: response.status, body: await response.json()};
    };

    Object.assign(process.env, binding);
    assert.equal((await send('/v1/capabilities')).status, 200);
    const fields = {title: 'Synthetic mounted Agent todo', notes: '', dueOn: null, status: 'open'};
    const created = await send('/v1/todos', 'POST', {fields});
    assert.equal(created.status, 201);
    const path = '/v1/todos/' + created.body.entry.id;
    const completed = await send(path, 'PATCH', {fields: {...fields, status: 'done', personal: null}, expectedRevision: 1});
    assert.equal(completed.status, 200);
    const readback = await send(path);
    assert.equal(readback.status, 200);
    assert.equal(readback.body.revision, 2);
    assert.equal(readback.body.fields.status, 'done');
    await auth.api.updateApiKey({body: {keyId: grant.id, userId: ownerId, enabled: false}});
    assert.equal((await send(path)).status, 401);
  } finally {
    for (const [key,value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await Promise.all([issuer.end(),runtime.end()]);
  }
});
