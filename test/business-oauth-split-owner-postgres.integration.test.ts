import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {oauthSqlFingerprints} from '../src/business-mcp-oauth/sql-fingerprints.ts';
import {verifyBusinessOAuthPool} from '../src/business-mcp-oauth/readiness.ts';
import {requirementsFixture as fixture,requirementsFixturePool as pool} from './helpers/requirements-stage-pg.ts';
import {existingMetadata,markCompleteOAuthMigration,prepareSplitOwnerFixture,providerDdl,providerTables,setOAuthMigrationContext,splitOwners} from './helpers/business-oauth-split-owner-pg.ts';

const optIn={skip:process.env.RUN_BUSINESS_MCP_OAUTH_POSTGRES_TESTS!=='1'&&'Explicit fresh SSH-loopback split-owner fixture required; PostgreSQL not executed',timeout:30000};
const source=()=>readFile('db/0021_business_mcp_oauth.proposed.sql','utf8');
const config={resource:'https://lifeos.nirvanachow.com/api/platform/mcp',issuer:'https://lifeos.nirvanachow.com/api/platform/auth',grantId:'synthetic-split-owner-grant',scopes:['todo:read','todo:write','offline_access']};
const owner={ownerId:fixture.ownerId,ownerEmail:fixture.email,spaceId:fixture.spaceId};
const ownerQuery=`SELECT c.relname,pg_get_userbyid(c.relowner) AS owner,pg_get_userbyid(t.typowner) AS type_owner,
 (SELECT bool_and(i.relowner=c.relowner) FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid WHERE x.indrelid=c.oid) AS index_owners
 FROM pg_class c JOIN pg_type t ON t.oid=c.reltype WHERE c.relnamespace='lifeos_platform'::regnamespace AND c.relname=ANY($1::text[]) ORDER BY c.relname`;

test('provider DDL follows the actual identity owner under the split owning migration role',optIn,async()=>{
 await prepareSplitOwnerFixture();const admin=pool('admin',1),client=await admin.connect();
 try{
  await setOAuthMigrationContext(client);const before=await existingMetadata(client);
  await client.query('BEGIN');await client.query(providerDdl(await source()));
  const rows=(await client.query(ownerQuery,[providerTables])).rows;
  assert.equal(rows.length,8);
  assert.deepEqual(rows.map(r=>({name:r.relname,owner:r.owner,typeOwner:r.type_owner,indexOwners:r.index_owners})),[...providerTables].sort().map(name=>({name,owner:splitOwners.provider,typeOwner:splitOwners.provider,indexOwners:true})),
   'Provider tables, row types and indexes must follow platform_user owner, not the distinct apikey migration owner');
  await client.query('ROLLBACK');assert.deepEqual(await existingMetadata(client),before);
 }finally{await client.query('ROLLBACK').catch(()=>{});await client.query('RESET ROLE');client.release();await admin.end();}
});

test('provider DDL rejects an identity owner without schema CREATE and rolls back every new object',optIn,async()=>{
 await prepareSplitOwnerFixture();const admin=pool('admin',1),client=await admin.connect();
 try{
  await setOAuthMigrationContext(client);const before=await existingMetadata(client);
  await client.query('BEGIN');
  await client.query('REVOKE CREATE ON SCHEMA lifeos_platform FROM lifeos_platform_candidate_migrator');
  await assert.rejects(client.query(providerDdl(await source())),{message:'Existing identity owner must be a qualified provider object owner'});
  await client.query('ROLLBACK');
  assert.equal((await client.query("SELECT to_regclass('lifeos_platform.platform_oauth_client') AS relation")).rows[0].relation,null);
  assert.deepEqual(await existingMetadata(client),before);
 }finally{await client.query('ROLLBACK').catch(()=>{});await client.query('RESET ROLE');client.release();await admin.end();}
});

