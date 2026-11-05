import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {prepareOrganizationFixture,fixturePool} from './organization-stage-pg.ts';
export {fixture,fixturePool} from './organization-stage-pg.ts';
/** Compose the existing target guard; no alternate target or server lifecycle. */
export async function prepareClassificationFixture(){
 if(process.env.RUN_CLASSIFICATION_POSTGRES_TESTS!=='1')throw Error('Explicit isolated classification fixture required');
 await prepareOrganizationFixture();
 const sql=await readFile('db/0012_todo_classification.proposed.sql','utf8'),sha256=createHash('sha256').update(sql).digest('hex');
 const admin=fixturePool('admin',1),runtime=fixturePool('runtime',1);
 try{
  for(const settings of ["SET lifeos.todo_classification_approved=''; SET lifeos.agent_expected_database='lifeos_platform_test_local'","SET lifeos.todo_classification_approved='1'; SET lifeos.agent_expected_database='wrong-target'"]){
   await admin.query(settings);await assert.rejects(admin.query(sql),/Explicit exact-target approval/);await admin.query('ROLLBACK');
  }
  await runtime.query("SET lifeos.todo_classification_approved='1'; SET lifeos.agent_expected_database='lifeos_platform_test_local'");
  await assert.rejects(runtime.query(sql),/Explicit exact-target approval/);await runtime.query('ROLLBACK');
  const present=(await admin.query("SELECT to_regclass('lifeos_platform.platform_classification_plan') AS installed")).rows[0].installed;
  if(!present){
   await admin.query("SET lifeos.todo_classification_approved='1'; SET lifeos.agent_expected_database='lifeos_platform_test_local'");await admin.query(sql);
   await admin.query('CREATE TABLE organization_fixture.classification_migration_evidence(sha256 text NOT NULL)');
   await admin.query('INSERT INTO organization_fixture.classification_migration_evidence VALUES($1)',[sha256]);
  }
  assert.equal((await admin.query('SELECT sha256 FROM organization_fixture.classification_migration_evidence')).rows[0]?.sha256,sha256,'Fixture migration differs: diagnose, never reset');
  return {sha256};
 }finally{await Promise.all([admin.end(),runtime.end()]);}
}
