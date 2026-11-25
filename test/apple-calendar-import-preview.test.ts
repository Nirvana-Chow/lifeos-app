import assert from 'node:assert/strict';
import {test} from 'node:test';
import {previewAppleCalendarImport} from '../src/calendar-candidate/apple-import-preview.ts';
import {occursOnDay} from '../src/calendar-candidate/domain.ts';

const allowed = {accountId: 'test-account', calendarId: 'allowed', identityEpoch: 'epoch-1'};
const overlay = {accountId: 'test-account', calendarId: 'overlay', identityEpoch: 'epoch-1'};
const scope = {coverageId: 'test-full-window-v1', allowed, overlay};
const occurrence = {
  seriesId: 'test-series',
  sourceItemId: 'test-item',
  original: {kind: 'instant', at: '2026-11-01T08:30:00.000Z'},
  title: 'Synthetic recurring event',
  schedule: {
    kind: 'timed', startAt: '2026-11-01T01:30:00-07:00',
    endAt: '2026-11-01T02:30:00-08:00', timeZone: 'America/Los_Angeles',
  },
};
const allDay = {
  seriesId: 'test-series',
  sourceItemId: 'test-item',
  original: {kind: 'date', date: '2026-11-01'},
  title: 'Synthetic all-day event',
  schedule: {kind: 'all-day', startDate: '2026-11-01', endDate: '2026-11-03'},
};

function snapshots(allowedEvents: readonly unknown[] = [occurrence], overlayEvents: readonly unknown[] = [allDay]) {
  return [allowed, overlay].map((source, index) => ({
    source, coverageId: scope.coverageId, complete: true, events: index === 0 ? allowedEvents : overlayEvents,
  }));
}

function ready(result: ReturnType<typeof previewAppleCalendarImport>) {
  assert.equal(result.status, 'ready');
  return result;
}

test('only the permissioned source proposes imports and the other source is projected as an overlay', () => {
  const result = ready(previewAppleCalendarImport(scope, snapshots()));
  assert.deepEqual(result.importChanges.map(change => change.action), ['create']);
  assert.equal(result.overlayEvents.length, 1);
  assert.equal(result.overlayEvents[0].identity.calendarId, overlay.calendarId);
  assert.deepEqual(result.importChanges[0].after.identity, {
    provider: 'apple-calendar', accountId: allowed.accountId, calendarId: allowed.calendarId,
    seriesId: occurrence.seriesId, original: occurrence.original,
  });
  assert.equal(result.state.events.length, 2);
});

test('date-only occurrences preserve the exclusive end across time zones and DST', () => {
  const {overlayEvents: [event]} = ready(previewAppleCalendarImport(scope, snapshots()));
  assert.deepEqual(event.identity.original, allDay.original);
  assert.deepEqual(event.schedule, allDay.schedule);
  for (const timeZone of ['Pacific/Kiritimati', 'America/Los_Angeles']) {
    assert.equal(occursOnDay(event.schedule, {date: '2026-10-31', timeZone}), false);
    assert.equal(occursOnDay(event.schedule, {date: '2026-11-01', timeZone}), true);
    assert.equal(occursOnDay(event.schedule, {date: '2026-11-02', timeZone}), true);
    assert.equal(occursOnDay(event.schedule, {date: '2026-11-03', timeZone}), false);
  }
});

test('replay, reordered source snapshots and equivalent timestamps add nothing', () => {
  const first = ready(previewAppleCalendarImport(scope, snapshots()));
  const next = snapshots([{...occurrence, schedule: {
    ...occurrence.schedule, startAt: '2026-11-01T08:30:00Z', endAt: '2026-11-01T10:30:00Z',
  }}]).reverse();
  const replay = ready(previewAppleCalendarImport(scope, next, first.state));
  assert.deepEqual(replay.importChanges, []);
  assert.deepEqual(replay.state, first.state);
});

