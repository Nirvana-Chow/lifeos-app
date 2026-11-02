import test from 'node:test';import assert from 'node:assert/strict';
import {PostgresCalendarRepository,verifyCalendarPool} from '../src/calendar-candidate/postgres.ts';
import type {SqlClient,SqlPool} from '../src/platform/postgres.ts';
import {CalendarService} from '../src/calendar-candidate/service.ts';
import {calendarInput} from './calendar-candidate-helpers.test.ts';
const core={role:'lifeos_platform_candidate_runtime',superuser:false,create_db:false,create_role:false,bypass_rls:false,memberships:0,owns_objects:0,can_create_schema:false,can_create_database:false,rls_tables:4,forced_tables:4,version:2};
const extension={version:1,rls_tables:3,forced_tables:3,required:true,excessive:false};
function fixture(respond:(sql:string,values:unknown[])=>{rows:Record<string,unknown>[];rowCount:number|null}=()=>({rows:[],rowCount:1})){
 const calls:{sql:string;values:unknown[]}[]=[];let released=0;const client:SqlClient={query:async(sql,values=[])=>{calls.push({sql,values});return respond(sql,values);},release:()=>{released++;}};
 const pool:SqlPool={connect:async()=>client};return{pool,calls,get released(){return released;}};
}
test('PG creation binds original input, shares source table, isolates owner and commits atomic history plus receipt',async()=>{
 const f=fixture(),service=new CalendarService(new PostgresCalendarRepository(f.pool)),input={...calendarInput,title:"x'); DROP TABLE platform_user; --"};
 const result=await service.create('owner-fixture',input,'calendar-pg-command');assert.equal(result.entry.title,input.title);
 const scope=f.calls.find(c=>c.sql.includes('set_config'));assert.deepEqual(scope?.values,['owner-fixture']);
 const lock=f.calls.find(c=>c.sql.includes('pg_advisory_xact_lock'));assert.deepEqual(lock?.values,[JSON.stringify(['calendar','owner-fixture','calendar-pg-command'])]);
 const source=f.calls.find(c=>c.sql.startsWith('INSERT INTO lifeos_platform.platform_source'));assert.equal(source?.values[0],'owner-fixture');assert.deepEqual(JSON.parse(source?.values[6] as string),input);
 assert.equal(f.calls.filter(c=>c.sql.startsWith('INSERT')).length,4);assert.equal(f.calls.some(c=>c.sql.includes(input.title)),false);assert.equal(f.calls.at(-1)?.sql,'COMMIT');assert.equal(f.released,1);
});
test('PG edit uses locked row and CAS; lost revision rolls back and releases',async()=>{
 const f=fixture(sql=>({rows:[],rowCount:sql.startsWith('UPDATE')?0:1})),repository=new PostgresCalendarRepository(f.pool);
 const entry={id:'1501884d-b5fe-4c29-9dc1-ded16a5a1111',ownerId:'owner-a',title:'synthetic',notes:'',schedule:{kind:'all-day' as const,startDate:'2026-10-23',endDate:'2026-10-24'},status:'planned' as const,revision:2,source:{id:'1501884d-b5fe-4c29-9dc1-ded16a5a2222',system:'website' as const,externalId:'calendar-fixture',version:1,asOf:'2026-10-23T00:00:00.000Z',original:{}},createdAt:'2026-10-23T00:00:00.000Z',updatedAt:'2026-10-23T00:00:00.000Z'};
 await assert.rejects(repository.transaction('owner-a','calendar-pg-command',async tx=>{await tx.get(entry.id);await tx.write(entry,{title:'synthetic'},false);}),(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code==='REVISION_CONFLICT');
 assert.match(f.calls.find(c=>c.sql.includes('FOR UPDATE'))!.sql,/FOR UPDATE OF e/);
 const update=f.calls.find(c=>c.sql.startsWith('UPDATE'))!;assert.match(update.sql,/revision=\$\d+/);assert.equal(update.values.at(-1),1);assert.equal(f.calls.at(-1)?.sql,'ROLLBACK');assert.equal(f.released,1);
});
test('PG read returns normalized dates and full export uses one consistent read transaction',async()=>{
 const row={id:'1501884d-b5fe-4c29-9dc1-ded16a5a1111',owner_id:'owner-a',title:'synthetic',notes:'',schedule_kind:'all-day',start_date:'2026-10-23',end_date:'2026-10-24',status:'cancelled',revision:2,source_id:'1501884d-b5fe-4c29-9dc1-ded16a5a2222',external_id:'event-fixture',source_version:1,as_of:new Date('2026-10-23T00:00:00Z'),original:calendarInput,created_at:new Date('2026-10-23T00:00:00Z'),updated_at:new Date('2026-10-23T00:00:00Z')};
 const f=fixture(sql=>({rows:sql.includes('JOIN lifeos_platform.platform_source')?[row]:[],rowCount:1})),repository=new PostgresCalendarRepository(f.pool);
 const snapshot=await repository.exportSnapshot('owner-a');assert.equal(snapshot.entries[0].status,'cancelled');assert.deepEqual(snapshot.entries[0].schedule,{kind:'all-day',startDate:'2026-10-23',endDate:'2026-10-24'});assert.equal(snapshot.entries[0].createdAt,'2026-10-23T00:00:00.000Z');assert.equal(f.calls[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(f.calls.at(-1)?.sql,'COMMIT');
});
test('extension verifier requires core v2, extension v1, forced RLS and no excessive grants',async()=>{
 const check=(coreValue=core,extensionValue:Record<string,unknown>=extension)=>{const f=fixture(sql=>({rows:[sql.includes('FROM pg_roles')?coreValue:extensionValue],rowCount:1}));return verifyCalendarPool(f.pool);};
 await assert.doesNotReject(check());
 await assert.rejects(check({...core,version:3}));
 for(const patch of [{version:2},{rls_tables:2},{forced_tables:2},{required:false},{excessive:true}])await assert.rejects(check(core,{...extension,...patch}));
});
