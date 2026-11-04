import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Pool} from 'pg';

export const fixture={ownerId:'organization-fixture-owner',spaceId:'organization-fixture-space',
  email:'organization-fixture-owner@example.test',database:'lifeos_platform_test_local',port:55432,
  origin:'https://organization.example.test',sessionSecret:'fixture-organization-session-never-live-0000',
  agentSecret:'fixture-organization-agent-never-live-0000'} as const;
const roles={admin:['postgres','fixture-ci-admin-never-live'],runtime:['lifeos_platform_candidate_runtime','fixture-ci-runtime-never-live'],
  bootstrap:['lifeos_platform_candidate_bootstrap','fixture-ci-bootstrap-never-live'],issuer:['lifeos_agent_issuer','fixture-agent-issuer-never-live'],
  verifier:['lifeos_agent_verifier','fixture-agent-verifier-never-live'],manager:['lifeos_agent_key_manager','fixture-agent-manager-never-live']} as const;
export function fixturePool(role:keyof typeof roles,max=2){
  return new Pool({host:'127.0.0.1',port:fixture.port,database:fixture.database,user:roles[role][0],password:roles[role][1],max,
    connectionTimeoutMillis:2000,statement_timeout:10000,lock_timeout:8000,idle_in_transaction_session_timeout:15000,
    options:'-c search_path=pg_catalog,lifeos_platform'});
}
export function fixtureManagerURL(){const url=new URL('postgresql://127.0.0.1:55432/'+fixture.database);url.username=roles.manager[0];url.password=roles.manager[1];return url.href;}
/** A separate local qualification path. Never changes or impersonates the CI-only recovery/MFA runner. */
export async function prepareOrganizationFixture(){
  if(process.env.RUN_ORGANIZATION_POSTGRES_TESTS!=='1'||process.env.LIFEOS_FIXTURE_FRESH!=='approved-isolated-fixture'||
     !process.execArgv.includes('--test-isolation=none')||process.env.CI==='true'||process.env.GITHUB_ACTIONS==='true')
    throw Error('Explicit isolated local organization fixture required');
  const declared=process.env.LIFEOS_ORGANIZATION_FIXTURE_DATA_DIRECTORY;
  if(!declared||!/^\/private\/tmp\/lifeos-pg17\.[A-Za-z0-9]+\/data$/.test(declared))throw Error('Predeclared private data directory required');
  const tool=JSON.parse(await readFile('.superpowers/sdd/2026-11-05-organization-access/local-pg-tool.json','utf8'));
  assert.equal(declared,tool.root+'/data');assert.equal(tool.version,'17.11');assert.equal(tool.database,fixture.database);assert.equal(tool.port,fixture.port);
  const admin=fixturePool('admin',1);
  try{
    const identity=(await admin.query(`SELECT current_setting('data_directory') AS data,current_setting('server_version_num') AS version,
      current_database() AS database,current_user AS role,host(inet_server_addr()) AS address,inet_server_port() AS port,
      (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) AS owner`)).rows[0];
    assert.deepEqual(identity,{data:declared,version:'170011',database:fixture.database,role:'postgres',address:'127.0.0.1',port:55432,owner:'postgres'});
    const present=(await admin.query("SELECT to_regclass('organization_fixture.identity') AS marker,to_regnamespace('lifeos_platform') AS platform")).rows[0];
    if(present.marker){
      assert.deepEqual((await admin.query('SELECT data_path,database_name FROM organization_fixture.identity')).rows,[{data_path:declared,database_name:fixture.database}]);
    }else{
      assert.equal(present.platform,null,'Refuse to initialize an existing fixture');
      assert.deepEqual((await admin.query("SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('public','information_schema')")).rows,[]);
      assert.deepEqual((await admin.query("SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg_%' AND rolname<>'postgres'")).rows,[]);
      await admin.query('CREATE SCHEMA organization_fixture; REVOKE ALL ON SCHEMA organization_fixture FROM PUBLIC');
      await admin.query('CREATE TABLE organization_fixture.identity(data_path text NOT NULL,database_name text NOT NULL)');
      await admin.query('INSERT INTO organization_fixture.identity VALUES ($1,$2)',[declared,fixture.database]);
      for(const [name,password]of Object.values(roles).slice(1))
        await admin.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION`);
      await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE CREATE ON DATABASE lifeos_platform_test_local FROM PUBLIC');
      await admin.query("SET lifeos.calendar_migration_approved='1'; SET lifeos.chat_migration_approved='1'");
      for(const name of ['0001_platform_candidate.sql','0002_platform_inbox.sql','0003_ai_settings.proposed.sql','0004_calendar.proposed.sql','0005_ai_chat.proposed.sql','platform-synthetic-bootstrap-grants.proposed.sql'])
        await admin.query(await readFile('db/'+name,'utf8'));
      await admin.query("SET lifeos.owner_mfa_migration_approved='native-totp-v1'");
      await admin.query(await readFile('db/0009_owner_mfa.proposed.sql','utf8'));
      await admin.query("SET lifeos.agent_migration_approved='1'; SET lifeos.agent_expected_database='lifeos_platform_test_local'");
      await admin.query(await readFile('db/0006_agent_api.proposed.sql','utf8'));
      await admin.query("SELECT set_config('lifeos.agent_key_manager_owner',$1,false),set_config('lifeos.agent_key_manager_space',$2,false),set_config('lifeos.agent_key_management_approved','1',false)",[fixture.ownerId,fixture.spaceId]);
      await admin.query(await readFile('db/0010_agent_key_management.proposed.sql','utf8'));
      await admin.query('INSERT INTO lifeos_platform.platform_user(id,name,email,"twoFactorEnabled") VALUES($1,$1,$2,true)',[fixture.ownerId,fixture.email]);
      await admin.query('INSERT INTO lifeos_platform.platform_two_factor(id,secret,"backupCodes","userId",verified) VALUES($1,$2,$3,$4,true)',
        ['organization-fixture-factor','synthetic-unused-factor','synthetic-unused-backup',fixture.ownerId]);
    }
    const proposed=await readFile('db/0011_business_agent_grants.proposed.sql','utf8').catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return null;throw error;});
    if(proposed&&!(await admin.query("SELECT to_regprocedure('lifeos_agent.assert_business_grant(text,text,text,text[])') AS installed")).rows[0].installed){
      await admin.query("SET lifeos.agent_expected_database='lifeos_platform_test_local'; SET lifeos.agent_business_grants_approved='1'");
      await admin.query(proposed);
      await admin.query('CREATE TABLE organization_fixture.migration_evidence(sha256 text NOT NULL)');
      await admin.query('INSERT INTO organization_fixture.migration_evidence VALUES($1)',[createHash('sha256').update(proposed).digest('hex')]);
    }
    if(proposed)assert.equal((await admin.query('SELECT sha256 FROM organization_fixture.migration_evidence')).rows[0]?.sha256,createHash('sha256').update(proposed).digest('hex'),'Fixture migration differs from candidate; diagnose instead of reset');
  }finally{await admin.end();}
}
