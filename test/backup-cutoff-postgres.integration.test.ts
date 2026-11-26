import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, readdir, rm, stat, unlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import type {Pool} from 'pg';
import {FileHandoffError, type FileHandoffActor} from '../src/file-handoff/contracts.ts';
import {PrivateFileBlobs} from '../src/file-handoff/blob-store.ts';
import {PostgresFileHandoffs, type FileHandoffAuthority} from '../src/file-handoff/postgres.ts';
import {FileHandoffService} from '../src/file-handoff/service.ts';
import {PinnedFileSource} from '../src/file-handoff/source.ts';
import {PostgresPlatformRepository, readPlatformEntryOnClient, verifyRestrictedPool, type SqlClient} from '../src/platform/postgres.ts';
import type {Transaction} from '../src/platform/contracts.ts';
import {requirements} from '../src/platform/requirements.ts';
import {RequirementsService} from '../src/requirements-candidate/service.ts';
import {DurableRequirementQueue} from '../src/requirement-events/mac-dispatcher.ts';
import {decodeWork} from '../src/requirement-events/postgres.ts';
import {qualifyBackupCutoff, type BlobAtCutoff, type Checkpoint} from './helpers/backup-cutoff.ts';
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

function openFileServices(pool: Pool, directory: string) {
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
    open: async url => ({
      status: 200, length: null, mimeType: 'text/plain', encoding: null,
      body: (async function* () {yield Buffer.from('Synthetic retained file ' + url.pathname + '\n');})(),
      close() {},
    }),
  });
  const blobs = new PrivateFileBlobs({directory, maxBytes: 128});
  const files = new FileHandoffService({enabled: true, repository, source, blobs});
  return {requirementsReader, repository, files, blobs};
}

async function eventState(client: SqlClient) {
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
  return {cursor: (outbox.at(-1)?.cursor ?? '0') as string, ready};
}

async function readEvents(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('begin isolation level repeatable read read only');
    return await eventState(client);
  } finally {await client.query('rollback');client.release();}
}

async function readBlobs(reader: Pick<SqlClient, 'query'>): Promise<BlobAtCutoff[]> {
  return (await reader.query('select state,blob_key key,sha256,byte_length::integer bytes from lifeos_platform.file_handoff order by id')).rows as BlobAtCutoff[];
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

async function blobDigests(directory: string) {
  const names = (await readdir(directory)).sort();
  return Promise.all(names.map(async name => [name, sha256(await readFile(join(directory, name)))]));
}

function encrypt(key: Buffer, sourceSha: string, plaintext: Buffer) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from('synthetic-backup-cutoff-v1|' + sourceSha));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
}

function decrypt(key: Buffer, sourceSha: string, sealed: Buffer) {
  assert.ok(sealed.length >= 28, 'Truncated synthetic package');
  const cipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
  cipher.setAAD(Buffer.from('synthetic-backup-cutoff-v1|' + sourceSha));
  cipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([cipher.update(sealed.subarray(28)), cipher.final()]);
}

/**
 * Run from a clean checkout after loading the repository's pinned CI image:
 * RUN_BACKUP_CUTOFF_POSTGRES_TESTS=1 node --test test/backup-cutoff-postgres.integration.test.ts
 */
