import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {RequirementsService} from '../src/requirements-candidate/service.ts';
import {PostgresPlatformRepository,type SqlPool} from '../src/platform/postgres.ts';
import {requirements} from '../src/platform/requirements.ts';
import {prepareRequirementsFixture,requirementsFixture,requirementsFixturePool} from './helpers/requirements-stage-pg.ts';

// Reuses the exact source/run-bound disposable requirements fixture. Never redirects to a live database.
test('OPT-IN requirement transaction outbox rollback, receipt dedupe and lease fence on restricted PostgreSQL',{
 skip:process.env.RUN_REQUIREMENT_EVENT_POSTGRES_TESTS!=='1'&&'Dedicated requirement event PostgreSQL qualification not enabled',timeout:30000,
},async()=>{
 await prepareRequirementsFixture();const admin=requirementsFixturePool('admin',1),pool=requirementsFixturePool('runtime',3);
 try{
  const current=(await admin.query("SELECT to_regclass('lifeos_platform.requirement_work') AS work")).rows[0];assert.equal(current.work,null,'Fresh event schema required; never reuse an unknown migrated target');
  await admin.query("SET lifeos.requirement_events_migration_approved='transaction-outbox-v1'; SET lifeos.agent_expected_database='lifeos_platform_test_local'");await admin.query(await readFile('db/0020_requirement_events.proposed.sql','utf8'));
  const config={ownerId:requirementsFixture.ownerId,ownerEmail:requirementsFixture.email,spaceId:requirementsFixture.spaceId,databaseName:requirementsFixture.database,baseURL:requirementsFixture.origin,approval:'personal-manual-v1',allowedTypes:['todo','journal'],requirementsEnabled:true} as const;
  const repository=new PostgresPlatformRepository(pool as SqlPool,false,false,undefined,true),service=new RequirementsService(repository,config);
  const fields={title:'Synthetic event ticket',body:'No real requirement data',phaseId:requirements().roadmap!.phases[0].id,priority:'P2',plannedStartOn:null,plannedEndOn:null,workflow:{state:'planned',purpose:'Synthetic',nextStep:'Verify transaction'}} as const;
  const input={spaceId:config.spaceId,confirmed:true,fields};
  const before=await admin.query('SELECT count(*)::int AS n FROM lifeos_platform.platform_record');
  const rollbackRepository={...repository,transaction:repository.transaction.bind(repository),get:repository.get.bind(repository),list:repository.list.bind(repository),history:repository.history.bind(repository),exportSnapshot:repository.exportSnapshot.bind(repository)};
  rollbackRepository.transaction=(owner,key,run)=>repository.transaction(owner,key,tx=>run({...tx,saveReceipt:async()=>{throw Error('synthetic receipt failure after original write');}}));
  await assert.rejects(new RequirementsService(rollbackRepository,config).mutate(config.ownerId,null,input,'synthetic-event-rollback'));
  assert.deepEqual((await admin.query('SELECT count(*)::int AS n FROM lifeos_platform.platform_record')).rows,before.rows);assert.equal((await admin.query('SELECT count(*)::int AS n FROM lifeos_platform.requirement_event_outbox')).rows[0].n,0);
  const created=await service.mutate(config.ownerId,null,input,'synthetic-event-create');await service.mutate(config.ownerId,null,input,'synthetic-event-create');
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM lifeos_platform.requirement_event_outbox')).rows[0].n,1);
  const work=(await admin.query('SELECT * FROM lifeos_platform.requirement_work WHERE requirement_id=$1',[created.entry.id])).rows[0];assert.equal(work.dispatch_state,'ready');
  const lease={id:'11111111-1111-4111-8111-111111111111',fence:1,holderId:'synthetic-mac',grantId:'synthetic-grant',workDigest:work.work_digest};
  await admin.query("UPDATE lifeos_platform.requirement_work SET dispatch_state='running',lease_id=$1,lease_fence=1,lease_holder=$2,lease_grant_id=$3,lease_expires_at=clock_timestamp()+interval '1 minute' WHERE requirement_id=$4",[lease.id,lease.holderId,lease.grantId,created.entry.id]);
  const progress={...input,fields:{...fields,workflow:{...fields.workflow,state:'in_progress',nextStep:'Synthetic progress only'}},expectedRevision:1,baselineBinding:null};
  await service.mutate(config.ownerId,created.entry.id,progress,'synthetic-event-progress',undefined,undefined,lease);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM lifeos_platform.requirement_event_outbox')).rows[0].n,1,'progress-only change must not start another model');
  await admin.query("UPDATE lifeos_platform.requirement_work SET lease_expires_at=clock_timestamp()-interval '1 second',lease_fence=2 WHERE requirement_id=$1",[created.entry.id]);
  await assert.rejects(service.mutate(config.ownerId,created.entry.id,{...progress,expectedRevision:2},'synthetic-event-expired',undefined,undefined,lease),{code:'EXECUTION_LEASE_LOST'});
  const replay=await service.mutate(config.ownerId,created.entry.id,progress,'synthetic-event-progress',undefined,undefined,lease);assert.equal(replay.duplicate,true);assert.equal(replay.entry.revision,2);assert.equal((await service.get(config.ownerId,created.entry.id)).revision,2);
  const suggestion=await service.mutate(config.ownerId,null,{...input,fields:{...fields,workflow:null}},'synthetic-event-candidate');assert.equal((await admin.query('SELECT dispatch_state FROM lifeos_platform.requirement_work WHERE requirement_id=$1',[suggestion.entry.id])).rows[0].dispatch_state,'candidate');
  await service.mutate(config.ownerId,suggestion.entry.id,{...input,expectedRevision:1,baselineBinding:null},'synthetic-candidate-no-resume');assert.equal((await admin.query('SELECT dispatch_state FROM lifeos_platform.requirement_work WHERE requirement_id=$1',[suggestion.entry.id])).rows[0].dispatch_state,'candidate');
  await admin.query("UPDATE lifeos_platform.requirement_work SET dispatch_state='paused',lease_id=null,lease_holder=null,lease_grant_id=null,lease_expires_at=null WHERE requirement_id=$1",[created.entry.id]);
  await service.mutate(config.ownerId,created.entry.id,{...progress,fields:{...fields,body:'Synthetic owner refinement'},expectedRevision:2},'synthetic-paused-no-resume');assert.equal((await admin.query('SELECT dispatch_state FROM lifeos_platform.requirement_work WHERE requirement_id=$1',[created.entry.id])).rows[0].dispatch_state,'paused');
 }finally{await pool.end();await admin.end();}
});
