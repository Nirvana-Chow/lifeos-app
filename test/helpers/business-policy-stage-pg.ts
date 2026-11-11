import assert from 'node:assert/strict';
import {realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {Pool} from 'pg';
type Facts={platform:string;execArgv:readonly string[];workingDirectory:string;workspaceDirectory:string;head:string};
export const policyCIPassword='fixture-policy-ci-never-live';
const roles=['postgres','lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap','lifeos_agent_issuer','lifeos_agent_verifier','lifeos_agent_key_manager'];
export function businessPolicyCIIdentity(env:Record<string,string|undefined>,facts:Facts){
 const fixtureId=`business-policy-ci-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
 if(env.RUN_BUSINESS_POLICY_POSTGRES_TESTS!=='1'||env.LIFEOS_FIXTURE_FRESH!=='approved-isolated-fixture'||
  env.LIFEOS_POLICY_FIXTURE_CONTEXT!=='github-actions'||facts.platform!=='linux'||env.CI!=='true'||env.GITHUB_ACTIONS!=='true'||
  env.GITHUB_REPOSITORY!=='Nirvana-Chow/lifeos-app'||env.CI_SOURCE_REPOSITORY!==env.GITHUB_REPOSITORY||
  !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID??'')||!/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT??'')||
  !/^[a-f0-9]{40}$/.test(env.SOURCE_SHA??'')||env.SOURCE_SHA!==env.CI_HEAD_SHA||env.SOURCE_SHA!==facts.head||
  !env.GITHUB_WORKSPACE||facts.workingDirectory!==facts.workspaceDirectory||!facts.execArgv.includes('--test-isolation=none')||
  env.LIFEOS_POLICY_FIXTURE_ID!==fixtureId||env.LIFEOS_POLICY_PG_BIN!==undefined||env.LIFEOS_POLICY_DATABASE_URL!==undefined)
  throw Error('Actual source-bound GitHub Actions policy fixture55449 required');
 return{fixtureId,identity:{repository:env.GITHUB_REPOSITORY,run_id:env.GITHUB_RUN_ID!,attempt:env.GITHUB_RUN_ATTEMPT!,source_sha:env.SOURCE_SHA!}};
}
/** A dedicated empty service, never the already initialized requirements/other fixtures. */
export function assertEmptyPolicyCICluster(facts:Record<string,unknown>):void{
 assert.match(String(facts.address),/^(?:10\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|192\.168\.)/);
 assert.deepEqual({...facts,address:'docker-private'},{data:'/var/lib/postgresql/data',version:'170011',database:'postgres',role:'postgres',address:'docker-private',port:5432,owner:'postgres',roles:[],databases:['postgres'],schemas:[]});
}
export async function prepareBusinessPolicyCI(){
 const env=process.env;if(!env.GITHUB_WORKSPACE)throw Error('Actual policy workspace required');
 const [workingDirectory,workspaceDirectory]=await Promise.all([realpath(process.cwd()),realpath(env.GITHUB_WORKSPACE)]);
 const binding=businessPolicyCIIdentity(env,{platform:process.platform,execArgv:process.execArgv,workingDirectory,workspaceDirectory,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()});
 const connect=(user='postgres',database='lifeos_platform_test_local')=>{
  if(!roles.includes(user)||!['postgres','lifeos_platform_test_local'].includes(database))throw Error('Fixed isolated policy connection required');
  return new Pool({host:'127.0.0.1',port:55449,database,user,password:user==='postgres'?'fixture-ci-admin-never-live':policyCIPassword,max:4,connectionTimeoutMillis:2000,statement_timeout:7000,lock_timeout:5000});
 };
 const initial=connect('postgres','postgres');
 try{
  const facts=(await initial.query(`SELECT current_setting('data_directory') AS data,current_setting('server_version_num') AS version,current_database() AS database,current_user AS role,host(inet_server_addr()) AS address,inet_server_port() AS port,(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) AS owner,
   ARRAY(SELECT rolname::text FROM pg_roles WHERE rolname NOT LIKE 'pg_%' AND rolname<>'postgres' ORDER BY rolname) AS roles,
   ARRAY(SELECT datname::text FROM pg_database WHERE NOT datistemplate ORDER BY datname) AS databases,
   ARRAY(SELECT nspname::text FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('public','information_schema') ORDER BY nspname) AS schemas`)).rows[0];
  assertEmptyPolicyCICluster(facts);
 }finally{await initial.end();}
 return{connect,managerURL:`postgresql://lifeos_agent_key_manager:${policyCIPassword}@127.0.0.1:55449/lifeos_platform_test_local`,bindDatabase:async(admin:Pool)=>{
  assert.equal((await admin.query('SELECT current_database() AS database')).rows[0].database,'lifeos_platform_test_local');
  assert.deepEqual((await admin.query("SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('public','information_schema')")).rows,[]);
  await admin.query('CREATE SCHEMA business_policy_fixture; REVOKE ALL ON SCHEMA business_policy_fixture FROM PUBLIC; CREATE TABLE business_policy_fixture.identity(fixture_id text NOT NULL,repository text NOT NULL,run_id text NOT NULL,attempt text NOT NULL,source_sha text NOT NULL)');
  await admin.query('INSERT INTO business_policy_fixture.identity VALUES($1,$2,$3,$4,$5)',[binding.fixtureId,...Object.values(binding.identity)]);
  assert.deepEqual((await admin.query('SELECT fixture_id,repository,run_id,attempt,source_sha FROM business_policy_fixture.identity')).rows,[{fixture_id:binding.fixtureId,...binding.identity}]);
 }};
}
