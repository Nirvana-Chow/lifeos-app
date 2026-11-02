import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresCaptureRunRepository,verifyCaptureRunPool} from '../src/capture-runs-candidate/postgres.ts';
import type {CaptureRun} from '../src/capture-runs-candidate/contracts.ts';
import type {SqlPool,SqlClient} from '../src/platform/postgres.ts';

const owner="capture-fixture-owner-a'); SELECT synthetic; --",id='91000000-0000-4000-8000-000000000001';
const initial:CaptureRun={id,ownerId:owner,kind:'todo',adapter:'ai',sourceHash:'a'.repeat(64),provenance:{provider:'volcengine-ark',model:'synthetic-model',configurationRevision:3,materialRevision:2,mode:'synthetic-sdk-test'},revision:1,state:'pending',createdAt:'2026-10-23T20:00:00.000Z',updatedAt:'2026-10-23T20:00:00.000Z',confirmationHash:null,record:null};
const ready:CaptureRun={...initial,revision:2,state:'ready',updatedAt:'2026-10-23T20:00:01.000Z'};
const dbRow=(value:CaptureRun=initial):Record<string,unknown>=>({id:value.id,owner_id:value.ownerId,kind:value.kind,adapter:value.adapter,source_hash:value.sourceHash,provenance:structuredClone(value.provenance),revision:value.revision,state:value.state,created_at:new Date(value.createdAt),updated_at:new Date(value.updatedAt),confirmation_hash:value.confirmationHash,record:structuredClone(value.record)});
const isRead=(sql:string)=>sql.startsWith('SELECT ')&&sql.includes('FROM lifeos_platform.platform_capture_run');
function fixture(respond:(sql:string,values:unknown[])=>{rows:Record<string,unknown>[];rowCount:number|null}=()=>({rows:[],rowCount:1})){
 const calls:{sql:string;values:unknown[]}[]=[];let released=0;
 const client:SqlClient={query:async(sql,values=[])=>{calls.push({sql,values});return respond(sql,values);},release(){released++;}};
 return{pool:{connect:async()=>client} as SqlPool,calls,get released(){return released;}};
}

test('capture run get is owner-scoped read-only and normalizes a UUID before SQL',async()=>{
 const f=fixture(sql=>({rows:isRead(sql)?[dbRow()]:[],rowCount:1}));
 assert.deepEqual(await new PostgresCaptureRunRepository(f.pool).get(owner,id.toUpperCase()),initial);
 assert.equal(f.calls[0].sql,'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');assert.deepEqual(f.calls.find(call=>call.sql.includes('set_config'))?.values,[owner]);
 const read=f.calls.find(call=>isRead(call.sql));assert.ok(read);assert.match(read.sql,/WHERE owner_id=\$1 AND id=\$2/);assert.deepEqual(read.values,[owner,id]);
 assert.equal(f.calls.some(call=>call.sql.includes(owner)||/^(INSERT|UPDATE|DELETE)/.test(call.sql)),false);assert.equal(f.calls.at(-1)?.sql,'COMMIT');assert.equal(f.released,1);
});

test('missing metadata returns null; invalid ID has no SQL side effects',async()=>{
 const f=fixture(),repository=new PostgresCaptureRunRepository(f.pool);assert.equal(await repository.get(owner,id),null);
 const before=f.calls.length;await assert.rejects(repository.get(owner,'invalid-id'));await assert.rejects(repository.change(owner,'invalid-id',()=>initial));assert.equal(f.calls.length,before);
});

test('get rejects foreign, wrong identity, malformed or ambiguous metadata rows',async()=>{
 for(const rows of [[dbRow({...initial,ownerId:'another-owner'})],[dbRow({...initial,id:'91000000-0000-4000-8000-000000000099'})],[{...dbRow(),source_hash:'not-a-sha'}],[{...dbRow(),state:'completed'}],[dbRow(),dbRow()]]){
  const f=fixture(sql=>({rows:isRead(sql)?rows:[],rowCount:1}));await assert.rejects(new PostgresCaptureRunRepository(f.pool).get(owner,id));assert.equal(f.calls.at(-1)?.sql,'ROLLBACK');assert.equal(f.released,1);
 }
});

