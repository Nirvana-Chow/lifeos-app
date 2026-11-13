import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Pool} from 'pg';
import {verifyRequirementEventReadiness} from '../src/requirement-events/readiness.ts';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {readCurrentAgentGrant} from '../src/agent-api/runtime.ts';
import {AuthorityService} from '../src/agent-authority/service.ts';
import {eventOperations} from '../src/requirement-events/contracts.ts';
import {PostgresRequirementEventStore} from '../src/requirement-events/postgres.ts';
import {RequirementEventService} from '../src/requirement-events/service.ts';
import {RequirementsService} from '../src/requirements-candidate/service.ts';
import {PostgresPlatformRepository,type SqlPool} from '../src/platform/postgres.ts';
import {requirements} from '../src/platform/requirements.ts';
import {prepareRequirementsFixture,requirementsFixture,requirementsFixturePool} from './helpers/requirements-stage-pg.ts';

// Runs only AFTER the original source/run-bound disposable cluster preflight.
// Objects have two distinct owners at creation; no ALTER OWNER or private-table grant.
async function qualifyEventSplitOwners(admin:Pool){
 const database='lifeos_platform_test_event_owners',platformOwner='lifeos_platform_candidate_migrator',authOwner='lifeos_auth_test_bootstrap',password='fixture-event-owner-never-live';
 const pools:Pool[]=[],createdRoles:{name:string;oid:number}[]=[];let databaseOid:number|undefined;
 const connect=(user:string)=>{const pool=new Pool({host:'127.0.0.1',port:requirementsFixture.port,database,user,password:user==='postgres'?'fixture-ci-admin-never-live':user==='lifeos_platform_candidate_runtime'?'fixture-ci-runtime-never-live':password,max:1,connectionTimeoutMillis:2000,statement_timeout:10000,lock_timeout:8000});pools.push(pool);return pool;};
 try{
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM pg_database WHERE datname=$1',[database])).rows[0].n,0,'Never touch an existing owner-split database');
  assert.deepEqual((await admin.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])',[[platformOwner,authOwner]])).rows,[],'Never reuse existing owner roles');
  for(const name of [platformOwner,authOwner]){
   await admin.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION`);
   createdRoles.push({name,oid:(await admin.query('SELECT oid::int AS oid FROM pg_roles WHERE rolname=$1',[name])).rows[0].oid});
  }
  await admin.query(`CREATE DATABASE ${database} OWNER ${platformOwner}`);
  databaseOid=(await admin.query('SELECT oid::int AS oid FROM pg_database WHERE datname=$1',[database])).rows[0].oid;
  const owner=connect(platformOwner),auth=connect(authOwner),runtime=connect('lifeos_platform_candidate_runtime'),catalog=connect('postgres');
  assert.deepEqual((await catalog.query("SELECT current_database() AS database,current_setting('server_version_num') AS version")).rows,[{database,version:'170011'}]);
  await catalog.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC; CREATE SCHEMA lifeos_agent AUTHORIZATION ${authOwner}; REVOKE ALL ON SCHEMA lifeos_agent FROM PUBLIC`);
  for(const name of ['0001_platform_candidate.sql','0002_platform_inbox.sql'])await owner.query(await readFile('db/'+name,'utf8'));
  // Existing Auth migration prerequisites need only platform meta in this narrow fixture.
  // Full reviewed grant functions and fences remain covered by the separate policy PG case.
  await owner.query(`GRANT USAGE ON SCHEMA lifeos_platform TO ${authOwner}; GRANT SELECT ON lifeos_platform.platform_meta TO ${authOwner}`);
  await owner.query('INSERT INTO lifeos_platform.platform_user(id,name,email) VALUES($1,$1,$2)',[requirementsFixture.ownerId,requirementsFixture.email]);
  await auth.query(`CREATE TABLE lifeos_agent.key_management_binding(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),owner_id text NOT NULL,space_id text NOT NULL);
   CREATE TABLE lifeos_agent.apikey(id text PRIMARY KEY,permissions jsonb NOT NULL);
   CREATE TABLE lifeos_agent.business_policy_control(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),enabled boolean NOT NULL DEFAULT false);
   INSERT INTO lifeos_agent.business_policy_control(singleton) VALUES(true);
   CREATE TABLE lifeos_agent.business_policy_operation(operation_id text PRIMARY KEY,required_scopes text[] NOT NULL,enabled boolean NOT NULL DEFAULT false);
   REVOKE ALL ON ALL TABLES IN SCHEMA lifeos_agent FROM PUBLIC;
   CREATE FUNCTION lifeos_agent.assert_business_grant(text,text,text,text[]) RETURNS boolean LANGUAGE sql AS 'SELECT false';
   CREATE FUNCTION lifeos_agent.assert_current_business_grant(text,text,text,text[],text,text) RETURNS boolean LANGUAGE sql AS 'SELECT false';
   REVOKE ALL ON ALL FUNCTIONS IN SCHEMA lifeos_agent FROM PUBLIC`);
  await auth.query('INSERT INTO lifeos_agent.key_management_binding(owner_id,space_id) VALUES($1,$2)',[requirementsFixture.ownerId,requirementsFixture.spaceId]);
  await auth.query(`INSERT INTO lifeos_agent.apikey VALUES('synthetic-legacy','{"requirements":["read"]}')`);
  const keyBefore=(await auth.query('SELECT * FROM lifeos_agent.apikey')).rows;
  const config={ownerId:requirementsFixture.ownerId,ownerEmail:requirementsFixture.email,spaceId:requirementsFixture.spaceId,databaseName:database,baseURL:requirementsFixture.origin,approval:'personal-manual-v1',allowedTypes:['todo','journal'],requirementsEnabled:true} as const;
  const fields={title:'Synthetic split-owner ticket',body:'Disposable fixture only',phaseId:requirements().roadmap!.phases[0].id,priority:'P2',plannedStartOn:null,plannedEndOn:null,workflow:{state:'planned',purpose:'Synthetic',nextStep:'Check ownership'}} as const,input={spaceId:config.spaceId,confirmed:true,fields};
  const service=new RequirementsService(new PostgresPlatformRepository(runtime as SqlPool,false,false,{organization:false,classification:false,requirements:true}),config);
  const legacy=(await service.mutate(config.ownerId,null,input,'synthetic-split-legacy')).entry;
  const platformSQL=await readFile('db/0020_requirement_events.proposed.sql','utf8'),policySQL=await readFile('db/0020_requirement_events_agent_operations.proposed.sql','utf8');
  const migrate=async(pool:Pool,sql:string,change:Partial<Record<'database'|'owner'|'space'|'platformApproval'|'policyApproval',string>>={})=>{
   const session=await pool.connect();try{
    const values={database,owner:config.ownerId,space:config.spaceId,platformApproval:'transaction-outbox-v1',policyApproval:'1',...change};
    await session.query("SELECT set_config('lifeos.agent_expected_database',$1,false),set_config('lifeos.agent_expected_owner',$2,false),set_config('lifeos.agent_expected_space',$3,false),set_config('lifeos.requirement_events_migration_approved',$4,false),set_config('lifeos.requirement_events_agent_approved',$5,false)",Object.values(values));
    await session.query(sql);
   }catch(error){await session.query('ROLLBACK');throw error;}finally{session.release(true);}
  };
  assert.deepEqual((await catalog.query(`SELECT pg_get_userbyid(c.relowner) AS owner FROM pg_class c WHERE c.oid IN ('lifeos_platform.platform_record'::regclass,'lifeos_agent.business_policy_operation'::regclass) ORDER BY owner`)).rows,[{owner:authOwner},{owner:platformOwner}]);
  assert.equal((await catalog.query("SELECT has_schema_privilege($1,'lifeos_agent','USAGE') AS allowed",[platformOwner])).rows[0].allowed,false);
  for(const change of [{database:'wrong_database'},{owner:'wrong_owner'},{space:''},{platformApproval:''}])await assert.rejects(migrate(owner,platformSQL,change),{code:'P0001'});
  await assert.rejects(migrate(auth,platformSQL));await assert.rejects(migrate(runtime,platformSQL),{code:'P0001'});
  await migrate(owner,platformSQL);await verifyRequirementEventReadiness(runtime);
  assert.equal((await catalog.query('SELECT count(*)::int AS n FROM lifeos_platform.requirement_work')).rows[0].n,0,'No legacy backfill');
  assert.equal((await catalog.query('SELECT count(*)::int AS n FROM lifeos_platform.requirement_event_outbox')).rows[0].n,0);
  assert.deepEqual((await service.get(config.ownerId,legacy.id)).fields,fields,'DDL does not edit the owner requirement');
  for(const change of [{database:'wrong_database'},{owner:'wrong_owner'},{space:'wrong_space'},{policyApproval:''}])await assert.rejects(migrate(auth,policySQL,change),{code:'P0001'});
  for(const role of [owner,runtime]){
   await assert.rejects(migrate(role,policySQL),{code:'42501'});
   await assert.rejects(role.query('SELECT * FROM lifeos_agent.business_policy_operation'),{code:'42501'});
   await assert.rejects(role.query("INSERT INTO lifeos_agent.business_policy_operation VALUES('untrusted',ARRAY['requirements:read'],false)"),{code:'42501'});
   await assert.rejects(role.query('UPDATE lifeos_agent.business_policy_operation SET enabled=true'),{code:'42501'});
  }
  assert.equal((await auth.query('SELECT count(*)::int AS n FROM lifeos_agent.business_policy_operation')).rows[0].n,0);
  await migrate(auth,policySQL);
  assert.deepEqual((await auth.query('SELECT operation_id,required_scopes,enabled FROM lifeos_agent.business_policy_operation ORDER BY operation_id')).rows,[
   {operation_id:'claimRequirementExecution',required_scopes:['requirements:read','requirements:write'],enabled:false},
   {operation_id:'streamRequirementEvents',required_scopes:['requirements:read'],enabled:false},
   {operation_id:'updateRequirementExecution',required_scopes:['requirements:read','requirements:write'],enabled:false},
  ]);
  assert.deepEqual((await auth.query('SELECT enabled FROM lifeos_agent.business_policy_control')).rows,[{enabled:false}]);assert.deepEqual((await auth.query('SELECT * FROM lifeos_agent.apikey')).rows,keyBefore);
  await service.mutate(config.ownerId,null,input,'synthetic-split-after-ddl');
  assert.equal((await catalog.query('SELECT count(*)::int AS n FROM lifeos_platform.requirement_event_outbox')).rows[0].n,1,'Original restricted writer still invokes the unchanged trigger');
  await verifyRequirementEventReadiness(runtime);
 }finally{
  await Promise.all(pools.map(pool=>pool.end()));
  if(databaseOid!==undefined){
   assert.deepEqual((await admin.query('SELECT oid::int AS oid,pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1',[database])).rows,[{oid:databaseOid,owner:platformOwner}]);
   await admin.query(`DROP DATABASE ${database}`);
  }
  for(const role of createdRoles.reverse()){
   assert.deepEqual((await admin.query('SELECT oid::int AS oid FROM pg_roles WHERE rolname=$1',[role.name])).rows,[{oid:role.oid}]);await admin.query(`DROP ROLE ${role.name}`);
  }
 }
}