test('OPT-IN synthetic backup restores an exact online PostgreSQL, file and queue cutoff', {
  skip: !enabled && 'Set RUN_BACKUP_CUTOFF_POSTGRES_TESTS=1 on a disposable Docker host',
  timeout: 140_000,
}, async t => {
  const imageId = assertBackupFixtureEnvironment();
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  assert.match(sourceSha, /^[a-f0-9]{40}$/);
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {encoding: 'utf8'}).trim(), '',
    'Use a clean checkout so the reported SHA identifies all fixture code and migrations');
  t.diagnostic('source=' + sourceSha + ' image=' + postgresImage);
  const {source, target} = await startBackupClusters(t, imageId);
  const directory = await mkdtemp('/tmp/lifeos-backup-cutoff-');
  t.after(async () => {
    await rm(directory, {recursive: true, force: true});
    await assert.rejects(stat(directory), {code: 'ENOENT'});
    t.diagnostic('Verified cleanup of package, source and restored fixture directories');
  });
  const sourceBlobs = join(directory, 'source-blobs'), sourceQueue = join(directory, 'source-queue'), restoreDir = join(directory, 'restore');
  await mkdir(sourceBlobs, {mode: 0o700});
  await prepareSource(source.admin);
  const restricted = source.read();
  await verifyRestrictedPool(restricted);
  const app = openFileServices(restricted, sourceBlobs);
  const queue = new DurableRequirementQueue(sourceQueue);
  const fields = {
    title: 'Synthetic requirement before cutoff', body: 'Synthetic qualification only', phaseId: requirements().roadmap!.phases[0].id,
    priority: 'P2', plannedStartOn: null, plannedEndOn: null,
    workflow: {state: 'planned', purpose: 'Synthetic backup', nextStep: 'Verify recovery'},
  };
  const create = async (title: string, service = app.requirementsReader) => (await service.mutate(ownerId, null,
    {spaceId, confirmed: true, fields: {...fields, title}}, randomUUID())).entry;
  const input = (requirementId: string, fileId: string) => ({
    file: {download_url: 'https://synthetic-files.example.invalid/' + fileId, file_id: fileId, file_name: fileId + '.txt', mime_type: 'text/plain'},
    requirementId, retention: {kind: 'retained' as const},
  });
  const stage = async (requirementId: string, fileId: string) =>
    (await app.files.stage(actor, input(requirementId, fileId), randomUUID())).entry;

  const first = await create(fields.title);
  const staged = await stage(first.id, 'file_synthetic_before');
  const file = (await app.files.acknowledge({...actor, consumer: 'website'}, {
    id: staged.id, expectedRevision: staged.revision, sha256: staged.sha256!, bytes: staged.bytes!,
  }, randomUUID())).entry;
  const original = await app.files.download(actor, file.id);
  const receipt = (await app.repository.get(actor, file.id)).blob!;
  await queue.ingest(await readEvents(restricted));
  const checkpoint = await queue.snapshot();
  const checkpointBytes = await readFile(join(sourceQueue, 'queue.json'));
  assert.deepEqual(JSON.parse(checkpointBytes.toString()), checkpoint);

  // Pause the real application transaction after its database write, outbox and receipt,
  // and before its repository COMMIT. No synthetic database trigger is needed on the source.
  const written = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  class PausedRepository extends PostgresPlatformRepository {
    override transaction<T>(owner: string, key: string, callback: (tx: Transaction) => Promise<T>) {
      return super.transaction(owner, key, async tx => {
        const result = await callback(tx);
        written.resolve();
        await resume.promise;
        return result;
      });
    }
  }
  const client = await source.admin.connect();
  const crossing = create('Synthetic requirement crossing cutoff', new RequirementsService(new PausedRepository(restricted, true), personal));
  let dump: Buffer, cutoffDigest: string, crossingId: string, crossingFile: string;
  try {
    await Promise.race([written.promise, crossing.then(() => assert.fail('Write committed before cutoff'))]);
    await client.query('begin isolation level repeatable read read only');
    const snapshot = (await client.query('select pg_export_snapshot() id')).rows[0].id as string;
    const cutoff = {...await eventState(client), blobs: await readBlobs(client)};
    cutoffDigest = await databaseDigest(client);
    assert.equal(cutoff.cursor, '1');
    assert.equal(cutoff.blobs.length, 1);
    assert.deepEqual(file.target, {id: first.id, sourceId: first.sourceId, revision: first.revision});
    assert.deepEqual(checkpoint.pending.map(row => row.ticket), cutoff.ready);

    resume.resolve();
    crossingId = (await crossing).id;
    crossingFile = (await stage(crossingId, 'file_synthetic_crossing')).id;
    await queue.ingest(await readEvents(restricted));
    assert.equal((await queue.snapshot()).cursor, '2');
    const readBlob = (value: typeof receipt) => app.blobs.read(value);
    await assert.rejects(qualifyBackupCutoff(cutoff, await queue.snapshot(), readBlob), /BACKUP_CHECKPOINT_MISMATCH/);

    const copiedCheckpoint = JSON.parse(checkpointBytes.toString()) as Checkpoint;
    const verified = await qualifyBackupCutoff(cutoff, copiedCheckpoint, readBlob);
    assert.deepEqual([...verified], [[receipt.key, original.bytes]]);
    for (const mode of ['missing', 'concurrent deletion']) {
      const shadow = await mkdtemp(join(directory, 'shadow-'));
      const shadowFile = join(shadow, receipt.key);
      if (mode === 'concurrent deletion') await writeFile(shadowFile, original.bytes, {mode: 0o600});
      const shadowStore = new PrivateFileBlobs({directory: shadow, maxBytes: 128});
      await assert.rejects(qualifyBackupCutoff(cutoff, copiedCheckpoint, async requested => {
        // This callback runs after entry selection, before the read opens the file.
        if (mode === 'concurrent deletion') await unlink(shadowFile);
        return shadowStore.read(requested);
      }), /BACKUP_BLOB_UNAVAILABLE/);
    }
    dump = source.dump(snapshot);
    t.diagnostic('Proved pre-commit cutoff, live cursor drift, missing blob and deletion after manifest selection');
  } finally {
    resume.resolve();
    await crossing.catch(() => {});
    await client.query('rollback');
    client.release();
  }

  const later = await create('Synthetic requirement after cutoff');
  const laterFile = await stage(later.id, 'file_synthetic_after');
  await queue.ingest(await readEvents(restricted));
  assert.equal((await queue.snapshot()).cursor, '3');
  const sourceDigest = await databaseDigest(source.admin);
  const sourceQueueHash = sha256(await readFile(join(sourceQueue, 'queue.json')));
  const sourceHashes = await blobDigests(sourceBlobs);
  assert.equal(sourceHashes.length, 3);

  const parts = {database: dump, blob: original.bytes, checkpoint: checkpointBytes};
  const manifest = {
    sourceSha, cutoffDigest, cursor: checkpoint.cursor, target: file.target, fileId: file.id, blobKey: receipt.key,
    digests: Object.fromEntries(Object.entries(parts).map(([name, value]) => [name, sha256(value)])),
  };
  const key = randomBytes(32), wrongKey = randomBytes(32);
  let restored: typeof parts;
  try {
    const plaintext = Buffer.from(JSON.stringify({manifest, parts: Object.fromEntries(
      Object.entries(parts).map(([name, value]) => [name, value.toString('base64')]),
    )}));
    const path = join(directory, 'package.aesgcm');
    await writeFile(path, encrypt(key, sourceSha, plaintext), {flag: 'wx', mode: 0o600});
    const sealed = await readFile(path);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const corrupt = Buffer.from(sealed);
    corrupt[corrupt.length - 1] ^= 1;
    for (const [candidate, candidateKey] of [[sealed, wrongKey], [corrupt, key]]) {
      assert.throws(() => decrypt(candidateKey, sourceSha, candidate), /unable to authenticate data|Unsupported state/i);
      await assert.rejects(stat(restoreDir), {code: 'ENOENT'});
      const empty = await target.admin.query("select to_regnamespace('lifeos_platform') is null as empty");
      assert.equal(empty.rows[0].empty, true);
    }
    const parsed = JSON.parse(decrypt(key, sourceSha, sealed).toString());
    assert.deepEqual(parsed.manifest, manifest);
    restored = {
      database: Buffer.from(parsed.parts.database, 'base64'),
      checkpoint: Buffer.from(parsed.parts.checkpoint, 'base64'), blob: Buffer.from(parsed.parts.blob, 'base64'),
    };
    for (const [name, value] of Object.entries(restored)) assert.equal(sha256(value), manifest.digests[name]);
    t.diagnostic('Authenticated package SHA-256 ' + sha256(sealed) + '; wrong key and corrupt package rejected');
  } finally {key.fill(0);wrongKey.fill(0);}

  await target.admin.query(`create schema backup_qualification;
    create table backup_qualification.sentinel(value text not null);
    insert into backup_qualification.sentinel values ('synthetic-target');
    create function backup_qualification.fail_after_copy() returns event_trigger language plpgsql as $$
    begin
      if to_regclass('lifeos_platform.platform_record') is not null
        and (select count(*) from lifeos_platform.platform_record)=1
      then raise exception 'BACKUP_FIXTURE_LATE_FAILURE'; end if;
    end $$;
    create event trigger backup_fixture_failure on ddl_command_end when tag in ('CREATE INDEX')
      execute function backup_qualification.fail_after_copy()`);
  const failed = target.restore(restored.database);
  assert.equal(failed.status, 1, 'Injected restore must fail with pg_restore exit 1');
  assert.match(failed.stderr.toString(), /BACKUP_FIXTURE_LATE_FAILURE/);
  assert.equal((await target.admin.query("select to_regnamespace('lifeos_platform') is null empty")).rows[0].empty, true);
  assert.equal((await target.admin.query('select value from backup_qualification.sentinel')).rows[0].value, 'synthetic-target');
  await assert.rejects(stat(restoreDir), {code: 'ENOENT'});
  await target.admin.query('drop event trigger backup_fixture_failure');
  const success = target.restore(restored.database);
  assert.equal(success.status, 0, 'Expected pg_restore --single-transaction --exit-on-error to succeed');
  assert.equal((await target.admin.query('select value from backup_qualification.sentinel')).rows[0].value, 'synthetic-target');
  const blobs = join(restoreDir, 'blobs'), queueDir = join(restoreDir, 'queue');
  await mkdir(blobs, {recursive: true, mode: 0o700});
  await mkdir(queueDir, {mode: 0o700});
  await writeFile(join(blobs, receipt.key), restored.blob, {mode: 0o600, flag: 'wx'});
  await writeFile(join(queueDir, 'queue.json'), restored.checkpoint, {mode: 0o600, flag: 'wx'});

  const restoredPool = target.read();
  await verifyRestrictedPool(restoredPool);
  const restoredApp = openFileServices(restoredPool, blobs);
  assert.deepEqual(await restoredApp.files.download(actor, file.id), original);
  assert.deepEqual(await restoredApp.requirementsReader.get(ownerId, first.id), first);
  const restoredQueue = await new DurableRequirementQueue(queueDir).snapshot();
  assert.deepEqual(restoredQueue, checkpoint);
  assert.deepEqual(await readEvents(restoredPool), {cursor: restoredQueue.cursor, ready: restoredQueue.pending.map(item => item.ticket)});
  assert.equal(await databaseDigest(target.admin), cutoffDigest);
  for (const requirementId of [crossingId, later.id]) await assert.rejects(restoredApp.requirementsReader.get(ownerId, requirementId), {status: 404});
  for (const fileId of [crossingFile, laterFile.id]) await assert.rejects(restoredApp.files.get(actor, fileId), {code: 'FILE_NOT_FOUND'});
  await assert.rejects(restoredApp.files.download({...actor, spaceId: 'foreign-fixture-space'}, file.id), {code: 'FILE_ACCESS_DENIED'});
  assert.equal((await restoredPool.query('select * from lifeos_platform.file_handoff')).rowCount, 0);
  await assert.rejects(restoredPool.query('delete from lifeos_platform.file_handoff'), {code: '42501'});
  assert.equal(await databaseDigest(source.admin), sourceDigest);
  assert.equal(sha256(await readFile(join(sourceQueue, 'queue.json'))), sourceQueueHash);
  assert.deepEqual(await blobDigests(sourceBlobs), sourceHashes);
  t.diagnostic('Restore exit 1 rolled back after data load; restore exit 0, native readback, ACL isolation and source unchanged');

  // Reservation is a distinct snapshot hazard: no durable blob reference yet.
  const pending = await app.repository.reserve(actor, input(later.id, 'file_synthetic_pending'), randomUUID());
  assert.ok(pending.token);
  const pendingCutoff = {...await readEvents(restricted), blobs: await readBlobs(source.admin)};
  await assert.rejects(qualifyBackupCutoff(pendingCutoff, await queue.snapshot(), receipt => app.blobs.read(receipt)), /BACKUP_FILE_PENDING/);
  t.diagnostic('Pending in-flight file reservation rejected');
});