test('change reserves metadata under one transaction lock and inserts only parameterized digests and configuration',async()=>{
 const f=fixture();let previous:CaptureRun|null|undefined;
 assert.deepEqual(await new PostgresCaptureRunRepository(f.pool).change(owner,id,value=>{previous=value;return initial;}),initial);assert.equal(previous,null);
 assert.equal(f.calls[0].sql,'BEGIN ISOLATION LEVEL READ COMMITTED');
 const lock=f.calls.findIndex(call=>call.sql.includes('pg_advisory_xact_lock')),read=f.calls.findIndex(call=>isRead(call.sql));assert.ok(lock>0&&lock<read);
 assert.deepEqual(f.calls[lock].values,[JSON.stringify(['capture-run',owner,id])]);assert.match(f.calls[read].sql,/owner_id=\$1 AND id=\$2 FOR UPDATE/);assert.deepEqual(f.calls[read].values,[owner,id]);
 const insert=f.calls.find(call=>call.sql.startsWith('INSERT'));assert.ok(insert);assert.deepEqual(insert.values,[owner,id,'todo','ai',initial.sourceHash,JSON.stringify(initial.provenance),1,'pending',initial.createdAt,initial.updatedAt,null,null]);
 assert.equal(f.calls.some(call=>call.sql.includes(owner)||call.sql.includes(initial.sourceHash)),false);assert.equal(f.calls.at(-1)?.sql,'COMMIT');assert.equal(f.released,1);
});

test('change locks the previous row and CAS-updates only mutable state columns',async()=>{
 const f=fixture(sql=>({rows:isRead(sql)?[dbRow()]:[],rowCount:1}));
 assert.deepEqual(await new PostgresCaptureRunRepository(f.pool).change(owner,id,previous=>{assert.deepEqual(previous,initial);return ready;}),ready);
 const update=f.calls.find(call=>call.sql.startsWith('UPDATE'));assert.ok(update);assert.match(update.sql,/SET revision=\$3,state=\$4,updated_at=\$5,confirmation_hash=\$6,record=\$7::jsonb/);assert.match(update.sql,/WHERE owner_id=\$1 AND id=\$2 AND revision=\$8/);
 assert.deepEqual(update.values,[owner,id,2,'ready',ready.updatedAt,null,null,1]);assert.doesNotMatch(update.sql,/SET[^]*\b(source_hash|provenance|kind|adapter|created_at)\s*=/);assert.equal(f.calls.at(-1)?.sql,'COMMIT');
});

test('idempotent same-value callback makes no write even when object keys are reordered',async()=>{
 const f=fixture(sql=>({rows:isRead(sql)?[dbRow(ready)]:[],rowCount:1}));
 const result=await new PostgresCaptureRunRepository(f.pool).change(owner,id,previous=>({...previous!,provenance:{mode:'synthetic-sdk-test',materialRevision:2,configurationRevision:3,model:'synthetic-model',provider:'volcengine-ark'}}));
 assert.deepEqual(result,ready);assert.equal(f.calls.some(call=>/^(INSERT|UPDATE)/.test(call.sql)),false);assert.equal(f.calls.at(-1)?.sql,'COMMIT');
});

test('immutable metadata cannot be changed including by mutating the callback argument in place',async()=>{
 const changes:Partial<CaptureRun>[]=[{id:'91000000-0000-4000-8000-000000000099'},{ownerId:'another-owner'},{kind:'life'},{adapter:'manual',provenance:null},{sourceHash:'b'.repeat(64)},{provenance:{...initial.provenance!,configurationRevision:4}},{createdAt:'2026-10-23T19:00:00.000Z'}];
 for(const patch of changes){
  const f=fixture(sql=>({rows:isRead(sql)?[dbRow()]:[],rowCount:1}));await assert.rejects(new PostgresCaptureRunRepository(f.pool).change(owner,id,previous=>Object.assign(previous!,ready,patch)));assert.equal(f.calls.some(call=>/^(INSERT|UPDATE)/.test(call.sql)),false);assert.equal(f.calls.at(-1)?.sql,'ROLLBACK');
 }
});

test('new metadata must start pending at revision one with one creation timestamp',async()=>{
 for(const value of [ready,{...initial,updatedAt:ready.updatedAt},{...initial,ownerId:'another-owner'},{...initial,prompt:'synthetic forbidden text'}]){
  const f=fixture();await assert.rejects(new PostgresCaptureRunRepository(f.pool).change(owner,id,()=>value));assert.equal(f.calls.some(call=>call.sql.startsWith('INSERT')),false);assert.equal(f.calls.at(-1)?.sql,'ROLLBACK');
 }
});

