import {validateCalendarDate} from '../../calendar-candidate/domain.ts';

export const trainingMuscles = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps', 'quadriceps',
  'hamstrings', 'glutes', 'calves', 'core',
] as const;

export type TrainingMuscle = typeof trainingMuscles[number];
export type TrainingGrain = 'day' | 'week' | 'month' | 'quarter' | 'year';

export type TrainingAnalyticsSnapshot = {
  schemaVersion: 1;
  source: 'xunji';
  days: Array<{
    date: string;
    status: 'complete' | 'partial' | 'unavailable';
    sets: Array<{
      exercise: string;
      muscle: TrainingMuscle | null;
      reps: number | null;
      load: {amount: number; unit: 'kg' | 'lb'} | null;
    }>;
  }>;
};

type TrainingTotals = {sets: number; kilograms: number | null; pounds: number | null};

export type TrainingAnalyticsPoint = {
  key: string;
  start: string;
  end: string;
  totalDays: number;
  completeDays: number;
  partialDays: number;
  sets: number | null;
  kilograms: number | null;
  pounds: number | null;
  unmappedSets: number;
  unweightedSets: number;
  muscles: Partial<Record<TrainingMuscle, TrainingTotals>>;
  days: TrainingAnalyticsSnapshot['days'];
};

type TrainingDay = TrainingAnalyticsSnapshot['days'][number];
type TrainingSet = TrainingDay['sets'][number];

const millisecondsPerDay = 86_400_000;
const maxDays = 3_660;
const maxSets = 100_000;
const lastCivilDay = Date.parse('9999-12-31T00:00:00Z');

function invalidSnapshot(): never {
  throw new Error('Invalid training analytics snapshot.');
}

function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    return invalidSnapshot();
  }
  return value as Record<string, unknown>;
}

function isTrainingMuscle(value: unknown): value is TrainingMuscle {
  return typeof value === 'string' && (trainingMuscles as readonly string[]).includes(value);
}

function parseSet(value: unknown): TrainingSet {
  const {exercise, muscle, reps, load} = fields(value, ['exercise', 'muscle', 'reps', 'load']);
  if (typeof exercise !== 'string' || !exercise.trim() || exercise.length > 240 ||
      (muscle !== null && !isTrainingMuscle(muscle))) return invalidSnapshot();

  if (reps !== null && (typeof reps !== 'number' || !Number.isInteger(reps) ||
      reps < 0 || reps > 10_000)) return invalidSnapshot();

  if (load === null) return {exercise, muscle, reps, load: null};

  const {amount, unit} = fields(load, ['amount', 'unit']);
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 100_000 ||
      (unit !== 'kg' && unit !== 'lb')) return invalidSnapshot();
  return {exercise, muscle, reps, load: {amount, unit}};
}

/** Validate the bounded projection. This format has no raw source or credential fields. */
export function parseTrainingAnalyticsSnapshot(value: unknown): TrainingAnalyticsSnapshot {
  const {schemaVersion, source, days: rawDays} = fields(value, ['schemaVersion', 'source', 'days']);
  if (schemaVersion !== 1 || source !== 'xunji' || !Array.isArray(rawDays) || rawDays.length > maxDays) {
    return invalidSnapshot();
  }
  const days: TrainingAnalyticsSnapshot['days'] = [];
  const dates = new Set<string>();
  let earliest = Infinity;
  let latest = -Infinity;
  let setCount = 0;
  for (const rawDay of rawDays) {
    const {date: rawDate, status, sets} = fields(rawDay, ['date', 'status', 'sets']);
    let date: string;
    try {
      date = validateCalendarDate(rawDate);
    } catch {
      return invalidSnapshot();
    }
    if (dates.has(date) || (status !== 'complete' && status !== 'partial' && status !== 'unavailable') ||
        !Array.isArray(sets) || (status === 'unavailable' && sets.length !== 0)) return invalidSnapshot();

    setCount += sets.length;
    if (setCount > maxSets) return invalidSnapshot();

    dates.add(date);
    const time = dateTime(date);
    earliest = Math.min(earliest, time);
    latest = Math.max(latest, time);
    if (latest - earliest >= maxDays * millisecondsPerDay) return invalidSnapshot();

    days.push({date, status, sets: Array.from(sets, parseSet)});
  }
  return {schemaVersion, source, days};
}

