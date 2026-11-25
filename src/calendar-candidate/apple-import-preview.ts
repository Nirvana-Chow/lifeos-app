import {object, PlatformError} from '../platform/domain.ts';
import {validateCalendarDate, validateCalendarDraft, type CalendarSchedule} from './domain.ts';

type AppleCalendarRef = {
  accountId: string;
  calendarId: string;
};
type AppleCalendarSource = AppleCalendarRef & {identityEpoch: string};

type SourceRole = 'allowed' | 'overlay';
type OriginalOccurrence =
  | {kind: 'single'}
  | {kind: 'date'; date: string}
  | {kind: 'instant'; at: string};

type AppleOccurrenceIdentity = {
  provider: 'apple-calendar';
  accountId: string;
  calendarId: string;
  seriesId: string;
  original: OriginalOccurrence;
};

type PreviewEvent = {
  key: string;
  role: SourceRole;
  identity: AppleOccurrenceIdentity;
  sourceItemId: string;
  title: string;
  schedule: CalendarSchedule;
};

type PreviewState = {
  scopeKey: string;
  events: readonly PreviewEvent[];
};

type ImportChange =
  | {action: 'create'; before: null; after: PreviewEvent}
  | {action: 'update'; before: PreviewEvent; after: PreviewEvent};

type BlockCode =
  | 'scope-invalid'
  | 'scope-changed'
  | 'source-missing'
  | 'source-excluded'
  | 'source-outside-scope'
  | 'source-duplicated'
  | 'source-identity-changed'
  | 'coverage-unverified'
  | 'identity-invalid'
  | 'event-invalid'
  | 'occurrence-duplicated'
  | 'occurrence-missing';

type PreviewResult =
  | {status: 'blocked'; code: BlockCode}
  | {
    status: 'ready'; state: PreviewState; importChanges: ImportChange[];
    overlayEvents: PreviewEvent[]; overlayStatus: 'observed' | 'excluded-unread';
  };

class PreviewBlocked extends Error {
  readonly code: BlockCode;

  constructor(code: BlockCode) {
    super(code);
    this.code = code;
  }
}

function reject(code: BlockCode): never {
  throw new PreviewBlocked(code);
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
    return reject('identity-invalid');
  }
  return value;
}

function parseSource(input: unknown): AppleCalendarSource {
  const fields = object(input, ['accountId', 'calendarId', 'identityEpoch']);
  return {
    accountId: identifier(fields.accountId),
    calendarId: identifier(fields.calendarId),
    identityEpoch: identifier(fields.identityEpoch),
  };
}

function calendarKey(source: AppleCalendarRef): string {
  return JSON.stringify([source.accountId, source.calendarId]);
}

function parseScope(input: unknown) {
  try {
    const fields = object(input, ['coverageId', 'allowed', 'overlay', 'overlayRead']);
    const allowed = parseSource(fields.allowed);
    const coverageId = identifier(fields.coverageId);
    if (Object.hasOwn(fields, 'overlayRead') && fields.overlayRead !== 'exclude') return reject('scope-invalid');
    if (fields.overlayRead === 'exclude') {
      const excluded = object(fields.overlay, ['accountId', 'calendarId']);
      const overlay = {accountId: identifier(excluded.accountId), calendarId: identifier(excluded.calendarId)};
      if (calendarKey(allowed) === calendarKey(overlay)) return reject('scope-invalid');
      return {coverageId, allowed, overlay, overlayRead: 'exclude' as const};
    }
    const overlay = parseSource(fields.overlay);
    if (calendarKey(allowed) === calendarKey(overlay)) return reject('scope-invalid');
    return {coverageId, allowed, overlay};
  } catch (error) {
    if (error instanceof PlatformError || error instanceof PreviewBlocked) return reject('scope-invalid');
    throw error;
  }
}

function parseOriginal(input: unknown): OriginalOccurrence {
  const {kind} = object(input, ['kind', 'date', 'at']);
  if (kind === 'single') {
    object(input, ['kind']);
    return {kind};
  }
  if (kind === 'date') {
    const {date} = object(input, ['kind', 'date']);
    return {kind, date: validateCalendarDate(date)};
  }
  if (kind !== 'instant') return reject('identity-invalid');
  const {at} = object(input, ['kind', 'at']);
  if (typeof at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at)) {
    return reject('identity-invalid');
  }
  validateCalendarDate(at.slice(0, 10));
  const instant = new Date(at);
  if (!Number.isFinite(instant.valueOf()) || instant.toISOString() !== at) return reject('identity-invalid');
  return {kind, at};
}