test('rescheduling an occurrence produces one update and replaces the old projection', () => {
  const first = ready(previewAppleCalendarImport(scope, snapshots()));
  const moved = {...occurrence, schedule: {
    kind: 'all-day', startDate: '2026-11-04', endDate: '2026-11-05',
  }};
  const movedOverlay = {...allDay, schedule: {
    kind: 'all-day', startDate: '2026-11-05', endDate: '2026-11-06',
  }};
  const batch = snapshots([moved], [movedOverlay]);
  const second = ready(previewAppleCalendarImport(scope, batch, first.state));
  assert.deepEqual(second.importChanges.map(change => change.action), ['update']);
  const [change] = second.importChanges;
  assert.equal(change.before?.key, change.after.key);
  assert.equal(second.state.events.filter(event => event.key === change.after.key).length, 1);
  assert.deepEqual(change.after.schedule, moved.schedule);
  assert.equal(occursOnDay(change.after.schedule, {date: '2026-11-01', timeZone: 'America/Los_Angeles'}), false);
  assert.equal(second.overlayEvents[0].key, first.overlayEvents[0].key);
  assert.deepEqual(second.overlayEvents[0].schedule, movedOverlay.schedule);
  assert.equal(first.state.events[0].schedule.kind, 'timed');
  assert.deepEqual(ready(previewAppleCalendarImport(scope, batch, second.state)).importChanges, []);
});

test('equal titles and schedules do not merge separate occurrences or accounts', () => {
  const secondOccurrence = {...occurrence, original: {kind: 'instant', at: '2026-11-01T09:30:00.000Z'}};
  const otherAccount = {...allowed, accountId: 'other-test-account'};
  const otherScope = {...scope, overlay: otherAccount};
  const [input] = snapshots([occurrence, secondOccurrence]);
  const result = ready(previewAppleCalendarImport(otherScope, [
    input, {...input, source: otherAccount},
  ]));
  assert.equal(new Set(result.state.events.map(event => event.key)).size, 4);
  assert.equal(result.importChanges.length, 2);
  assert.equal(result.overlayEvents.length, 2);
});

test('a singleton uses its explicit stable UID and stays the same when moved', () => {
  const singleton = {...allDay, original: {kind: 'single'}};
  const first = ready(previewAppleCalendarImport(scope, snapshots([singleton])));
  const moved = {...singleton, schedule: {...allDay.schedule, endDate: '2026-11-04'}};
  const result = ready(previewAppleCalendarImport(scope, snapshots([moved]), first.state));
  assert.equal(result.importChanges[0].action, 'update');
  assert.equal(result.importChanges[0].after.key, first.importChanges[0].after.key);
});

test('rejects extra, missing, partial, duplicate and reidentified calendar sources', () => {
  const [a, b] = snapshots();
  const first = ready(previewAppleCalendarImport(scope, [a, b]));
  const cases = [
    [[a, b, {...a, source: {...allowed, calendarId: 'outside-scope'}}], 'source-outside-scope'],
    [[a], 'source-missing'],
    [[a, {...b, complete: false}], 'coverage-unverified'],
    [[a, {...b, coverageId: 'narrower'}], 'coverage-unverified'],
    [[a, b, b], 'source-duplicated'],
    [[a, {...b, source: {...overlay, identityEpoch: 'reset'}}], 'source-identity-changed'],
  ] as const;
  for (const [batch, code] of cases) {
    assert.deepEqual(previewAppleCalendarImport(scope, batch, first.state), {status: 'blocked', code});
  }
  assert.deepEqual(previewAppleCalendarImport({...scope, overlay: allowed}, [a, b]),
    {status: 'blocked', code: 'scope-invalid'});
  assert.deepEqual(previewAppleCalendarImport({...scope, allowed: overlay, overlay: allowed}, [a, b], first.state),
    {status: 'blocked', code: 'scope-changed'});
});

test('a disappeared or rekeyed occurrence blocks the whole batch with no proposed changes', () => {
  const first = ready(previewAppleCalendarImport(scope, snapshots()));
  const validChange = {...occurrence, title: 'Pending title edit'};
  for (const [events, code] of [
    [[], 'occurrence-missing'],
    [[{...allDay, seriesId: 'replacement', sourceItemId: 'replacement'}], 'occurrence-missing'],
    [[{...allDay, original: {kind: 'date', date: '2026-11-02'}}], 'occurrence-missing'],
    [[{...allDay, seriesId: 'new-series'}], 'source-identity-changed'],
    [[{...allDay, sourceItemId: 'new-item-id'}], 'source-identity-changed'],
  ] as const) {
    assert.deepEqual(previewAppleCalendarImport(scope, snapshots([validChange], events), first.state),
      {status: 'blocked', code});
  }
  assert.equal(first.state.events[0].title, occurrence.title);
  assert.equal(first.state.events.length, 2);
});

