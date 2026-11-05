import assert from 'node:assert/strict';
import type {Pool,PoolClient} from 'pg';
import {verifyClassificationClient} from '../../src/personal-candidate/classification-postgres.ts';

const platformOwner='classification_fixture_platform_owner';
const existingTables=['platform_meta','platform_source','platform_record','platform_history','platform_command'];
const serviceRoles=['lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap','lifeos_agent_issuer','lifeos_agent_verifier','lifeos_agent_key_manager'];

/** Run the actual proposed DDL inside rollback-only synthetic transactions.
 * Preserve the CI's finite leaf manifest: these prerequisites qualify its
 * existing classification suite, rather than adding an unexecuted test file. */
export async function qualifyClassificationMigrationOwners(admin:Pool,sql:string){
 assert.match(sql,/\nBEGIN;\n/,'Expected one explicit migration transaction');
 assert.match(sql,/\nCOMMIT;\s*$/,'Expected a final migration commit');
 const body=sql.replace('\nBEGIN;\n','\n').replace(/\nCOMMIT;\s*$/,'\n');
 assert.doesNotMatch(body,/(?:^|\n)(?:BEGIN|COMMIT|ROLLBACK);(?:\n|$)/,'A rollback-only probe must remove the migration transaction wrapper');
 const client=await admin.connect();
 const probe=async(run:(client:PoolClient)=>Promise<void>)=>{
  await client.query('BEGIN');
  try{
   await client.query(`CREATE ROLE ${platformOwner} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION`);
   await client.query(`ALTER SCHEMA lifeos_platform OWNER TO ${platformOwner}`);
   for(const table of existingTables)await client.query(`ALTER TABLE lifeos_platform.${table} OWNER TO ${platformOwner}`);
   await client.query("SELECT set_config('lifeos.todo_classification_approved','1',true),set_config('lifeos.agent_expected_database',current_database(),true),set_config('lifeos.todo_classification_expected_platform_owner',$1,true)",[platformOwner]);
   await run(client);
  }finally{await client.query('ROLLBACK');}
  assert.equal((await client.query("SELECT to_regclass('lifeos_platform.platform_classification_plan') AS installed")).rows[0].installed,null,'A qualification probe must leave no migration objects');
 };
 try{
  await probe(async c=>{
   const old=(await c.query("SELECT c.relname,c.relowner::text,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lifeos_platform' AND c.relname=ANY($1) ORDER BY c.relname",[existingTables])).rows;
   await c.query(body); // RED: the old guard incorrectly requires both owners to be current_user.
   assert.deepEqual((await c.query("SELECT c.relname,c.relowner::text,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lifeos_platform' AND c.relname=ANY($1) ORDER BY c.relname",[existingTables])).rows,old);
   assert.deepEqual((await c.query("SELECT p.proowner=(SELECT relowner FROM pg_class WHERE oid='lifeos_agent.apikey'::regclass) AS auth_owned,p.prosecdef,p.proconfig FROM pg_proc p WHERE p.oid='lifeos_platform.classification_producer_matches(text,text,text)'::regprocedure")).rows,[{auth_owned:true,prosecdef:true,proconfig:['search_path=pg_catalog, pg_temp']}]);
   assert.equal((await c.query('SELECT (SELECT count(*) FROM lifeos_platform.platform_classification_plan)+(SELECT count(*) FROM lifeos_platform.platform_classification_approval)+(SELECT count(*) FROM lifeos_platform.platform_classification_command) AS rows')).rows[0].rows,'0');
   await c.query('SET LOCAL ROLE lifeos_platform_candidate_runtime');
   await verifyClassificationClient(c);
  });
  for(const expected of ['', 'classification_fixture_unknown_owner','postgres',...serviceRoles])await probe(async c=>{
   // Matching object ownership must not make a service identity a migration owner.
   if(serviceRoles.includes(expected)){
    await c.query(`ALTER SCHEMA lifeos_platform OWNER TO ${expected}`);
    for(const table of existingTables)await c.query(`ALTER TABLE lifeos_platform.${table} OWNER TO ${expected}`);
   }
   await c.query("SELECT set_config('lifeos.todo_classification_expected_platform_owner',$1,true)",[expected]);
   await assert.rejects(c.query(body),/Qualified 0011 and restricted schema2 prerequisites required/,`Reject unqualified expected platform owner: ${expected||'empty'}`);
  });
  for(const mutation of [
   'ALTER SCHEMA lifeos_platform OWNER TO postgres',
   ...existingTables.map(table=>`ALTER TABLE lifeos_platform.${table} OWNER TO postgres`),
   'ALTER TABLE lifeos_platform.platform_record NO FORCE ROW LEVEL SECURITY',
   'ALTER TABLE lifeos_agent.key_management_binding RENAME TO fixture_hidden_binding',
   'ALTER TABLE lifeos_platform.platform_two_factor RENAME TO fixture_hidden_factor',
   'DROP FUNCTION lifeos_agent.set_managed_grant_scopes(text,text,text,jsonb)',
   `GRANT ${platformOwner} TO lifeos_agent_verifier`,
   'ALTER ROLE lifeos_agent_key_manager INHERIT',
  ])await probe(async c=>{
   await c.query(mutation);
   await assert.rejects(c.query(body),/Qualified 0011 and restricted schema2 prerequisites required/,mutation);
  });
  for(const role of serviceRoles)await probe(async c=>{
   await c.query('SET LOCAL ROLE '+role);
   await assert.rejects(c.query(body),/Explicit exact-target approval and independent migration owner required/,role);
  });
  await probe(async c=>{
   await c.query('SET LOCAL ROLE '+platformOwner);
   await assert.rejects(c.query(body),/Qualified 0011|permission denied/,'Platform ownership alone cannot substitute for auth ownership');
  });
 }finally{client.release();}
}
