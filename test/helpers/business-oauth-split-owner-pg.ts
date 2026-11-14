import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {prepareRequirementsFixture,requirementsFixture as fixture,requirementsFixturePool} from './requirements-stage-pg.ts';

export const splitOwners={auth:'lifeos_auth_test_bootstrap',provider:'lifeos_platform_candidate_migrator'} as const;
export const providerTables=['platform_oauth_client','platform_oauth_resource','platform_oauth_client_resource','platform_oauth_refresh_token','platform_oauth_access_token','platform_oauth_consent','platform_oauth_client_assertion','platform_oauth_jwks'] as const;
const files=['test/fixtures/business-oauth-split-owner.sql','db/0016_all_personal_business_policy.proposed.sql','test/fixtures/business-oauth-split-owner-acl.json'];
const fixtureId='business-oauth-split-owner-20261114';
type Queryable=Pick<Pool,'query'>|Pick<PoolClient,'query'>;

/** A separate source marker leaves the original requirements marker and digest untouched. */
export async function prepareSplitOwnerFixture(){
 assert.equal(process.env.RUN_BUSINESS_MCP_OAUTH_POSTGRES_TESTS,'1');
 assert.equal(process.env.LIFEOS_REQUIREMENTS_FIXTURE_CONTEXT,'ssh-loopback');
 await prepareRequirementsFixture();
 const sources=await Promise.all(files.map(async name=>({name,text:await readFile(name,'utf8')})));
 const digest=createHash('sha256').update(JSON.stringify(sources)).digest('hex'),admin=requirementsFixturePool('admin',1);
 try{
  const marker=(await admin.query("SELECT to_regclass('oauth_split_owner_fixture.identity') AS marker,to_regclass('lifeos_agent.business_policy_control') AS policy,to_regclass('lifeos_agent.oauth_business_control') AS oauth")).rows[0];
  if(marker.marker){assert.deepEqual((await admin.query('SELECT fixture_id,source_digest FROM oauth_split_owner_fixture.identity')).rows,[{fixture_id:fixtureId,source_digest:digest}]);return;}
  assert.equal(marker.policy,null,'Refuse another policy writer');assert.equal(marker.oauth,null,'Refuse unmarked OAuth schema');
  assert.deepEqual((await admin.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])',[Object.values(splitOwners)])).rows,[]);
  await admin.query(sources[0]!.text);
  const client=await admin.connect();try{await setOAuthMigrationContext(client);await client.query(sources[1]!.text);}finally{await client.query('RESET ROLE');client.release();}
  await admin.query('CREATE SCHEMA oauth_split_owner_fixture;REVOKE ALL ON SCHEMA oauth_split_owner_fixture FROM PUBLIC;CREATE TABLE oauth_split_owner_fixture.identity(fixture_id text NOT NULL,source_digest text NOT NULL)');
  await admin.query('INSERT INTO oauth_split_owner_fixture.identity VALUES($1,$2)',[fixtureId,digest]);
 }finally{await admin.end();}
}

export async function setOAuthMigrationContext(client:PoolClient){
 await client.query('SET ROLE lifeos_auth_test_bootstrap');
 await client.query("SET lifeos.agent_expected_database='lifeos_platform_test_local';SET lifeos.business_policy_approved='1';SET lifeos.business_mcp_oauth_approved='1'");
 await client.query("SELECT set_config('lifeos.agent_expected_owner',$1,false),set_config('lifeos.agent_expected_space',$2,false)",[fixture.ownerId,fixture.spaceId]);
}

/** Existing object metadata only. Excludes new OAuth objects and their intentional triggers. */
export async function existingMetadata(client:Queryable){
 return (await client.query(`SELECT jsonb_build_object(
  'schemas',(SELECT jsonb_agg(jsonb_build_array(nspname,nspowner,nspacl) ORDER BY nspname) FROM pg_namespace WHERE nspname IN('lifeos_agent','lifeos_platform')),
  'relations',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,(SELECT jsonb_agg(jsonb_build_array(attname,attacl) ORDER BY attnum) FROM pg_attribute WHERE attrelid=c.oid AND attnum>0 AND NOT attisdropped)) ORDER BY c.oid) FROM pg_class c WHERE c.relnamespace IN('lifeos_agent'::regnamespace,'lifeos_platform'::regnamespace) AND c.relkind='r' AND c.relname NOT LIKE '%oauth%'),
  'functions',(SELECT jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl,p.prosrc,p.proconfig,p.prosecdef) ORDER BY p.oid) FROM pg_proc p WHERE p.pronamespace IN('lifeos_agent'::regnamespace,'lifeos_platform'::regnamespace) AND p.proname NOT LIKE '%oauth%'),
  'roles',(SELECT jsonb_agg(jsonb_build_array(oid,rolname,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolbypassrls,rolreplication,rolcanlogin) ORDER BY oid) FROM pg_roles WHERE rolname NOT LIKE 'pg_%'),
  'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m),
  'defaultAcl',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.oid) FROM pg_default_acl a)
 ) AS value`)).rows[0].value;
}

/** The source fragment keeps its exact bytes; the caller supplies an explicit rollback transaction. */
export function providerDdl(source:string){
 const start=source.indexOf('CREATE TABLE lifeos_platform.platform_oauth_client('),end=source.indexOf('CREATE TABLE lifeos_agent.oauth_business_control(');
 assert.ok(start>0&&end>start);return source.slice(start,end);
}

export async function markCompleteOAuthMigration(admin:Queryable,source:string){
 const policy=await readFile('db/0016_all_personal_business_policy.proposed.sql','utf8');
 const digest=createHash('sha256').update(JSON.stringify([{name:'0016_all_personal_business_policy.proposed.sql',text:policy},{name:'0021_business_mcp_oauth.proposed.sql',text:source}])).digest('hex');
 await admin.query('CREATE SCHEMA business_oauth_fixture;REVOKE ALL ON SCHEMA business_oauth_fixture FROM PUBLIC;CREATE TABLE business_oauth_fixture.identity(fixture_id text NOT NULL,source_digest text NOT NULL)');
 await admin.query('INSERT INTO business_oauth_fixture.identity VALUES($1,$2)',['business-mcp-oauth-source-only-20261114',digest]);
}
