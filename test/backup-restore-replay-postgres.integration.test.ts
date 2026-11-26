import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import type {Pool} from 'pg';
import {FileHandoffError, type FileHandoffActor} from '../src/file-handoff/contracts.ts';
import {PrivateFileBlobs} from '../src/file-handoff/blob-store.ts';
import {PostgresFileHandoffs, type FileHandoffAuthority} from '../src/file-handoff/postgres.ts';
import {FileHandoffService} from '../src/file-handoff/service.ts';
import {PinnedFileSource} from '../src/file-handoff/source.ts';
import {PostgresPlatformRepository, readPlatformEntryOnClient, verifyRestrictedPool, type SqlClient} from '../src/platform/postgres.ts';
import {requirements} from '../src/platform/requirements.ts';
import {RequirementsService} from '../src/requirements-candidate/service.ts';
import {DurableRequirementQueue} from '../src/requirement-events/mac-dispatcher.ts';
import {decodeWork} from '../src/requirement-events/postgres.ts';
import {assertBackupFixtureEnvironment, database, postgresImage, startBackupClusters} from './helpers/backup-cutoff-postgres.ts';
import {fileFixture} from './helpers/file-handoff-stage-pg.ts';

const enabled = process.env.RUN_BACKUP_CUTOFF_POSTGRES_TESTS === '1';
const {ownerId, spaceId, email} = fileFixture;
const actor: FileHandoffActor = {ownerId, spaceId, authorityRef: 'synthetic-file-authority'};
const personal = {
  ownerId, ownerEmail: email, spaceId, databaseName: database, baseURL: 'https://synthetic.example.invalid',
  approval: 'personal-manual-v1', allowedTypes: ['todo', 'journal', 'project', 'domain', 'topic'],
  requirementsEnabled: true,
} as const;
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const schemas = "('lifeos_platform','file_handoff_fixture')";

async function prepareSource(pool: Pool) {
  const client = await pool.connect();
  try {
    for (const migration of ['0001_platform_candidate.sql', '0002_platform_inbox.sql']) {
      await client.query(await readFile('db/' + migration, 'utf8'));
    }
    await client.query('insert into lifeos_platform.platform_user(id,name,email) values($1,$2,$3)',
      [ownerId, 'Synthetic file owner', email]);
    const approvals = {
      'lifeos.agent_expected_database': database, 'lifeos.agent_expected_owner': ownerId,
      'lifeos.agent_expected_space': spaceId, 'lifeos.file_handoff_migration_approved': 'file-handoff-v1',
      'lifeos.requirement_events_migration_approved': 'transaction-outbox-v1',
    };
    for (const [name, value] of Object.entries(approvals)) await client.query('select set_config($1,$2,false)', [name, value]);
    for (const migration of ['0020_requirement_events.proposed.sql', '0022_file_handoff.proposed.sql']) {
      await client.query(await readFile('db/' + migration, 'utf8'));
    }
    // Same synthetic authority port as the file handoff PostgreSQL fixture.
    await client.query(`create schema file_handoff_fixture;
      create table file_handoff_fixture.authority(owner_id text, space_id text, id text, enabled boolean, operations text[],
        primary key(owner_id, space_id, id));
      grant usage on schema file_handoff_fixture to lifeos_platform_candidate_runtime;
      grant select, update on file_handoff_fixture.authority to lifeos_platform_candidate_runtime`);
    await client.query('insert into file_handoff_fixture.authority values($1,$2,$3,true,$4)', [
      ownerId, spaceId, actor.authorityRef, ['stageFileHandoff', 'downloadFileHandoff', 'getFileHandoff', 'acknowledgeFileHandoff'],
    ]);
  } finally {client.release();}
}

