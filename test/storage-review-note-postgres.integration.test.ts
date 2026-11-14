import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {requirementsFixture as fixture,requirementsFixturePool as pool} from './helpers/requirements-stage-pg.ts';
import {prepareSplitOwnerFixture,splitOwners} from './helpers/business-oauth-split-owner-pg.ts';
import {storageReviewOperations} from '../src/storage-review/operations.ts';

test('OPT-IN0026 registers note in both actual registries, remains off and uses the original grant fence',{
 skip:process.env.RUN_STORAGE_REVIEW_NOTE_POSTGRES_TESTS!=='1'&&'Separately approved marked SSH-loopback PostgreSQL fixture with original0021 required; not executed',timeout:30000,
},async()=>{
 await prepareSplitOwnerFixture();
 const admin=pool('admin',1),runtime=pool('runtime',1);
 let ownerPool:Pool|undefined,owner:PoolClient|undefined;
 const grantId='synthetic-storage-note-policy-grant',scope=['storage-review:read','storage-review:write'];
 try{
  assert.notEqual((await admin.query("SELECT to_regclass('lifeos_agent.oauth_business_operation') AS value")).rows[0].value,null,'Original0021 must be independently qualified first');
  assert.equal((await admin.query("SELECT to_regclass('storage_note_registration_fixture.identity') AS value")).rows[0].value,null,'Do not replay/resume an existing qualification marker');
  await admin.query("ALTER ROLE lifeos_auth_test_bootstrap PASSWORD 'fixture-storage-note-owner-never-live'");
  ownerPool=new Pool({host:'127.0.0.1',port:fixture.port,database:fixture.database,user:splitOwners.auth,password:'fixture-storage-note-owner-never-live',max:1,connectionTimeoutMillis:2000,statement_timeout:10000,lock_timeout:2000,options:'-c search_path=pg_catalog,pg_temp'});
  owner=await ownerPool.connect();
  const ownerPid=(await owner.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  assert.deepEqual((await owner.query('SELECT current_user AS role,current_database() AS database')).rows,[{role:splitOwners.auth,database:fixture.database}]);
  assert.equal((await runtime.query('SELECT current_user AS role')).rows[0].role,'lifeos_platform_candidate_runtime');
  const source=await readFile('db/0026_storage_review_note_agent_operation.proposed.sql','utf8'),prior=await readFile('db/0019_storage_review_agent_operations.proposed.sql','utf8');
  const sourceDigest=createHash('sha256').update(JSON.stringify({source,prior,operation:storageReviewOperations.find(op=>op.id==='updateStorageReviewNote')})).digest('hex');
  await admin.query('CREATE SCHEMA storage_note_registration_fixture;REVOKE ALL ON SCHEMA storage_note_registration_fixture FROM PUBLIC;CREATE TABLE storage_note_registration_fixture.identity(source_digest text NOT NULL,status text NOT NULL)');
  await admin.query('INSERT INTO storage_note_registration_fixture.identity VALUES($1,$2)',[sourceDigest,'started-do-not-replay']);
  await owner.query("SELECT set_config('lifeos.storage_review_agent_approved','1',false),set_config('lifeos.agent_expected_database',$1,false),set_config('lifeos.agent_expected_owner',$2,false),set_config('lifeos.agent_expected_space',$3,false)",[fixture.database,fixture.ownerId,fixture.spaceId]);
  await owner.query(prior);
  const oldRows=(await owner.query("SELECT operation_id,required_scopes,enabled FROM lifeos_agent.business_policy_operation WHERE operation_id<>'updateStorageReviewNote' ORDER BY operation_id")).rows;
  await owner.query('INSERT INTO lifeos_agent.apikey(id,"configId","referenceId",key,enabled,"createdAt","updatedAt","expiresAt",metadata,permissions) VALUES($1,\'default\',$2,\'synthetic-unusable-note-key\',true,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval \'1 hour\',$3,$4)',[grantId,fixture.ownerId,JSON.stringify({spaceId:fixture.spaceId,businessDataPolicy:'all-personal-business-v1'}),JSON.stringify({todo:['read']})]);
  const keyDigest=async()=>(await owner!.query('SELECT lifeos_agent.current_managed_grant_digest($1) AS value',[grantId])).rows[0].value;
  const beforeDigest=await keyDigest();
  const fence=async()=>{
   const client=await runtime.connect();try{
    await client.query('BEGIN');await client.query("SELECT set_config('lifeos.owner_id',$1,true)",[fixture.ownerId]);
    return (await client.query('SELECT lifeos_agent.assert_current_business_grant($1,$2,$3,$4::text[],\'all-personal-business-v1\',\'updateStorageReviewNote\') AS value',[grantId,fixture.ownerId,fixture.spaceId,scope])).rows[0].value;
   }finally{await client.query('ROLLBACK');client.release();}
  };
  assert.equal(await fence(),false,'A new source operation without its actual registry row is unavailable');
  await assert.rejects(owner.query(source),{code:'P0001'});await owner.query('ROLLBACK');
  assert.equal((await owner.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,ownerPid,'Negative migration must retain the same explicit owning-role session');
  await assert.rejects(runtime.query(source),error=>['P0001','42501'].includes((error as {code:string}).code));await runtime.query('ROLLBACK');
  assert.deepEqual((await owner.query("SELECT operation_id FROM lifeos_agent.business_policy_operation WHERE operation_id='updateStorageReviewNote'")).rows,[]);
  await owner.query("SET lifeos.storage_review_note_approved='1'");await owner.query(source);
  assert.deepEqual((await owner.query("SELECT required_scopes,enabled FROM lifeos_agent.business_policy_operation WHERE operation_id='updateStorageReviewNote'")).rows,[{required_scopes:scope,enabled:false}]);
  assert.deepEqual((await owner.query("SELECT required_scopes FROM lifeos_agent.oauth_business_operation WHERE operation_id='updateStorageReviewNote'")).rows,[{required_scopes:scope}]);
  assert.equal(await fence(),false,'Registration does not activate a new operation');
  assert.deepEqual((await owner.query("SELECT operation_id,required_scopes,enabled FROM lifeos_agent.business_policy_operation WHERE operation_id<>'updateStorageReviewNote' ORDER BY operation_id")).rows,oldRows);
  const control=(await owner.query('SELECT enabled FROM lifeos_agent.business_policy_control WHERE singleton')).rows[0].enabled;
  try{
   await owner.query('UPDATE lifeos_agent.business_policy_control SET enabled=true WHERE singleton');
   await owner.query("UPDATE lifeos_agent.business_policy_operation SET enabled=true WHERE operation_id='updateStorageReviewNote'");
   assert.equal(await fence(),true,'Actual original policy/operation/grant checks permit the separately enabled fixture operation');
   await owner.query('UPDATE lifeos_agent.apikey SET enabled=false WHERE id=$1',[grantId]);assert.equal(await fence(),false,'Actual revocation wins over source and operation availability');
   await owner.query('UPDATE lifeos_agent.apikey SET enabled=true WHERE id=$1',[grantId]);
  }finally{
   await owner.query("UPDATE lifeos_agent.business_policy_operation SET enabled=false WHERE operation_id='updateStorageReviewNote'");
   await owner.query('UPDATE lifeos_agent.business_policy_control SET enabled=$1 WHERE singleton',[control]);
  }
  assert.equal(await keyDigest(),beforeDigest,'Migration and original fences never change the original grant');
  await admin.query("UPDATE storage_note_registration_fixture.identity SET status='qualified-default-disabled' WHERE source_digest=$1",[sourceDigest]);
  console.log(JSON.stringify({status:'ACTUAL0026_NOTE_REGISTRATION_AND_FENCE_PASS',sourceDigest,actualOwnerLogin:true,actualRestrictedRuntime:true,newOperationEnabled:false,originalGrantUnchanged:true,productionAccepted:false}));
 }finally{
  if(owner){await owner.query('ROLLBACK').catch(()=>{});owner.release();}
  await Promise.allSettled([admin.end(),runtime.end(),...(ownerPool?[ownerPool.end()]:[])]);
 }
});
