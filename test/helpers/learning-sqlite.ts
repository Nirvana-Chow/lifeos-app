import {DatabaseSync} from 'node:sqlite';
import type {Binding, Card, Receipt, Review} from '../../src/personal-learning/domain.ts';
import type {LearningReader, LearningRepository, LearningTransaction} from '../../src/personal-learning/service.ts';

/** Disposable synthetic adapter. Production storage and permission wiring are outside this slice. */
export class LearningSQLiteFixture implements LearningRepository {
  private readonly db: DatabaseSync;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cards (owner TEXT, space TEXT, id TEXT, data TEXT NOT NULL, PRIMARY KEY(owner,space,id));
      CREATE TABLE IF NOT EXISTS events (owner TEXT, space TEXT, card TEXT, sequence INTEGER,
        id TEXT, data TEXT NOT NULL, PRIMARY KEY(owner,space,card,sequence), UNIQUE(owner,space,id));
      CREATE TABLE IF NOT EXISTS receipts (owner TEXT, space TEXT, key TEXT,
        digest TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner,space,key));
    `);
  }
  close() {this.db.close();}
  read<T>(binding: Binding, run: (reader: LearningReader) => Promise<T>): Promise<T> {
    return this.transaction(binding, 'BEGIN', run);
  }
  write<T>(binding: Binding, run: (transaction: LearningTransaction) => Promise<T>): Promise<T> {
    return this.transaction(binding, 'BEGIN IMMEDIATE', run);
  }
  private transaction<T>(binding: Binding, begin: string, run: (tx: LearningTransaction) => Promise<T>): Promise<T> {
    const operation = this.tail.then(async () => {
      this.db.exec(begin);
      const args = [binding.ownerId,binding.spaceId] as const;
      const parse = <V,>(row: unknown): V => {
        if (!row || typeof row !== 'object' || !('data' in row) || typeof row.data !== 'string') {
          throw new Error('Invalid synthetic SQLite row');
        }
        return JSON.parse(row.data) as V;
      };
      const tx: LearningTransaction = {
        cards: async () => this.db.prepare('SELECT data FROM cards WHERE owner=? AND space=? ORDER BY id').all(...args).map(parse<Card>),
        card: async id => {
          const row = this.db.prepare('SELECT data FROM cards WHERE owner=? AND space=? AND id=?').get(...args,id);
          return row ? parse<Card>(row) : null;
        },
        history: async id => this.db.prepare('SELECT data FROM events WHERE owner=? AND space=? AND card=? ORDER BY sequence')
          .all(...args,id).map(parse<Review>),
        receipt: async key => {
          const row = this.db.prepare('SELECT digest,data FROM receipts WHERE owner=? AND space=? AND key=?').get(...args,key);
          if (!row) return null;
          if (typeof row !== 'object' || !('digest' in row) || typeof row.digest !== 'string') {
            throw new Error('Invalid synthetic receipt row');
          }
          return {digest:row.digest,receipt:parse<Receipt>(row)};
        },
        insertCard: async card => {this.db.prepare('INSERT INTO cards VALUES (?,?,?,?)').run(...args,card.id,JSON.stringify(card));},
        insertReview: async review => {this.db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?)')
          .run(...args,review.cardId,review.sequence,review.id,JSON.stringify(review));},
        insertReceipt: async (key,digest,receipt) => {this.db.prepare('INSERT INTO receipts VALUES (?,?,?,?,?)')
          .run(...args,key,digest,JSON.stringify(receipt));},
      };
      try {
        const result = await run(tx);
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }
}
