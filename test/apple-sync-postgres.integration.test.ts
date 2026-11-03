import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const fixtureEnv={RUN_APPLE_SYNC_POSTGRES_TESTS:'1',LIFEOS_PLATFORM_CANDIDATE:'1',LIFEOS_PLATFORM_TARGET:'isolated-test',LIFEOS_PLATFORM_BASE_URL:'http://127.0.0.1:3190',LIFEOS_PLATFORM_OWNER_ID:'fixture-owner-a',LIFEOS_PLATFORM_OWNER_EMAIL:'fixture@example.invalid',LIFEOS_PLATFORM_SECRET:'fixture-ci-session-key-never-live-00000000',LIFEOS_PLATFORM_TEST_DATABASE_URL:'postgresql://lifeos_platform_candidate_runtime:fixture-ci-runtime-never-live@127.0.0.1:55432/lifeos_platform_test_local',LIFEOS_PLATFORM_TEST_APPROVAL:'approved-isolated-fixtures'};
async function fixtureModule(){assert.equal(existsSync(new URL('./helpers/apple-sync-postgres-fixture.ts',import.meta.url)),true,'exact-target Apple sync fixture helper is missing');return import('./helpers/apple-sync-postgres-fixture.ts');}
test('Apple sync PG gate rejects nonexplicit flags, target/role/identity drift and a nondedicated runner before connecting',async()=>{
 const {readAppleSyncAcceptance}=await fixtureModule();assert.equal(readAppleSyncAcceptance(fixtureEnv,['--test-isolation=none']).ownerId,'fixture-owner-a');
 for(const patch of [{RUN_APPLE_SYNC_POSTGRES_TESTS:undefined},{RUN_APPLE_SYNC_POSTGRES_TESTS:'true'},{LIFEOS_PLATFORM_TEST_APPROVAL:''},{LIFEOS_PLATFORM_OWNER_ID:'actual-owner'},{LIFEOS_PLATFORM_OWNER_EMAIL:'actual@example.com'},{LIFEOS_PLATFORM_TEST_DATABASE_URL:fixtureEnv.LIFEOS_PLATFORM_TEST_DATABASE_URL.replace('55432','5432')},{LIFEOS_PLATFORM_TEST_DATABASE_URL:fixtureEnv.LIFEOS_PLATFORM_TEST_DATABASE_URL.replace('test_local','test_other')},{LIFEOS_PLATFORM_TEST_DATABASE_URL:fixtureEnv.LIFEOS_PLATFORM_TEST_DATABASE_URL.replace('candidate_runtime','candidate_bootstrap')},{LIFEOS_PLATFORM_TEST_DATABASE_URL:fixtureEnv.LIFEOS_PLATFORM_TEST_DATABASE_URL+'?sslmode=require'}])assert.throws(()=>readAppleSyncAcceptance({...fixtureEnv,...patch},['--test-isolation=none']));
 assert.throws(()=>readAppleSyncAcceptance(fixtureEnv,[]));
});
import {randomUUID} from 'node:crypto';
import {PostgresSyncRepository,verifyAppleSyncPool} from '../src/apple-sync-candidate/postgres.ts';
import type {SyncPrincipal,SyncMapping} from '../src/apple-sync-candidate/store-contracts.ts';
import type {SqlPool} from '../src/platform/postgres.ts';
import {DraftService} from '../src/platform/service.ts';
import {CalendarService} from '../src/calendar-candidate/service.ts';
import {canonicalDigest} from '../src/apple-sync-candidate/domain.ts';
const enabled=process.env.RUN_APPLE_SYNC_POSTGRES_TESTS==='1';
const optIn={skip:enabled?false:'Exact pre-migrated PostgreSQL 17.11 synthetic Apple sync target not explicitly approved; NOT executed',timeout:90000};
const clock=()=>new Date().toISOString();
const batch=()=>'fixture-apple-sync-'+randomUUID();
function principal(spaceId:string,ownerId='fixture-owner-a'):SyncPrincipal{return{ownerId,spaceId,bridgeId:'fixture-bridge',identityEpoch:'fixture-epoch-1',scopes:['sync:read','sync:write']};}
const tables=['platform_sync_cursor','platform_sync_lease','platform_sync_outbox','platform_sync_mapping','platform_sync_command','platform_sync_conflict'] as const;
function syntheticMapping(p:SyncPrincipal,entry:{id:string;source:{id:string};revision:number}):SyncMapping{return{id:randomUUID(),ownerId:p.ownerId,spaceId:p.spaceId,bridgeId:p.bridgeId,kind:'todo',entityId:entry.id,sourceId:entry.source.id,version:1,businessRevision:entry.revision,nativeIdentity:{storeEpoch:'fixture-store',sourceId:'fixture-account',containerId:'fixture-container',itemId:entry.id,externalId:null,aliases:[],seriesId:null,originalOccurrenceDate:null},baseline:{title:{kind:'known',value:'Synthetic only'}},nativeHash:canonicalDigest({synthetic:true,id:entry.id}),status:'active',evidence:{synthetic:true}};}