// Reuses the exact source/run-bound disposable requirements fixture. Never redirects to a live database.
test('OPT-IN requirement transaction outbox rollback, receipt dedupe and lease fence on restricted PostgreSQL',{
 skip:process.env.RUN_REQUIREMENT_EVENT_POSTGRES_TESTS!=='1'&&'Dedicated requirement event PostgreSQL qualification not enabled',timeout:30000,
},async()=>{
 await prepareRequirementsFixture();const admin=requirementsFixturePool('admin',1),pool=requirementsFixturePool('runtime',2);
 try{
  await qualifyEventSplitOwners(admin);
  const config={ownerId:requirementsFixture.ownerId,ownerEmail:requirementsFixture.email,spaceId:requirementsFixture.spaceId,databaseName:requirementsFixture.database,baseURL:requirementsFixture.origin,approval:'personal-manual-v1',allowedTypes:['todo','journal'],requirementsEnabled:true} as const;
  const repository=new PostgresPlatformRepository(pool as SqlPool,false,false,{organization:false,classification:false,requirements:true},true),service=new RequirementsService(repository,config);
  const fields={title:'Synthetic event ticket',body:'No real requirement data',phaseId:requirements().roadmap!.phases[0].id,priority:'P2',plannedStartOn:null,plannedEndOn:null,workflow:{state:'planned',purpose:'Synthetic',nextStep:'Verify transaction'}} as const;
  const input={spaceId:config.spaceId,confirmed:true,fields};
  // Genuine legacy records go through the original writer BEFORE 0020 exists.
  // The core fixture is shared serially; never assume its public overlays empty.
  const legacyPrivate=(await service.mutate(config.ownerId,null,input,'synthetic-legacy-event-private')).entry;
  const rollbackLegacy=(await service.mutate(config.ownerId,null,input,'synthetic-legacy-event-rollback')).entry;
  let legacyPublic:typeof legacyPrivate|undefined;
  for(const candidate of requirements().requirements){const read=await service.get(config.ownerId,candidate.id);if(read.revision===0){legacyPublic=(await service.mutate(config.ownerId,read.id,{...input,expectedRevision:0,baselineBinding:read.baselineBinding},'synthetic-legacy-event-public')).entry;break;}}
  assert.ok(legacyPublic,'At least one unmodified synthetic public baseline slot required');
  const current=(await admin.query("SELECT to_regclass('lifeos_platform.requirement_work') AS work")).rows[0];assert.equal(current.work,null,'Fresh event schema required; never reuse an unknown migrated target');
  const migration=await readFile('db/0020_requirement_events.proposed.sql','utf8'),session=await admin.connect();
  try{
   assert.equal((await session.query("SELECT to_regclass('requirements_fixture.requirement_event_identity') AS marker")).rows[0].marker,null,'Fresh source-bound event marker required');
   const core=(await session.query('SELECT fixture_id,source_digest FROM requirements_fixture.identity')).rows;assert.equal(core.length,1);
   const sqlDigest=createHash('sha256').update(migration).digest('hex');
   await session.query('CREATE TABLE requirements_fixture.requirement_event_identity(fixture_id text NOT NULL,core_digest text NOT NULL,sql_digest text NOT NULL,source_sha text NOT NULL); REVOKE ALL ON requirements_fixture.requirement_event_identity FROM PUBLIC');
   await session.query('INSERT INTO requirements_fixture.requirement_event_identity VALUES($1,$2,$3,$4)',[core[0].fixture_id,core[0].source_digest,sqlDigest,process.env.SOURCE_SHA??'declared-local-synthetic']);
   await session.query("SELECT set_config('lifeos.requirement_events_migration_approved','transaction-outbox-v1',false),set_config('lifeos.agent_expected_database','lifeos_platform_test_local',false),set_config('lifeos.agent_expected_owner',$1,false),set_config('lifeos.agent_expected_space',$2,false)",[requirementsFixture.ownerId,requirementsFixture.spaceId]);
   assert.deepEqual((await session.query("SELECT current_setting('lifeos.requirement_events_migration_approved') AS approval,current_setting('lifeos.agent_expected_database') AS database")).rows,[{approval:'transaction-outbox-v1',database:'lifeos_platform_test_local'}]);
   await session.query(migration);
   assert.deepEqual((await session.query('SELECT * FROM requirements_fixture.requirement_event_identity')).rows,[{fixture_id:core[0].fixture_id,core_digest:core[0].source_digest,sql_digest:sqlDigest,source_sha:process.env.SOURCE_SHA??'declared-local-synthetic'}]);
  }finally{session.release(true);}
  await verifyRequirementEventReadiness(pool);

  const before=await admin.query('SELECT count(*)::int AS n FROM lifeos_platform.platform_record');
  const rollbackRepository={...repository,transaction:repository.transaction.bind(repository),get:repository.get.bind(repository),list:repository.list.bind(repository),history:repository.history.bind(repository),exportSnapshot:repository.exportSnapshot.bind(repository)};
  rollbackRepository.transaction=(owner,key,run)=>repository.transaction(owner,key,tx=>run({...tx,saveReceipt:async()=>{throw Error('synthetic receipt failure after original write');}}));
  await assert.rejects(new RequirementsService(rollbackRepository,config).mutate(config.ownerId,null,input,'synthetic-event-rollback'));
  assert.deepEqual((await admin.query('SELECT count(*)::int AS n FROM lifeos_platform.platform_record')).rows,before.rows);assert.equal((await admin.query('SELECT count(*)::int AS n FROM lifeos_platform.requirement_event_outbox')).rows[0].n,0);
  const created=await service.mutate(config.ownerId,null,input,'synthetic-event-create');await service.mutate(config.ownerId,null,input,'synthetic-event-create');
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM lifeos_platform.requirement_event_outbox')).rows[0].n,1);
  const work=(await admin.query('SELECT * FROM lifeos_platform.requirement_work WHERE requirement_id=$1',[created.entry.id])).rows[0];assert.equal(work.dispatch_state,'ready');
  const eventCount=async(id:string)=>(await admin.query('SELECT count(*)::int AS n FROM lifeos_platform.requirement_event_outbox WHERE requirement_id=$1',[id])).rows[0].n;
  const verifier=requirementsFixturePool('verifier',1),grantId='synthetic-event-postgres-grant';
  try{
   await admin.query(`INSERT INTO lifeos_agent.apikey(id,"configId","referenceId",key,enabled,"createdAt","updatedAt","expiresAt",metadata,permissions) VALUES($1,'default',$2,'synthetic-event-hash',true,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 hour',$3,$4)`,[grantId,config.ownerId,JSON.stringify({spaceId:config.spaceId}),JSON.stringify({requirements:['read','write']})]);
   const events=new RequirementEventService(new PostgresRequirementEventStore(pool as SqlPool,true));
   const handlerFor=(backing=repository)=>createAgentHandler({enabled:true,mountPath:'/api/platform/agent',fenceWrites:true,config,repository:backing,modules:{organization:false,classification:false,requirements:true,requirementEvents:true},verify:async()=>readCurrentAgentGrant(verifier,grantId),readCurrentGrant:id=>readCurrentAgentGrant(verifier,id),operationAvailable:()=>true,assertWritable:async()=>{},requirementEvents:{service:events,ready:async()=>{await verifyRequirementEventReadiness(pool);return true;},openNotifications:async()=>({wait:async()=>{throw Error('synthetic-end');},close:async()=>{}})}}),handler=handlerFor();
   const send=(path:string,method='GET',body?:unknown,key='synthetic-event-api-key',target=handler)=>target(new Request(config.baseURL+'/api/platform/agent'+path,{method,headers:{host:new URL(config.baseURL).host,authorization:'Bearer synthetic-event-request','idempotency-key':key,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));
   const catalog=await(await send('/v2/capabilities')).json();assert.equal(catalog.eventTransports[0].transport,'sse');assert.equal(catalog.operations.some((op:any)=>op.id==='streamRequirementEvents'),false);
   const claim=await send('/v1/requirement-events/claims','POST',{requirementId:created.entry.id,workDigest:work.work_digest,holderId:'synthetic-api-mac'},'synthetic-event-api-claim');assert.equal(claim.status,200);const claimed=(await claim.json()).lease;
   const current=await(await send('/v1/requirements/'+created.entry.id)).json();assert.equal(current.execution.lease.id,claimed.id);assert.equal(current.execution.leaseActive,true);
   // Expiry is observable loss of authority, not evidence that the old process
   // stopped. Exercise the real restricted query before its page limit and the
   // original HTTP claim/receipt path; no synthetic takeover is authorized.
   const authority=new AuthorityService({ownerId:config.ownerId,spaceId:config.spaceId,verifyOwner:async()=>null,verifyAgent:async()=>readCurrentAgentGrant(verifier,grantId),readCurrentAgent:id=>readCurrentAgentGrant(verifier,id)});
   const actor=await authority.resolveAgentActor('synthetic-event-request');assert.ok(actor);
   await admin.query("UPDATE lifeos_platform.requirement_work SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE requirement_id=$1",[created.entry.id]);
   try{
    const expired=(await admin.query('SELECT * FROM lifeos_platform.requirement_work WHERE requirement_id=$1',[created.entry.id])).rows;
    assert.deepEqual(await events.store.transaction(actor,eventOperations.stream,tx=>tx.ready(1)),[],'Expired running work must be excluded by the actual SQL query before LIMIT');
    const held=await send('/v1/requirement-events/claims','POST',{requirementId:created.entry.id,workDigest:work.work_digest,holderId:'synthetic-replacement-server'},'synthetic-event-expired-reclaim');
    assert.equal(held.status,409);assert.deepEqual(await held.json(),{error:'EXECUTION_RECONCILIATION_REQUIRED'});
    assert.deepEqual((await admin.query('SELECT * FROM lifeos_platform.requirement_work WHERE requirement_id=$1',[created.entry.id])).rows,expired,'No attempt, fence, old lease or progress changes before reconciliation');
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM lifeos_platform.requirement_claim_command WHERE command_key='synthetic-event-expired-reclaim'")).rows[0].n,0);
    const recovered=await send('/v1/requirement-events/claims','POST',{requirementId:created.entry.id,workDigest:work.work_digest,holderId:'synthetic-api-mac'},'synthetic-event-api-claim');
    assert.equal(recovered.status,200);assert.deepEqual((await recovered.json()).lease,claimed,'Original command can recover its historical receipt without acquiring another lease');
    const observed=await(await send('/v1/requirements/'+created.entry.id)).json();assert.equal(observed.execution.leaseActive,false);assert.equal(observed.execution.lease.id,claimed.id);
    assert.equal((await send('/v1/requirement-events/claims/'+claimed.id,'PATCH',{action:'renew',lease:claimed},'synthetic-event-expired-renew')).status,409);
    assert.deepEqual((await admin.query('SELECT * FROM lifeos_platform.requirement_work WHERE requirement_id=$1',[created.entry.id])).rows,expired);
   }finally{
    // Restore only this fixture's injected clock condition for independent
    // original cases below; this is not a production reconciliation operation.
    await admin.query('UPDATE lifeos_platform.requirement_work SET lease_expires_at=$1 WHERE requirement_id=$2 AND lease_id=$3',[new Date(claimed.expiresAt).toISOString(),created.entry.id,claimed.id]);
   }
   const admissions=[];
   for(const original of [legacyPrivate,legacyPublic]){
    const read=await(await send('/v1/requirements/'+original.id)).json();assert.equal(read.execution.admissionEligible,true);assert.equal(await eventCount(original.id),0,'GET does not backfill or admit legacy records');
    const command={action:'admit',requirementId:original.id,sourceId:read.entry.sourceId,expectedRevision:read.entry.revision,workDigest:read.execution.workDigest},key='synthetic-admit-'+original.id;
    for(const stale of [{expectedRevision:2},{sourceId:'33333333-3333-4333-8333-333333333333'},{workDigest:'f'.repeat(64)}])assert.equal((await send('/v1/requirement-events/claims','POST',{...command,...stale},key+'-stale')).status,409);
    const result=await send('/v1/requirement-events/claims','POST',command,key);assert.equal(result.status,200,JSON.stringify(await result.clone().json()));assert.equal((await result.json()).admission.state,'ready');
    const again=await(await send('/v1/requirement-events/claims','POST',command,key)).json();assert.equal(again.duplicate,true);assert.equal(await eventCount(original.id),1);const observed=await(await send('/v1/requirements/'+original.id)).json();assert.deepEqual(observed.entry,read.entry);assert.equal(observed.execution.state,'ready');
    assert.equal((await send('/v1/requirement-events/claims','POST',command,key+'-noop')).status,200);assert.equal(await eventCount(original.id),1);admissions.push({command,key});
   }
   // Both actions could succeed independently. The common grant/key advisory
   // lock must serialize them so exactly one receipt wins, without deadlock.
   const race=await Promise.all([send('/v1/requirement-events/claims','POST',admissions[0].command,'synthetic-cross-action-race'),send('/v1/requirement-events/claims','POST',{requirementId:legacyPrivate.id,workDigest:admissions[0].command.workDigest,holderId:'synthetic-racing-mac'},'synthetic-cross-action-race')]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
   const publicClaim=await(await send('/v1/requirement-events/claims','POST',{requirementId:legacyPublic.id,workDigest:admissions[1].command.workDigest,holderId:'synthetic-public-mac'},'synthetic-public-existing-claim')).json();assert.ok(publicClaim.lease);
   assert.equal((await send('/v1/requirement-events/claims/'+publicClaim.lease.id,'PATCH',{action:'renew',lease:publicClaim.lease},admissions[1].key)).status,409,'renew cannot reuse an admission key');
   assert.equal((await send('/v1/requirement-events/claims','POST',admissions[1].command,'synthetic-public-existing-claim')).status,409,'admission cannot reuse a claim key');
   // Same-generation budget is retained, including candidate work from legacy
   // edits; a ready no-op cannot create a new notification loop.
   await admin.query("UPDATE lifeos_platform.requirement_work SET dispatch_state='candidate',attempts=2,lease_fence=2,lease_id=null,lease_holder=null,lease_grant_id=null,lease_expires_at=null WHERE requirement_id=$1",[legacyPrivate.id]);
   const preserved=await(await send('/v1/requirement-events/claims','POST',admissions[0].command,'synthetic-preserved-attempts')).json();assert.equal(preserved.admission.attempts,2);assert.equal(preserved.admission.fence,2);
   await service.mutate(config.ownerId,legacyPrivate.id,{...input,fields:{...fields,workflow:{...fields.workflow,state:'in_progress'}},expectedRevision:1,baselineBinding:null},'synthetic-admitted-later-progress');
   const historical=await(await send('/v1/requirement-events/claims','POST',admissions[0].command,admissions[0].key)).json();assert.equal(historical.duplicate,true);assert.equal(historical.admission.revision,1);assert.equal((await(await send('/v1/requirements/'+legacyPrivate.id)).json()).entry.revision,2);
   await admin.query("UPDATE lifeos_platform.requirement_work SET dispatch_state='candidate',attempts=3 WHERE requirement_id=$1",[legacyPrivate.id]);const exhaustedView=await(await send('/v1/requirements/'+legacyPrivate.id)).json();assert.equal((await send('/v1/requirement-events/claims','POST',{...admissions[0].command,expectedRevision:2,workDigest:exhaustedView.execution.workDigest},'synthetic-exhausted-admission')).status,409);
   const rollbackView=await(await send('/v1/requirements/'+rollbackLegacy.id)).json(),failedRepository=Object.create(repository) as PostgresPlatformRepository;
   failedRepository.transaction=(owner,key,run)=>repository.transaction(owner,key,tx=>run({...tx,admitRequirementExecution:async b=>{await tx.admitRequirementExecution!(b);throw Error('synthetic failure after admission, outbox and receipt');}}));
   assert.equal((await send('/v1/requirement-events/claims','POST',{action:'admit',requirementId:rollbackLegacy.id,sourceId:rollbackLegacy.sourceId,expectedRevision:1,workDigest:rollbackView.execution.workDigest},'synthetic-admission-rollback',handlerFor(failedRepository))).status,503);
   assert.equal((await admin.query('SELECT count(*)::int AS n FROM lifeos_platform.requirement_work WHERE requirement_id=$1',[rollbackLegacy.id])).rows[0].n,0);assert.equal(await eventCount(rollbackLegacy.id),0);assert.equal((await admin.query("SELECT count(*)::int AS n FROM lifeos_platform.requirement_claim_command WHERE command_key='synthetic-admission-rollback'")).rows[0].n,0);
   const scope=await pool.connect();try{await scope.query('BEGIN');await scope.query("SELECT set_config('lifeos.owner_id',$1,true),set_config('lifeos.requirement_event_space','wrong-space',true)",[config.ownerId]);assert.deepEqual((await scope.query('SELECT requirement_id FROM lifeos_platform.requirement_work')).rows,[]);await scope.query('ROLLBACK');}finally{scope.release();}
   await admin.query('UPDATE lifeos_agent.apikey SET enabled=false WHERE id=$1',[grantId]);assert.equal((await send('/v1/requirement-events/claims/'+claimed.id,'PATCH',{action:'renew',lease:claimed},'synthetic-event-revoked-renew')).status,401);
  }finally{await verifier.end();}

  const lease={id:'11111111-1111-4111-8111-111111111111',fence:1,holderId:'synthetic-mac',grantId:'synthetic-grant',workDigest:work.work_digest};
  await admin.query("UPDATE lifeos_platform.requirement_work SET dispatch_state='running',lease_id=$1,lease_fence=1,lease_holder=$2,lease_grant_id=$3,lease_expires_at=clock_timestamp()+interval '1 minute' WHERE requirement_id=$4",[lease.id,lease.holderId,lease.grantId,created.entry.id]);
  const progress={...input,fields:{...fields,workflow:{...fields.workflow,state:'in_progress',nextStep:'Synthetic progress only'}},expectedRevision:1,baselineBinding:null};
  await service.mutate(config.ownerId,created.entry.id,progress,'synthetic-event-progress',undefined,undefined,lease);
  assert.equal(await eventCount(created.entry.id),1,'progress-only change must not start another model');
  await admin.query("UPDATE lifeos_platform.requirement_work SET lease_expires_at=clock_timestamp()-interval '1 second',lease_fence=2 WHERE requirement_id=$1",[created.entry.id]);
  await assert.rejects(service.mutate(config.ownerId,created.entry.id,{...progress,expectedRevision:2},'synthetic-event-expired',undefined,undefined,lease),{code:'EXECUTION_LEASE_LOST'});
  const replay=await service.mutate(config.ownerId,created.entry.id,progress,'synthetic-event-progress',undefined,undefined,lease);assert.equal(replay.duplicate,true);assert.equal(replay.entry.revision,2);assert.equal((await service.get(config.ownerId,created.entry.id)).revision,2);
  const suggestion=await service.mutate(config.ownerId,null,{...input,fields:{...fields,workflow:null}},'synthetic-event-candidate');assert.equal((await admin.query('SELECT dispatch_state FROM lifeos_platform.requirement_work WHERE requirement_id=$1',[suggestion.entry.id])).rows[0].dispatch_state,'candidate');
  await service.mutate(config.ownerId,suggestion.entry.id,{...input,expectedRevision:1,baselineBinding:null},'synthetic-candidate-no-resume');assert.equal((await admin.query('SELECT dispatch_state FROM lifeos_platform.requirement_work WHERE requirement_id=$1',[suggestion.entry.id])).rows[0].dispatch_state,'candidate');
  await admin.query("UPDATE lifeos_platform.requirement_work SET dispatch_state='paused',lease_id=null,lease_holder=null,lease_grant_id=null,lease_expires_at=null WHERE requirement_id=$1",[created.entry.id]);
  await service.mutate(config.ownerId,created.entry.id,{...progress,fields:{...fields,body:'Synthetic owner refinement'},expectedRevision:2},'synthetic-paused-no-resume');assert.equal((await admin.query('SELECT dispatch_state FROM lifeos_platform.requirement_work WHERE requirement_id=$1',[created.entry.id])).rows[0].dispatch_state,'paused');
 }finally{await pool.end();await admin.end();}
});
