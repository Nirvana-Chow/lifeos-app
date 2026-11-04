import test from 'node:test';import assert from 'node:assert/strict';
import{PostgresPlatformRepository,assertRestrictedMetadata,verifyRestrictedPool,type SqlClient}from'../src/platform/postgres.ts';
const safe={role:'lifeos_platform_candidate_runtime',superuser:false,create_db:false,create_role:false,bypass_rls:false,memberships:0,owns_objects:0,can_create_schema:false,can_create_database:false,rls_tables:4,forced_tables:4,version:2};
test('database metadata must prove a restricted nonowner role and all four forced RLS tables',()=>{
 assert.doesNotThrow(()=>assertRestrictedMetadata(safe));
 for(const [key,value]of Object.entries({role:'postgres',superuser:true,create_db:true,create_role:true,bypass_rls:true,memberships:1,owns_objects:1,can_create_schema:true,can_create_database:true,rls_tables:3,forced_tables:3,version:0}))assert.throws(()=>assertRestrictedMetadata({...safe,[key]:value}),/Restricted isolated PostgreSQL target required/);
 assert.throws(()=>assertRestrictedMetadata({...safe,version:1}),/Restricted isolated PostgreSQL target required/);
 assert.throws(()=>assertRestrictedMetadata({}),/Restricted isolated PostgreSQL target required/);
});
test('bootstrap purpose never relaxes the default runtime role boundary',()=>{
 const bootstrap={...safe,role:'lifeos_platform_candidate_bootstrap'};assert.throws(()=>assertRestrictedMetadata(bootstrap));assert.doesNotThrow(()=>assertRestrictedMetadata(bootstrap,'synthetic-bootstrap'));assert.throws(()=>assertRestrictedMetadata(safe,'synthetic-bootstrap'));assert.throws(()=>assertRestrictedMetadata(bootstrap,'unknown' as never));
});
test('bootstrap connection gate requires exact auth INSERT/SELECT grants and rejects excess privileges',async()=>{
 for(const [grants,allowed]of [[{required:true,excessive:false},true],[{required:false,excessive:false},false],[{required:true,excessive:true},false]] as const){let calls=0,released=false;const pool={connect:async()=>({query:async()=>({rows:calls++===0?[{...safe,role:'lifeos_platform_candidate_bootstrap'}]:[grants],rowCount:1}),release:()=>{released=true;}})};
  const result=verifyRestrictedPool(pool,'synthetic-bootstrap');if(allowed)await result;else await assert.rejects(result,/Restricted synthetic bootstrap grants required/);assert.equal(calls,2);assert.equal(released,true);
 }
});
function driver(){const calls:{sql:string;values:unknown[]}[]=[];let released=0;const client:SqlClient={query:async(sql,values=[])=>{calls.push({sql,values});return{rows:[],rowCount:0};},release:()=>{released++;}};return{repo:new PostgresPlatformRepository({connect:async()=>client}),calls,released:()=>released};}
test('owner scope and command lock are bound values inside a READ COMMITTED transaction',async()=>{
 const d=driver(),owner="fixture-owner'; DROP TABLE nope;--",key='fixture-command-001';
 assert.equal(await d.repo.transaction(owner,key,async tx=>{assert.equal(await tx.receipt(),null);return 'ok';}),'ok');
 assert.equal(d.calls[0].sql,'BEGIN ISOLATION LEVEL READ COMMITTED');assert.deepEqual(d.calls[1].values,[owner]);assert.match(d.calls[1].sql,/set_config/);assert.deepEqual(d.calls[2].values,[JSON.stringify([owner,key])]);assert.match(d.calls[2].sql,/pg_advisory_xact_lock/);assert.equal(d.calls.at(-1)?.sql,'COMMIT');assert.equal(d.released(),1);assert.ok(d.calls.every(c=>!c.sql.includes(owner)));
});
test('failed application callbacks roll back and release instead of claiming save',async()=>{
 const d=driver();await assert.rejects(d.repo.transaction('fixture-owner','fixture-command',async()=>{throw Error('fixture-reject');}),/fixture-reject/);assert.equal(d.calls.at(-1)?.sql,'ROLLBACK');assert.equal(d.released(),1);assert.ok(!d.calls.some(c=>c.sql==='COMMIT'));
});
test('object reads and linked refunds keep owner predicates; mutation get holds the source row lock',async()=>{
 const d=driver(),owner='fixture-owner',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';assert.deepEqual(await d.repo.list(owner,'finance'),[]);assert.equal(await d.repo.get(owner,'finance',id),null);
 await d.repo.transaction(owner,'fixture-command',async tx=>{await tx.get('finance',id);await tx.refundsFor(id);});
 const reads=d.calls.filter(c=>/FROM lifeos_platform.platform_record r/.test(c.sql));assert.equal(reads.length,4);for(const r of reads){assert.ok(r.values.includes(owner));assert.match(r.sql,/r.owner_id=\$1/);}assert.match(reads[2].sql,/FOR UPDATE OF r/);assert.match(reads[3].sql,/original_entry_id/);
});
test('project link discovery peeks on the same transaction connection without locking before ordered gets',async()=>{
 const d=driver(),id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 await d.repo.transaction('fixture-owner','fixture-project-peek',async tx=>{assert.equal(await tx.peek('inbox',id),null);assert.equal(await tx.get('inbox',id),null);});
 const reads=d.calls.filter(call=>call.sql.includes('FROM lifeos_platform.platform_record r'));assert.equal(reads.length,2);
 assert.deepEqual(reads.map(call=>call.values),[['fixture-owner','inbox',id],['fixture-owner','inbox',id]]);
 assert.doesNotMatch(reads[0].sql,/FOR UPDATE/);assert.match(reads[1].sql,/FOR UPDATE OF r/);assert.equal(d.released(),1);
});