// All tests below use already migrated, separately bootstrapped synthetic fixtures.
// They retain synthetic rows. They contain no DDL/admin connection/role/grant setup.
test('OPT-IN real PG17.11 sync migration readiness, owner FORCE RLS and least grants across actual retained rows',optIn,async t=>{
 const {openAppleSyncFixture,fixtureOwner,issuedDeliveryFixture,deliveryArchiveFixture}=await fixtureModule(),{pool}=await openAppleSyncFixture(process.env,process.execArgv),space=batch();
 try{
  const p=principal(space),other=principal(space,'fixture-owner-b');
  const create=async(p:SyncPrincipal,suffix:string)=>new PostgresSyncRepository(pool as SqlPool,p).transaction(p,space+'-'+suffix,async tx=>{
   const lease=await tx.claimLease(clock(),300),result=await new DraftService(tx.platform).mutate(p.ownerId,'todo',null,{title:'Synthetic sync RLS '+suffix},space+'-todo-'+suffix),mapping=syntheticMapping(p,result.entry);
   await tx.saveMapping(mapping,null);await tx.saveConflict({id:randomUUID(),mappingId:mapping.id,kind:'fixture-evidence',evidence:{synthetic:true},createdAt:clock()});const delivery=issuedDeliveryFixture(p,result.entry);await tx.saveReceipt({digest:canonicalDigest({suffix}),result:deliveryArchiveFixture(delivery)});await tx.saveDelivery(null,delivery);return{lease,result,mapping,delivery};
  });
  const a=await create(p,'a'),b=await create(other,'b');
  await verifyAppleSyncPool(pool as SqlPool);
  const guard=(await pool.query("SELECT m.delivery_shape_digest,encode(sha256(convert_to(c.conbin::text||':'||c.conkey::text,'UTF8')),'hex') AS actual,ARRAY(SELECT a.attname::text FROM unnest(c.conkey) k(attnum) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY a.attname) AS columns FROM lifeos_platform.platform_sync_meta m JOIN pg_constraint c ON c.conrelid='lifeos_platform.platform_sync_lease'::regclass AND c.conname='sync_delivery_shape' AND c.contype='c' AND c.convalidated")).rows;
  assert.equal(guard.length,1);assert.match(guard[0].delivery_shape_digest,/^[0-9a-f]{64}$/);assert.equal(guard[0].actual,guard[0].delivery_shape_digest);assert.deepEqual(guard[0].columns,['active_delivery','bridge_id','identity_epoch','owner_id','space_id']);
  for(const table of tables){assert.equal(Number((await pool.query('SELECT count(*) AS n FROM lifeos_platform.'+table)).rows[0].n),0,'Forced RLS hides unscoped actual '+table);await fixtureOwner(pool,p.ownerId,async c=>{const rows=(await c.query('SELECT DISTINCT owner_id FROM lifeos_platform.'+table+' WHERE space_id=$1',[space])).rows;assert.deepEqual(rows,[{owner_id:p.ownerId}],'RLS filters foreign owner without an owner predicate: '+table);});}
  const repo=new PostgresSyncRepository(pool as SqlPool,p);
  await assert.rejects(repo.transaction(other,space+'-wrong-owner',async()=>{}),e=>!!e&&typeof e==='object'&&'code'in e&&e.code==='SYNC_PRINCIPAL_INVALID');
  await repo.transaction(p,space+'-foreign-mapping',async tx=>{await tx.requireLease(a.lease.fence,clock());assert.equal(await tx.getMapping(b.mapping.id),null);await assert.rejects(tx.saveMapping({...b.mapping,ownerId:p.ownerId},null),e=>!!e&&typeof e==='object'&&'code'in e&&e.code==='SYNC_MAPPING_BINDING');});
  await repo.transaction(p,space+'-delivery-read',async tx=>{await tx.requireLease(a.lease.fence,clock());assert.deepEqual(await tx.readDelivery(),a.delivery);});
  const afterExpiry=new Date(Date.now()+600000).toISOString();
  for(const changed of [{...p,bridgeId:'fixture-other-bridge'},{...p,identityEpoch:'fixture-epoch-2'}])await assert.rejects(repo.transaction(changed,space+'-handover-'+(changed.bridgeId===p.bridgeId?'epoch':'bridge'),tx=>tx.claimLease(afterExpiry,60)),e=>!!e&&typeof e==='object'&&'code'in e&&e.code==='SYNC_LEASE_HANDOVER_REQUIRED');
  // Raw SQL cannot bypass the owner/space/bridge/epoch/size shape CHECK.
  for(const payload of [{}, {...a.delivery,binding:{...a.delivery.binding,bridgeId:'other-bridge'}}, {...a.delivery,intent:{...a.delivery.intent,expectedFields:{notes:{kind:'known',value:'x'.repeat(262145)}}}}])await assert.rejects(fixtureOwner(pool,p.ownerId,c=>c.query('UPDATE lifeos_platform.platform_sync_lease SET active_delivery=$3::jsonb WHERE owner_id=$1 AND space_id=$2',[p.ownerId,space,JSON.stringify(payload)])),e=>!!e&&typeof e==='object'&&'code'in e&&e.code==='23514');
  for(const sql of ["UPDATE lifeos_platform.platform_sync_outbox SET snapshot='{}'::jsonb WHERE false","UPDATE lifeos_platform.platform_sync_mapping SET owner_id='fixture-owner-b' WHERE false","UPDATE lifeos_platform.platform_sync_lease SET owner_id='fixture-owner-b' WHERE false","UPDATE lifeos_platform.platform_history SET raw='{}'::jsonb WHERE false","DELETE FROM lifeos_platform.platform_sync_command WHERE false","TRUNCATE lifeos_platform.platform_sync_conflict","INSERT INTO lifeos_platform.platform_sync_meta(version) VALUES(1)","UPDATE lifeos_platform.platform_sync_meta SET delivery_shape_digest=repeat('0',64) WHERE false"]){await assert.rejects(pool.query(sql),e=>!!e&&typeof e==='object'&&'code'in e&&e.code==='42501');}
  t.diagnostic(JSON.stringify({space,postgres:'17.11',core:2,calendar:1,sync:1,forceRlsActual:true,restrictedRuntimeActual:true,syntheticRowsRetained:true,migrationAppliedByExternalFixtureSetup:true}));
 }finally{await pool.end();}
});