test('changed metadata requires exactly one revision increment and nondecreasing time',async()=>{
 for(const value of [{...ready,revision:1},{...ready,revision:3},{...ready,updatedAt:'2026-10-23T19:59:59.000Z'}]){
  const f=fixture(sql=>({rows:isRead(sql)?[dbRow()]:[],rowCount:1}));await assert.rejects(new PostgresCaptureRunRepository(f.pool).change(owner,id,()=>value));assert.equal(f.calls.some(call=>call.sql.startsWith('UPDATE')),false);assert.equal(f.calls.at(-1)?.sql,'ROLLBACK');
 }
});

test('confirmation metadata stores only a hash and exact record reference, never a result payload',async()=>{
 const pending:CaptureRun={...ready,state:'confirmation-pending',revision:3,confirmationHash:'b'.repeat(64),updatedAt:'2026-10-23T20:00:02.000Z'},record={kind:'todo' as const,id:'91000000-0000-4000-8000-000000000002',sourceId:'91000000-0000-4000-8000-000000000003',revision:1 as const};
 const f=fixture(sql=>({rows:isRead(sql)?[dbRow(pending)]:[],rowCount:1})),confirmed:CaptureRun={...pending,state:'confirmed',revision:4,record,updatedAt:'2026-10-23T20:00:03.000Z'};
 assert.deepEqual(await new PostgresCaptureRunRepository(f.pool).change(owner,id,()=>confirmed),confirmed);const update=f.calls.find(call=>call.sql.startsWith('UPDATE'));assert.ok(update);assert.equal(update.values[5],pending.confirmationHash);assert.equal(update.values[6],JSON.stringify(record));
 const invalid=fixture(sql=>({rows:isRead(sql)?[{...dbRow(confirmed),record:{...record,text:'unexpected synthetic payload'}}]:[],rowCount:1}));await assert.rejects(new PostgresCaptureRunRepository(invalid.pool).get(owner,id));
});

test('failed insert or lost CAS cannot claim committed state and always rolls back and releases',async()=>{
 for(const previous of [null,initial])for(const count of [0,null,2]){
  const f=fixture(sql=>({rows:isRead(sql)&&previous?[dbRow(previous)]:[],rowCount:/^(INSERT|UPDATE)/.test(sql)?count:1}));
  await assert.rejects(new PostgresCaptureRunRepository(f.pool).change(owner,id,()=>previous?ready:initial),{code:'CAPTURE_RUN_CONFLICT'});assert.equal(f.calls.at(-1)?.sql,'ROLLBACK');assert.equal(f.released,1);assert.equal(f.calls.some(call=>call.sql==='COMMIT'),false);
 }
 const f=fixture();await assert.rejects(new PostgresCaptureRunRepository(f.pool).change(owner,id,()=>{throw new Error('synthetic callback failure');}),/synthetic callback failure/);assert.equal(f.calls.at(-1)?.sql,'ROLLBACK');assert.equal(f.released,1);
});

test('capture run verifier is read-only and rejects unsafe core, missing grants, widened grants and nonexact RLS',async()=>{
 const core={role:'lifeos_platform_candidate_runtime',superuser:false,create_db:false,create_role:false,bypass_rls:false,memberships:0,owns_objects:0,can_create_schema:false,can_create_database:false,rls_tables:4,forced_tables:4,version:2};
 const extension={version:1,rls_tables:1,forced_tables:1,owner_policies:1,policies:1,required:true,excessive:false};
 const run=(patch:Record<string,unknown>={},corePatch:Record<string,unknown>={})=>{const f=fixture(sql=>({rows:[sql.includes('FROM pg_roles')?{...core,...corePatch}:{...extension,...patch}],rowCount:1}));return{f,promise:verifyCaptureRunPool(f.pool)};};
 const good=run();await good.promise;assert.equal(good.f.calls.length,2);assert.ok(good.f.calls.every(call=>call.sql.startsWith('SELECT ')));assert.equal(good.f.released,2);
 const sql=good.f.calls[1].sql;assert.match(sql,/has_column_privilege/);assert.match(sql,/has_any_column_privilege/);assert.match(sql,/pg_policy/);assert.match(sql,/polwithcheck/);
 for(const patch of [{version:2},{rls_tables:0},{forced_tables:0},{owner_policies:0},{policies:2},{required:false},{excessive:true}])await assert.rejects(run(patch).promise);
 for(const patch of [{bypass_rls:true},{owns_objects:1},{superuser:true},{memberships:1},{can_create_schema:true}])await assert.rejects(run({},patch).promise);
});