test('moving a record across calendars requires review even when the provider IDs match', () => {
  const first = ready(previewAppleCalendarImport(scope, snapshots([occurrence], [])));
  assert.deepEqual(previewAppleCalendarImport(scope, snapshots([], [occurrence]), first.state),
    {status: 'blocked', code: 'occurrence-missing'});
});

test('a verified empty source can later add a new occurrence', () => {
  const first = ready(previewAppleCalendarImport(scope, snapshots([], [])));
  assert.deepEqual(first.state.events, []);
  const next = ready(previewAppleCalendarImport(scope, snapshots([occurrence], []), first.state));
  assert.deepEqual(next.importChanges.map(change => change.action), ['create']);
});

test('excluding an unread overlay accepts only the permissioned snapshot and never assumes zero overlay rows', () => {
  const overlayRef = {accountId: overlay.accountId, calendarId: overlay.calendarId};
  const excludeScope = {...scope, overlay: overlayRef, overlayRead: 'exclude'};
  const [permitted, excluded] = snapshots();
  const initial = ready(previewAppleCalendarImport(excludeScope, [permitted]));
  assert.equal(initial.overlayStatus, 'excluded-unread');
  assert.deepEqual(initial.overlayEvents, []);
  assert.deepEqual(initial.importChanges.map(change => change.action), ['create']);
  assert.deepEqual(ready(previewAppleCalendarImport(excludeScope, [permitted], initial.state)).importChanges, []);

  // A partial fix that only makes the overlay snapshot optional fails here.
  assert.deepEqual(previewAppleCalendarImport(excludeScope, [permitted, excluded], initial.state),
    {status: 'blocked', code: 'source-excluded'});
  assert.deepEqual(previewAppleCalendarImport(excludeScope, [permitted, {...excluded, events: []}], initial.state),
    {status: 'blocked', code: 'source-excluded'});
  const unread = {...excluded, get events(): never { throw new Error('excluded events must stay unread'); }};
  assert.deepEqual(previewAppleCalendarImport(excludeScope, [permitted, unread], initial.state),
    {status: 'blocked', code: 'source-excluded'});
  assert.deepEqual(previewAppleCalendarImport(excludeScope, [], initial.state),
    {status: 'blocked', code: 'source-missing'});
  assert.deepEqual(previewAppleCalendarImport(scope, [permitted, excluded], initial.state),
    {status: 'blocked', code: 'scope-changed'});
  assert.deepEqual(previewAppleCalendarImport({...excludeScope, overlayRead: false}, [permitted]),
    {status: 'blocked', code: 'scope-invalid'});
  assert.deepEqual(previewAppleCalendarImport({...excludeScope, overlay: {accountId: allowed.accountId, calendarId: allowed.calendarId}}, [permitted]),
    {status: 'blocked', code: 'scope-invalid'});
  const observed = ready(previewAppleCalendarImport(scope, [permitted, excluded]));
  assert.equal(observed.overlayStatus, 'observed');
  assert.equal(observed.state.scopeKey, JSON.stringify(scope));
  assert.deepEqual(previewAppleCalendarImport(excludeScope, [permitted], observed.state),
    {status: 'blocked', code: 'scope-changed'});
});

test('ambiguous recurrence evidence, duplicate keys and invalid schedules stop preview', () => {
  for (const original of [undefined, {kind: 'unknown'}, {kind: 'date', date: '2026-02-30'},
    {kind: 'instant', at: '2026-11-01T01:30:00'}, {kind: 'date', date: '2026-11-01', inferred: true}]) {
    assert.deepEqual(previewAppleCalendarImport(scope, snapshots([{...occurrence, original}])),
      {status: 'blocked', code: 'identity-invalid'});
  }
  assert.deepEqual(previewAppleCalendarImport(scope, snapshots([occurrence, occurrence])),
    {status: 'blocked', code: 'occurrence-duplicated'});
  assert.deepEqual(previewAppleCalendarImport(scope, snapshots([occurrence, {...occurrence, seriesId: 'other'}])),
    {status: 'blocked', code: 'source-identity-changed'});
  assert.deepEqual(previewAppleCalendarImport(scope, snapshots([occurrence, {...occurrence, original: {kind: 'single'}}])),
    {status: 'blocked', code: 'identity-invalid'});
  assert.deepEqual(previewAppleCalendarImport(scope, snapshots([{...allDay,
    schedule: {...allDay.schedule, endDate: allDay.schedule.startDate}}])),
    {status: 'blocked', code: 'event-invalid'});
});
