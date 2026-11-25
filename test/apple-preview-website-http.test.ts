import assert from 'node:assert/strict';
import {test} from 'node:test';
import {applePreviewPath, type AppleCalendarPreviewReader} from '../src/calendar-candidate/apple-preview-http.ts';
import {previewAppleCalendarImport} from '../src/calendar-candidate/apple-import-preview.ts';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {MemoryPort} from './helpers/platform.ts';

const config = {
  ownerId: 'synthetic-owner', ownerEmail: 'synthetic@example.test', spaceId: 'synthetic-space',
  databaseName: 'synthetic', baseURL: 'https://synthetic.example.test', allowedTypes: ['todo'] as const,
  calendarEnabled: true as const, approval: 'personal-manual-v1' as const,
};
const allowed = {accountId: 'synthetic-account', calendarId: 'ordinary', identityEpoch: 'one'};
const grant = {id: 'synthetic-selection', label: '合成普通日历', source: allowed, kind: 'calendar' as const, authorized: true, readable: true};
const overlay = {...grant, id: 'overlay', kind: 'automatic-overlay' as const};
const query = '?calendar=synthetic-selection&from=2030-11-05&to=2030-11-08&timeZone=Asia%2FTokyo';
const allDay = {seriesId:'all-day',sourceItemId:'all-day-1',original:{kind:'date',date:'2030-11-05'},title:'合成全天',
  schedule:{kind:'all-day',startDate:'2030-11-05',endDate:'2030-11-06'}};
const overnight = {seriesId:'overnight',sourceItemId:'overnight-1',original:{kind:'instant',at:'2030-11-05T07:00:00.000Z'},title:'合成跨日',
  schedule:{kind:'timed',startAt:'2030-11-04T23:00:00-08:00',endAt:'2030-11-05T01:00:00-08:00',timeZone:'America/Los_Angeles'}};

function setup(reader?: AppleCalendarPreviewReader) {
  const repository = new MemoryPort();
  let session: string | null = config.ownerId;
  let writeChecks = 0;
  const handler = createPersonalPlatformHandler({
    repository, config: {...config, allowedTypes: [...config.allowedTypes]}, storageVerified: true,
    sessions: {read: async () => session ? {userId: session, email: config.ownerEmail} : null},
    appleCalendarPreview: reader,
    assertWritable: async () => {writeChecks++; throw Error('Synthetic read only');},
  });
  function request(path = '', method = 'GET', extra: HeadersInit = {}) {
    return handler(new Request(config.baseURL + applePreviewPath + path, {method, headers:{host:'synthetic.example.test', ...extra}}));
  }
  return {request, revoke: () => {session = null;}, foreign: () => {session = 'foreign-owner';}, rows: repository.rows, writeChecks: () => writeChecks};
}

test('website preview defaults unconnected and rejects foreign, bearer and writing requests', async () => {
  const {request, revoke, foreign, rows, writeChecks} = setup();
  const status = await request();
  assert.deepEqual(await status.json(), {status: 'not-connected'});
  assert.match(status.headers.get('cache-control')!, /private, no-store/);
  assert.equal((await request(query)).status, 403);
  assert.equal((await request('', 'POST')).status, 405);
  assert.equal((await request('', 'GET', {authorization: 'Bearer synthetic'})).status, 403);
  assert.equal((await request('', 'GET', {'sec-fetch-site': 'same-site'})).status, 403);
  foreign();
  assert.equal((await request()).status, 403);
  revoke();
  assert.equal((await request()).status, 401);
  assert.equal(rows.size, 0);
  assert.equal(writeChecks(), 0);
});

test('website accepts only the authorized ordinary calendar and reuses stable source deduplication', async () => {
  let reads = 0;
  const reader: AppleCalendarPreviewReader = {
    catalog: async () => ({status:'ready',calendars:[grant,overlay,{...grant,id:'revoked',authorized:false},{...grant,id:'unreadable',readable:false}]}),
    async read(binding, source, window) {
      assert.deepEqual(binding,{ownerId:config.ownerId,spaceId:config.spaceId});
      assert.deepEqual(source,allowed);
      assert.equal(window.timeZone,'Asia/Tokyo');
      const scope = {allowed,coverageId:window.coverageId,overlay:null,overlayRead:'exclude'};
      const snapshots = [{source,coverageId:window.coverageId,complete:true,events:[allDay,overnight]}];
      const first = previewAppleCalendarImport(scope,snapshots);
      assert.equal(first.status,'ready');
      return {snapshots,previous:reads++ ? first.state : null};
    },
  };
  const {request, rows, writeChecks} = setup(reader);
  assert.deepEqual(await (await request()).json(),{status:'ready',calendars:[{id:grant.id,label:grant.label}]});
  for (const id of ['overlay','revoked','unreadable','foreign']) assert.equal((await request(query.replace(grant.id,id))).status,403);
  for (const params of ['&calendar=overlay','&ownerId=foreign','&coverageId=fake']) assert.equal((await request(query+params)).status,400);
  assert.equal((await request(query.replace('Asia%2FTokyo','bad-zone'))).status,400);
  assert.equal(reads,0);
  const first = await (await request(query)).json();
  assert.equal(first.status,'ready');
  assert.deepEqual(first.rows.map((row: {action:string}) => row.action),['create','create']);
  assert.deepEqual(first.rows[0].schedule,allDay.schedule);
  assert.equal(first.rows[1].schedule.startAt,'2030-11-05T07:00:00.000Z');
  assert.equal(first.window.timeZone,'Asia/Tokyo');
  const replay = await (await request(query)).json();
  assert.deepEqual(replay.rows.map((row: {action:string}) => row.action),['unchanged','unchanged']);
  assert.equal(rows.size,0);
  assert.equal(writeChecks(),0);
});

test('website suppresses stale grants, missing coverage, duplicate rows and unverified baseline claims', async () => {
  let available = true;
  let mode = 'missing-baseline';
  let revoke = () => {};
  const reader: AppleCalendarPreviewReader = {
    catalog: async () => available ? {status:'ready',calendars:[grant]} : {status:'not-authorized'},
    async read(_binding, source, window) {
      if (mode === 'grant') available = false;
      if (mode === 'session') revoke();
      const snapshot = {source,coverageId:window.coverageId,complete:mode !== 'incomplete',events:
        mode === 'duplicate' ? [allDay,allDay] :
        mode === 'out-of-window' ? [{...allDay,schedule:{kind:'all-day',startDate:'2030-11-08',endDate:'2030-11-09'}}] : [allDay]};
      return {snapshots:mode === 'extra-source' ? [snapshot,{...snapshot,source:overlay.source}] : [snapshot]};
    },
  };
  const fixture = setup(reader);
  revoke = fixture.revoke;
  const {request} = fixture;
  const unknown = await (await request(query)).json();
  assert.equal(unknown.comparison,'unavailable');
  assert.equal(unknown.rows[0].action,'unverified');
  for (const [next,code] of [['incomplete','coverage-unverified'],['duplicate','occurrence-duplicated'],
    ['extra-source','coverage-unverified'],['out-of-window','coverage-unverified']]) {
    mode=next;
    assert.deepEqual(await (await request(query)).json(),{status:'blocked',code});
  }
  mode = 'grant';
  const revoked = await request(query);
  assert.equal(revoked.status,403);
  assert.equal((await revoked.json()).rows,undefined);
  assert.deepEqual(await (await request()).json(),{status:'not-authorized'});
  available=true;
  mode='session';
  assert.equal((await request(query)).status,401);
});
