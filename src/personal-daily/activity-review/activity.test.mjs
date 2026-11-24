import assert from 'node:assert/strict';
import test from 'node:test';
import { dayLabel, initialDay, localDay, periodRange, projectActivity, projectDay, projectRecords, summarizePeriod, yearGrid } from './activity.mjs';
import { sources } from './fixtures.mjs';

test('calendar uses Monday columns and retains every civil date, including leap day', () => {
  const grid = yearGrid(2024);
  const dates = grid.rows.flat().filter(Boolean).sort();
  assert.equal(grid.rows[0][0], '2024-01-01');
  assert.equal(dates.length, 366);
  assert.equal(new Set(dates).size, 366);
  assert.ok(dates.includes('2024-02-29'));
  assert.deepEqual(grid.months.map(month => month.label), Array.from({ length: 12 }, (_, i) => i + 1 + '月'));
});

test('explicit instants cross the Shanghai midnight without moving source civil dates', () => {
  assert.equal(localDay({ at: '2026-11-23T15:59:59.999Z' }), '2026-11-23');
  assert.equal(localDay({ at: '2026-11-23T16:00:00Z' }), '2026-11-24');
  assert.equal(localDay({ at: '2026-11-24T00:00:00+08:00' }), '2026-11-24');
  assert.equal(localDay({ date: '2026-11-23' }), '2026-11-23');
  assert.throws(() => localDay({ at: '2026-11-24T00:00:00' }));
  assert.throws(() => localDay({ date: '2026-02-30' }));
});

test('only complete coverage can produce zero or expose records', () => {
  const entries = [{ id: 'hidden', when: { date: initialDay }, text: '合成的隐藏数据' }];
  for (const state of ['unknown', 'unauthorized']) {
    const day = projectDay({ coverage: new Map([[initialDay, state]]), entries }, 'memos', initialDay);
    assert.deepEqual(day, { state, count: null, level: state, entries: [] });
  }
  assert.equal(projectDay({ coverage: new Map(), entries }, 'memos', initialDay).count, null);
  assert.equal(projectDay({ coverage: new Map([[initialDay, 'complete']]), entries: [] }, 'memos', initialDay).count, 0);
});

test('same date keeps Memos and Diary separate and preserves untitled or multiline text', () => {
  const memos = projectDay(sources.memos, 'memos', initialDay);
  const diary = projectDay(sources.diary, 'diary', initialDay);
  assert.equal(memos.count, 2);
  assert.equal(memos.entries[0].title, undefined);
  assert.equal(diary.count, 1);
  assert.match(diary.entries[0].text, /\n\n/);
});

test('development counts evidenced results once, retains distinct stages and excludes unverified events', () => {
  const day = projectDay(sources.development, 'development', initialDay);
  assert.equal(day.count, 3);
  assert.deepEqual(day.entries.map(record => record.id), ['d-1', 'd-2', 'd-3']);
  assert.deepEqual(day.entries.flatMap(record => record.milestones.map(event => event.stage)),
    ['candidate', 'merged', 'released', 'accepted']);
  assert.equal(dayLabel(day, 'development'), '3 项可核成果');
});

test('coverage and evidence dates both govern points shown on a day', () => {
  const evidence = { id: 'demo', title: '合成成果', stage: 'candidate', verified: true };
  const source = {
    coverage: new Map([['2026-11-23', 'complete'], ['2026-11-24', 'complete']]),
    entries: [
      { ...evidence, evidence: '已核样例', when: { at: '2026-11-23T16:00:00Z' } },
      { ...evidence, id: 'empty', evidence: '  ', when: { date: '2026-11-23' } },
      { ...evidence, id: 'unsupported', evidence: '聊天条数', stage: 'message', when: { date: '2026-11-23' } },
    ],
  };
  assert.equal(projectDay(source, 'development', '2026-11-23').count, 0);
  assert.equal(projectDay(source, 'development', '2026-11-24').count, 1);
});

test('quarter bounds preserve leap February and exclude adjacent dates', () => {
  const grid = yearGrid(2024, 1);
  assert.equal(grid.first, '2024-01-01');
  assert.equal(grid.last, '2024-03-31');
  assert.equal(grid.rows.flat().filter(Boolean).length, 91);
  assert.equal(yearGrid(2026, 4).rows.flat().filter(Boolean).length, 92);
  assert.throws(() => yearGrid(2026, 5));
});

test('combined records retain both sources and never substitute zero for partial coverage', () => {
  const day = projectRecords(sources, initialDay);
  assert.deepEqual(day.entries.map(record => record.source), ['memos', 'memos', 'diary']);
  assert.equal(day.count, 3);
  assert.equal(day.entries[0].text, sources.memos.entries.find(row => row.id === 'm-1').text);
  const coverage = new Map([[initialDay, 'complete']]);
  const denied = new Map([[initialDay, 'unauthorized']]);
  const mixed = projectRecords({ memos: { coverage, entries: [] }, diary: { coverage: denied, entries: day.entries } }, initialDay);
  assert.equal(mixed.level, 'partial');
  assert.equal(mixed.count, null);
  assert.deepEqual(mixed.entries, []);
});

test('period totals deduplicate same development outcome across days and keep separate stage counts', () => {
  const first = projectDay(sources.development, 'development', initialDay);
  const repeated = { ...first, entries: [first.entries[1]] };
  const unknown = projectDay(sources.development, 'development', '2026-11-22');
  assert.deepEqual(summarizePeriod([first, repeated, unknown], 'development'), {
    count: 3, activeDays: 2, coverage: { complete: 2, partial: 0, unknown: 1, unauthorized: 0, future: 0 },
    stageCounts: { candidate: 1, merged: 1, released: 1, accepted: 1 },
  });
});

test('five dimensions share natural Shanghai civil boundaries including a cross-year Monday week', () => {
  assert.deepEqual(periodRange('2026-12-31', 'day'), { first: '2026-12-31', last: '2026-12-31' });
  assert.deepEqual(periodRange('2026-12-31', 'week'), { first: '2026-12-28', last: '2027-01-03' });
  assert.deepEqual(periodRange('2024-02-29', 'month'), { first: '2024-02-01', last: '2024-02-29' });
  assert.deepEqual(periodRange('2026-12-31', 'quarter'), { first: '2026-10-01', last: '2026-12-31' });
  assert.deepEqual(periodRange('2026-12-31', 'year'), { first: '2026-01-01', last: '2026-12-31' });
});

test('future days stay uncounted even if supplied with complete coverage and a record', () => {
  for (const category of ['records', 'development']) {
    const future = projectActivity(sources, category, initialDay, '2026-11-23');
    assert.deepEqual(future, { state: 'future', count: null, level: 'future', entries: [] });
    const total = summarizePeriod([future], category);
    assert.equal(total.coverage.complete, 0);
    assert.equal(total.coverage.future, 1);
    assert.equal(total.activeDays, 0);
  }
  assert.equal(projectActivity(sources, 'records', '2026-11-21', initialDay).count, 0);
  assert.equal(projectActivity(sources, 'development', '2026-11-23', initialDay).state, 'unauthorized');
});
