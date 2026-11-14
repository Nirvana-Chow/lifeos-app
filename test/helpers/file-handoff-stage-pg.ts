import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {Pool} from 'pg';import {splitOwners} from './business-oauth-split-owner-pg.ts';
export const fileFixture={ownerId:'file-handoff-fixture-owner',spaceId:'file-handoff-fixture-space',email:'file-handoff@example.test'};
export const fileFixtureSqlFiles=['0001_platform_candidate.sql','0002_platform_inbox.sql','platform-synthetic-bootstrap-grants.proposed.sql','0009_owner_mfa.proposed.sql','0006_agent_api.proposed.sql','0010_agent_key_management.proposed.sql','0011_business_agent_grants.proposed.sql','0014_requirements_agent_grants.proposed.sql','0016_all_personal_business_policy.proposed.sql','0021_business_mcp_oauth.proposed.sql','0022_file_handoff.proposed.sql','0023_file_handoff_permissions.proposed.sql'].map(name=>'db/'+name).concat(['test/fixtures/business-oauth-split-owner.sql']);
const urls={admin:['LIFEOS_FILE_HANDOFF_TEST_ADMIN_URL','postgres'],runtime:['LIFEOS_FILE_HANDOFF_TEST_DATABASE_URL','lifeos_platform_candidate_runtime'],manager:['LIFEOS_FILE_HANDOFF_TEST_MANAGER_URL','lifeos_agent_key_manager'],verifier:['LIFEOS_FILE_HANDOFF_TEST_VERIFIER_URL','lifeos_agent_verifier']} as const;
export function fileFixturePool(role:keyof typeof urls,max=2){
 const [key,user]=urls[role],url=new URL(process.env[key]!);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55452');assert.equal(url.username,user);assert.equal(url.pathname,'/lifeos_platform_test_local');assert.equal(url.search,'');assert.equal(url.hash,'');
 return new Pool({connectionString:url.href,max,connectionTimeoutMillis:2000,statement_timeout:10000,lock_timeout:5000,idle_in_transaction_session_timeout:15000,options:role==='manager'||role==='verifier'?'-c search_path=lifeos_agent,pg_catalog':'-c search_path=pg_catalog,lifeos_platform'});
}
/** Read-only admission of a separately prepared fresh target. Never creates schemas/roles/grants. */
export async function qualifyFileFixture(){
 const env=process.env;assert.equal(env.RUN_FILE_HANDOFF_POSTGRES_TESTS,'1');assert.equal(env.LIFEOS_FILE_HANDOFF_TEST_APPROVAL,'approved-isolated-file-handoff-v2');assert.notEqual(env.CI,'true');assert.notEqual(env.GITHUB_ACTIONS,'true');assert.ok(process.execArgv.includes('--test-isolation=none'));
 assert.match(env.LIFEOS_FILE_HANDOFF_FIXTURE_ID??'',/^file-handoff-v2-[a-z0-9-]{8,80}$/);assert.match(env.LIFEOS_FILE_HANDOFF_CONTAINER_ID??'',/^[a-f0-9]{12,64}$/);assert.match(env.LIFEOS_FILE_HANDOFF_IMAGE_ID??'',/^sha256:[a-f0-9]{64}$/);assert.ok(env.LIFEOS_FILE_HANDOFF_FORWARD_SESSION);
 const sourceSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.equal(env.LIFEOS_FILE_HANDOFF_SOURCE_SHA,sourceSha);execFileSync('git',['diff','--quiet','HEAD']);
 assert.deepEqual(execFileSync('git',['ls-files','--others','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(path=>path&&path!=='node_modules'),[]);
 const sourceDigest=createHash('sha256').update(JSON.stringify(await Promise.all(fileFixtureSqlFiles.map(async name=>({name,text:await readFile(name,'utf8')}))))).digest('hex');
 const lockDigest=createHash('sha256').update(await readFile('package-lock.json')).digest('hex'),admin=fileFixturePool('admin',1);
 try{
  const identity=(await admin.query("SELECT current_setting('server_version_num') AS version,current_setting('data_directory') AS data,current_database() AS database,current_user AS role,inet_server_port() AS port,host(inet_server_addr()) AS address")).rows[0];
  assert.match(identity.address,/^(?:10\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|192\.168\.)/);assert.deepEqual({...identity,address:'docker-private'},{version:'170011',data:'/var/lib/postgresql/data',database:'lifeos_platform_test_local',role:'postgres',port:5432,address:'docker-private'});
  assert.deepEqual((await admin.query('SELECT fixture_id,source_digest,source_sha,lock_digest,container_id,image_id FROM file_handoff_fixture.identity')).rows,[{fixture_id:env.LIFEOS_FILE_HANDOFF_FIXTURE_ID,source_digest:sourceDigest,source_sha:sourceSha,lock_digest:lockDigest,container_id:env.LIFEOS_FILE_HANDOFF_CONTAINER_ID,image_id:env.LIFEOS_FILE_HANDOFF_IMAGE_ID}]);
  assert.deepEqual((await admin.query("SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid IN('lifeos_platform.platform_record'::regclass,'lifeos_agent.apikey'::regclass) ORDER BY owner")).rows,[{owner:splitOwners.auth},{owner:splitOwners.provider}]);
 }finally{await admin.end();}
}
