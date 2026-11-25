import {PlatformError} from '../platform/domain.ts';
import {previewAppleCalendarImport, type AppleCalendarPreviewState, type AppleCalendarSource} from './apple-import-preview.ts';
import type {CalendarSchedule} from './domain.ts';
import {dateInCalendarZone, validateCalendarWindow} from './personal-projection.ts';

export const applePreviewPath = '/api/platform/personal/calendar/apple-preview';

type Binding = {ownerId: string; spaceId: string};
type Window = {from: string; to: string; timeZone: string};
type CalendarGrant = {
  id: string; label: string; source: AppleCalendarSource;
  kind: 'calendar' | 'automatic-overlay'; authorized: boolean; readable: boolean;
};
type Catalog =
  | {status: 'not-connected' | 'not-authorized' | 'unreadable'}
  | {status: 'ready'; calendars: readonly CalendarGrant[]};

export type ApplePreviewAvailability =
  | {status: 'not-connected' | 'not-authorized' | 'unreadable' | 'no-readable-calendar'}
  | {status: 'ready'; calendars: {id: string; label: string}[]};

export type ApplePreviewResult =
  | {status: 'blocked'; code: string}
  | {
    status: 'ready'; window: Window; comparison: 'verified' | 'unavailable';
    rows: {title: string; schedule: CalendarSchedule; action: 'create' | 'update' | 'unchanged' | 'unverified'}[];
  };

/** Server-only injection. Catalog and batch must be scoped to the current owner grant.
 * An empty baseline requires explicit verification (null); an absent baseline is unknown. */
export interface AppleCalendarPreviewReader {
  catalog(binding: Binding, signal: AbortSignal): Promise<Catalog>;
  read(binding: Binding, source: AppleCalendarSource, window: Window & {coverageId: string}, signal: AbortSignal): Promise<{
    snapshots: unknown;
    previous?: AppleCalendarPreviewState | null;
  }>;
}

const response = (value: ApplePreviewAvailability | ApplePreviewResult | {error: {code: string; message: string}}, status = 200, extra = {}) =>
  Response.json(value, {status, headers: {'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', ...extra}});

function validIdentifier(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
}

function eligible(grants: readonly CalendarGrant[]): CalendarGrant[] {
  const seen = new Set<string>();
  return grants.filter(grant => {
    if (grant.kind !== 'calendar' || grant.authorized !== true || grant.readable !== true) return false;
    if (!validIdentifier(grant.id, 120) || !validIdentifier(grant.label, 240) || seen.has(grant.id) ||
        !grant.source || ![grant.source.accountId, grant.source.calendarId, grant.source.identityEpoch].every(value => validIdentifier(value, 256))) {
      throw new PlatformError(503, 'APPLE_CATALOG_INVALID', '无法核对可读 Apple 日历。');
    }
    seen.add(grant.id);
    return true;
  });
}

function intersects(schedule: CalendarSchedule, window: Window): boolean {
  if (schedule.kind === 'all-day') return schedule.startDate < window.to && schedule.endDate > window.from;
  const start = dateInCalendarZone(schedule.startAt, window.timeZone);
  const end = dateInCalendarZone(new Date(Date.parse(schedule.endAt) - 1).toISOString(), window.timeZone);
  return start < window.to && end >= window.from;
}

export async function handleAppleCalendarPreview(
  request: Request, binding: Binding, assertOwner: () => Promise<void>, reader?: AppleCalendarPreviewReader,
): Promise<Response> {
  if (request.method !== 'GET') return response({error: {code: 'METHOD_NOT_ALLOWED', message: 'Apple 日历预演仅可读取。'}}, 405, {Allow: 'GET'});
  const params = new URL(request.url).searchParams;
  const selecting = params.size !== 0;
  for (const name of params.keys()) {
    if (!['calendar', 'from', 'to', 'timeZone'].includes(name) || params.getAll(name).length !== 1) {
      throw new PlatformError(400, 'INVALID_APPLE_PREVIEW', '预演参数无效。');
    }
  }
  const id = params.get('calendar');
  const window = selecting ? validateCalendarWindow({from: params.get('from'), to: params.get('to'), timeZone: params.get('timeZone')}) : null;
  if (selecting && (!id || id.length > 120)) throw new PlatformError(400, 'INVALID_APPLE_PREVIEW', '请选择已授权的日历。');

  const catalog = reader ? await reader.catalog(binding, request.signal) : {status: 'not-connected' as const};
  await assertOwner();
  const grants = catalog.status === 'ready' ? eligible(catalog.calendars) : [];
  if (!window) return response(catalog.status !== 'ready' ? {status: catalog.status} :
    grants.length ? {status: 'ready', calendars: grants.map(({id, label}) => ({id, label}))} : {status: 'no-readable-calendar'});
  const grant = grants.find(item => item.id === id);
  if (!reader || !grant) throw new PlatformError(403, 'APPLE_CALENDAR_NOT_READABLE', '该 Apple 日历未授权或不可读取。');

  const {from, to, timeZone} = window;
  const coverageId = JSON.stringify([from, to, timeZone]);
  const {accountId, calendarId, identityEpoch} = grant.source;
  const allowed = {accountId, calendarId, identityEpoch};
  const {snapshots, previous} = await reader.read(binding, {...allowed}, {from, to, timeZone, coverageId}, request.signal);
  const current = await reader.catalog(binding, request.signal);
  await assertOwner();
  const currentGrant = current.status === 'ready' ? eligible(current.calendars).find(item => item.id === id) : undefined;
  if (!currentGrant || currentGrant.source.accountId !== accountId ||
      currentGrant.source.calendarId !== calendarId || currentGrant.source.identityEpoch !== identityEpoch) {
    throw new PlatformError(403, 'APPLE_CALENDAR_NOT_READABLE', 'Apple 日历的读取授权或来源已变化。');
  }
  if (!Array.isArray(snapshots) || snapshots.length !== 1 || !Array.isArray(snapshots[0]?.events) ||
      snapshots[0].events.length > window.limit || (previous && previous.events.length > window.limit)) {
    return response({status: 'blocked', code: 'coverage-unverified'});
  }
  const result = previewAppleCalendarImport({allowed, coverageId, overlay: null, overlayRead: 'exclude'}, snapshots, previous ?? undefined);
  if (result.status === 'blocked') return response(result);
  if (!result.state.events.every(event => intersects(event.schedule, window))) return response({status: 'blocked', code: 'coverage-unverified'});
  const changes = new Map(result.importChanges.map(change => [change.after.key, change.action]));
  return response({
    status: 'ready', window: {from, to, timeZone}, comparison: previous === undefined ? 'unavailable' : 'verified',
    rows: result.state.events.map(({key, title, schedule}) => ({
      title, schedule, action: previous === undefined ? 'unverified' : changes.get(key) ?? 'unchanged',
    })),
  });
}