function openFileServices(pool: Pool, directory: string, onDownload: () => void) {
  const requirementsReader = new RequirementsService(new PostgresPlatformRepository(pool, true), personal);
  const authority: FileHandoffAuthority = {
    async authorize(client, identity, operation) {
      const row = (await client.query('select enabled,operations from file_handoff_fixture.authority where owner_id=$1 and space_id=$2 and id=$3 for share',
        [identity.ownerId, identity.spaceId, identity.authorityRef])).rows[0];
      if (row?.enabled !== true || !Array.isArray(row.operations) || !row.operations.includes(operation)) throw new FileHandoffError(403, 'FILE_ACCESS_DENIED');
    },
    async readTarget(client, identity, id) {
      const tx = {get: (kind: Parameters<typeof readPlatformEntryOnClient>[2], recordId: string) =>
        readPlatformEntryOnClient(client, identity.ownerId, kind, recordId, true)};
      try {
        const record = await requirementsReader.getInTransaction(identity.ownerId, id, tx);
        return record.sourceId ? {id: record.id, sourceId: record.sourceId, revision: record.revision} : null;
      } catch (error) {
        if ((error as {status?: number}).status === 404) return null;
        throw error;
      }
    },
  };
  const repository = new PostgresFileHandoffs(pool, {enabled: true, ownerId, spaceId, maxBytes: 128, maxReservedBytes: 32768}, authority);
  const source = new PinnedFileSource({allowedOrigins: ['https://synthetic-files.example.invalid'], maxBytes: 128, timeoutMs: 1000}, {
    lookup: async () => [{address: '8.8.8.8', family: 4}],
    open: async url => {
      onDownload();
      return {
      status: 200, length: null, mimeType: 'text/plain', encoding: null,
      body: (async function* () {yield Buffer.from('Synthetic retained file ' + url.pathname + '\n');})(),
        close() {},
      };
    },
  });
  const blobs = new PrivateFileBlobs({directory, maxBytes: 128});
  const files = new FileHandoffService({enabled: true, repository, source, blobs});
  return {requirementsReader, repository, files, blobs};
}

async function eventState(client: SqlClient, after: string) {
  await client.query("select set_config('lifeos.owner_id',$1,true),set_config('lifeos.requirement_event_space',$2,true)", [ownerId, spaceId]);
  const outbox = (await client.query(`select event_id::text cursor, requirement_id, source_id::text, record_revision, work_digest, dispatch_state
    from lifeos_platform.requirement_event_outbox where owner_id=$1 and space_id=$2 order by event_id`, [ownerId, spaceId])).rows;
  const ready = (await client.query('select * from lifeos_platform.requirement_work where owner_id=$1 and space_id=$2 order by requirement_id',
    [ownerId, spaceId])).rows.map(decodeWork);
  for (const work of ready) {
    const event = outbox.findLast(row => row.requirement_id === work.requirementId);
    assert.deepEqual([event?.source_id, event?.record_revision, event?.work_digest, event?.dispatch_state],
      [work.sourceId, work.revision, work.workDigest, 'ready']);
  }
  const cursor = String(outbox.at(-1)?.cursor ?? '0');
  assert.ok(BigInt(after) <= BigInt(cursor));
  const events = outbox.filter(row => BigInt(String(row.cursor)) > BigInt(after));
  return {cursor, ready, events};
}

async function readEvents(pool: Pool, after = '0') {
  const client = await pool.connect();
  try {
    await client.query('begin isolation level repeatable read read only');
    return await eventState(client, after);
  } finally {await client.query('rollback');client.release();}
}

async function databaseDigest(reader: Pick<SqlClient, 'query'>) {
  const tables = (await reader.query('select schemaname,tablename from pg_tables where schemaname in ' + schemas + ' order by schemaname,tablename')).rows;
  const entries = [];
  for (const {schemaname, tablename} of tables) {
    assert.equal(typeof schemaname, 'string');
    assert.equal(typeof tablename, 'string');
    assert.match(schemaname as string, /^[a-z_]+$/);
    assert.match(tablename as string, /^[a-z_]+$/);
    const rows = (await reader.query('select to_jsonb(t)::text value from ' + schemaname + '.' + tablename + ' t order by value')).rows;
    entries.push([schemaname, tablename, rows]);
  }
  return sha256(JSON.stringify(entries));
}

