export const scheduleVersion = 'recall-ladder-v1' as const;
const dayMs = 86_400_000;
const recalledDays = [3, 6, 12, 24, 48, 96] as const;

export type Binding = Readonly<{ownerId: string; spaceId: string}>;
export type Rating = 'again' | 'recalled';
export type Card = {id: string; revision: 1; front: string; back: string; createdAt: string};
export type Review = {
  id: string; cardId: string; cardRevision: 1; sequence: number; previousId: string | null;
  rating: Rating; reviewedAt: string; scheduleVersion: typeof scheduleVersion;
};
export type Schedule = {nextDueAt: string; consecutiveRecalls: number};
export type CardView = {card: Card; history: Review[]; schedule: Schedule | null};
export type Snapshot = {asOf: string; cards: CardView[]; dueCardIds: string[]};
export type Command =
  | {kind: 'create'; confirmed: true; front: string; back: string}
  | {kind: 'review'; confirmed: true; cardId: string; cardRevision: number; previousId: string | null; rating: Rating};
export type Receipt = {kind: 'card' | 'review'; id: string; cardId: string};

export function projectSchedule(card: Card, history: readonly Review[]): Schedule | null {
  let schedule: Schedule | null = null;
  let previous: Review | null = null;
  for (const review of history) {
    const timestamp = Date.parse(review.reviewedAt);
    if (review.scheduleVersion !== scheduleVersion || review.cardId !== card.id ||
        review.cardRevision !== card.revision || review.previousId !== (previous?.id ?? null) ||
        review.sequence !== (previous?.sequence ?? 0) + 1 || !Number.isFinite(timestamp) ||
        timestamp < Date.parse(previous?.reviewedAt ?? card.createdAt) ||
        (review.rating !== 'again' && review.rating !== 'recalled')) {
      throw new Error('Incomplete or unsupported review history');
    }
    const consecutiveRecalls: number = review.rating === 'again' ? 0 :
      Math.min((schedule?.consecutiveRecalls ?? 0) + 1, recalledDays.length);
    const days = consecutiveRecalls === 0 ? 1 : recalledDays[consecutiveRecalls - 1];
    schedule = {nextDueAt: new Date(timestamp + days * dayMs).toISOString(), consecutiveRecalls};
    previous = review;
  }
  return schedule;
}

export function projectSnapshot(asOf: string, cards: CardView[]): Snapshot {
  const dueCardIds = cards.flatMap(({card, schedule}) =>
    schedule && schedule.nextDueAt <= asOf ? [{id: card.id, due: schedule.nextDueAt}] : [])
    .sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id))
    .map(({id}) => id);
  return {asOf, cards, dueCardIds};
}
