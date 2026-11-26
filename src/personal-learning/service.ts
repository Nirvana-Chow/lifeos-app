import {createHash, randomUUID} from 'node:crypto';
import {commandOf} from './command.ts';
import {PlatformError, validateId, validateIdempotencyKey} from '../platform/domain.ts';
import {projectSchedule, projectSnapshot, scheduleVersion, type Binding, type Card, type CardView, type Receipt, type Review} from './domain.ts';

export interface LearningReader {
  cards(): Promise<Card[]>;
  card(id: string): Promise<Card | null>;
  history(id: string): Promise<Review[]>;
}
export interface LearningTransaction extends LearningReader {
  receipt(key: string): Promise<{digest: string; receipt: Receipt} | null>;
  insertCard(card: Card): Promise<void>;
  insertReview(review: Review): Promise<void>;
  insertReceipt(key: string, digest: string, receipt: Receipt): Promise<void>;
}
/** The production adapter must bind all queries, locks and receipts to both owner and space.
 * write must serialize this binding, roll back on any failure, and commit before resolving.
 * read must provide a consistent snapshot with complete, ordered review histories. */
export interface LearningRepository {
  read<T>(binding: Binding, run: (reader: LearningReader) => Promise<T>): Promise<T>;
  write<T>(binding: Binding, run: (transaction: LearningTransaction) => Promise<T>): Promise<T>;
}

const missing = () => new PlatformError(404, 'LEARNING_NOT_FOUND', '词卡或复习事件不可访问。');

export class LearningService {
  private readonly repository: LearningRepository;
  private readonly now: () => Date;
  constructor(repository: LearningRepository, now: () => Date = () => new Date()) {
    this.repository = repository;
    this.now = now;
  }

  snapshot(binding: Binding) {
    return this.repository.read(binding, async reader => {
      const asOf = this.now().toISOString();
      const cards = await reader.cards();
      const views: CardView[] = [];
      for (const card of cards) {
        const history = await reader.history(card.id);
        views.push({card, history, schedule: projectSchedule(card, history)});
      }
      return projectSnapshot(asOf, views);
    });
  }

  detail(binding: Binding, cardId: string, reviewId: string | null) {
    validateId(cardId);
    if (reviewId !== null) validateId(reviewId);
    return this.repository.read(binding, async reader => {
      const card = await reader.card(cardId);
      if (!card) throw missing();
      const history = await reader.history(card.id);
      const review = reviewId ? history.find(item => item.id === reviewId) : null;
      if (reviewId && !review) throw missing();
      return {card, history, review: review ?? null, schedule: projectSchedule(card, history)};
    });
  }

  mutate(binding: Binding, value: unknown, commandKey: string, authorize: () => Promise<void>) {
    const key = validateIdempotencyKey(commandKey);
    const command = commandOf(value);
    const digest = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    return this.repository.write(binding, async tx => {
      await authorize();
      const card = command.kind === 'review' ? await tx.card(command.cardId) : null;
      if (command.kind === 'review' && !card) throw missing();
      const prior = await tx.receipt(key);
      if (prior) {
        if (prior.digest !== digest) throw new PlatformError(409, 'LEARNING_COMMAND_CONFLICT', '请求标识已用于不同内容。');
        return prior.receipt;
      }

      const at = this.now().toISOString();
      let receipt: Receipt;
      if (command.kind === 'create') {
        const id = randomUUID();
        await tx.insertCard({id, revision: 1, front: command.front, back: command.back, createdAt: at});
        receipt = {kind: 'card', id, cardId: id};
      } else {
        const history = await tx.history(card!.id);
        projectSchedule(card!, history);
        const previous = history.at(-1);
        if (command.cardRevision !== card!.revision || command.previousId !== (previous?.id ?? null)) {
          throw new PlatformError(409, 'LEARNING_REVISION_CONFLICT', '复习记录已更新，请重新读取。');
        }
        const review: Review = {id: randomUUID(), cardId: card!.id, cardRevision: card!.revision,
          sequence: history.length + 1, previousId: command.previousId, rating: command.rating,
          reviewedAt: at, scheduleVersion};
        projectSchedule(card!, [...history, review]);
        await tx.insertReview(review);
        receipt = {kind: 'review', id: review.id, cardId: card!.id};
      }
      await tx.insertReceipt(key, digest, receipt);
      await authorize();
      return receipt;
    });
  }
}