test('business fence accepts read-only producer scopes and rejects malformed requirements without a legacy fallback',async()=>{
 const fences=await import('../src/agent-api/grant-fence.ts');
 assert.equal(typeof fences.assertAgentGrant,'function');
 const binding={grantId:'fixture-grant',ownerId:'fixture-owner',spaceId:'fixture-space'};
 const calls:{sql:string;values:unknown[]}[]=[];
 const client:SqlClient={query:async(sql,values=[])=>{calls.push({sql,values});return {rows:[{allowed:true}],rowCount:1};},release(){}};
 const repo=new PostgresPlatformRepository({connect:async()=>client},true,true,{organization:true,classification:false});
 await repo.transaction(binding.ownerId,'preview',async tx=>{
   await fences.assertAgentGrant(tx,binding,['todo:read','organization:read']);
   for(const scopes of [[],['unknown:read'],['organization:write']])
     await assert.rejects(fences.assertAgentGrant(tx,binding,scopes as never),{status:403});
   await assert.rejects(fences.assertAgentGrant(tx,{...binding,ownerId:'spoof'},['organization:read']),{status:403});
 });
 const query=calls.find(call=>call.sql.includes('assert_business_grant'));
 assert.deepEqual(query?.values,[binding.grantId,binding.ownerId,binding.spaceId,['todo:read','organization:read']]);
 assert.match(calls[2].sql,/pg_advisory_xact_lock_shared/);assert.match(calls[3].sql,/pg_advisory_xact_lock/);
 await assert.rejects(fences.assertAgentGrant({lockAgentTodoWriteGrant:async()=>true} as never,binding,['organization:read']),{status:503});
});

test('legacy todo fence still works without the business migration',async()=>{
 const {assertAgentTodoWriteGrant}=await import('../src/agent-api/grant-fence.ts');
 const d=driver();let called=false;
 await d.repo.transaction('fixture-owner','legacy',async tx=>assertAgentTodoWriteGrant({...tx,lockAgentTodoWriteGrant:async()=>{called=true;return true;}},
   {grantId:'fixture',ownerId:'fixture-owner',spaceId:'fixture-space'}));
 assert.equal(called,true);
});

test('classification is default closed before connecting and legacy transactions expose no feature queries',async()=>{
 const d=driver();await assert.rejects(d.repo.classificationTransaction('fixture-owner','fixture-space','classify-1',async()=>null),{status:503});assert.equal(d.calls.length,0);
 await d.repo.transaction('fixture-owner','ordinary',async tx=>assert.equal('getClassificationPlan' in tx,false));
 assert.equal(d.calls.some(call=>call.sql.includes('platform_classification')),false);
});

test('enabled classification without all three qualified tables fails 503 before callback and rolls back',async()=>{
 const d=driver();const calls:typeof d.calls=[];let released=0,invoked=false;
 const repo=new PostgresPlatformRepository({connect:async()=>({query:async(sql,values=[])=>{calls.push({sql,values});return{rows:[],rowCount:0};},release(){released++;}})},true,true,{organization:true,classification:true});
 await assert.rejects(repo.classificationTransaction('fixture-owner','fixture-space','classify-1',async()=>{invoked=true;}),{status:503});
 assert.equal(invoked,false);assert.equal(released,1);assert.equal(calls.at(-1)?.sql,'ROLLBACK');
 assert.equal(calls.some(c=>/INSERT INTO/.test(c.sql)),false);
 assert.deepEqual(calls.find(c=>c.sql.includes('pg_advisory_xact_lock('))?.values,['["fixture-owner","todo-classification-v1","fixture-space","classify-1"]']);
});
test('stored classification JSON is decoded on read, never cast into trusted operation state',async()=>{
 const {classificationQueries}=await import('../src/personal-candidate/classification-postgres.ts');
 const client:SqlClient={query:async()=>({rows:[{plan:{title:'private text'},receipt:{requestDigest:'a'.repeat(64),result:{entry:{title:'private text'}}}}],rowCount:1}),release(){}};
 const tx=classificationQueries(client,'fixture-owner','fixture-space','classify-1');
 await assert.rejects(tx.getClassificationPlan('00000000-0000-4000-8000-000000000001'));
 await assert.rejects(tx.classificationReceipt());
});
