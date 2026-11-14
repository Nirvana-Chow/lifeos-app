import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Pool} from 'pg';
import {prepareSplitOwnerFixture,splitOwners} from './business-oauth-split-owner-pg.ts';
import {requirementsFixture as fixture,requirementsFixturePool} from './requirements-stage-pg.ts';
export const policyFixtureImage='sha256:839fbb5a4942a7758dd93e18b42ea5649807491a0545b5eeeb8f0b8bb11857a5';
const prerequisites=['0012_todo_classification.proposed.sql','0017_personal_records_agent_operations.proposed.sql','0019_storage_review_agent_operations.proposed.sql','0021_business_mcp_oauth.proposed.sql','0023_file_handoff_permissions.proposed.sql','0026_storage_review_note_agent_operation.proposed.sql','0024_device_login_duration.proposed.sql'];
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
/** No lifecycle or alternate database path. The external owner creates and cleans
 * one fresh descriptor-bound fixture; this helper refuses an existing attempt. */
export async function prepareBusinessMcpPolicyFixture(){
 assert.equal(process.env.RUN_BUSINESS_MCP_POLICY_POSTGRES_TESTS,'1');
 assert.equal(process.env.LIFEOS_FULL_POLICY_APPROVAL,'fresh-synthetic-full-policy-only-20261114');
 assert.equal(process.env.LIFEOS_REQUIREMENTS_FIXTURE_CONTEXT,'ssh-loopback');
 assert.notEqual(process.env.CI,'true');assert.notEqual(process.env.GITHUB_ACTIONS,'true');
 assert.ok(process.execArgv.includes('--test-isolation=none'));
 const descriptor=JSON.parse(await readFile(process.env.LIFEOS_FULL_POLICY_DESCRIPTOR!,'utf8'));
 assert.equal(descriptor.host,'127.0.0.1');assert.equal(descriptor.port,55452);assert.equal(descriptor.database,fixture.database);
 assert.equal(descriptor.dataDirectory,'/var/lib/postgresql/data');assert.equal(descriptor.imageId,policyFixtureImage);
 assert.match(descriptor.containerId,/^[a-f0-9]{64}$/);assert.equal(descriptor.purpose,'isolated-full-business-mcp-policy-qualification');
 assert.match(descriptor.forwardSession,/^dedicated-ssh-pid-[1-9][0-9]*$/);
 for(const [key,value]of Object.entries({LIFEOS_REQUIREMENTS_FIXTURE_CONTAINER_ID:descriptor.containerId,LIFEOS_REQUIREMENTS_FIXTURE_IMAGE_ID:descriptor.imageId,LIFEOS_REQUIREMENTS_FIXTURE_FORWARD_SESSION:descriptor.forwardSession,LIFEOS_REQUIREMENTS_FIXTURE_DATA_DIRECTORY:descriptor.dataDirectory}))assert.equal(process.env[key],value,key);
 const pins=JSON.parse(await readFile(process.env.LIFEOS_FULL_POLICY_SOURCE_PINS!,'utf8'));
 assert.match(pins.sourceSha,/^[a-f0-9]{40}$/);assert.equal(pins.lockSha256,'720bcc1103fdd7ef7f671612ef078ef6d74924724828dc09ce0072aa2b4b7909');
 assert.equal(hash(await readFile('package-lock.json')),pins.lockSha256);
 assert.ok(Object.keys(pins.files).length>1000,'Whole fixed archive inventory required');
 for(const [name,digest]of Object.entries(pins.files)){assert.ok(!name.startsWith('/')&&!name.split('/').includes('..'));assert.equal(hash(await readFile(name)),digest,name);}
 const sources=await Promise.all(prerequisites.map(async name=>({name,text:await readFile('db/'+name,'utf8')})));
 const sourceDigest=hash(JSON.stringify({pins,sources}));
 await prepareSplitOwnerFixture();
 const admin=requirementsFixturePool('admin',1);
 try{
  assert.equal((await admin.query("SELECT to_regnamespace('business_mcp_policy_fixture') AS marker")).rows[0].marker,null,'Existing attempt: diagnose, never replay');
  assert.equal((await admin.query("SELECT to_regclass('lifeos_agent.oauth_business_control') AS existing")).rows[0].existing,null,'Refuse another OAuth schema owner');
  await admin.query('CREATE SCHEMA business_mcp_policy_fixture;REVOKE ALL ON SCHEMA business_mcp_policy_fixture FROM PUBLIC;CREATE TABLE business_mcp_policy_fixture.identity(source_sha text NOT NULL,source_digest text NOT NULL,container_id text NOT NULL,phase text NOT NULL)');
  await admin.query('INSERT INTO business_mcp_policy_fixture.identity VALUES($1,$2,$3,$4)',[pins.sourceSha,sourceDigest,descriptor.containerId,'prepared']);
  await admin.query("ALTER ROLE lifeos_auth_test_bootstrap PASSWORD 'fixture-basic-mcp-owner-never-live'");
 }finally{await admin.end();}
 const writer=new Pool({host:'127.0.0.1',port:55452,database:fixture.database,user:splitOwners.auth,password:'fixture-basic-mcp-owner-never-live',max:2,connectionTimeoutMillis:2000,statement_timeout:15000,lock_timeout:8000,idle_in_transaction_session_timeout:15000,options:'-c search_path=pg_catalog,pg_temp'});
 const client=await writer.connect().catch(async error=>{await writer.end();throw error;});let prepared=false;try{
  assert.equal((await client.query('SELECT current_user AS role')).rows[0].role,splitOwners.auth);
  await client.query("SELECT set_config('lifeos.agent_expected_database',$1,false),set_config('lifeos.agent_expected_owner',$2,false),set_config('lifeos.agent_expected_space',$3,false),set_config('lifeos.todo_classification_expected_platform_owner',$4,false)",[fixture.database,fixture.ownerId,fixture.spaceId,splitOwners.provider]);
  await client.query("SET lifeos.todo_classification_approved='1';SET lifeos.business_records_approved='1';SET lifeos.storage_review_agent_approved='1';SET lifeos.business_mcp_oauth_approved='1';SET lifeos.file_handoff_grants_approved='file-handoff-grants-v1';SET lifeos.storage_review_note_approved='1';SET lifeos.device_sessions_approved='native-device-v1'");
  for(const file of sources)await client.query(file.text);
  prepared=true;
 }finally{if(!prepared)await client.query('ROLLBACK').catch(()=>{});client.release();if(!prepared)await writer.end();}
 return{writer,sourceDigest,sourceSha:pins.sourceSha,descriptor};
}
