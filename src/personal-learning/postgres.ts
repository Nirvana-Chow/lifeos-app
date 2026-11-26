import {ownerMaintenanceKey} from '../deployment-candidate/owner-maintenance-key.ts';
import {verifyRestrictedPool, type SqlClient, type SqlPool} from '../platform/postgres.ts';
import {scheduleVersion, type Binding, type Card, type Receipt, type Review} from './domain.ts';
import type {LearningReader, LearningRepository, LearningTransaction} from './service.ts';

const scopeWhere = 'owner_id=$1 AND space_id=$2';
const cardFields = 'id, revision, front, back, created_at AS "createdAt"';
const reviewFields = 'id, card_id AS "cardId", card_revision AS "cardRevision", sequence, previous_id AS "previousId", rating, reviewed_at AS "reviewedAt", schedule_version AS "scheduleVersion"';

function cardOf(row: Record<string, unknown>): Card {
  if (row.revision !== 1 || typeof row.id !== 'string' || typeof row.front !== 'string' ||
      typeof row.back !== 'string' || !(row.createdAt instanceof Date)) throw new Error('Invalid vocabulary card row');
  return {id:row.id, revision:row.revision, front:row.front, back:row.back, createdAt:row.createdAt.toISOString()};
}
function reviewOf(row: Record<string, unknown>): Review {
  if (typeof row.id !== 'string' || typeof row.cardId !== 'string' || row.cardRevision !== 1 ||
      typeof row.sequence !== 'number' || (row.previousId !== null && typeof row.previousId !== 'string') ||
      (row.rating !== 'again' && row.rating !== 'recalled') || !(row.reviewedAt instanceof Date) ||
      row.scheduleVersion !== scheduleVersion) throw new Error('Invalid vocabulary review row');
  return {id:row.id, cardId:row.cardId, cardRevision:row.cardRevision, sequence:row.sequence,
    previousId:row.previousId, rating:row.rating, reviewedAt:row.reviewedAt.toISOString(), scheduleVersion:row.scheduleVersion};
}

export type LearningWriteFence = (client: SqlClient, binding: Binding) => Promise<void>;

/** Run once when admitting the restricted, already migrated pool. No bootstrap or grants here. */
export async function verifyLearningPostgres(pool: SqlPool): Promise<void> {
  await verifyRestrictedPool(pool);
  const client = await pool.connect();
  try {
    const result = await client.query(`SELECT count(*)::int AS ready
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='lifeos_platform' AND c.relname IN ('learning_card','learning_review','learning_command')
        AND c.relrowsecurity AND c.relforcerowsecurity
        AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT')
        AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE,REFERENCES')`);
    if (result.rows[0]?.ready !== 3) throw new Error('Restricted vocabulary PostgreSQL schema required');
  } finally {
    client.release();
  }
}

/** Use the existing business pool. The caller derives binding from current authorization,
 * never from the request payload. A request-scoped Agent fence can use this transaction client. */
export class PostgresLearningRepository implements LearningRepository {
  private readonly pool: SqlPool;
  private readonly writeFence?: LearningWriteFence;

  constructor(pool: SqlPool, writeFence?: LearningWriteFence) {
    this.pool = pool;
    this.writeFence = writeFence;
  }

  read<T>(binding: Binding, run: (reader: LearningReader) => Promise<T>): Promise<T> {
    return this.scoped(binding, false, async (client, args) => run(this.reader(client,args)));
  }

  write<T>(binding: Binding, run: (transaction: LearningTransaction) => Promise<T>): Promise<T> {
    return this.scoped(binding, true, async (client, args) => {
      await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))',[ownerMaintenanceKey(binding.ownerId)]);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [JSON.stringify(['lifeos-learning-v1',...args])]);
      await this.writeFence?.(client,binding);
      return run({
        ...this.reader(client,args),
        receipt: async key => {
          const row = (await client.query(`SELECT digest,card_id,review_id FROM lifeos_platform.learning_command
            WHERE ${scopeWhere} AND command_key=$3`,[...args,key])).rows[0];
          if (!row) return null;
          if (typeof row.digest !== 'string' || typeof row.card_id !== 'string' ||
              (row.review_id !== null && typeof row.review_id !== 'string')) throw new Error('Invalid vocabulary receipt row');
          const receipt: Receipt = row.review_id ? {kind:'review',id:row.review_id,cardId:row.card_id} :
            {kind:'card',id:row.card_id,cardId:row.card_id};
          return {digest:row.digest,receipt};
        },
        insertCard: async card => {
          await client.query(`INSERT INTO lifeos_platform.learning_card
            (owner_id,space_id,id,revision,front,back,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [...args,card.id,card.revision,card.front,card.back,card.createdAt]);
        },
        insertReview: async review => {
          await client.query(`INSERT INTO lifeos_platform.learning_review
            (owner_id,space_id,id,card_id,card_revision,sequence,previous_id,rating,reviewed_at,schedule_version)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[...args,review.id,review.cardId,review.cardRevision,
            review.sequence,review.previousId,review.rating,review.reviewedAt,review.scheduleVersion]);
        },
        insertReceipt: async (key,digest,receipt) => {
          await client.query(`INSERT INTO lifeos_platform.learning_command
            (owner_id,space_id,command_key,digest,card_id,review_id) VALUES($1,$2,$3,$4,$5,$6)`,
          [...args,key,digest,receipt.cardId,receipt.kind === 'review' ? receipt.id : null]);
        },
      });
    });
  }

  private reader(client: SqlClient, args: string[]): LearningReader {
    return {
      cards: async () => (await client.query(`SELECT ${cardFields} FROM lifeos_platform.learning_card
        WHERE ${scopeWhere} ORDER BY id`,args)).rows.map(cardOf),
      card: async id => {
        const row = (await client.query(`SELECT ${cardFields} FROM lifeos_platform.learning_card
          WHERE ${scopeWhere} AND id=$3`,[...args,id])).rows[0];
        return row ? cardOf(row) : null;
      },
      history: async id => (await client.query(`SELECT ${reviewFields} FROM lifeos_platform.learning_review
        WHERE ${scopeWhere} AND card_id=$3 ORDER BY sequence`,[...args,id])).rows.map(reviewOf),
    };
  }

  private async scoped<T>(binding: Binding, write: boolean, run: (client: SqlClient,args: string[]) => Promise<T>): Promise<T> {
    ownerMaintenanceKey(binding.ownerId);
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(binding.spaceId)) throw new Error('Invalid vocabulary workspace');
    const client = await this.pool.connect();
    const args = [binding.ownerId,binding.spaceId];
    try {
      await client.query(write ? 'BEGIN ISOLATION LEVEL READ COMMITTED' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SELECT set_config('lifeos.owner_id',$1,true),set_config('lifeos.learning_space_id',$2,true)",args);
      const result = await run(client,args);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(()=>undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