function dateTime(date: string): number {
  return Date.parse(date + 'T00:00:00Z');
}

function dateString(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function startOfPeriod(time: number, grain: TrainingGrain): number {
  const date = new Date(time);
  switch (grain) {
    case 'day':
      return time;
    case 'week':
      return time - ((date.getUTCDay() + 6) % 7) * millisecondsPerDay;
    case 'month':
      return date.setUTCDate(1);
    case 'quarter':
      return date.setUTCMonth(Math.floor(date.getUTCMonth() / 3) * 3, 1);
    case 'year':
      return date.setUTCMonth(0, 1);
  }
}

function nextPeriod(start: number, grain: TrainingGrain): number {
  if (grain === 'day' || grain === 'week') {
    return start + (grain === 'day' ? 1 : 7) * millisecondsPerDay;
  }
  const date = new Date(start);
  const months = grain === 'month' ? 1 : grain === 'quarter' ? 3 : 12;
  return date.setUTCMonth(date.getUTCMonth() + months);
}

function emptyTotals(): TrainingTotals {
  return {sets: 0, kilograms: null, pounds: null};
}

function countSet(totals: TrainingTotals, set: TrainingSet): void {
  totals.sets++;
  if (set.load === null || set.reps === null) return;
  const key = set.load.unit === 'kg' ? 'kilograms' : 'pounds';
  totals[key] = (totals[key] ?? 0) + set.load.amount * set.reps;
}

function summarizePeriod(
  start: number, end: number, days: TrainingAnalyticsSnapshot['days'],
): TrainingAnalyticsPoint {
  const totalDays = (end - start) / millisecondsPerDay + 1;
  const totals = emptyTotals();
  const muscles: TrainingAnalyticsPoint['muscles'] = {};
  let completeDays = 0;
  let partialDays = 0;
  let unmappedSets = 0;
  let unweightedSets = 0;
  for (const day of days) {
    if (day.status === 'complete') completeDays++;
    if (day.status === 'partial') partialDays++;
    for (const set of day.sets) {
      countSet(totals, set);
      if (set.load === null || set.reps === null) unweightedSets++;
      if (set.muscle === null) {
        unmappedSets++;
      } else {
        const muscleTotals = muscles[set.muscle] ??= emptyTotals();
        countSet(muscleTotals, set);
      }
    }
  }

  const key = dateString(start);
  return {
    ...totals,
    key, start: key, end: dateString(end), totalDays, completeDays, partialDays,
    sets: totals.sets > 0 || completeDays === totalDays ? totals.sets : null,
    unmappedSets, unweightedSets, muscles, days,
  };
}

/** Aggregate by civil period. Days missing from the source remain outside the observed rows. */
export function aggregateTrainingAnalytics(
  snapshot: TrainingAnalyticsSnapshot, grain: TrainingGrain,
): TrainingAnalyticsPoint[] {
  if (snapshot.days.length === 0) return [];
  const daysByTime = new Map(snapshot.days.map(day => [dateTime(day.date), day]));
  const times = [...daysByTime.keys()];
  const first = Math.min(...times);
  const last = Math.max(...times);
  const points: TrainingAnalyticsPoint[] = [];
  for (let start = startOfPeriod(first, grain); start <= last; start = nextPeriod(start, grain)) {
    const end = Math.min(nextPeriod(start, grain) - millisecondsPerDay, lastCivilDay);
    const days: TrainingAnalyticsSnapshot['days'] = [];
    for (let time = start; time <= end; time += millisecondsPerDay) {
      const day = daysByTime.get(time);
      if (day) days.push(day);
    }
    points.push(summarizePeriod(start, end, days));
  }
  return points;
}