function parseEvent(input: unknown, source: AppleCalendarSource, role: SourceRole): PreviewEvent {
  let fields;
  let identity: AppleOccurrenceIdentity;
  let sourceItemId: string;
  try {
    fields = object(input, ['seriesId', 'sourceItemId', 'original', 'title', 'schedule']);
    identity = {
      provider: 'apple-calendar',
      accountId: source.accountId,
      calendarId: source.calendarId,
      seriesId: identifier(fields.seriesId),
      original: parseOriginal(fields.original),
    };
    sourceItemId = identifier(fields.sourceItemId);
  } catch (error) {
    if (error instanceof PlatformError) return reject('identity-invalid');
    throw error;
  }

  try {
    const {title, schedule} = validateCalendarDraft({title: fields.title, schedule: fields.schedule});
    return {key: JSON.stringify(identity), role, identity, sourceItemId, title, schedule};
  } catch (error) {
    if (error instanceof PlatformError) return reject('event-invalid');
    throw error;
  }
}

function collectEvents(
  scope: ReturnType<typeof parseScope>,
  input: unknown,
  previous: readonly PreviewEvent[],
): Map<string, PreviewEvent> {
  if (!Array.isArray(input)) return reject('coverage-unverified');

  const overlayKey = calendarKey(scope.overlay);
  const sources = new Map<string, {role: SourceRole; source: AppleCalendarSource}>([
    [calendarKey(scope.allowed), {role: 'allowed', source: scope.allowed}],
  ]);
  if (scope.overlayRead !== 'exclude') sources.set(overlayKey, {role: 'overlay', source: scope.overlay});
  const seen = new Set<string>();
  const events = new Map<string, PreviewEvent>();
  const itemSeries = new Map<string, string>();
  const seriesKinds = new Map<string, OriginalOccurrence['kind']>();

  function checkSeries(event: PreviewEvent) {
    const {identity, sourceItemId} = event;
    const itemKey = JSON.stringify([identity.accountId, identity.calendarId, sourceItemId]);
    const seriesKey = JSON.stringify([identity.accountId, identity.calendarId, identity.seriesId]);
    const boundSeries = itemSeries.get(itemKey);
    if (boundSeries !== undefined && boundSeries !== identity.seriesId) return reject('source-identity-changed');
    itemSeries.set(itemKey, identity.seriesId);
    const kind = seriesKinds.get(seriesKey);
    if (kind !== undefined && kind !== identity.original.kind) return reject('identity-invalid');
    seriesKinds.set(seriesKey, identity.original.kind);
  }

  for (const event of previous) checkSeries(event);
  for (const snapshot of input) {
    const fields = object(snapshot, ['source', 'coverageId', 'complete', 'events']);
    const source = parseSource(fields.source);
    const key = calendarKey(source);
    const expected = sources.get(key);
    if (!expected) return reject(key === overlayKey ? 'source-excluded' : 'source-outside-scope');
    if (expected.source.identityEpoch !== source.identityEpoch) return reject('source-identity-changed');
    if (seen.has(key)) return reject('source-duplicated');
    if (fields.coverageId !== scope.coverageId || fields.complete !== true || !Array.isArray(fields.events)) {
      return reject('coverage-unverified');
    }
    seen.add(key);
    for (const input of fields.events) {
      const event = parseEvent(input, source, expected.role);
      if (events.has(event.key)) return reject('occurrence-duplicated');
      checkSeries(event);
      events.set(event.key, event);
    }
  }
  if (seen.size !== sources.size) return reject('source-missing');
  return events;
}

/** Pure preview for synthetic snapshots. Previous state comes from a ready preview under this exact scope. */
export function previewAppleCalendarImport(scopeInput: unknown, snapshots: unknown, previous?: PreviewState): PreviewResult {
  try {
    const scope = parseScope(scopeInput);
    const scopeKey = JSON.stringify(scope);
    if (previous && previous.scopeKey !== scopeKey) return reject('scope-changed');
    const priorEvents = previous?.events ?? [];
    const events = collectEvents(scope, snapshots, priorEvents);
    const priorByKey = new Map<string, PreviewEvent>();
    for (const before of priorEvents) {
      const after = events.get(before.key);
      if (!after) return reject('occurrence-missing');
      if (after.sourceItemId !== before.sourceItemId) return reject('source-identity-changed');
      priorByKey.set(before.key, before);
    }

    const orderedEvents = [...events.values()].sort((left, right) => {
      if (left.key === right.key) return 0;
      return left.key < right.key ? -1 : 1;
    });
    const importChanges: ImportChange[] = [];
    const overlayEvents: PreviewEvent[] = [];
    for (const after of orderedEvents) {
      if (after.role === 'overlay') {
        overlayEvents.push(after);
        continue;
      }
      const before = priorByKey.get(after.key);
      if (!before) importChanges.push({action: 'create', before: null, after});
      else if (before.title !== after.title || JSON.stringify(before.schedule) !== JSON.stringify(after.schedule)) {
        importChanges.push({action: 'update', before, after});
      }
    }
    const overlayStatus = scope.overlayRead === 'exclude' ? 'excluded-unread' : 'observed';
    return {status: 'ready', state: {scopeKey, events: orderedEvents}, importChanges, overlayEvents, overlayStatus};
  } catch (error) {
    if (error instanceof PreviewBlocked) return {status: 'blocked', code: error.code};
    if (error instanceof PlatformError) return {status: 'blocked', code: 'coverage-unverified'};
    throw error;
  }
}