/** Sibling of the exact-cutoff test. Exercise only what happens after restore. */
test('OPT-IN restored file receipts and durable queue replay without duplicates', {
  skip: !enabled && 'Set RUN_BACKUP_CUTOFF_POSTGRES_TESTS=1 on a disposable Docker host',
  timeout: 140_000,
}, async t => {
  const imageId = assertBackupFixtureEnvironment();
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {encoding: 'utf8'}).trim(), '',
    'Use a clean checkout so the SHA identifies the proof');
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  assert.match(sourceSha, /^[a-f0-9]{40}$/);
  t.diagnostic('source=' + sourceSha + ' image=' + postgresImage);
  const {source, target} = await startBackupClusters(t, imageId);
  t.diagnostic('Synthetic PostgreSQL system identifiers source=' + source.identifier + ' target=' + target.identifier);
  const root = await mkdtemp('/tmp/lifeos-backup-replay-');
  t.after(async () => {
    await rm(root, {recursive: true, force: true});
    await assert.rejects(stat(root), {code: 'ENOENT'});
    t.diagnostic('Verified removal of source/restore blob and checkpoint directories');
  });
  const sourceBlobs = join(root, 'source-blobs'), targetBlobs = join(root, 'target-blobs');
  const sourceQueuePath = join(root, 'source-queue'), targetQueuePath = join(root, 'target-queue');
  await Promise.all([sourceBlobs, targetBlobs, targetQueuePath].map(path => mkdir(path, {mode: 0o700})));
  await prepareSource(source.admin);
  const sourcePool = source.read();
  await verifyRestrictedPool(sourcePool);
  const original = openFileServices(sourcePool, sourceBlobs, () => {});
  const fields = {
    title: 'Synthetic file target to replay', body: 'Synthetic restore replay proof',
    phaseId: requirements().roadmap!.phases[0].id, priority: 'P2', plannedStartOn: null, plannedEndOn: null,
    workflow: {state: 'planned', purpose: 'Synthetic replay', nextStep: 'Verify deduplication'},
  };
  const input = {spaceId, confirmed: true, fields};
  const requirementKey = randomUUID();
  const {entry: saved} = await original.requirementsReader.mutate(ownerId, null, input, requirementKey);
  const {entry: unprocessed} = await original.requirementsReader.mutate(ownerId, null,
    {...input, fields: {...fields, title: 'Synthetic pending before backup'}}, randomUUID());
  const fileInput = {
    file: {download_url: 'https://synthetic-files.example.invalid/replay', file_id: 'file_synthetic_replay',
      file_name: 'replay.txt', mime_type: 'text/plain'},
    requirementId: saved.id, retention: {kind: 'retained'},
  };
  const stageKey = randomUUID(), acknowledgeKey = randomUUID();
  const staged = await original.files.stage(actor, fileInput, stageKey);
  const acknowledgment = {
    id: staged.entry.id, expectedRevision: staged.entry.revision, sha256: staged.entry.sha256!, bytes: staged.entry.bytes!,
  };
  const consumer: FileHandoffActor = {...actor, consumer: 'website'};
  const confirmed = await original.files.acknowledge(consumer, acknowledgment, acknowledgeKey);
  const originalRead = await original.files.download(actor, confirmed.entry.id);
  const originBlob = (await original.repository.get(actor, confirmed.entry.id)).blob!;
  assert.equal(sha256(originalRead.bytes), confirmed.entry.sha256);
  assert.deepEqual(confirmed.entry.target, {id: saved.id, sourceId: saved.sourceId, revision: saved.revision});

  const sourceQueue = new DurableRequirementQueue(sourceQueuePath);
  const originalEvents = await readEvents(sourcePool);
  assert.equal(originalEvents.events.length, 2);
  await sourceQueue.ingest(originalEvents);
  const finished = (await sourceQueue.snapshot()).pending.find(item => item.ticket.requirementId === saved.id)!;
  await sourceQueue.finish(finished.key);
  const before = await sourceQueue.snapshot();
  assert.deepEqual(before.completed, [finished.key]);
  assert.deepEqual(before.pending.map(item => item.ticket.requirementId), [unprocessed.id]);
  const checkpointBytes = await readFile(join(sourceQueuePath, 'queue.json'));

  const exporter = await source.admin.connect();
  let dump: Buffer, sourceDigest: string;
  try {
    await exporter.query('begin isolation level repeatable read read only');
    const token = (await exporter.query('select pg_export_snapshot() id')).rows[0].id as string;
    sourceDigest = await databaseDigest(exporter);
    dump = source.dump(token);
  } finally {
    await exporter.query('rollback');
    exporter.release();
  }
  assert.equal(target.restore(dump).status, 0, 'Expected pg_restore --single-transaction --exit-on-error exit 0');
  await writeFile(join(targetBlobs, originBlob.key), originalRead.bytes, {mode: 0o600, flag: 'wx'});
  await writeFile(join(targetQueuePath, 'queue.json'), checkpointBytes, {mode: 0o600, flag: 'wx'});

  const restoredPool = target.read();
  await verifyRestrictedPool(restoredPool);
  let downloadCount = 0;
  const restored = openFileServices(restoredPool, targetBlobs, () => {downloadCount++;});
  const restoredQueue = new DurableRequirementQueue(targetQueuePath);
  assert.deepEqual(await restoredQueue.snapshot(), before);
  assert.deepEqual(await restored.requirementsReader.get(ownerId, saved.id), saved);
  assert.deepEqual(await restored.files.download(actor, confirmed.entry.id), originalRead);
  assert.equal(await databaseDigest(target.admin), sourceDigest);
  await assert.rejects(restored.files.download({...actor, spaceId: 'foreign-fixture-space'}, confirmed.entry.id), {code: 'FILE_ACCESS_DENIED'});

  const replayed = await restored.requirementsReader.mutate(ownerId, null, input, requirementKey);
  assert.equal(replayed.duplicate, true);
  assert.deepEqual(replayed.entry, saved);
  const stagedAgain = await restored.files.stage(actor, {
    ...fileInput, file: {...fileInput.file, download_url: fileInput.file.download_url + '?refreshed=1'},
  }, stageKey);
  assert.equal(stagedAgain.duplicate, true);
  assert.deepEqual(stagedAgain.entry, staged.entry);
  const confirmedAgain = await restored.files.acknowledge(consumer, acknowledgment, acknowledgeKey);
  assert.equal(confirmedAgain.duplicate, true);
  assert.deepEqual(confirmedAgain.entry, confirmed.entry);
  assert.equal(downloadCount, 0);
  assert.deepEqual(await readdir(targetBlobs), [originBlob.key]);
  assert.equal(await databaseDigest(target.admin), sourceDigest);
  t.diagnostic('Original requirement, file stage and acknowledgment receipts replayed without a database or blob write');

  const {entry: next} = await restored.requirementsReader.mutate(ownerId, null,
    {...input, fields: {...fields, title: 'Synthetic first new event after restore'}}, randomUUID());
  const delta = await readEvents(restoredPool, before.cursor);
  assert.ok(BigInt(delta.cursor) > BigInt(before.cursor));
  assert.deepEqual(delta.events.map(row => row.requirement_id), [next.id]);
  assert.deepEqual(delta.events.map(row => [row.source_id, row.record_revision]), [[next.sourceId, next.revision]]);
  // The server replay includes all ready work, including the already completed ticket.
  assert.ok(delta.ready.some(ticket => ticket.requirementId === saved.id));
  await restoredQueue.ingest(delta);
  const advanced = await restoredQueue.snapshot();
  assert.deepEqual(advanced.completed, before.completed);
  assert.equal(advanced.cursor, delta.cursor);
  assert.equal(advanced.pending.length, 2);
  assert.deepEqual(advanced.pending.find(item => item.ticket.requirementId === unprocessed.id), before.pending[0]);
  assert.ok(advanced.pending.some(item => item.ticket.requirementId === next.id));
  await new DurableRequirementQueue(targetQueuePath).ingest(delta);
  assert.deepEqual(await restoredQueue.snapshot(), advanced);
  assert.deepEqual((await readEvents(restoredPool, delta.cursor)).events, []);
  assert.equal(await databaseDigest(source.admin), sourceDigest);
  assert.deepEqual(await readFile(join(sourceQueuePath, 'queue.json')), checkpointBytes);
  assert.deepEqual(await readFile(join(sourceBlobs, originBlob.key)), originalRead.bytes);
  t.diagnostic('Next cursor advanced once; duplicate batch preserves completed key and pending request IDs; source unchanged');
});
