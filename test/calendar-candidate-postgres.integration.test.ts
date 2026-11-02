import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateAcceptanceEnvironment,acceptancePool} from './helpers/platform-pg.ts';
import {readCalendarCandidateFlag} from '../src/platform/calendar-config.ts';
import {PlatformError} from '../src/platform/domain.ts';
import type {SqlPool} from '../src/platform/postgres.ts';
import {CalendarService} from '../src/calendar-candidate/service.ts';
import {PostgresCalendarRepository,verifyCalendarPool} from '../src/calendar-candidate/postgres.ts';

// Definition only. The existing isolated database must already have the separately
// approved calendar migration and synthetic identities. This test never migrates,
// bootstraps, changes grants, deletes records, reads secrets or calls a model.
// All configuration gates below run before acceptancePool() can create a pool.
function calendarAcceptance(env:Record<string,string|undefined>,args:readonly string[]){
 if(env.RUN_PLATFORM_CALENDAR_POSTGRES_TESTS!=='1'||!readCalendarCandidateFlag(env))throw Error('Explicit isolated calendar acceptance required');
 const config=validateAcceptanceEnvironment(env,args),target=new URL(config.databaseURL);
 if(target.pathname!=='/lifeos_platform_test_local'||target.port!=='55432')throw Error('Exact pre-migrated calendar test database required');
 return config;
}

test('calendar PG opt-in gate requires exact target, extension, approval and dedicated runner before a pool can be created',()=>{
 const env={RUN_PLATFORM_CALENDAR_POSTGRES_TESTS:'1',LIFEOS_CALENDAR_CANDIDATE:'1',LIFEOS_PLATFORM_CANDIDATE:'1',LIFEOS_PLATFORM_TARGET:'isolated-test',LIFEOS_PLATFORM_BASE_URL:'http://127.0.0.1:3002',LIFEOS_PLATFORM_OWNER_ID:'fixture-owner-a',LIFEOS_PLATFORM_OWNER_EMAIL:'fixture@example.invalid',LIFEOS_PLATFORM_SECRET:'fixture-only-calendar-config-never-live-00000000',LIFEOS_PLATFORM_TEST_DATABASE_URL:'postgresql://lifeos_platform_candidate_runtime:fixture-only@127.0.0.1:55432/lifeos_platform_test_local',LIFEOS_PLATFORM_TEST_APPROVAL:'approved-isolated-fixtures'};
 assert.equal(calendarAcceptance(env,['--test-isolation=none']).ownerId,'fixture-owner-a');
 for(const patch of [
  {RUN_PLATFORM_CALENDAR_POSTGRES_TESTS:undefined},
  {LIFEOS_CALENDAR_CANDIDATE:undefined},
  {LIFEOS_CALENDAR_CANDIDATE:'true'},
  {LIFEOS_PLATFORM_TEST_APPROVAL:undefined},
  {LIFEOS_PLATFORM_OWNER_ID:'personal-owner'},
  {LIFEOS_PLATFORM_TEST_DATABASE_URL:env.LIFEOS_PLATFORM_TEST_DATABASE_URL.replace('55432','5432')},
  {LIFEOS_PLATFORM_TEST_DATABASE_URL:env.LIFEOS_PLATFORM_TEST_DATABASE_URL.replace('test_local','test_other')},
  {LIFEOS_PLATFORM_TEST_DATABASE_URL:env.LIFEOS_PLATFORM_TEST_DATABASE_URL.replace('candidate_runtime','candidate_bootstrap')},
 ])assert.throws(()=>calendarAcceptance({...env,...patch},['--test-isolation=none']));
 assert.throws(()=>calendarAcceptance(env,[]));
});

