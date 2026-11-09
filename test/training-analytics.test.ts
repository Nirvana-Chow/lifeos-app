import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateTrainingAnalytics,
  parseTrainingAnalyticsSnapshot,
  type TrainingAnalyticsSnapshot,
  type TrainingGrain,
} from '../src/personal-health/training-analytics/model.ts';

type Day = TrainingAnalyticsSnapshot['days'][number];
const snapshot = (...days: Day[]): TrainingAnalyticsSnapshot => ({
  schemaVersion: 1,
  source: 'xunji',
  days,
});
const day = (date: string, status: Day['status'], ...sets: Day['sets']): Day => ({date, status, sets});

test('parser retains verified empty days, partial sets, and explicitly missing measurements', () => {
  const value = snapshot(
    day('2024-02-29', 'complete'),
    day('2024-03-01', 'partial', {exercise: 'Synthetic exercise', muscle: null, reps: null, load: null}),
    day('2024-03-02', 'unavailable'),
  );
  assert.deepEqual(parseTrainingAnalyticsSnapshot(value), value);
});

test('parser rejects invalid dates, duplicate days, oversized date spans and unsupported private fields', () => {
  for (const invalid of [
    snapshot(day('2025-02-29', 'complete')),
    snapshot(day('0000-01-01', 'complete')),
    snapshot(day('2026-11-09', 'complete'), day('2026-11-09', 'partial')),
    snapshot(day('2000-01-01', 'complete'), day('2026-11-09', 'complete')),
    {...snapshot(), credential: 'synthetic sentinel'},
    {...snapshot(), schemaVersion: 2},
    {...snapshot(), source: 'manual'},
    {...snapshot(), days: Array(3661).fill(day('2026-11-09', 'complete'))},
  ]) {
    assert.throws(() => parseTrainingAnalyticsSnapshot(invalid), /^Error: Invalid training analytics snapshot\.$/);
  }
});

test('parser rejects measurements and muscle labels outside the projection contract', () => {
  const valid = {exercise: 'Synthetic exercise', muscle: 'back', reps: 8, load: {amount: 12, unit: 'kg'}};
  for (const invalid of [
    {...valid, exercise: '   '},
    {...valid, muscle: 'other'},
    {...valid, reps: 2.5},
    {...valid, reps: -1},
    {...valid, load: {amount: Number.NaN, unit: 'kg'}},
    {...valid, load: {amount: -1, unit: 'kg'}},
    {...valid, load: {amount: 12, unit: 'stone'}},
    {...valid, note: 'synthetic sentinel'},
  ]) {
    assert.throws(() => parseTrainingAnalyticsSnapshot({
      ...snapshot(), days: [{date: '2026-11-09', status: 'complete', sets: [invalid]}],
    }), /^Error: Invalid training analytics snapshot\.$/);
  }
  assert.throws(() => parseTrainingAnalyticsSnapshot({
    ...snapshot(), days: [{date: '2026-11-09', status: 'unavailable', sets: [valid]}],
  }), /^Error: Invalid training analytics snapshot\.$/);
});

test('daily coverage distinguishes verified zero, omitted days, failed dates and incomplete dates', () => {
  const points = aggregateTrainingAnalytics(snapshot(
    day('2026-11-04', 'partial'),
    day('2026-11-01', 'complete'),
    day('2026-11-03', 'unavailable'),
  ), 'day');
  assert.deepEqual(points.map(({start, totalDays, completeDays, partialDays, sets, kilograms, days}) =>
    [start, totalDays, completeDays, partialDays, sets, kilograms, days.length]), [
    ['2026-11-01', 1, 1, 0, 0, null, 1],
    ['2026-11-02', 1, 0, 0, null, null, 0],
    ['2026-11-03', 1, 0, 0, null, null, 1],
    ['2026-11-04', 1, 0, 1, null, null, 1],
  ]);
});

test('natural week starts Monday and includes days on both sides of a calendar year', () => {
  const points = aggregateTrainingAnalytics(snapshot(
    day('2026-01-04', 'complete'),
    day('2025-12-28', 'complete'),
    day('2026-01-05', 'partial'),
  ), 'week');
  assert.deepEqual(points.map(({key, start, end, totalDays, completeDays, partialDays}) =>
    [key, start, end, totalDays, completeDays, partialDays]), [
    ['2025-12-22', '2025-12-22', '2025-12-28', 7, 1, 0],
    ['2025-12-29', '2025-12-29', '2026-01-04', 7, 1, 0],
    ['2026-01-05', '2026-01-05', '2026-01-11', 7, 0, 1],
  ]);
});

test('month, quarter, and year use natural boundaries, including leap days and empty intervening months', () => {
  const source = snapshot(day('2024-02-29', 'complete'), day('2024-04-01', 'complete'));
  const cases: Array<[TrainingGrain, Array<[string, string, number, number]>]> = [
    ['month', [
      ['2024-02-01', '2024-02-29', 29, 1],
      ['2024-03-01', '2024-03-31', 31, 0],
      ['2024-04-01', '2024-04-30', 30, 1],
    ]],
    ['quarter', [['2024-01-01', '2024-03-31', 91, 1], ['2024-04-01', '2024-06-30', 91, 1]]],
    ['year', [['2024-01-01', '2024-12-31', 366, 2]]],
  ];
  for (const [grain, expected] of cases) {
    assert.deepEqual(aggregateTrainingAnalytics(source, grain).map(({start, end, totalDays, completeDays}) =>
      [start, end, totalDays, completeDays]), expected);
  }
  assert.deepEqual(aggregateTrainingAnalytics(snapshot(), 'year'), []);
});

test('partial observations contribute known sets and separate kg/lb without inventing muscle or volume', () => {
  const source = snapshot(
    day('2026-11-09', 'complete',
      {exercise: 'Synthetic row', muscle: 'back', reps: 10, load: {amount: 10, unit: 'kg'}},
      {exercise: 'Synthetic row', muscle: 'back', reps: 8, load: {amount: 25, unit: 'lb'}},
      {exercise: 'Synthetic timed set', muscle: 'core', reps: null, load: null},
    ),
    day('2026-11-10', 'partial',
      {exercise: 'Synthetic unmapped', muscle: null, reps: 5, load: {amount: 10, unit: 'kg'}},
      {exercise: 'Synthetic missing reps', muscle: 'core', reps: null, load: {amount: 5, unit: 'kg'}},
    ),
  );
  const [point] = aggregateTrainingAnalytics(source, 'week');
  assert.deepEqual(point, {
    key: '2026-11-09', start: '2026-11-09', end: '2026-11-15',
    totalDays: 7, completeDays: 1, partialDays: 1,
    sets: 5, kilograms: 150, pounds: 200, unmappedSets: 1, unweightedSets: 2,
    muscles: {back: {sets: 2, kilograms: 100, pounds: 200}, core: {sets: 2, kilograms: null, pounds: null}},
    days: source.days,
  });
});
