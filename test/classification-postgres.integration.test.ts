import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
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

import {ClassificationService,classificationPolicyRevision} from '../src/personal-candidate/classification-service.ts';
import {AuthorityService} from '../src/agent-authority/service.ts';
import {readCurrentAgentGrant} from '../src/agent-api/runtime.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import {ownerMaintenanceKey} from '../src/deployment-candidate/owner-maintenance-key.ts';
import type {SqlPool} from '../src/platform/postgres.ts';
import type {Pool} from 'pg';
import type {StoredEntry} from '../src/platform/contracts.ts';
const nativeConfig={ownerId:fixture.ownerId,spaceId:fixture.spaceId,ownerEmail:fixture.email,databaseName:fixture.database,approval:'personal-manual-v1',baseURL:fixture.origin,allowedTypes:['todo','journal','project','domain','topic'],businessWriteMode:'owner-managed'} as const;
const confirmation=(p:{planId:string;digest:string})=>({planId:p.planId,digest:p.digest,confirmed:true});
const outcome=<T>(promise:Promise<T>)=>promise.then(value=>({value,error:null}),error=>({value:null,error}));
function barrier(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return{promise,release};}
async function signal(promise:Promise<unknown>){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Native classification barrier not reached')),4000);})]);}finally{clearTimeout(timer);}}
async function blocked(admin:Pool,pid:number,by:number){const deadline=Date.now()+4000;while(Date.now()<deadline){if((await admin.query('SELECT $2::int=ANY(pg_blocking_pids($1)) AS blocked',[pid,by])).rows[0].blocked)return;await new Promise<void>(resolve=>setImmediate(resolve));}assert.fail('Expected native blocking relationship');}
function observedPool(pool:Pool,onQuery:(sql:string,values:unknown[]|undefined,pid:number)=>Promise<void>,before=false):SqlPool{return{connect:async()=>{const client=await pool.connect(),pid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;return{release:()=>client.release(),query:async(sql,values)=>{if(before)await onQuery(sql,values,pid);const result=await client.query(sql,values);if(!before)await onQuery(sql,values,pid);return result;}};}};}
test('classification native atomic service, authority and deterministic concurrency',{skip:!enabled,timeout:90000},async t=>{
 await prepareClassificationFixture();const business=fixturePool('runtime',4),admin=fixturePool('admin',3),verifier=fixturePool('verifier',3),manager=fixturePool('manager',2);
 const repo=new PostgresPlatformRepository(business,true,true,{organization:true,classification:true});const personal=new PersonalService(repo,nativeConfig);
 const session='classification-'+randomUUID();
 const seedGrant=async(write=false)=>{const id=randomUUID();await admin.query(`INSERT INTO lifeos_agent.apikey(id,"configId","referenceId",key,enabled,"createdAt","updatedAt","expiresAt",metadata,permissions) VALUES($1,'default',$2,$3,true,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 hour',$4,$5)`,[id,fixture.ownerId,'synthetic-classification-'+id,JSON.stringify({spaceId:fixture.spaceId}),JSON.stringify({todo:write?['read','write']:['read'],organization:['read']})]);return id;};
 const auth=(grant:string)=>new AuthorityService({...nativeConfig,verifyOwner:async()=>({ownerId:fixture.ownerId,spaceId:fixture.spaceId,sessionRef:session}),verifyAgent:async()=>readCurrentAgentGrant(verifier,grant),readCurrentAgent:id=>readCurrentAgentGrant(verifier,id)});
 const service=(authority:AuthorityService,repository=repo,now?:()=>number)=>new ClassificationService(repository,nativeConfig,{authority,assertReady:async()=>{},assertWritable:async()=>{},policyRevision:()=>classificationPolicyRevision(nativeConfig),now});
 const make=async(write=false,noop=false)=>{
  const grant=await seedGrant(write),authority=auth(grant),owner=(await authority.resolveOwnerActor(new Headers()))!,agent=(await authority.resolveAgentActor('synthetic'))!;
  const fields={title:'Synthetic classification project '+randomUUID(),text:'',occurredOn:null,personal:{type:'project',stage:'active',purpose:null,nextStep:'',domain:null,topics:[]}};
  const project=(await personal.mutate(fixture.ownerId,'project',null,{spaceId:fixture.spaceId,confirmed:true,fields},randomUUID())).entry;
  const todos=await Promise.all([0,1].map(async i=>(await personal.mutate(fixture.ownerId,'todo',null,{spaceId:fixture.spaceId,confirmed:true,fields:{title:'Synthetic classification '+i+' '+randomUUID(),notes:'preserve notes',status:'open',dueOn:'2026-11-06'}},randomUUID())).entry));
  const changes=todos.map(row=>({todo:{id:row.id,sourceId:row.source.id,expectedRevision:1},before:null,after:{project:noop?null:{id:project.id,sourceId:project.source.id,revision:1},domain:null,topics:[]}}));
  const svc=service(authority),plan=await svc.preview(agent,{changes});await svc.approve(owner,confirmation(plan));return{grant,authority,owner,agent,project,todos,changes,svc,plan};
 };
 const counts=async(ids:string[],plan:string)=>(await admin.query(`SELECT (SELECT sum(revision)::int FROM lifeos_platform.platform_record WHERE id=ANY($1::uuid[])) AS revisions,(SELECT count(*)::int FROM lifeos_platform.platform_history WHERE record_id=ANY($1::uuid[])) AS histories,(SELECT count(*)::int FROM lifeos_platform.platform_classification_command WHERE plan_id=$2) AS receipts`,[ids,plan])).rows[0];
 try{
  await admin.query('INSERT INTO lifeos_platform.platform_session(id,token,"userId","expiresAt","mfaVerified") VALUES($1,$2,$3,clock_timestamp()+interval \'1 hour\',true)',[randomUUID(),session,fixture.ownerId]);
  await t.test('read-only producer preview, owner approval/commit preserve grant bytes and unrelated business fields',async()=>{const f=await make(),ids=f.todos.map(x=>x.id);const before=(await admin.query('SELECT * FROM lifeos_agent.apikey WHERE id=$1',[f.grant])).rows;await assert.rejects(f.svc.commit(f.agent,confirmation(f.plan),randomUUID()),{status:403});assert.deepEqual(await counts(ids,f.plan.planId),{revisions:2,histories:2,receipts:0});const result=await f.svc.commit(f.owner,confirmation(f.plan),randomUUID());assert.equal(result.entries.length,2);assert.deepEqual(await counts(ids,f.plan.planId),{revisions:4,histories:4,receipts:1});assert.deepEqual((await admin.query('SELECT * FROM lifeos_agent.apikey WHERE id=$1',[f.grant])).rows,before);for(const old of f.todos){const row=await repo.get(fixture.ownerId,'todo',old.id);assert.deepEqual({...row,draft:old.draft,updatedAt:old.updatedAt,revision:old.revision},{...old,ownerId:fixture.ownerId});assert.deepEqual({...row!.draft,personal:undefined},{...old.draft,personal:undefined});}});
  await t.test('last conflict writes zero batch history/receipt and stale approval bindings reject',async()=>{const f=await make();await personal.mutate(fixture.ownerId,'todo',f.todos[1].id,{spaceId:fixture.spaceId,confirmed:true,expectedRevision:1,fields:{...f.todos[1].draft,title:'Synthetic conflicting edit'}},randomUUID());const before=await counts(f.todos.map(x=>x.id),f.plan.planId);await assert.rejects(f.svc.commit(f.owner,confirmation(f.plan),randomUUID()),{status:409});assert.deepEqual(await counts(f.todos.map(x=>x.id),f.plan.planId),before);});
  await t.test('lost response after native COMMIT recovers original receipt after edits/expiry across API and owner',async()=>{
   const f=await make(true),pool=fixturePool('runtime',1);let lost=true;const wrapped=observedPool(pool,async sql=>{if(sql==='COMMIT'&&lost){lost=false;throw Error('Synthetic lost COMMIT response');}}),uncertain=service(f.authority,new PostgresPlatformRepository(wrapped,true,true,{organization:true,classification:true})),key=randomUUID();
   try{await assert.rejects(uncertain.commit(f.owner,confirmation(f.plan),key),/Synthetic lost/);const original=await f.svc.commit(f.agent,confirmation(f.plan),key);assert.equal(original.duplicate,true);await personal.mutate(fixture.ownerId,'todo',f.todos[0].id,{spaceId:fixture.spaceId,confirmed:true,expectedRevision:2,fields:{...f.todos[0].draft,title:'Synthetic later edit',personal:f.changes[0].after}},randomUUID());const before=await counts(f.todos.map(x=>x.id),f.plan.planId);const expired=service(f.authority,repo,()=>Date.parse(f.plan.expiresAt)+1);assert.deepEqual(await expired.commit(f.owner,confirmation(f.plan),key),original);assert.deepEqual(await counts(f.todos.map(x=>x.id),f.plan.planId),before);await assert.rejects(expired.commit(f.owner,{...confirmation(f.plan),planId:randomUUID()},key),{status:409});const otherAuth=auth(await seedGrant(true)),other=(await otherAuth.resolveAgentActor('synthetic'))!;await assert.rejects(service(otherAuth).commit(other,confirmation(f.plan),key),{status:403});await admin.query('UPDATE lifeos_agent.apikey SET enabled=false WHERE id=$1',[f.grant]);await assert.rejects(f.svc.commit(f.owner,confirmation(f.plan),key),{status:403});}finally{await pool.end();}
  });
  for(const sameKey of [true,false,'changed'] as const)await t.test('all-no-op native plan concurrent '+(sameKey==='changed'?'same key changed body conflicts':sameKey?'same key restores duplicate':'different keys yield one conflict'),async()=>{
   const f=await make(false,true),pause=barrier(),resume=barrier(),entered=barrier(),left=fixturePool('runtime',1),right=fixturePool('runtime',1);let lp=0,rp=0;
   // Plan key is a bound value, so pause after the second exclusive advisory lock.
   let locks=0;const l2=service(f.authority,new PostgresPlatformRepository(observedPool(left,async(sql,_v,pid)=>{lp=pid;if(sql.includes('pg_advisory_xact_lock(')&&++locks===2){pause.release();await resume.promise;}}),true,true,{organization:true,classification:true}));
   const r=service(f.authority,new PostgresPlatformRepository(observedPool(right,async(_sql,_v,pid)=>{rp=pid;entered.release();},true),true,true,{organization:true,classification:true}));let one:ReturnType<typeof outcome>|undefined,two:ReturnType<typeof outcome>|undefined;const key=randomUUID();
   try{one=outcome(l2.commit(f.owner,confirmation(f.plan),key));await signal(pause.promise);two=outcome(r.commit(f.owner,sameKey==='changed'?{...confirmation(f.plan),planId:randomUUID()}:confirmation(f.plan),sameKey?key:randomUUID()));await signal(entered.promise);await blocked(admin,rp,lp);resume.release();const [a,b]=await Promise.all([one,two]);assert.equal(a.error,null);if(sameKey===true){assert.equal(b.error,null);assert.equal((b.value as {duplicate:boolean}).duplicate,true);}else assert.equal(b.error.status,409);assert.deepEqual(await counts(f.todos.map(x=>x.id),f.plan.planId),{revisions:2,histories:2,receipts:1});}finally{resume.release();await Promise.allSettled([one,two]);await Promise.all([left.end(),right.end()]);}
  });
  for(const preview of [true,false])for(const producerFirst of [true,false])for(const mutation of ['revoke','reduce'] as const)await t.test(`${preview?'preview':'owner commit'} grant fence vs ${mutation}: ${producerFirst?'producer':'manager'} wins`,async()=>{
   const f=await make(),pause=barrier(),resume=barrier(),entered=barrier(),pool=fixturePool('runtime',1),management=await manager.connect();let pid=0,held=false,work:ReturnType<typeof outcome>|undefined,manage:Promise<unknown>|undefined;
   // Readiness also mentions the function name; only the actual fence SELECT proves SHARE is held.
   const wrapped=observedPool(pool,async(sql,_v,p)=>{pid=p;entered.release();if(sql.startsWith('SELECT lifeos_agent.assert_business_grant(')&&producerFirst&&!held){held=true;pause.release();await resume.promise;}});
   const svc=service(f.authority,new PostgresPlatformRepository(wrapped,true,true,{organization:true,classification:true}));
   const change=async()=>mutation==='revoke'?management.query('UPDATE lifeos_agent.apikey SET enabled=false WHERE id=$1',[f.grant]):management.query('SELECT lifeos_agent.set_managed_grant_scopes($1,$2,$3,$4::jsonb)',[session,f.grant,(await management.query('SELECT lifeos_agent.managed_grant_digest($1) AS digest',[f.grant])).rows[0].digest,JSON.stringify({todo:['read']})]);
   try{await management.query('BEGIN');const mp=(await management.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const run=()=>outcome<unknown>(preview?svc.preview(f.agent,{changes:f.changes}):svc.commit(f.owner,confirmation(f.plan),randomUUID()));
    if(producerFirst){work=run();await signal(pause.promise);manage=change();await blocked(admin,mp,pid);resume.release();assert.equal((await work).error,null);await manage;await management.query('COMMIT');}
    else{await change();work=run();await signal(entered.promise);await blocked(admin,pid,mp);await management.query('COMMIT');assert.equal((await work).error.status,403);}
    assert.deepEqual(await counts(f.todos.map(x=>x.id),f.plan.planId),{revisions:!preview&&producerFirst?4:2,histories:!preview&&producerFirst?4:2,receipts:!preview&&producerFirst?1:0});
   }finally{resume.release();await management.query('ROLLBACK');await Promise.allSettled([work,manage]);management.release();await pool.end();}
  });
  await t.test('expiry and current permission CAS invalidate unconsumed plans',async()=>{
   for(const change of ['expiry','extended-expiry','extra-scope','lost-write'] as const){const f=await make(true);if(change==='expiry')await admin.query('UPDATE lifeos_agent.apikey SET "expiresAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1',[f.grant]);else if(change==='extended-expiry')await admin.query('UPDATE lifeos_agent.apikey SET "expiresAt"=clock_timestamp()+interval \'2 hours\' WHERE id=$1',[f.grant]);else{const digest=(await manager.query('SELECT lifeos_agent.managed_grant_digest($1) AS digest',[f.grant])).rows[0].digest;await manager.query('SELECT lifeos_agent.set_managed_grant_scopes($1,$2,$3,$4::jsonb)',[session,f.grant,digest,JSON.stringify({todo:change==='lost-write'?['read']:['read','write'],organization:change==='extra-scope'?['read','write']:['read']})]);}await assert.rejects(f.svc.commit(change==='lost-write'?f.agent:f.owner,confirmation(f.plan),randomUUID()),{status:change==='extra-scope'||change==='extended-expiry'?409:403});assert.deepEqual(await counts(f.todos.map(x=>x.id),f.plan.planId),{revisions:2,histories:2,receipts:0});}
  });
  await t.test('owner maintenance exclusive gate blocks whole classification before records',async()=>{const f=await make(),control=await admin.connect(),pool=fixturePool('runtime',1),entered=barrier();let pid=0,work:ReturnType<typeof outcome>|undefined;try{await control.query('BEGIN');await control.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[ownerMaintenanceKey(fixture.ownerId)]);const cp=(await control.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;const svc=service(f.authority,new PostgresPlatformRepository(observedPool(pool,async(_s,_v,p)=>{pid=p;entered.release();},true),true,true,{organization:true,classification:true}));work=outcome(svc.commit(f.owner,confirmation(f.plan),randomUUID()));await signal(entered.promise);await blocked(admin,pid,cp);assert.deepEqual(await counts(f.todos.map(x=>x.id),f.plan.planId),{revisions:2,histories:2,receipts:0});await control.query('COMMIT');assert.equal((await work).error,null);}finally{await control.query('ROLLBACK');await Promise.allSettled([work]);control.release();await pool.end();}});

  for(const opponent of ['project','todo','batch'] as const)for(const leader of ['classification','opponent'] as const)await t.test(`ordered physical rows: ${opponent} and classification, ${leader} leads`,async()=>{
   const grant=await seedGrant(true),authority=auth(grant),owner=(await authority.resolveOwnerActor(new Headers()))!,agent=(await authority.resolveAgentActor('synthetic'))!;
   const suffix=randomUUID().slice(-12),A='00000000-0000-4000-8000-'+suffix,Z='ffffffff-ffff-4fff-bfff-'+suffix,T='77777777-7777-4777-8777-'+suffix,U='88888888-8888-4888-8888-'+suffix;
   const put=async(type:'todo'|'domain'|'project',id:string)=>{const fields=type==='todo'?{title:'Synthetic ordered todo',notes:'keep',status:'open',dueOn:null}:{title:'Synthetic ordered '+type,text:'',occurredOn:null,personal:type==='project'?{type,stage:'active',purpose:null,nextStep:'',domain:null,topics:[]}:{type}};const raw={spaceId:fixture.spaceId,confirmed:true,fields},now=new Date().toISOString(),row={id,ownerId:fixture.ownerId,kind:type==='todo'?'todo':'inbox',draft:type==='todo'?fields:{...fields,disposition:'reference'},source:{id:randomUUID(),system:'website',externalId:id,version:1,asOf:now,original:{marker:'personal-manual-v1',spaceId:fixture.spaceId,type,input:raw}},revision:1,createdAt:now,updatedAt:now,syncState:'draft',externalStatus:null} as StoredEntry;await repo.transaction(fixture.ownerId,randomUUID(),tx=>tx.write(row,raw,true));return row;};
   const domain=await put('domain',A),project=await put('project',Z),todo=await put('todo',T),todo2=await put('todo',U),ref=(r:StoredEntry)=>({id:r.id,sourceId:r.source.id,revision:r.revision});
   const changes=[todo2,todo].map(row=>({todo:{id:row.id,sourceId:row.source.id,expectedRevision:1},before:null,after:{project:ref(project),domain:ref(domain),topics:[]}}));
   const svc=service(authority),plan=await svc.preview(agent,{changes});await svc.approve(owner,confirmation(plan));
   const second=opponent==='batch'?await svc.preview(agent,{changes:[...changes].reverse()}):null;if(second)await svc.approve(owner,confirmation(second));
   const left=fixturePool('runtime',1),right=fixturePool('runtime',1),paused=barrier(),resume=barrier(),connected=barrier();let lp=0,rp=0,held=false;const order:{classification:string[];opponent:string[]}={classification:[],opponent:[]};
   const instrument=(pool:Pool,label:'classification'|'opponent')=>observedPool(pool,async(sql,values,pid)=>{if(label==='classification')lp=pid;else rp=pid;if(label!==leader)connected.release();if(sql.includes('FOR UPDATE OF r')){order[label].push(JSON.stringify([values![1],values![2]]));if(label===leader&&!held&&(opponent!=='project'||values![1]==='inbox')){held=true;paused.release();await resume.promise;}}});
   const cr=new PostgresPlatformRepository(instrument(left,'classification'),true,true,{organization:true,classification:true}),or=new PostgresPlatformRepository(instrument(right,'opponent'),true,true,{organization:true,classification:true});
   const cs=service(authority,cr),os=service(authority,or),ordinary=new PersonalService(or,nativeConfig),key=randomUUID();let one:ReturnType<typeof outcome>|undefined,two:ReturnType<typeof outcome>|undefined;
   const runClass=()=>outcome(cs.commit(owner,confirmation(plan),key));
   const runOpponent=()=>outcome<unknown>(opponent==='batch'?os.commit(owner,confirmation(second!),randomUUID()):ordinary.mutate(fixture.ownerId,opponent,opponent==='project'?Z:T,{spaceId:fixture.spaceId,confirmed:true,expectedRevision:1,fields:opponent==='todo'?{...todo.draft,title:'Synthetic concurrent todo'}:{title:'Synthetic concurrent project',text:'',occurredOn:null,personal:{type:'project',stage:'active',purpose:null,nextStep:'',domain:ref(domain),topics:[]}}},randomUUID()));
   try{if(leader==='classification')one=runClass();else two=runOpponent();await signal(paused.promise);if(leader==='classification')two=runOpponent();else one=runClass();await signal(connected.promise);await blocked(admin,leader==='classification'?rp:lp,leader==='classification'?lp:rp);resume.release();const [a,b]=await Promise.all([one!,two!]);
    if(leader==='classification'){assert.equal(a.error,null);if(opponent==='project')assert.equal(b.error,null);else assert.equal(b.error.status,409);}else{assert.equal(b.error,null);assert.equal(a.error.status,409);}
    assert.deepEqual(order.classification,[JSON.stringify(['todo',T]),JSON.stringify(['todo',U]),JSON.stringify(['inbox',A]),JSON.stringify(['inbox',Z])]);
    if(opponent==='project')assert.deepEqual(order.opponent,[JSON.stringify(['inbox',A]),JSON.stringify(['inbox',Z])]);
    if(opponent==='batch')assert.deepEqual(order.opponent,order.classification);
    const expected=leader==='classification'?4:opponent==='batch'?4:opponent==='todo'?3:2;assert.deepEqual(await counts([T,U],plan.planId),{revisions:expected,histories:expected,receipts:leader==='classification'?1:0});
   }finally{resume.release();await Promise.allSettled([one,two]);await Promise.all([left.end(),right.end()]);}
  });

  await t.test('two occupied business connections use same-client readiness rather than borrow a third connection',async()=>{
   const first=await make(),second=await make(),pool=fixturePool('runtime',2),ready=barrier();let entered=0;
   const qualified=observedPool(pool,async sql=>{if(sql.includes("set_config('lifeos.classification_space_id'")){if(++entered===2)ready.release();await ready.promise;}});
   const repository=new PostgresPlatformRepository(qualified,true,true,{organization:true,classification:true});
   const svc=(f:typeof first)=>new ClassificationService(repository,nativeConfig,{authority:f.authority,assertReady:()=>verifyClassificationPool(pool),assertWritable:async()=>{},policyRevision:()=>classificationPolicyRevision(nativeConfig)});
   const jobs=[outcome(svc(first).commit(first.owner,confirmation(first.plan),randomUUID())),outcome(svc(second).commit(second.owner,confirmation(second.plan),randomUUID()))];
   try{const results=await Promise.all(jobs);for(const result of results)assert.equal(result.error,null);assert.equal(entered,2);}finally{ready.release();await Promise.allSettled(jobs);await pool.end();}
  });

  await t.test('three occupied business connections still revalidate native owner sessions through bounded read pool',async()=>{
   const {createPlatformAuth}=await import('../src/platform/auth.ts'),{createOwnerAuthority}=await import('../src/agent-authority/owner-adapter.ts');
   const pool=fixturePool('runtime',3),readPool=fixturePool('runtime',2),platform={baseURL:fixture.origin,ownerId:fixture.ownerId,ownerEmail:fixture.email,secret:fixture.sessionSecret,databaseURL:'synthetic-unused',sessionSeconds:1800};
   const nativeAuth=createPlatformAuth(platform,readPool,{requireMfa:true,forceSecureCookies:true,disableSessionRefresh:true,readOnlySessions:true}),authority=createOwnerAuthority(nativeAuth,platform,nativeConfig,id=>readCurrentAgentGrant(verifier,id));
   const context=await nativeAuth.$context,cookie=context.authCookies.sessionToken.name+'='+encodeURIComponent(session+'.'+createHmac('sha256',fixture.sessionSecret).update(session).digest('base64'));
   const owner=await authority.resolveOwnerActor(new Headers({cookie}));assert.ok(owner,'Synthetic verified MFA session must pass the native reader');
   const batches=await Promise.all([make(),make(),make()]),allEntered=barrier();let entered=0;
   const wrapped=observedPool(pool,async sql=>{if(sql.includes("set_config('lifeos.classification_space_id'")){if(++entered===3)allEntered.release();await allEntered.promise;}});
   const repository=new PostgresPlatformRepository(wrapped,true,true,{organization:true,classification:true}),svc=new ClassificationService(repository,nativeConfig,{authority,assertReady:()=>verifyClassificationPool(pool),assertWritable:async()=>{},policyRevision:()=>classificationPolicyRevision(nativeConfig)});
   const jobs=batches.map(f=>outcome(svc.commit(owner,confirmation(f.plan),randomUUID())));
   try{for(const result of await Promise.all(jobs))assert.equal(result.error,null);assert.equal(entered,3);assert.ok(readPool.totalCount<=2);assert.equal(pool.totalCount,3);}finally{allEntered.release();await Promise.allSettled(jobs);await Promise.all([pool.end(),readPool.end()]);}
  });

  await t.test('producer expiry committed ahead of a waiting owner fence rejects with zero writes',async()=>{
   const f=await make(),control=await admin.connect(),pool=fixturePool('runtime',1),entered=barrier();let pid=0,work:ReturnType<typeof outcome>|undefined;
   try{await control.query('BEGIN');await control.query('UPDATE lifeos_agent.apikey SET "expiresAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1',[f.grant]);const cp=(await control.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const svc=service(f.authority,new PostgresPlatformRepository(observedPool(pool,async(_s,_v,p)=>{pid=p;entered.release();},true),true,true,{organization:true,classification:true}));
    work=outcome(svc.commit(f.owner,confirmation(f.plan),randomUUID()));await signal(entered.promise);await blocked(admin,pid,cp);await control.query('COMMIT');assert.equal((await work).error.status,403);assert.deepEqual(await counts(f.todos.map(x=>x.id),f.plan.planId),{revisions:2,histories:2,receipts:0});
   }finally{await control.query('ROLLBACK');await Promise.allSettled([work]);control.release();await pool.end();}
  });
 }finally{await Promise.all([business.end(),admin.end(),verifier.end(),manager.end()]);}
});