test('OPT-IN real PG numeric outbox pull/ACK preserves 1..12, 9→10, 99→100 and integers beyond Number safety',optIn,async t=>{
 const {openAppleSyncFixture,fixtureOwner}=await fixtureModule(),{pool}=await openAppleSyncFixture(process.env,process.execArgv),space=batch(),p=principal(space),repo=new PostgresSyncRepository(pool as SqlPool,p);
 try{
  const lease=await repo.transaction(p,space+'-create',async tx=>{const lease=await tx.claimLease(clock(),300);for(let i=1;i<=102;i++)await new DraftService(tx.platform).mutate(p.ownerId,'todo',null,{title:'Synthetic numeric cursor '+i},space+'-todo-'+i);return lease;});
  await repo.transaction(p,space+'-ack',async tx=>{
   await tx.requireLease(lease.fence,clock());assert.deepEqual((await tx.pull('0',12)).map(row=>row.cursor),Array.from({length:12},(_,i)=>String(i+1)));
   assert.equal((await tx.advanceCursor(lease.fence,'1',clock())).ackCursor,'1');await assert.rejects(tx.advanceCursor(lease.fence,'10',clock()),e=>!!e&&typeof e==='object'&&'code'in e&&e.code==='SYNC_ACK_NOT_NEXT');
   for(let i=2;i<=102;i++)assert.equal((await tx.advanceCursor(lease.fence,String(i),clock())).ackCursor,String(i));
   assert.deepEqual((await tx.pull('8',4)).map(row=>row.cursor),['9','10','11','12']);assert.deepEqual((await tx.pull('98',4)).map(row=>row.cursor),['99','100','101','102']);
  });
  for(const base of ['9007199254740991','99999999999999999999']){
   const s=batch(),q=principal(s),expected=[String(BigInt(base)+1n),String(BigInt(base)+2n)];
   // Test-only synthetic acknowledged high-water prefix: production protocol never
   // seeds or jumps cursors. Subsequent values are allocated by the real capture hook.
   await fixtureOwner(pool,q.ownerId,async c=>{await c.query('INSERT INTO lifeos_platform.platform_sync_cursor(owner_id,space_id,published) VALUES($1,$2,$3::numeric)',[q.ownerId,s,base]);await c.query('INSERT INTO lifeos_platform.platform_sync_lease(owner_id,space_id,bridge_id,identity_epoch,fence,expires_at,ack_cursor) VALUES($1,$2,$3,$4,1,$5,$6::numeric)',[q.ownerId,s,q.bridgeId,q.identityEpoch,new Date(Date.now()+300000).toISOString(),base]);});
   await new PostgresSyncRepository(pool as SqlPool,q).transaction(q,s+'-large',async tx=>{await tx.requireLease('1',clock());for(let i=0;i<2;i++)await new DraftService(tx.platform).mutate(q.ownerId,'todo',null,{title:'Synthetic large cursor '+i},s+'-todo-'+i);assert.deepEqual((await tx.pull(base,10)).map(row=>row.cursor),expected);await assert.rejects(tx.advanceCursor('1',expected[1],clock()),e=>!!e&&typeof e==='object'&&'code'in e&&e.code==='SYNC_ACK_NOT_NEXT');for(const value of expected)assert.equal((await tx.advanceCursor('1',value,clock())).ackCursor,value);});
  }
  t.diagnostic(JSON.stringify({space,numericRows:102,cursorBoundaries:['9→10','99→100','9007199254740991→9007199254740992','99999999999999999999→100000000000000000000'],realPostgresSort:true,syntheticRowsRetained:true}));
 }finally{await pool.end();}
});

