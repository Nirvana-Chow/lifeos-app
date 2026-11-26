import {createHash} from 'node:crypto';

export type CutoffWork = {
  requirementId: string;
  sourceId: string;
  revision: number;
  workDigest: string;
  fence: number;
};
export type Checkpoint = {
  cursor: string;
  pending: readonly {state: string; ticket: CutoffWork}[];
};
export type BlobAtCutoff = {
  state: string;
  key: string | null;
  sha256: string | null;
  bytes: number | null;
};
const ticketKey = (item: CutoffWork) =>
  JSON.stringify([item.requirementId, item.sourceId, item.revision, item.workDigest, item.fence]);

/**
 * Synthetic qualification candidate. Both database inputs must be from the
 * same exported snapshot as the dump. The caller stages the copied checkpoint
 * and publishes the manifest only after this returns. Reject active work too
 * until a separately qualified resume contract exists.
 */
export async function qualifyBackupCutoff(
  snapshot: {cursor: string; ready: readonly CutoffWork[]; blobs: readonly BlobAtCutoff[]},
  checkpoint: Checkpoint,
  readBlob: (receipt: {key: string; sha256: string; bytes: number}) => Promise<Uint8Array>,
) {
  const outbox = snapshot.ready.map(ticketKey).sort();
  const queued = checkpoint.pending.map(item => ticketKey(item.ticket)).sort();
  if (checkpoint.cursor !== snapshot.cursor ||
      checkpoint.pending.some(item => item.state !== 'queued') ||
      JSON.stringify(outbox) !== JSON.stringify(queued)) {
    throw Error('BACKUP_CHECKPOINT_MISMATCH');
  }

  const verified = new Map<string, Buffer>();
  for (const row of snapshot.blobs) {
    if (row.state !== 'ready' || row.key === null || row.sha256 === null || row.bytes === null) {
      throw Error('BACKUP_FILE_PENDING');
    }
    if (!/^[a-f0-9-]{36}\.[a-f0-9-]{36}\.blob$/.test(row.key) ||
        !/^[a-f0-9]{64}$/.test(row.sha256) || !Number.isSafeInteger(row.bytes) ||
        row.bytes < 0 || verified.has(row.key)) {
      throw Error('BACKUP_FILE_MANIFEST_INVALID');
    }
    let bytes: Buffer;
    try {
      bytes = Buffer.from(await readBlob({key: row.key, sha256: row.sha256, bytes: row.bytes}));
    } catch {
      throw Error('BACKUP_BLOB_UNAVAILABLE');
    }
    if (bytes.length !== row.bytes || createHash('sha256').update(bytes).digest('hex') !== row.sha256) {
      throw Error('BACKUP_BLOB_MISMATCH');
    }
    verified.set(row.key, bytes);
  }
  return verified;
}
