import assert from 'node:assert/strict';import {readFile}from'node:fs/promises';import {createHash}from'node:crypto';
import {prepareRequirementsFixture,requirementsFixturePool}from'./requirements-stage-pg.ts';
/** Reuse the existing exact SSH/container/PG17.11/empty-target proof; never another DB port. */
export async function prepareBusinessOAuthFixture(){
 assert.equal(process.env.RUN_BUSINESS_MCP_OAUTH_POSTGRES_TESTS,'1');
 assert.equal(process.env.LIFEOS_REQUIREMENTS_FIXTURE_CONTEXT,'ssh-loopback');
 await prepareRequirementsFixture();
 const files=await Promise.all(['0016_all_personal_business_policy.proposed.sql','0021_business_mcp_oauth.proposed.sql'].map(async name=>({name,text:await readFile('db/'+name,'utf8')}))),digest=createHash('sha256').update(JSON.stringify(files)).digest('hex');
 const admin=requirementsFixturePool('admin',1);
 try{
  const marker=(await admin.query("SELECT to_regclass('business_oauth_fixture.identity') AS marker,to_regclass('lifeos_agent.oauth_business_control') AS oauth,to_regclass('lifeos_agent.business_policy_control') AS policy")).rows[0];
  if(marker.marker){assert.deepEqual((await admin.query('SELECT fixture_id,source_digest FROM business_oauth_fixture.identity')).rows,[{fixture_id:'business-mcp-oauth-source-only-20261114',source_digest:digest}]);return;}
  assert.equal(marker.oauth,null,'Refuse unmarked OAuth schema');assert.equal(marker.policy,null,'Refuse another policy qualification writer');
  await admin.query("SET lifeos.agent_expected_database='lifeos_platform_test_local';SET lifeos.business_policy_approved='1';SET lifeos.business_mcp_oauth_approved='1'");
  const binding=(await admin.query('SELECT owner_id,space_id FROM lifeos_agent.key_management_binding')).rows[0];
  await admin.query("SELECT set_config('lifeos.agent_expected_owner',$1,false),set_config('lifeos.agent_expected_space',$2,false)",[binding.owner_id,binding.space_id]);
  for(const file of files)await admin.query(file.text);
  await admin.query('CREATE SCHEMA business_oauth_fixture;REVOKE ALL ON SCHEMA business_oauth_fixture FROM PUBLIC;CREATE TABLE business_oauth_fixture.identity(fixture_id text NOT NULL,source_digest text NOT NULL)');
  await admin.query('INSERT INTO business_oauth_fixture.identity VALUES($1,$2)',['business-mcp-oauth-source-only-20261114',digest]);
 }finally{await admin.end();}
}
