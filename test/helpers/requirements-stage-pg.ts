import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Pool} from 'pg';
export const requirementsFixture={ownerId:'requirements-fixture-owner',spaceId:'requirements-fixture-space',email:'requirements-fixture@example.test',database:'lifeos_platform_test_local',port:55452,origin:'https://requirements.example.test',sessionSecret:'fixture-requirements-session-never-live-0000',agentSecret:'fixture-requirements-agent-never-live-0000'} as const;
const roles={admin:['postgres','fixture-ci-admin-never-live'],runtime:['lifeos_platform_candidate_runtime','fixture-ci-runtime-never-live'],bootstrap:['lifeos_platform_candidate_bootstrap','fixture-ci-bootstrap-never-live'],issuer:['lifeos_agent_issuer','fixture-agent-issuer-never-live'],verifier:['lifeos_agent_verifier','fixture-agent-verifier-never-live'],manager:['lifeos_agent_key_manager','fixture-agent-manager-never-live']} as const;
export function requirementsFixturePool(role:keyof typeof roles,max=2){return new Pool({host:'127.0.0.1',port:requirementsFixture.port,database:requirementsFixture.database,user:roles[role][0],password:roles[role][1],max,connectionTimeoutMillis:2000,statement_timeout:10000,lock_timeout:8000,idle_in_transaction_session_timeout:15000,options:role==='verifier'||role==='manager'?'-c search_path=lifeos_agent,pg_catalog':'-c search_path=pg_catalog,lifeos_platform'});}
export function requirementsManagerURL(){const u=new URL('postgresql://127.0.0.1:55452/'+requirementsFixture.database);u.username=roles.manager[0];u.password=roles.manager[1];return u.href;}
const sqlFiles=['0001_platform_candidate.sql','0002_platform_inbox.sql','platform-synthetic-bootstrap-grants.proposed.sql','0009_owner_mfa.proposed.sql','0006_agent_api.proposed.sql','0010_agent_key_management.proposed.sql','0011_business_agent_grants.proposed.sql','0014_requirements_agent_grants.proposed.sql'];
type CIIdentity={repository:string;run_id:string;attempt:string;source_sha:string};
type CIFacts={platform:string;execArgv:readonly string[];workingDirectory:string;workspaceDirectory:string;head:string};
/** Pure preflight; the runtime wrapper supplies actual filesystem/Git facts. No network or DB actions. */
export function requirementsCIIdentity(env:Record<string,string|undefined>,facts:CIFacts):{fixtureId:string;identity:CIIdentity}{
 const fixtureId=`requirements-ci-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
 if(env.RUN_REQUIREMENTS_POSTGRES_TESTS!=='1'||env.LIFEOS_FIXTURE_FRESH!=='approved-isolated-fixture'||
  env.LIFEOS_REQUIREMENTS_FIXTURE_CONTEXT!=='github-actions'||facts.platform!=='linux'||env.CI!=='true'||env.GITHUB_ACTIONS!=='true'||
  env.GITHUB_REPOSITORY!=='Nirvana-Chow/lifeos-app'||env.CI_SOURCE_REPOSITORY!==env.GITHUB_REPOSITORY||
  !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID??'')||!/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT??'')||
  !/^[a-f0-9]{40}$/.test(env.SOURCE_SHA??'')||env.SOURCE_SHA!==env.CI_HEAD_SHA||env.SOURCE_SHA!==facts.head||
  !env.GITHUB_WORKSPACE||facts.workingDirectory!==facts.workspaceDirectory||!facts.execArgv.includes('--test-isolation=none')||
  env.LIFEOS_REQUIREMENTS_FIXTURE_ID!==fixtureId||['LIFEOS_REQUIREMENTS_FIXTURE_DATA_DIRECTORY','LIFEOS_REQUIREMENTS_FIXTURE_CONTAINER_ID','LIFEOS_REQUIREMENTS_FIXTURE_IMAGE_ID','LIFEOS_REQUIREMENTS_FIXTURE_FORWARD_SESSION'].some(key=>env[key]!==undefined))
  throw Error('Actual source-bound GitHub Actions requirements fixture55452 required');
 return{fixtureId,identity:{repository:env.GITHUB_REPOSITORY,run_id:env.GITHUB_RUN_ID!,attempt:env.GITHUB_RUN_ATTEMPT!,source_sha:env.SOURCE_SHA!}};
}
export async function assertRequirementsCIContext(){
 const env=process.env;if(!env.GITHUB_WORKSPACE)throw Error('Actual requirements workspace required');
 const [workingDirectory,workspaceDirectory]=await Promise.all([realpath(process.cwd()),realpath(env.GITHUB_WORKSPACE)]);
 return requirementsCIIdentity(env,{platform:process.platform,execArgv:process.execArgv,workingDirectory,workspaceDirectory,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()});
}
/** Dedicated runner service or explicitly declared local Docker/SSH target55452 only. */
export async function prepareRequirementsFixture(){
 const env=process.env;
 const ci=env.LIFEOS_REQUIREMENTS_FIXTURE_CONTEXT==='github-actions'?await assertRequirementsCIContext():null;
 if(!ci){
  if(env.RUN_REQUIREMENTS_POSTGRES_TESTS!=='1'||env.LIFEOS_FIXTURE_FRESH!=='approved-isolated-fixture'||!['local-docker','ssh-loopback'].includes(env.LIFEOS_REQUIREMENTS_FIXTURE_CONTEXT??'')||env.LIFEOS_REQUIREMENTS_FIXTURE_ID!=='requirements-source-only-20261105'||env.LIFEOS_REQUIREMENTS_FIXTURE_DATA_DIRECTORY!=='/var/lib/postgresql/data'||env.CI==='true'||env.GITHUB_ACTIONS==='true'||!process.execArgv.includes('--test-isolation=none'))throw Error('Separately declared isolated requirements Docker/SSH fixture55452 required');
  if(env.LIFEOS_REQUIREMENTS_FIXTURE_CONTEXT==='ssh-loopback'&&(!/^[a-f0-9]{12,64}$/.test(env.LIFEOS_REQUIREMENTS_FIXTURE_CONTAINER_ID??'')||!/^sha256:[a-f0-9]{64}$/.test(env.LIFEOS_REQUIREMENTS_FIXTURE_IMAGE_ID??'')||!env.LIFEOS_REQUIREMENTS_FIXTURE_FORWARD_SESSION))throw Error('Explicit remote Docker identity and active forward evidence required');
 }
 const fixtureId=ci?.fixtureId??'requirements-source-only-20261105';
 const admin=requirementsFixturePool('admin',1),files=await Promise.all(sqlFiles.map(async name=>({name,text:await readFile('db/'+name,'utf8')}))),sourceDigest=createHash('sha256').update(JSON.stringify(files)).digest('hex');
 try{
  const identity=(await admin.query(`SELECT current_setting('data_directory') AS data,current_setting('server_version_num') AS version,current_database() AS database,current_user AS role,host(inet_server_addr()) AS address,inet_server_port() AS port,(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) AS owner`)).rows[0];
  assert.match(identity.address,/^(?:10\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|192\.168\.)/);
  assert.deepEqual({...identity,address:'docker-private'},{data:'/var/lib/postgresql/data',version:'170011',database:requirementsFixture.database,role:'postgres',address:'docker-private',port:5432,owner:'postgres'});
  const marker=(await admin.query("SELECT to_regclass('requirements_fixture.identity') AS marker,to_regnamespace('lifeos_platform') AS platform")).rows[0];
  if(marker.marker){assert.deepEqual((await admin.query('SELECT fixture_id,source_digest FROM requirements_fixture.identity')).rows,[{fixture_id:fixtureId,source_digest:sourceDigest}]);if(ci)assert.deepEqual((await admin.query('SELECT repository,run_id,attempt,source_sha FROM requirements_fixture.ci_identity')).rows,[ci.identity]);return;}
  assert.equal(marker.platform,null,'Refuse existing target without exact fixture marker');
  assert.deepEqual((await admin.query("SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('public','information_schema')")).rows,[]);
  assert.deepEqual((await admin.query("SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg_%' AND rolname<>'postgres'")).rows,[]);
  await admin.query('CREATE SCHEMA requirements_fixture; REVOKE ALL ON SCHEMA requirements_fixture FROM PUBLIC; CREATE TABLE requirements_fixture.identity(fixture_id text NOT NULL,source_digest text NOT NULL)');
  if(ci){await admin.query('CREATE TABLE requirements_fixture.ci_identity(repository text NOT NULL,run_id text NOT NULL,attempt text NOT NULL,source_sha text NOT NULL)');await admin.query('INSERT INTO requirements_fixture.ci_identity VALUES($1,$2,$3,$4)',Object.values(ci.identity));}
  for(const[name,password]of Object.values(roles).slice(1))await admin.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION`);
  await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE CREATE ON DATABASE lifeos_platform_test_local FROM PUBLIC');
  await admin.query("SET lifeos.owner_mfa_migration_approved='native-totp-v1'; SET lifeos.agent_migration_approved='1'; SET lifeos.agent_expected_database='lifeos_platform_test_local'; SET lifeos.agent_business_grants_approved='1'; SET lifeos.requirements_grants_approved='1'");
  await admin.query("SELECT set_config('lifeos.agent_key_manager_owner',$1,false),set_config('lifeos.agent_key_manager_space',$2,false),set_config('lifeos.agent_key_management_approved','1',false),set_config('lifeos.agent_expected_owner',$1,false),set_config('lifeos.agent_expected_space',$2,false)",[requirementsFixture.ownerId,requirementsFixture.spaceId]);
  for(const {text}of files)await admin.query(text);
  await admin.query('INSERT INTO lifeos_platform.platform_user(id,name,email,"twoFactorEnabled") VALUES($1,$1,$2,true)',[requirementsFixture.ownerId,requirementsFixture.email]);
  await admin.query('INSERT INTO lifeos_platform.platform_two_factor(id,secret,"backupCodes","userId",verified) VALUES($1,$2,$3,$4,true)',['requirements-fixture-factor','synthetic-unused-factor','synthetic-unused-backup',requirementsFixture.ownerId]);
  await admin.query('INSERT INTO requirements_fixture.identity VALUES($1,$2)',[fixtureId,sourceDigest]);
 }finally{await admin.end();}
}