test('OPT-IN real PG one-connection business history/outbox/receipts roll back together with no cursor gap',optIn,async t=>{
 const {openAppleSyncFixture,fixtureOwner,traceFixturePool,issuedDeliveryFixture,deliveryArchiveFixture,retiredDeliveryFixture}=await fixtureModule(),{pool}=await openAppleSyncFixture(process.env,process.execArgv),space=batch(),p=principal(space),trace=traceFixturePool(pool),repo=new PostgresSyncRepository(trace.pool,p);
 let failedTodo='',failedCalendar='',failedSources:string[]=[];
 try{
  await assert.rejects(repo.transaction(p,space+'-rollback',async tx=>{
   await tx.claimLease(clock(),300);const todo=await new DraftService(tx.platform).mutate(p.ownerId,'todo',null,{title:'Synthetic rolled back todo'},space+'-failed-todo');const calendar=await new CalendarService(tx.calendar).create(p.ownerId,{title:'Synthetic rolled back event',notes:'',schedule:{kind:'all-day',startDate:'2026-11-03',endDate:'2026-11-04'}},space+'-failed-calendar');failedTodo=todo.entry.id;failedCalendar=calendar.entry.id;failedSources=[todo.entry.source.id,calendar.entry.source.id];const delivery=issuedDeliveryFixture(p,todo.entry);await tx.saveReceipt({digest:canonicalDigest({rollback:true}),result:deliveryArchiveFixture(delivery)});await tx.saveDelivery(null,delivery);throw Error('SYNTHETIC_OUTER_ROLLBACK');
  }),/SYNTHETIC_OUTER_ROLLBACK/);
  await fixtureOwner(pool,p.ownerId,async c=>{
   const row=(await c.query(`SELECT (SELECT count(*)::int FROM lifeos_platform.platform_record WHERE id=$1) AS todo,(SELECT count(*)::int FROM lifeos_platform.platform_calendar_event WHERE id=$2) AS calendar,(SELECT count(*)::int FROM lifeos_platform.platform_source WHERE id=ANY($3::uuid[])) AS sources,(SELECT count(*)::int FROM lifeos_platform.platform_history WHERE record_id=$1) AS todo_history,(SELECT count(*)::int FROM lifeos_platform.platform_calendar_history WHERE event_id=$2) AS calendar_history,(SELECT count(*)::int FROM lifeos_platform.platform_command WHERE command_key=$4) AS todo_receipt,(SELECT count(*)::int FROM lifeos_platform.platform_calendar_command WHERE command_key=$5) AS calendar_receipt,(SELECT count(*)::int FROM lifeos_platform.platform_sync_outbox WHERE space_id=$6) AS outbox,(SELECT count(*)::int FROM lifeos_platform.platform_sync_command WHERE space_id=$6) AS sync_receipt,(SELECT count(*)::int FROM lifeos_platform.platform_sync_cursor WHERE space_id=$6) AS cursor`,[failedTodo,failedCalendar,failedSources,space+'-failed-todo',space+'-failed-calendar',space])).rows[0];assert.deepEqual(row,{todo:0,calendar:0,sources:0,todo_history:0,calendar_history:0,todo_receipt:0,calendar_receipt:0,outbox:0,sync_receipt:0,cursor:0});
  });
  trace.calls.length=0;
  const result=await repo.transaction(p,space+'-success',async tx=>{await tx.claimLease(clock(),300);const todo=await new DraftService(tx.platform).mutate(p.ownerId,'todo',null,{title:'Synthetic committed todo'},space+'-todo');const event=await new CalendarService(tx.calendar).create(p.ownerId,{title:'Synthetic committed calendar',notes:'',schedule:{kind:'all-day',startDate:'2026-11-03',endDate:'2026-11-04'}},space+'-calendar');const delivery=issuedDeliveryFixture(p,todo.entry);await tx.saveReceipt({digest:canonicalDigest({ok:true}),result:deliveryArchiveFixture(delivery)});await tx.saveDelivery(null,delivery);return{todo,event,delivery};});
  assert.equal(new Set(trace.calls.map(call=>call.pid)).size,1,'Outer sync and both unchanged business services use one actual backend');assert.equal(trace.calls.filter(call=>call.sql.startsWith('BEGIN')).length,1);assert.equal(trace.calls.filter(call=>call.sql==='COMMIT').length,1);
  await fixtureOwner(pool,p.ownerId,async c=>{const rows=(await c.query('SELECT cursor::text,entity_id::text FROM lifeos_platform.platform_sync_outbox WHERE space_id=$1 ORDER BY cursor::numeric',[space])).rows;assert.deepEqual(rows,[{cursor:'1',entity_id:result.todo.entry.id},{cursor:'2',entity_id:result.event.entry.id}]);assert.equal((await c.query('SELECT published::text FROM lifeos_platform.platform_sync_cursor WHERE space_id=$1',[space])).rows[0].published,'2');assert.equal(Number((await c.query('SELECT count(*) AS n FROM lifeos_platform.platform_sync_command WHERE space_id=$1',[space])).rows[0].n),1);assert.equal(Number((await c.query('SELECT count(*) AS n FROM lifeos_platform.platform_history WHERE record_id=$1',[result.todo.entry.id])).rows[0].n),1);assert.equal(Number((await c.query('SELECT count(*) AS n FROM lifeos_platform.platform_calendar_history WHERE event_id=$1',[result.event.entry.id])).rows[0].n),1);});
  // A caught logical CAS failure still forces outer rollback, including its archive.
  const retired=retiredDeliveryFixture(result.delivery);
  await assert.rejects(repo.transaction(p,space+'-bad-cas',async tx=>{await tx.requireLease('1',clock());await tx.saveReceipt({digest:canonicalDigest(retired),result:deliveryArchiveFixture(retired)});await assert.rejects(tx.saveDelivery('0',retired),e=>!!e&&typeof e==='object'&&'code'in e&&e.code==='SYNC_DELIVERY_CAS');}),e=>!!e&&typeof e==='object'&&'code'in e&&e.code==='SYNC_DELIVERY_CAS');
  await fixtureOwner(pool,p.ownerId,async c=>{assert.equal(Number((await c.query('SELECT count(*) AS n FROM lifeos_platform.platform_sync_command WHERE space_id=$1 AND command_key=$2',[space,space+'-bad-cas'])).rows[0].n),0);assert.deepEqual((await c.query('SELECT active_delivery FROM lifeos_platform.platform_sync_lease WHERE space_id=$1',[space])).rows[0].active_delivery,result.delivery);});
  for(const scenario of ['archive-mismatch','invalid-next'] as const){
   const key=space+'-'+scenario,archive=scenario==='archive-mismatch'?{...result.delivery,attemptId:randomUUID()}:result.delivery,next=scenario==='invalid-next'?{...result.delivery,version:'0'}:result.delivery,code=scenario==='archive-mismatch'?'SYNC_DELIVERY_ARCHIVE_REQUIRED':'SYNC_DELIVERY_COUNTER',expected=(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code===code;
   await assert.rejects(repo.transaction(p,key,async tx=>{await tx.requireLease('1',clock());await tx.saveReceipt({digest:canonicalDigest(archive),result:deliveryArchiveFixture(archive)});await assert.rejects(tx.saveDelivery(null,next),expected);}),expected);
   await fixtureOwner(pool,p.ownerId,async c=>{assert.equal(Number((await c.query('SELECT count(*) AS n FROM lifeos_platform.platform_sync_command WHERE space_id=$1 AND command_key=$2',[space,key])).rows[0].n),0);assert.deepEqual((await c.query('SELECT active_delivery FROM lifeos_platform.platform_sync_lease WHERE space_id=$1',[space])).rows[0].active_delivery,result.delivery);});
  }
  await repo.transaction(p,space+'-retire',async tx=>{await tx.requireLease('1',clock());await tx.saveReceipt({digest:canonicalDigest(retired),result:deliveryArchiveFixture(retired)});await tx.saveDelivery('1',retired);});
  const future=new Date(Date.now()+600000).toISOString();
  await assert.rejects(repo.transaction({...p,identityEpoch:'fixture-epoch-2'},space+'-terminal-handover',tx=>tx.claimLease(future,60)),e=>!!e&&typeof e==='object'&&'code'in e&&e.code==='SYNC_LEASE_HANDOVER_REQUIRED');
  const next=issuedDeliveryFixture(p,result.todo.entry,'3');
  await repo.transaction(p,space+'-replacement',async tx=>{await tx.requireLease('1',clock());await tx.saveReceipt({digest:canonicalDigest(next),result:deliveryArchiveFixture(next)});await tx.saveDelivery('2',next);});
  await repo.transaction(p,space+'-success',async tx=>{assert.deepEqual((await tx.receipt())!.result,deliveryArchiveFixture(result.delivery));assert.deepEqual(await tx.readDelivery(),next);});
  await repo.transaction(p,space+'-renew',async tx=>{const lease=await tx.claimLease(future,60);assert.equal(lease.fence,'2');assert.deepEqual(await tx.readDelivery(),next);});
  t.diagnostic(JSON.stringify({space,sameBackendActual:true,rollbackVisibilityActual:true,cursorsAfterRollback:['1','2'],syntheticRowsRetained:true}));
 }finally{await pool.end();}
});

test('OPT-IN real PG two connections serialize cursor publication until COMMIT or ROLLBACK and release the next writer',optIn,async t=>{
 const {openAppleSyncFixture,fixtureOwner,traceFixturePool,deferred,bounded,requireAdvisoryWait,issuedDeliveryFixture,deliveryArchiveFixture,retiredDeliveryFixture}=await fixtureModule(),{pool}=await openAppleSyncFixture(process.env,process.execArgv);
 try{
  for(const rollback of [false,true]){
   const space=batch(),p=principal(space),first=traceFixturePool(pool),second=traceFixturePool(pool),ready=deferred<{id:string;fence:string}>(),release=deferred<void>();let secondEntered=false;
   const one=new PostgresSyncRepository(first.pool,p).transaction(p,space+'-first',async tx=>{const lease=await tx.claimLease(clock(),300);const result=await new DraftService(tx.platform).mutate(p.ownerId,'todo',null,{title:'Synthetic concurrent first'},space+'-todo-first');const delivery=issuedDeliveryFixture(p,result.entry);await tx.saveReceipt({digest:canonicalDigest({first:true}),result:deliveryArchiveFixture(delivery)});await tx.saveDelivery(null,delivery);ready.resolve({id:result.entry.id,fence:lease.fence});await release.promise;if(rollback)throw Error('SYNTHETIC_CONCURRENT_ROLLBACK');return result.entry.id;});
   const firstSettled=one.then(value=>({ok:true as const,value}),error=>({ok:false as const,error}));let secondSettled:Promise<{ok:true;value:string}|{ok:false;error:unknown}>|undefined;
   try{
    const initial=await bounded(ready.promise),firstPid=await bounded(first.connected);
    const two=new PostgresSyncRepository(second.pool,p).transaction(p,space+'-second',async tx=>{secondEntered=true;if(rollback)await tx.claimLease(clock(),300);else await tx.requireLease(initial.fence,clock());const result=await new DraftService(tx.platform).mutate(p.ownerId,'todo',null,{title:'Synthetic concurrent second'},space+'-todo-second');const previous=await tx.readDelivery(),delivery=previous?retiredDeliveryFixture(previous):issuedDeliveryFixture(p,result.entry);await tx.saveReceipt({digest:canonicalDigest({second:true}),result:deliveryArchiveFixture(delivery)});await tx.saveDelivery(previous?.version??null,delivery);return result.entry.id;});
    secondSettled=two.then(value=>({ok:true as const,value}),error=>({ok:false as const,error}));const secondPid=await bounded(second.connected);assert.notEqual(firstPid,secondPid);await requireAdvisoryWait(pool,secondPid);assert.equal(secondEntered,false,'Second callback cannot run before first transaction publishes or rolls back');
    await fixtureOwner(pool,p.ownerId,async c=>{assert.equal(Number((await c.query('SELECT count(*) AS n FROM lifeos_platform.platform_sync_outbox WHERE space_id=$1',[space])).rows[0].n),0,'Uncommitted earlier cursor must remain unpublished');});
    release.resolve(undefined);const a=await bounded(firstSettled),b=await bounded(secondSettled);assert.equal(a.ok,!rollback);if(!a.ok)assert.match(String(a.error),/SYNTHETIC_CONCURRENT_ROLLBACK/);if(!b.ok)throw b.error;assert.equal(secondEntered,true);
    await fixtureOwner(pool,p.ownerId,async c=>{const rows=(await c.query('SELECT o.cursor::text,o.entity_id::text FROM lifeos_platform.platform_sync_outbox o WHERE space_id=$1 ORDER BY o.cursor',[space])).rows;assert.deepEqual(rows,rollback?[{cursor:'1',entity_id:b.value}]:[{cursor:'1',entity_id:initial.id},{cursor:'2',entity_id:b.value}]);assert.equal(Number((await c.query('SELECT count(*) AS n FROM lifeos_platform.platform_sync_command WHERE space_id=$1',[space])).rows[0].n),rollback?1:2);if(rollback)assert.equal(Number((await c.query('SELECT count(*) AS n FROM lifeos_platform.platform_history WHERE record_id=$1',[initial.id])).rows[0].n),0);const delivery=(await c.query('SELECT active_delivery FROM lifeos_platform.platform_sync_lease WHERE space_id=$1',[space])).rows[0].active_delivery;assert.equal(delivery.version,rollback?'1':'2');assert.equal(delivery.phase,rollback?'issued':'retired-unapplied');});
    t.diagnostic(JSON.stringify({space,firstOutcome:rollback?'rollback':'commit',differentBackendPids:true,observedBackendWait:'Lock/advisory',secondReleased:true,publicationOrderActual:true,syntheticRowsRetained:true}));
   }finally{release.resolve(undefined);await firstSettled;if(secondSettled)await secondSettled;}
  }
 }finally{await pool.end();}
});
