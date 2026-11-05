import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateAcceptanceEnvironment} from './helpers/platform-pg.ts';
import {PostgresPlatformRepository,verifyRestrictedPool,type SqlPool} from '../src/platform/postgres.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import {PersonalCalendarService} from '../src/calendar-candidate/personal-service.ts';
import {calendarFields} from './helpers/personal-calendar-port.ts';

// Reuse the existing explicitly approved, pre-migrated synthetic schema2 target.
// This test does not create schemas/roles/grants or execute any migration SQL.
test('OPT-IN owner calendar uses existing restricted schema2 grants, CAS, receipts and independent readback',{
 skip:process.env.RUN_PERSONAL_CALENDAR_OWNER_POSTGRES_TESTS!=='1'&&'No approved isolated schema2 owner calendar target',timeout:45000,
},async()=>{
 const platform=validateAcceptanceEnvironment(process.env,process.execArgv);
 const {Pool}=await import('pg');
 const open=()=>new Pool({connectionString:platform.databaseURL,max:3,connectionTimeoutMillis:2000,statement_timeout:5000,lock_timeout:3000,idle_in_transaction_session_timeout:5000,options:'-c search_path=pg_catalog,lifeos_platform'});
 const pool=open();let readPool:InstanceType<typeof Pool>|undefined;
 const config={ownerId:platform.ownerId,ownerEmail:platform.ownerEmail,spaceId:'synthetic-calendar-owner-space',databaseName:new URL(platform.databaseURL).pathname.slice(1),baseURL:platform.baseURL,approval:'personal-manual-v1',allowedTypes:['todo','journal','project','domain','topic'],calendarEnabled:true} as const;
 const service=(p:InstanceType<typeof Pool>)=>new PersonalCalendarService(new PersonalService(new PostgresPlatformRepository(p as SqlPool,true),config),{ownerId:config.ownerId,spaceId:config.spaceId,enabled:true,writable:true});
 const body=(revision?:number,title='Synthetic owner calendar')=>({spaceId:config.spaceId,confirmed:true,fields:{...calendarFields,title,text:'字'.repeat(16384)},...(revision?{expectedRevision:revision}:{})});
 try{
  await verifyRestrictedPool(pool as SqlPool);
  const acl=await pool.query(`SELECT
   has_table_privilege(current_user,'lifeos_platform.platform_source','SELECT') AND has_table_privilege(current_user,'lifeos_platform.platform_source','INSERT') AND
   has_table_privilege(current_user,'lifeos_platform.platform_record','SELECT') AND has_table_privilege(current_user,'lifeos_platform.platform_record','INSERT') AND
   has_table_privilege(current_user,'lifeos_platform.platform_history','SELECT') AND has_table_privilege(current_user,'lifeos_platform.platform_history','INSERT') AND
   has_table_privilege(current_user,'lifeos_platform.platform_command','SELECT') AND has_table_privilege(current_user,'lifeos_platform.platform_command','INSERT') AND
   has_column_privilege(current_user,'lifeos_platform.platform_record','draft','UPDATE') AND
   has_column_privilege(current_user,'lifeos_platform.platform_record','revision','UPDATE') AND
   has_column_privilege(current_user,'lifeos_platform.platform_record','updated_at','UPDATE') AS required,
   has_table_privilege(current_user,'lifeos_platform.platform_record','DELETE') OR
   has_table_privilege(current_user,'lifeos_platform.platform_source','UPDATE,DELETE') OR
   has_table_privilege(current_user,'lifeos_platform.platform_history','UPDATE,DELETE') OR
   has_table_privilege(current_user,'lifeos_platform.platform_command','UPDATE,DELETE') AS excessive`);
  assert.deepEqual(acl.rows,[{required:true,excessive:false}]);
  const calendar=service(pool),key=randomUUID();
  const [a,b]=await Promise.all([calendar.mutate(config.ownerId,null,body(),key),calendar.mutate(config.ownerId,null,body(),key)]);
  assert.equal(a.entry.id,b.entry.id);assert.notEqual(a.duplicate,b.duplicate);
  const outcomes=await Promise.allSettled([calendar.mutate(config.ownerId,a.entry.id,body(1,'Synthetic CAS A'),randomUUID()),calendar.mutate(config.ownerId,a.entry.id,body(1,'Synthetic CAS B'),randomUUID())]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((outcomes.find(x=>x.status==='rejected') as PromiseRejectedResult).reason.code,'REVISION_CONFLICT');
  readPool=open();await verifyRestrictedPool(readPool as SqlPool);const reloaded=service(readPool),record=await reloaded.get(config.ownerId,a.entry.id);
  assert.equal(record.revision,2);assert.equal(record.fields.text.length,16384);assert.deepEqual(record.source,a.entry.source);
  const history=await reloaded.history(config.ownerId,record.id);assert.equal(history.entries.length,2);assert.equal(history.complete,true);
  const unscoped=await readPool.query('SELECT id FROM lifeos_platform.platform_record WHERE id=$1',[record.id]);assert.equal(unscoped.rowCount,0);
  await assert.rejects(reloaded.get('fixture-owner-b',record.id),{code:'OWNER_ONLY'});
  await assert.rejects(readPool.query('CREATE TABLE lifeos_platform.synthetic_calendar_forbidden(id integer)'),{code:'42501'});
 }finally{await Promise.all([pool.end(),readPool?.end()]);}
});