test('complete fixed migration qualifies split owners without changing existing owners roles or ACLs',optIn,async t=>{
 await prepareSplitOwnerFixture();const admin=pool('admin',1),runtime=pool('runtime',1),client=await admin.connect();
 try{
  await setOAuthMigrationContext(client);
  const before=await existingMetadata(client);
  const roles=(await client.query(`SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolbypassrls,rolreplication,rolcanlogin,
   (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS memberships FROM pg_roles r WHERE rolname=ANY($1::text[]) ORDER BY rolname`,[Object.values(splitOwners)])).rows;
  assert.deepEqual(roles,[{rolname:splitOwners.auth,rolsuper:true,rolcreatedb:true,rolcreaterole:true,rolinherit:true,rolbypassrls:true,rolreplication:true,rolcanlogin:true,memberships:0},{rolname:splitOwners.provider,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolinherit:false,rolbypassrls:false,rolreplication:false,rolcanlogin:false,memberships:0}]);
  const expectedAcl=JSON.parse(await readFile('test/fixtures/business-oauth-split-owner-acl.json','utf8'));
  const actualAcl=(await client.query(`SELECT n.nspname||'.'||c.relname AS name,pg_get_userbyid(c.relowner) AS owner,
   (SELECT jsonb_agg(jsonb_build_object('grantable',a.is_grantable,'grantee',pg_get_userbyid(a.grantee),'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type) ORDER BY pg_get_userbyid(a.grantee),a.privilege_type) FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a) AS acl,
   COALESCE((SELECT jsonb_object_agg(attname,attacl::text) FROM pg_attribute WHERE attrelid=c.oid AND attnum>0 AND NOT attisdropped AND attacl IS NOT NULL),'{}'::jsonb) AS "columnAcl"
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname||'.'||c.relname=ANY($1::text[])`,[Object.keys(expectedAcl)])).rows;
  assert.deepEqual(Object.fromEntries(actualAcl.map(({name,...metadata})=>[name,metadata])),expectedAcl,'Synthetic existing table/column ACLs reproduce the reviewed catalog projection');
  assert.equal((await client.query('SELECT count(*)::int AS count FROM pg_default_acl')).rows[0].count,0,'Actual catalog has no extra creator default ACL');
  const sql=await source();await client.query(sql); // Exact complete BEGIN/COMMIT source, no stripped transaction commands.
  assert.deepEqual(await existingMetadata(client),before,'No preexisting owner, schema ACL, role, membership, table/column ACL or function changed');
  await markCompleteOAuthMigration(client,sql);
  await t.test('all eight provider tables row types and indexes use the identity owner',async()=>{
   const rows=(await client.query(ownerQuery,[providerTables])).rows;assert.equal(rows.length,8);
   assert.ok(rows.every(r=>r.owner===splitOwners.provider&&r.type_owner===splitOwners.provider&&r.index_owners===true));
  });
  await t.test('provider ACLs have only their owning role and the four reviewed runtime privileges',async()=>{
   const rows=(await client.query(`SELECT c.relname,pg_get_userbyid(a.grantee) AS grantee,a.privilege_type,a.is_grantable FROM pg_class c
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    WHERE c.relnamespace='lifeos_platform'::regnamespace AND c.relname=ANY($1::text[]) ORDER BY c.relname,grantee,a.privilege_type`,[providerTables])).rows;
   for(const name of providerTables){const acl=rows.filter(r=>r.relname===name);assert.ok(acl.every(r=>r.grantee===splitOwners.provider||r.grantee==='lifeos_platform_candidate_runtime'&&!r.is_grantable));assert.deepEqual(acl.filter(r=>r.grantee==='lifeos_platform_candidate_runtime').map(r=>r.privilege_type),['DELETE','INSERT','SELECT','UPDATE']);}
   assert.equal((await client.query(`SELECT count(*)::int AS count FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relname=ANY($1::text[]) AND c.relnamespace='lifeos_platform'::regnamespace AND a.attnum>0 AND a.attacl IS NOT NULL`,[providerTables])).rows[0].count,0);
  });
  await t.test('private objects and exact function fingerprints remain owned by the apikey owner',async()=>{
   const privateRows=(await client.query(`SELECT relname,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relnamespace='lifeos_agent'::regnamespace AND relkind='r' AND relname LIKE 'oauth_business_%'`)).rows;
   assert.equal(privateRows.length,4);assert.ok(privateRows.every(r=>r.owner===splitOwners.auth));
   const functions=(await client.query(`SELECT proname,pg_get_userbyid(proowner) AS owner,encode(sha256(convert_to(prosrc,'UTF8')),'hex') AS digest FROM pg_proc WHERE pronamespace='lifeos_agent'::regnamespace AND proname=ANY($1::text[])`,[Object.keys(oauthSqlFingerprints)])).rows;
   assert.deepEqual(Object.fromEntries(functions.map(r=>[r.proname,r.digest])),oauthSqlFingerprints);assert.ok(functions.every(r=>r.owner===splitOwners.auth));
   for(const table of ['oauth_business_control','oauth_business_binding','oauth_business_token','oauth_business_operation'])await assert.rejects(runtime.query('SELECT * FROM lifeos_agent.'+table),{code:'42501'});
  });
  await t.test('restricted readiness qualifies schema and remains closed before owner activation',async()=>{
   await assert.rejects(verifyBusinessOAuthPool(runtime,config,owner),{message:'BUSINESS_MCP_OAUTH_ACTIVATION_UNAVAILABLE'});
  });
  await t.test('private read or extra function execute privileges fail existing readiness checks',async()=>{
   try{
    await client.query('GRANT SELECT ON lifeos_agent.oauth_business_token TO lifeos_platform_candidate_runtime');
    await assert.rejects(verifyBusinessOAuthPool(runtime,config,owner),{message:'BUSINESS_MCP_OAUTH_SCHEMA_UNAVAILABLE'});
   }finally{await client.query('REVOKE SELECT ON lifeos_agent.oauth_business_token FROM lifeos_platform_candidate_runtime');}
   try{
    await client.query('GRANT EXECUTE ON FUNCTION lifeos_agent.oauth_business_activation() TO lifeos_agent_verifier');
    await assert.rejects(verifyBusinessOAuthPool(runtime,config,owner),{message:'BUSINESS_MCP_OAUTH_SCHEMA_UNAVAILABLE'});
   }finally{await client.query('REVOKE EXECUTE ON FUNCTION lifeos_agent.oauth_business_activation() FROM lifeos_agent_verifier');}
   await assert.rejects(verifyBusinessOAuthPool(runtime,config,owner),{message:'BUSINESS_MCP_OAUTH_ACTIVATION_UNAVAILABLE'});
  });
 }finally{await client.query('ROLLBACK').catch(()=>{});await client.query('RESET ROLE');client.release();await Promise.allSettled([admin.end(),runtime.end()]);}
});