test('OPT-IN real PG calendar extension/RLS, atomic retry and conflict history, owner isolation and new-pool readback; retains synthetic records',{
 skip:process.env.RUN_PLATFORM_CALENDAR_POSTGRES_TESTS==='1'?false:'Exact calendar extension migration and retained synthetic writes are not approved/executed',
 timeout:45000,
},async t=>{
 const config=calendarAcceptance(process.env,process.execArgv);
 const pool=acceptancePool(config.databaseURL);
 let reopened:ReturnType<typeof acceptancePool>|undefined;
 const batch='fixture-calendar-pg-'+randomUUID(),otherOwner='fixture-owner-b';
 const failure=(code:string)=>(error:unknown)=>error instanceof PlatformError&&error.code===code;
 try{
  // Read-only core/extension version, forced-RLS and restricted-grant verification
  // must pass before the first synthetic event is created.
  await verifyCalendarPool(pool as SqlPool);
  const identities=await pool.query('SELECT id FROM lifeos_platform.platform_user WHERE id=ANY($1::text[])',[['fixture-owner-a',otherOwner]]);
  assert.deepEqual(identities.rows.map(row=>row.id).sort(),['fixture-owner-a',otherOwner],'Both existing synthetic identities are required; this test does not create them');
  const repository=new PostgresCalendarRepository(pool as SqlPool),service=new CalendarService(repository);
  const original={title:batch,notes:'Synthetic calendar acceptance only',schedule:{kind:'all-day',startDate:'2026-10-23',endDate:'2026-10-24'}};
  const [created,retried]=await Promise.all([
   service.create(config.ownerId,original,batch+'-create'),
   service.create(config.ownerId,original,batch+'-create'),
  ]);
  assert.equal(created.entry.id,retried.entry.id);
  assert.notEqual(created.duplicate,retried.duplicate,'Exactly one concurrent request writes the event');
  const id=created.entry.id,sourceId=created.entry.source.id;
  assert.equal(created.entry.revision,1);
  assert.deepEqual(created.entry.source.original,original);
  assert.ok(!('ownerId' in created.entry));
  await assert.rejects(service.create(config.ownerId,{...original,title:batch+' changed'},batch+'-create'),failure('COMMAND_CONFLICT'));

  // The same command key is legal for a different pre-existing fixture owner.
  const foreign=await service.create(otherOwner,{...original,title:batch+' other owner'},batch+'-create');
  assert.notEqual(foreign.entry.id,id);
  await assert.rejects(service.get(config.ownerId,foreign.entry.id),failure('NOT_FOUND'));
  await assert.rejects(service.history(config.ownerId,foreign.entry.id),failure('NOT_FOUND'));
  await assert.rejects(service.update(config.ownerId,foreign.entry.id,{expectedRevision:1,title:'Forbidden fixture update'},batch+'-foreign-update'),failure('NOT_FOUND'));
  assert.ok(!(await service.list(config.ownerId,{date:'2026-10-23',timeZone:'UTC'})).some(entry=>entry.id===foreign.entry.id));

  // Two independently keyed edits of revision 1 must have one winner, not two
  // history rows or a silently overwritten event. Both use the same schedule.
  const schedule={kind:'timed',startAt:'2026-10-23T16:00:00+08:00',endAt:'2026-10-23T17:00:00+08:00',timeZone:'Asia/Shanghai'};
  const edits=await Promise.allSettled([
   service.update(config.ownerId,id,{expectedRevision:1,title:batch+' edit-a',schedule},batch+'-edit-a'),
   service.update(config.ownerId,id,{expectedRevision:1,title:batch+' edit-b',schedule},batch+'-edit-b'),
  ]);
  assert.equal(edits.filter(result=>result.status==='fulfilled').length,1);
  const rejected=edits.filter(result=>result.status==='rejected');
  assert.equal(rejected.length,1);
  assert.ok(rejected[0].reason instanceof PlatformError&&rejected[0].reason.code==='REVISION_CONFLICT');
  const edited=await service.get(config.ownerId,id);
  assert.equal(edited.revision,2);
  assert.deepEqual(edited.schedule,{kind:'timed',startAt:'2026-10-23T08:00:00.000Z',endAt:'2026-10-23T09:00:00.000Z',timeZone:'Asia/Shanghai'});
  assert.deepEqual(edited.source.original,original);
  assert.equal(edited.source.id,sourceId);
  await assert.rejects(service.update(config.ownerId,id,{expectedRevision:1,title:'Stale fixture'},batch+'-stale'),failure('REVISION_CONFLICT'));

  const cancelled=await service.cancel(config.ownerId,id,{expectedRevision:2},batch+'-cancel');
  assert.equal(cancelled.entry.status,'cancelled');
  assert.equal(cancelled.entry.revision,3);
  const cancelReplay=await service.cancel(config.ownerId,id,{expectedRevision:2},batch+'-cancel');
  assert.equal(cancelReplay.duplicate,true);
  assert.equal(cancelReplay.entry.id,id);
  await assert.rejects(service.update(config.ownerId,id,{expectedRevision:3,title:'Cannot reopen fixture'},batch+'-cancelled-edit'),failure('EVENT_CANCELLED'));
  const history=await service.history(config.ownerId,id);
  assert.deepEqual(history.map(row=>row.entry.revision),[1,2,3]);
  assert.deepEqual(history[0].raw,original);
  assert.ok(history.every(row=>row.entry.source.id===sourceId&&!('ownerId' in row.entry)));

  const connection=await pool.connect();
  try{
   // Real policy evaluation without any owner context, after rows now exist.
   for(const table of ['platform_calendar_event','platform_calendar_history','platform_calendar_command']){
    const unscoped=await connection.query('SELECT count(*)::int AS n FROM lifeos_platform.'+table);
    assert.equal(unscoped.rows[0].n,0,'Forced RLS must hide unscoped calendar rows');
   }
   await connection.query('BEGIN');
   await connection.query("SELECT set_config('lifeos.owner_id',$1,true)",[config.ownerId]);
   const foreignVisible=await connection.query('SELECT id FROM lifeos_platform.platform_calendar_event WHERE id=$1',[foreign.entry.id]);
   assert.equal(foreignVisible.rowCount,0,'RLS must reject foreign rows even without an owner filter');
   const counts=await connection.query(`SELECT
    (SELECT count(*)::int FROM lifeos_platform.platform_calendar_event WHERE id=$1) AS events,
    (SELECT count(*)::int FROM lifeos_platform.platform_source WHERE id=$2) AS sources,
    (SELECT count(*)::int FROM lifeos_platform.platform_calendar_history WHERE event_id=$1) AS history,
    (SELECT count(*)::int FROM lifeos_platform.platform_calendar_command WHERE command_key=ANY($3::text[])) AS receipts`,[
    id,sourceId,[batch+'-create',batch+'-edit-a',batch+'-edit-b',batch+'-stale',batch+'-cancel',batch+'-cancelled-edit',batch+'-foreign-update'],
   ]);
   assert.deepEqual(counts.rows[0],{events:1,sources:1,history:3,receipts:3},'Rejected and repeated commands must not leave partial writes');
   await connection.query('ROLLBACK');
  }catch(error){await connection.query('ROLLBACK').catch(()=>undefined);throw error;}finally{connection.release();}

  const exported=await service.exportSnapshot(config.ownerId);
  assert.ok(exported.entries.some(entry=>entry.id===id));
  assert.ok(!exported.entries.some(entry=>entry.id===foreign.entry.id));
  assert.equal(exported.history.filter(row=>row.entry.id===id).length,3);
  await pool.end();
  reopened=acceptancePool(config.databaseURL);
  await verifyCalendarPool(reopened as SqlPool);
  const restored=new CalendarService(new PostgresCalendarRepository(reopened as SqlPool));
  assert.deepEqual(await restored.get(config.ownerId,id),cancelled.entry);
  assert.deepEqual(await restored.history(config.ownerId,id),history);
  assert.equal((await restored.create(config.ownerId,original,batch+'-create')).entry.id,id,'Creation receipt survives a new pool');
  assert.equal((await restored.get(config.ownerId,id)).revision,3,'Replaying creation must not overwrite later revisions');
  t.diagnostic(JSON.stringify({batch,eventIds:[id,foreign.entry.id],coreVersion:2,calendarExtensionVersion:1,recordsRetained:true,newPoolReadback:true,processRestartTested:false,databaseRestartTested:false,backupRestoreTested:false,externalCalls:false}));
 }finally{if(!pool.ended)await pool.end();if(reopened)await reopened.end();}
});
