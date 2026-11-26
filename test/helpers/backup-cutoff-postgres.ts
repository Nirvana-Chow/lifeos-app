import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
import type {TestContext} from 'node:test';

export const postgresImage = 'postgres:17.11-bookworm@sha256:839fbb5a4942a7758dd93e18b42ea5649807491a0545b5eeeb8f0b8bb11857a5';
export const database = 'lifeos_platform_test_local';
const runtimeRole = 'lifeos_platform_candidate_runtime';

function docker(args: string[], input?: Buffer) {
  return spawnSync('docker', ['--host', 'unix:///var/run/docker.sock', ...args], {
    input, timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
  });
}

function checkedDocker(args: string[], description: string, input?: Buffer) {
  const result = docker(args, input);
  assert.equal(result.status, 0, description + ' failed' + (result.error ? ' (' + ((result.error as NodeJS.ErrnoException).code ?? 'spawn error') + ')' : ''));
  return result.stdout;
}

export function assertBackupFixtureEnvironment() {
  assert.equal(process.env.RUN_BACKUP_CUTOFF_POSTGRES_TESTS, '1');
  // Refuse an ambient connection or path override before inspecting Docker.
  const configured = Object.keys(process.env).some(name =>
    /^(?:PG[A-Z_]*|DATABASE_URL|DOCKER_HOST|DOCKER_CONTEXT|LIFEOS_.*(?:DATABASE_URL|DATA_DIR|BLOB_DIR|STORAGE_DIR))$/.test(name),
  );
  assert.equal(configured, false, 'Run the synthetic fixture without ambient database, storage or Docker target settings');
  const metadata = JSON.parse(checkedDocker(['image', 'inspect', postgresImage], 'Preloaded CI image inspection').toString());
  assert.equal(metadata.length, 1);
  assert.match(metadata[0].Id, /^sha256:[a-f0-9]{64}$/);
  assert.ok(metadata[0].RepoDigests.some((value: string) => value.endsWith('@' + postgresImage.split('@')[1])));
  return metadata[0].Id as string;
}

/** Only creates fresh, loopback-published clusters with disposable memory storage. */
export async function startBackupClusters(test: TestContext, imageId: string) {
  const runId = randomUUID();
  const label = 'lifeos.backup.fixture=' + runId;
  const resources: {side: 'source' | 'target'; pools: Pool[]}[] = [];
  const fixtureName = (side: string) => 'lifeos-backup-' + side + '-' + runId;
  const fixtureIds = () => checkedDocker(['ps', '-aq', '--no-trunc', '--filter', 'label=' + label],
    'Fixture ownership inspection').toString().trim().split(/\s+/).filter(Boolean);
  assert.deepEqual(fixtureIds(), []);
  test.after(async () => {
    await Promise.allSettled(resources.flatMap(resource => resource.pools.map(pool => pool.end())));
    const ids = fixtureIds();
    assert.ok(ids.length <= 2);
    for (const id of ids) {
      assert.match(id, /^[a-f0-9]{64}$/);
      const details = JSON.parse(checkedDocker(['inspect', id], 'Fixture cleanup eligibility').toString())[0];
      assert.equal(details.Config.Labels['lifeos.backup.fixture'], runId);
      assert.ok(resources.some(resource => details.Name === '/' + fixtureName(resource.side)),
        'Refusing to stop a container outside this fixture');
      // --rm may remove a container between its inspection and the stop request.
      const stopped = docker(['stop', '--time', '5', id]);
      if (stopped.status !== 0) assert.ok(!fixtureIds().includes(id), 'Disposable cluster stop failed');
    }
    for (let attempt = 0; attempt < 30 && fixtureIds().length; attempt++) await delay(200);
    assert.deepEqual(fixtureIds(), [], 'Disposable backup containers still present');
    test.diagnostic('Verified removal of both labeled cluster resources');

  });

  async function start(side: 'source' | 'target') {
    const adminPassword = randomBytes(24).toString('hex');
    const runtimePassword = randomBytes(24).toString('hex');
    const resource = {side, pools: [] as Pool[]};
    resources.push(resource);
    const id = checkedDocker([
      'run', '--pull=never', '--detach', '--rm', '--name', fixtureName(side),
      '--label', label, '--network', 'bridge', '--publish', '127.0.0.1::5432',
      '--tmpfs', '/var/lib/postgresql/data:rw', '--env', 'POSTGRES_DB=' + database,
      '--env', 'POSTGRES_USER=postgres', '--env', 'POSTGRES_PASSWORD=' + adminPassword, imageId,
    ], 'Disposable ' + side + ' cluster startup').toString().trim();
    assert.match(id, /^[a-f0-9]{64}$/);
    const binding = checkedDocker(['port', id, '5432/tcp'], 'Loopback binding inspection').toString().trim();
    const match = /^127\.0\.0\.1:([0-9]+)$/.exec(binding);
    assert.ok(match, 'Fixture must be bound exclusively to IPv4 loopback');
    const port = Number(match[1]);
    assert.ok(port >= 1024 && port <= 65535);
    function connect(user: 'postgres' | typeof runtimeRole) {
      const pool = new Pool({
        host: '127.0.0.1', port, user, database, ssl: false,
        password: user === 'postgres' ? adminPassword : runtimePassword,
        max: 2, connectionTimeoutMillis: 2_000, statement_timeout: 10_000,
        idle_in_transaction_session_timeout: 35_000, options: '-c search_path=pg_catalog,lifeos_platform',
      });
      // pg Pool emits socket errors on idle clients independently of queries.
      pool.on('error', () => {});
      resource.pools.push(pool);
      return pool;
    }
    const admin = connect('postgres');
    let identifier: string | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const row = (await admin.query("select current_setting('server_version_num') version, current_database() database, system_identifier from pg_control_system()")).rows[0];
        assert.equal(row.version, '170011');
        assert.equal(row.database, database);
        identifier = row.system_identifier;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED' &&
            (error as NodeJS.ErrnoException).code !== '57P03' &&
            !/Connection terminated unexpectedly|timeout exceeded|Connection terminated due to connection timeout/i.test(String(error))) throw error;
        await delay(200);
      }
    }
    assert.ok(identifier, 'Disposable ' + side + ' PostgreSQL did not become ready');
    // The only SQL input here is generated hex for a synthetic restricted role.
    await admin.query(`CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${runtimePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      REVOKE CONNECT, CREATE ON DATABASE ${database} FROM PUBLIC;
      GRANT CONNECT ON DATABASE ${database} TO ${runtimeRole};`);
    const empty = await admin.query("select to_regnamespace('lifeos_platform') is null empty");
    assert.equal(empty.rows[0].empty, true);
    return {
      identifier, port, admin, read: () => connect(runtimeRole),
      dump(snapshot: string) {
        assert.equal(side, 'source');
        assert.match(snapshot, /^[A-Fa-f0-9-]+$/);
        return checkedDocker(['exec', id, 'pg_dump', '-U', 'postgres', '-d', database,
          '--format=custom', '--schema=lifeos_platform', '--schema=file_handoff_fixture', '--snapshot=' + snapshot], 'PostgreSQL snapshot dump');
      },
      restore(archive: Buffer) {
        assert.equal(side, 'target');
        return docker(['exec', '-i', id, 'pg_restore', '-U', 'postgres', '-d', database,
          '--single-transaction', '--exit-on-error'], archive);
      },
    };
  }

  const source = await start('source');
  const target = await start('target');
  assert.notEqual(source.port, target.port);
  assert.notEqual(source.identifier, target.identifier);
  test.diagnostic('Verified independent PostgreSQL 17.11 system identifiers');
  return {source, target};
}
