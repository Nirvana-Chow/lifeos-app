import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prepareClassificationFixture,fixturePool,fixture} from './helpers/classification-stage-pg.ts';
import {PostgresPlatformRepository,verifyRestrictedPool} from '../src/platform/postgres.ts';
import {verifyClassificationPool,verifyClassificationClient,classificationQueries} from '../src/personal-candidate/classification-postgres.ts';
import {classificationPlanDigest,classificationBindingsDigest,type ClassificationPlan} from '../src/personal-candidate/classification-contracts.ts';
const enabled=process.env.RUN_CLASSIFICATION_POSTGRES_TESTS==='1';
function makePlan():ClassificationPlan{const p:ClassificationPlan={schemaVersion:1,proposalRevision:1,ownerId:fixture.ownerId,spaceId:fixture.spaceId,grantId:null,producerAuthorizationRevision:null,policyRevision:'policy-v1',createdAt:'2026-11-05T00:00:00.000Z',preview:{planId:randomUUID(),digest:'a'.repeat(64),expiresAt:'2026-11-05T00:30:00.000Z',changes:[{todo:{id:randomUUID(),sourceId:randomUUID(),expectedRevision:1},before:null,after:{project:null,domain:null,topics:[]}}],unchangedIds:[]}};const preview={...p.preview,unchangedIds:[p.preview.changes[0].todo.id]};const result={...p,preview};return{...result,preview:{...preview,digest:classificationPlanDigest(result)}};}
test('classification PostgreSQL immutable storage qualification (explicit isolated fixture)',{skip:!enabled},async t=>{
 const proof=await prepareClassificationFixture();assert.match(proof.sha256,/^[a-f0-9]{64}$/);
 const runtime=fixturePool('runtime',2),admin=fixturePool('admin',1),manager=fixturePool('manager',1),verifier=fixturePool('verifier',1);
 try{
  const repo=new PostgresPlatformRepository(runtime,true,true,{organization:true,classification:true});
  await t.test('three separate forced-RLS tables qualify without changing schema2 and original four-table gate',async()=>{await verifyRestrictedPool(runtime);await verifyClassificationPool(runtime);});
  await t.test('readiness fails closed for privilege, policy, RLS, trigger and schema drift',async()=>{
   const client=await admin.connect();try{
    for(const mutation of [
     'GRANT UPDATE ON lifeos_platform.platform_classification_plan TO lifeos_platform_candidate_runtime',
     'ALTER TABLE lifeos_platform.platform_classification_plan NO FORCE ROW LEVEL SECURITY',
     'ALTER TABLE lifeos_platform.platform_classification_plan RENAME TO fixture_hidden_classification_plan',
     'ALTER POLICY classification_read ON lifeos_platform.platform_classification_plan USING (true)',
     'ALTER TABLE lifeos_platform.platform_classification_plan DISABLE TRIGGER classification_binding',
    ]){await client.query('BEGIN');await client.query(mutation);await client.query('SET LOCAL ROLE lifeos_platform_candidate_runtime');await assert.rejects(verifyClassificationClient(client),{status:503});await client.query('ROLLBACK');}
   }finally{await client.query('ROLLBACK');client.release();}
  });
  const semanticDrifts=[
   {name:'consumption UNIQUE with command key added',table:'command',kind:'u',definition:'UNIQUE(owner_id,space_id,command_key,plan_id)'},
   {name:'command primary key with plan added',table:'command',kind:'p',definition:'PRIMARY KEY(owner_id,space_id,command_key,plan_id)'},
   {name:'approval FK missing digest and proposal columns',table:'command',kind:'f',reference:'platform_classification_approval',definition:'FOREIGN KEY(owner_id,space_id,plan_id) REFERENCES lifeos_platform.platform_classification_approval(owner_id,space_id,plan_id)'},
   {name:'command FK targets plan instead of approval',table:'command',kind:'f',reference:'platform_classification_approval',definition:'FOREIGN KEY(owner_id,space_id,plan_id,digest,proposal_revision) REFERENCES lifeos_platform.platform_classification_plan(owner_id,space_id,plan_id,digest,proposal_revision)'},
   {name:'approval FK becomes deferred',table:'command',kind:'f',reference:'platform_classification_approval',definition:'FOREIGN KEY(owner_id,space_id,plan_id,digest,proposal_revision) REFERENCES lifeos_platform.platform_classification_approval(owner_id,space_id,plan_id,digest,proposal_revision) DEFERRABLE INITIALLY DEFERRED'},
   {name:'approval FK allows cascading deletion',table:'command',kind:'f',reference:'platform_classification_approval',definition:'FOREIGN KEY(owner_id,space_id,plan_id,digest,proposal_revision) REFERENCES lifeos_platform.platform_classification_approval(owner_id,space_id,plan_id,digest,proposal_revision) ON DELETE CASCADE'},
   {name:'approval FK allows cascading update',table:'command',kind:'f',reference:'platform_classification_approval',definition:'FOREIGN KEY(owner_id,space_id,plan_id,digest,proposal_revision) REFERENCES lifeos_platform.platform_classification_approval(owner_id,space_id,plan_id,digest,proposal_revision) ON UPDATE CASCADE'},
   {name:'approval FK changes match mode',table:'command',kind:'f',reference:'platform_classification_approval',definition:'FOREIGN KEY(owner_id,space_id,plan_id,digest,proposal_revision) REFERENCES lifeos_platform.platform_classification_approval(owner_id,space_id,plan_id,digest,proposal_revision) MATCH FULL'},
   {name:'approval FK is unvalidated',table:'command',kind:'f',reference:'platform_classification_approval',definition:'FOREIGN KEY(owner_id,space_id,plan_id,digest,proposal_revision) REFERENCES lifeos_platform.platform_classification_approval(owner_id,space_id,plan_id,digest,proposal_revision) NOT VALID'},
   {name:'required plan JSON CHECK replaced with true',table:'plan',kind:'c',expression:'classification_valid',definition:'CHECK(true)'},
   {name:'required plan JSON CHECK permits unknown shape',table:'plan',kind:'c',expression:'classification_valid',definition:"CHECK(lifeos_platform.classification_valid(plan,'plan') OR true)"},
  ];
  for(const drift of semanticDrifts)await t.test('readiness rejects same-name same-count '+drift.name,async()=>{
   const client=await admin.connect();try{
    await client.query('BEGIN');
    const table='lifeos_platform.platform_classification_'+drift.table;
    const constraints=(await client.query("SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=$1::regclass AND contype=$2 AND ($3::text IS NULL OR confrelid=to_regclass('lifeos_platform.'||$3)) AND ($4::text IS NULL OR pg_get_constraintdef(oid) LIKE '%'||$4||'%')",[table,drift.kind,drift.reference??null,drift.expression??null])).rows;
    assert.equal(constraints.length,1);const name=String(constraints[0].conname);assert.match(name,/^[a-z_]+$/);
    await client.query(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`);await client.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${drift.definition}`);
    await client.query('SET LOCAL ROLE lifeos_platform_candidate_runtime');await assert.rejects(verifyClassificationClient(client),{status:503});
   }finally{await client.query('ROLLBACK');client.release();}
   await verifyClassificationPool(runtime);
  });
  for(const [name,clause] of [
   ['wrong event','BEFORE UPDATE FOR EACH ROW'],['statement instead of row','BEFORE INSERT FOR EACH STATEMENT'],
   ['after instead of before','AFTER INSERT FOR EACH ROW'],['conditional insertion','BEFORE INSERT FOR EACH ROW WHEN (NEW.grant_id IS NOT NULL)'],
   ['column restricted update','BEFORE UPDATE OF plan FOR EACH ROW'],
  ])await t.test('readiness rejects binding trigger with '+name,async()=>{
   const client=await admin.connect();try{
    await client.query('BEGIN');await client.query('DROP TRIGGER classification_binding ON lifeos_platform.platform_classification_plan');
    const [timing,eventAndRow]=clause.split(/ (.*)/s);const event=eventAndRow.slice(0,eventAndRow.indexOf(' FOR EACH'));
    const rowClause=eventAndRow.slice(eventAndRow.indexOf(' FOR EACH'));
    await client.query(`CREATE TRIGGER classification_binding ${timing} ${event} ON lifeos_platform.platform_classification_plan${rowClause} EXECUTE FUNCTION lifeos_platform.classification_insert_binding()`);
    await client.query('SET LOCAL ROLE lifeos_platform_candidate_runtime');await assert.rejects(verifyClassificationClient(client),{status:503});
   }finally{await client.query('ROLLBACK');client.release();}
   await verifyClassificationPool(runtime);
  });
  await t.test('readiness rejects nullable mandatory FK columns despite unchanged constraints',async()=>{
   const client=await admin.connect();try{await client.query('BEGIN');await client.query('ALTER TABLE lifeos_platform.platform_classification_command ALTER COLUMN digest DROP NOT NULL');await client.query('SET LOCAL ROLE lifeos_platform_candidate_runtime');await assert.rejects(verifyClassificationClient(client),{status:503});}finally{await client.query('ROLLBACK');client.release();}
   await verifyClassificationPool(runtime);
  });
  await t.test('readiness accepts equivalent CHECK formatting, key ordering and object names',async()=>{
   const client=await admin.connect();try{
    await client.query('BEGIN');const row=(await client.query("SELECT conname FROM pg_constraint WHERE conrelid='lifeos_platform.platform_classification_plan'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%classification_valid%'")).rows[0];
    assert.match(row.conname,/^[a-z_]+$/);await client.query('ALTER TABLE lifeos_platform.platform_classification_plan DROP CONSTRAINT '+row.conname);
    await client.query("ALTER TABLE lifeos_platform.platform_classification_plan ADD CONSTRAINT fixture_equivalent_check CHECK ( ( lifeos_platform.classification_valid ( plan , 'plan' :: text ) ) )");
    const unique=(await client.query("SELECT conname FROM pg_constraint WHERE conrelid='lifeos_platform.platform_classification_command'::regclass AND contype='u'")).rows[0];
    assert.match(unique.conname,/^[a-z_]+$/);await client.query('ALTER TABLE lifeos_platform.platform_classification_command DROP CONSTRAINT '+unique.conname);
    await client.query('ALTER TABLE lifeos_platform.platform_classification_command ADD CONSTRAINT fixture_equivalent_unique UNIQUE(plan_id,space_id,owner_id)');
    await client.query('ALTER TRIGGER classification_binding ON lifeos_platform.platform_classification_plan RENAME TO fixture_equivalent_binding');
    await client.query('SET LOCAL ROLE lifeos_platform_candidate_runtime');await verifyClassificationClient(client);
   }finally{await client.query('ROLLBACK');client.release();}
   await verifyClassificationPool(runtime);
  });
  const p=makePlan(),key='classification-'+randomUUID();
  await t.test('same transaction stores immutable plan approval and batch receipt separately from legacy commands',async()=>{
   await repo.classificationTransaction(fixture.ownerId,fixture.spaceId,key,async tx=>{
    await tx.saveClassificationPlan(p);assert.deepEqual(await tx.getClassificationPlan(p.preview.planId),p);await tx.lockClassificationPlan(p.preview.planId);
    const a={planId:p.preview.planId,proposalRevision:1 as const,digest:p.preview.digest,operationIds:['commitTodoClassification'] as const,bindingsDigest:classificationBindingsDigest(p),producerAuthorizationRevision:null,policyRevision:p.policyRevision,approvedAt:'2026-11-05T00:01:00.000Z',expiresAt:p.preview.expiresAt};
    await tx.saveClassificationApproval(a);assert.deepEqual(await tx.classificationApproval(p.preview.planId),a);
    const receipt={requestDigest:'b'.repeat(64),planId:p.preview.planId,result:{planId:p.preview.planId,digest:p.preview.digest,duplicate:false,entries:p.preview.changes.map(c=>({id:c.todo.id,sourceId:c.todo.sourceId,revision:1,personal:null})),unchangedIds:p.preview.unchangedIds}};
    await tx.saveClassificationReceipt(receipt);assert.deepEqual(await tx.classificationReceipt(),receipt);assert.equal(await tx.classificationPlanCommitted(p.preview.planId),true);assert.equal(await tx.receipt(),null);
   });
  });
  await t.test('owner and space isolation deny reads and inserts outside both boundaries',async()=>{
   await repo.classificationTransaction('other-fixture-owner',fixture.spaceId,key,async tx=>assert.equal(await tx.getClassificationPlan(p.preview.planId),null));
   await repo.classificationTransaction(fixture.ownerId,'other-fixture-space',key,async tx=>assert.equal(await tx.getClassificationPlan(p.preview.planId),null));
   const client=await runtime.connect();try{await client.query('BEGIN');await client.query("SELECT set_config('lifeos.owner_id','other-fixture-owner',true),set_config('lifeos.classification_space_id',$1,true)",[fixture.spaceId]);await assert.rejects(client.query('INSERT INTO lifeos_platform.platform_classification_plan(owner_id,space_id,plan_id,digest,proposal_revision,grant_id,plan) VALUES($1,$2,$3,$4,1,NULL,$5)',[p.ownerId,p.spaceId,randomUUID(),p.preview.digest,JSON.stringify(p)]),/row-level security/);}finally{await client.query('ROLLBACK');client.release();}
  });
  await t.test('runtime cannot update delete truncate; manager and verifier have no business-table privileges',async()=>{
   for(const name of ['plan','approval','command']){
    const table='lifeos_platform.platform_classification_'+name;
    for(const sql of [`UPDATE ${table} SET owner_id=owner_id`,`DELETE FROM ${table}`,`TRUNCATE ${table}`])await assert.rejects(runtime.query(sql),/permission denied/);
    for(const pool of [manager,verifier])await assert.rejects(pool.query('SELECT * FROM '+table),/permission denied/);
   }
  });
  await t.test('native JSON checks reject omitted/unknown fields, bad UUID/revision, counts and producer mismatch',async()=>{
   const client=await runtime.connect();try{
    const badChanges=[[],Array.from({length:101},()=>p.preview.changes[0]),[{...p.preview.changes[0],before:{project:null}}],[{...p.preview.changes[0],after:{project:null,domain:null,topics:[],title:'secret'}}],[{...p.preview.changes[0],todo:{...p.preview.changes[0].todo,sourceId:'bad'}}],[{...p.preview.changes[0],todo:{...p.preview.changes[0].todo,expectedRevision:0}}],[{...p.preview.changes[0],after:{project:null,domain:null,topics:Array.from({length:21},()=>({id:randomUUID(),sourceId:randomUUID(),revision:1}))}}],[{...p.preview.changes[0],after:{project:null,domain:null,topics:Array.from({length:2},()=>({id:p.preview.planId,sourceId:p.preview.planId,revision:1}))}}],[p.preview.changes[0],p.preview.changes[0]]];
    const badPlans=[...badChanges.map(changes=>({...p,preview:{...p.preview,changes}})),{...p,notes:'secret'},{...p,grantId:'missing-grant'},{...p,preview:{...p.preview,expiresAt:'2026-11-05T00:30:00.001Z'}}];
    for(const bad of badPlans){await client.query('BEGIN');await client.query("SELECT set_config('lifeos.owner_id',$1,true),set_config('lifeos.classification_space_id',$2,true)",[fixture.ownerId,fixture.spaceId]);const id=randomUUID(),value={...bad,preview:{...bad.preview,planId:id}};value.preview.digest=classificationPlanDigest(value as ClassificationPlan);await assert.rejects(client.query('INSERT INTO lifeos_platform.platform_classification_plan(owner_id,space_id,plan_id,digest,proposal_revision,grant_id,plan) VALUES($1,$2,$3,$4,1,NULL,$5::jsonb)',[fixture.ownerId,fixture.spaceId,id,value.preview.digest,JSON.stringify(value)]));await client.query('ROLLBACK');}
   }finally{await client.query('ROLLBACK');client.release();}
  });
  await t.test('compact plans within 128KiB remain accepted despite PostgreSQL JSON display whitespace',async()=>{
   const base=makePlan();const changes=Array.from({length:100},()=>({todo:{id:randomUUID(),sourceId:randomUUID(),expectedRevision:1},before:null,after:{project:null,domain:null,topics:[] as {id:string;sourceId:string;revision:number}[]}}));
   const plan={...base,preview:{...base.preview,changes,unchangedIds:[] as string[]}};
   for(let i=0;Buffer.byteLength(JSON.stringify(plan))<130000;i++){
    const change=changes[i%100];assert.ok(change.after.topics.length<20);change.after.topics.push({id:randomUUID(),sourceId:randomUUID(),revision:1});
   }
   plan.preview.digest=classificationPlanDigest(plan);assert.ok(Buffer.byteLength(JSON.stringify(plan))<=131072);
   const size=(await admin.query('SELECT octet_length($1::jsonb::text) AS bytes',[JSON.stringify(plan)])).rows[0].bytes;assert.ok(size>131072);
   await repo.classificationTransaction(fixture.ownerId,fixture.spaceId,'large-'+randomUUID(),async tx=>{await tx.saveClassificationPlan(plan);assert.deepEqual(await tx.getClassificationPlan(plan.preview.planId),plan);});
   const oversized=structuredClone(plan);oversized.preview.planId=randomUUID();
   for(let i=0;Buffer.byteLength(JSON.stringify(oversized))<=131072;i++){const change=oversized.preview.changes[i%100];assert.ok(change.after.topics.length<20);change.after.topics.push({id:randomUUID(),sourceId:randomUUID(),revision:1});}
   oversized.preview.digest=classificationPlanDigest(oversized);
   await assert.rejects(admin.query('INSERT INTO lifeos_platform.platform_classification_plan(owner_id,space_id,plan_id,digest,proposal_revision,grant_id,plan) VALUES($1,$2,$3,$4,1,NULL,$5::jsonb)',[oversized.ownerId,oversized.spaceId,oversized.preview.planId,oversized.preview.digest,JSON.stringify(oversized)]),{code:'23514'});
  });
  await t.test('native approval and command bindings reject substitution before any approval is saved',async()=>{
   const plan=makePlan();await repo.classificationTransaction(fixture.ownerId,fixture.spaceId,'approval-'+randomUUID(),tx=>tx.saveClassificationPlan(plan));
   const valid={planId:plan.preview.planId,proposalRevision:1,digest:plan.preview.digest,operationIds:['commitTodoClassification'],bindingsDigest:classificationBindingsDigest(plan),producerAuthorizationRevision:null,policyRevision:plan.policyRevision,approvedAt:'2026-11-05T00:01:00.000Z',expiresAt:plan.preview.expiresAt};
   for(const patch of [{digest:'c'.repeat(64)},{proposalRevision:2},{policyRevision:'other'},{producerAuthorizationRevision:'other'},{bindingsDigest:'d'.repeat(64)},{expiresAt:'2026-11-05T00:29:00.000Z'},{notes:'secret'}]){
    const value={...valid,...patch};await assert.rejects(admin.query('INSERT INTO lifeos_platform.platform_classification_approval(owner_id,space_id,plan_id,digest,proposal_revision,approval) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[fixture.ownerId,fixture.spaceId,plan.preview.planId,value.digest,value.proposalRevision,JSON.stringify(value)]));
   }
   assert.equal((await admin.query('SELECT count(*)::int AS count FROM lifeos_platform.platform_classification_approval WHERE plan_id=$1',[plan.preview.planId])).rows[0].count,0);
   const receipt={requestDigest:'b'.repeat(64),planId:plan.preview.planId,result:{planId:plan.preview.planId,digest:plan.preview.digest,duplicate:false,entries:plan.preview.changes.map(c=>({id:c.todo.id,sourceId:c.todo.sourceId,revision:1,personal:null})),unchangedIds:plan.preview.unchangedIds}};
   await assert.rejects(admin.query('INSERT INTO lifeos_platform.platform_classification_command(owner_id,space_id,command_key,plan_id,digest,proposal_revision,receipt) VALUES($1,$2,$3,$4,$5,1,$6::jsonb)',[fixture.ownerId,fixture.spaceId,'no-approval-'+randomUUID(),plan.preview.planId,plan.preview.digest,JSON.stringify(receipt)]),{code:'23503'});
  });
  await t.test('actual stored malformed JSON fails the application decoder even if a privileged fixture bypassed a CHECK',async()=>{
   const client=await admin.connect();try{
    await client.query('BEGIN');
    const constraint=(await client.query("SELECT conname FROM pg_constraint WHERE conrelid='lifeos_platform.platform_classification_plan'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%classification_valid%'")).rows[0].conname;
    assert.match(constraint,/^[a-z_]+$/);await client.query('ALTER TABLE lifeos_platform.platform_classification_plan DROP CONSTRAINT '+constraint);
    const bad={...makePlan(),notes:'arbitrary business text'};await client.query('INSERT INTO lifeos_platform.platform_classification_plan(owner_id,space_id,plan_id,digest,proposal_revision,grant_id,plan) VALUES($1,$2,$3,$4,1,NULL,$5::jsonb)',[bad.ownerId,bad.spaceId,bad.preview.planId,bad.preview.digest,JSON.stringify(bad)]);
    await client.query('SET LOCAL ROLE lifeos_platform_candidate_runtime');await client.query("SELECT set_config('lifeos.owner_id',$1,true),set_config('lifeos.classification_space_id',$2,true)",[fixture.ownerId,fixture.spaceId]);
    await assert.rejects(classificationQueries(client,fixture.ownerId,fixture.spaceId,'corrupt-read').getClassificationPlan(bad.preview.planId),{status:400});
   }finally{await client.query('ROLLBACK');client.release();}
   await verifyClassificationPool(runtime);
  });
  await t.test('feature transaction uses the original writer and rolls back business rows history and plan together',async()=>{
   const plan=makePlan(),id=plan.preview.changes[0].todo.id,sourceId=plan.preview.changes[0].todo.sourceId;
   await assert.rejects(repo.classificationTransaction(fixture.ownerId,fixture.spaceId,'rollback-'+randomUUID(),async tx=>{
    await tx.saveClassificationPlan(plan);await tx.write({id,ownerId:fixture.ownerId,kind:'todo',draft:{title:'Synthetic classification rollback',notes:'',status:'open',dueOn:null},source:{id:sourceId,system:'website',externalId:'synthetic-'+id,version:1,asOf:plan.createdAt,original:{fixture:'classification-only'}},revision:1,createdAt:plan.createdAt,updatedAt:plan.createdAt,syncState:'draft',externalStatus:null},{fixture:true},true);
    assert.equal((await tx.get('todo',id))?.id,id);throw Error('synthetic-abort');
   }),/synthetic-abort/);
   assert.equal(await repo.get(fixture.ownerId,'todo',id),null);assert.deepEqual(await repo.history(fixture.ownerId,'todo',id),[]);
   await repo.classificationTransaction(fixture.ownerId,fixture.spaceId,'readback-'+randomUUID(),async tx=>assert.equal(await tx.getClassificationPlan(plan.preview.planId),null));
  });
  await t.test('unique plan consumption rejects a second command even for all no-op plans',async()=>{await assert.rejects(admin.query('INSERT INTO lifeos_platform.platform_classification_command SELECT owner_id,space_id,$1,plan_id,digest,proposal_revision,receipt FROM lifeos_platform.platform_classification_command WHERE plan_id=$2',['second-'+randomUUID(),p.preview.planId]),{code:'23505'});});
 }finally{await Promise.all([runtime.end(),admin.end(),manager.end(),verifier.end()]);}
});
