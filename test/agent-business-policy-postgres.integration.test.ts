import {StorageReviewService} from '../src/storage-review/service.ts';
import {assertAgentGrant} from '../src/agent-api/grant-fence.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {randomUUID,createHmac} from 'node:crypto';
import {Pool} from 'pg';
import {readBusinessPolicyCatalog} from '../src/agent-api/business-policy-postgres.ts';
import {readCurrentAgentGrant} from '../src/agent-api/runtime.ts';
import {agentOperations} from '../src/agent-api/capabilities.ts';
import {createPostgresKeyIssuer,readKeyIssuerConfig} from '../src/agent-api/key-issuer.ts';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {PostgresPlatformRepository,type SqlPool} from '../src/platform/postgres.ts';
import {prepareBusinessPolicyCI,policyCIPassword} from './helpers/business-policy-stage-pg.ts';
import {tmpdir} from 'node:os';

// Local mode owns a new cluster process; CI owns a dedicated empty Docker service.
// Neither mode reuses an initialized database or another qualification fixture.
test('OPT-IN fresh synthetic PostgreSQL all-business-policy qualification',{
 skip:process.env.RUN_BUSINESS_POLICY_POSTGRES_TESTS!=='1'&&'Fresh synthetic PostgreSQL policy fixture not requested',timeout:90000,
},async t=>{
 const ci=process.env.LIFEOS_POLICY_FIXTURE_CONTEXT==='github-actions'?await prepareBusinessPolicyCI():null;
 const bin=process.env.LIFEOS_POLICY_PG_BIN;
 if(!ci){
  assert.ok(process.env.CI!=='true'&&process.env.GITHUB_ACTIONS!=='true'&&bin&&/^\/private\/tmp\/lifeos-pg17\.[A-Za-z0-9]+\/install\/bin$/.test(bin));
  assert.match(execFileSync(join(bin,'postgres'),['--version'],{encoding:'utf8'}),/17\.11/);
 }
 const root=ci?tmpdir():await mkdtemp('/private/tmp/lifeos-policy-'),data=ci?'/var/lib/postgresql/data':join(root,'data');
 if(!ci){
  execFileSync(join(bin!,'initdb'),['-D',data,'-U','postgres','--auth=trust','--no-locale'],{stdio:'pipe'});
  // New process and private data path only; fixed test port never redirects to an existing server.
  execFileSync(join(bin!,'pg_ctl'),['-D',data,'-l',join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p 55449 -k ${root}`,'-w','start'],{stdio:'pipe'});
 }
 const pools:Pool[]=[];
 const connect=(user='postgres',database='lifeos_platform_test_local')=>{const p=ci?ci.connect(user,database):new Pool({host:'127.0.0.1',port:55449,database,user,max:4,connectionTimeoutMillis:2000,statement_timeout:7000,lock_timeout:5000});pools.push(p);return p;};
 const initial=connect('postgres','postgres');
 try{
  assert.equal((await initial.query("SELECT current_setting('data_directory') AS data")).rows[0].data,data);
  await initial.query('CREATE DATABASE lifeos_platform_test_local');
  const admin=connect();
  if(ci)await ci.bindDatabase(admin);
  for(const role of ['lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap','lifeos_agent_issuer','lifeos_agent_verifier','lifeos_agent_key_manager'])await admin.query(`CREATE ROLE ${role} LOGIN ${ci?`PASSWORD '${policyCIPassword}' `:''}NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION`);
  await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE CREATE ON DATABASE lifeos_platform_test_local FROM PUBLIC');
  await admin.query("SET lifeos.calendar_migration_approved='1'; SET lifeos.chat_migration_approved='1'");
  for(const name of ['0001_platform_candidate.sql','0002_platform_inbox.sql','0003_ai_settings.proposed.sql','0004_calendar.proposed.sql','0005_ai_chat.proposed.sql','platform-synthetic-bootstrap-grants.proposed.sql'])await admin.query(await readFile('db/'+name,'utf8'));
  await admin.query("SET lifeos.owner_mfa_migration_approved='native-totp-v1'");await admin.query(await readFile('db/0009_owner_mfa.proposed.sql','utf8'));
  await admin.query("SET lifeos.agent_migration_approved='1'; SET lifeos.agent_expected_database='lifeos_platform_test_local'");await admin.query(await readFile('db/0006_agent_api.proposed.sql','utf8'));
  const owner='policy-fixture-owner',space='policy-fixture-space',session='synthetic-policy-owner-session-0000001';
  await admin.query("SELECT set_config('lifeos.agent_key_manager_owner',$1,false),set_config('lifeos.agent_key_manager_space',$2,false),set_config('lifeos.agent_key_management_approved','1',false)",[owner,space]);await admin.query(await readFile('db/0010_agent_key_management.proposed.sql','utf8'));
  await admin.query('INSERT INTO lifeos_platform.platform_user(id,name,email,"twoFactorEnabled") VALUES($1,$1,$2,true)',[owner,'policy@example.test']);
  await admin.query('INSERT INTO lifeos_platform.platform_two_factor(id,secret,"backupCodes","userId",verified) VALUES($1,$2,$3,$4,true)',['policy-factor','synthetic-factor','synthetic-backup',owner]);
  await admin.query('INSERT INTO lifeos_platform.platform_session(id,token,"userId","expiresAt","mfaVerified") VALUES($1,$2,$3,clock_timestamp()+interval \'1 hour\',true)',[randomUUID(),session,owner]);
  await admin.query("SET lifeos.agent_business_grants_approved='1'");await admin.query(await readFile('db/0011_business_agent_grants.proposed.sql','utf8'));
  await admin.query("SELECT set_config('lifeos.agent_expected_owner',$1,false),set_config('lifeos.agent_expected_space',$2,false),set_config('lifeos.requirements_grants_approved','1',false)",[owner,space]);await admin.query(await readFile('db/0014_requirements_agent_grants.proposed.sql','utf8'));
  const manager=connect('lifeos_agent_key_manager'),runtime=connect('lifeos_platform_candidate_runtime'),verifier=connect('lifeos_agent_verifier');
  const seed=async()=>{const id=randomUUID();await admin.query('INSERT INTO lifeos_agent.apikey(id,"configId","referenceId",key,enabled,"createdAt","updatedAt","expiresAt",metadata,permissions) VALUES($1,\'default\',$2,$3,true,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval \'1 hour\',$4,$5)',[id,owner,'synthetic-hash-'+id,JSON.stringify({spaceId:space}),JSON.stringify({todo:['read']})]);return id;};
  const legacy=await seed();const prior=(await manager.query('SELECT lifeos_agent.managed_grant_digest($1) AS digest',[legacy])).rows[0].digest;
  await admin.query("SET lifeos.business_policy_approved='1'");await admin.query(await readFile('db/0016_all_personal_business_policy.proposed.sql','utf8'));
  const digest=async(id:string)=>(await manager.query('SELECT lifeos_agent.current_managed_grant_digest($1) AS digest',[id])).rows[0].digest as string;
  const cas=async(id:string,expected:string,policy:string|null,token=session,permissions={todo:['read']})=>manager.query('SELECT lifeos_agent.set_managed_business_grant($1,$2,$3,$4,$5) AS digest',[token,id,expected,JSON.stringify(permissions),policy]);
  const policy='all-personal-business-v1';
  const fence=async(id:string,expected:string|null,scopes=expected===null?['todo:read','todo:write']:['todo:write'],who=owner,where=space,operationId=scopes.includes('journal:write')?'writeJournal':scopes.includes('todo:write')?'createTodo':'getTodo')=>{const c=await runtime.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('lifeos.owner_id',$1,true)",[who]);const value=(await c.query('SELECT lifeos_agent.assert_current_business_grant($1,$2,$3,$4,$5,$6) AS allowed',[id,who,where,scopes,expected,operationId])).rows[0].allowed;await c.query('COMMIT');return value;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
  await t.test('migration changes no existing key and keeps exact legacy digest; policy starts closed',async()=>{
   assert.equal(await digest(legacy),prior);assert.equal((await readBusinessPolicyCatalog(manager)).enabled,false);
   await assert.rejects(cas(legacy,prior,policy),{code:'LG400'});assert.equal(await fence(legacy,null),false);assert.equal(await fence(legacy,null,['todo:read']),true);
  });
  await admin.query('UPDATE lifeos_agent.business_policy_control SET enabled=true; UPDATE lifeos_agent.business_policy_operation SET enabled=true');
  const all=await seed();const initialDigest=await digest(all);
  const initialIdentity=(await admin.query('SELECT key,"expiresAt" FROM lifeos_agent.apikey WHERE id=$1',[all])).rows[0];
  await cas(all,initialDigest,policy);
  await t.test('explicit MFA CAS changes only policy and permitted fallback; same command is no-op, stale CAS fails',async()=>{
   assert.notEqual(await digest(all),initialDigest);await assert.rejects(cas(all,initialDigest,null),{code:'LG409'});
   await assert.rejects(cas(all,await digest(all),null,'synthetic-unverified'),{code:'LG401'});
   const before=(await admin.query('SELECT count(*)::int AS n FROM lifeos_agent.grant_scope_audit WHERE grant_id=$1',[all])).rows[0].n;
   await cas(all,await digest(all),policy);assert.equal((await admin.query('SELECT count(*)::int AS n FROM lifeos_agent.grant_scope_audit WHERE grant_id=$1',[all])).rows[0].n,before);
   const audit=(await admin.query('SELECT before_policy,after_policy FROM lifeos_agent.grant_scope_audit WHERE grant_id=$1',[all])).rows[0];assert.deepEqual(audit,{before_policy:null,after_policy:policy});
   const row=(await admin.query('SELECT key,"expiresAt",metadata FROM lifeos_agent.apikey WHERE id=$1',[all])).rows[0];assert.equal(row.key,'synthetic-hash-'+all);assert.equal(JSON.parse(row.metadata).spaceId,space);
   assert.deepEqual({key:row.key,expiresAt:row.expiresAt},initialIdentity);
   const stable=await digest(all);await admin.query('UPDATE lifeos_agent.apikey SET "requestCount"=COALESCE("requestCount",0)+1,"updatedAt"=clock_timestamp() WHERE id=$1',[all]);assert.equal(await digest(all),stable);
   await assert.rejects(manager.query('SELECT lifeos_agent.set_managed_grant_scopes($1,$2,$3,$4)',[session,all,initialDigest,'{"todo":["read"]}']),{code:'LG409'});
  });
  await t.test('all-policy permits registered data, future reviewed registration; denies unknown/protected/write-only/closed gates',async()=>{
   assert.equal(await fence(all,policy),true);assert.equal(await fence(all,null,['todo:read']),false);
   for(const scopes of [['account:read'],['keys:read'],['payment:read'],['mystery:read'],['organization:write']])assert.equal(await fence(all,policy,scopes),false);
   for(const scopes of [['account:read'],['payment:read']])await assert.rejects(admin.query('INSERT INTO lifeos_agent.business_policy_operation(operation_id,required_scopes,enabled) VALUES($1,$2,true)',[randomUUID().replaceAll('-',''),scopes]),{code:'23514'});
   await admin.query("INSERT INTO lifeos_agent.business_policy_operation(operation_id,required_scopes,enabled) VALUES('writeJournal',ARRAY['journal:read','journal:write'],true)");assert.equal(await fence(all,policy,['journal:read','journal:write']),true);
   // Runtime refuses SQL entries until the matching reviewed code operation is deployed.
   await assert.rejects(readBusinessPolicyCatalog(verifier),/registry mismatch/);await admin.query("DELETE FROM lifeos_agent.business_policy_operation WHERE operation_id='writeJournal'");
   await admin.query('UPDATE lifeos_agent.business_policy_control SET enabled=false');assert.equal(await fence(all,policy),false);await admin.query('UPDATE lifeos_agent.business_policy_control SET enabled=true');
  });
  await t.test('current reader denies policy when runtime is off and derives policy scopes only through current gates',async()=>{
   assert.equal(await readCurrentAgentGrant(verifier,all),null);
   const options=async()=>({ownerId:owner,spaceId:space,policyEnabled:true,registry:agentOperations,operationAvailable:(id:string)=>id==='getTodo'});
   const current=await readCurrentAgentGrant(verifier,all,options);assert.deepEqual(current?.scopes,['todo:read']);assert.equal(current?.businessDataPolicy,policy);
   const changedOperation=await readCurrentAgentGrant(verifier,all,async()=>({...await options(),operationAvailable:(id:string)=>id==='listTodos'}));
   assert.deepEqual(changedOperation?.scopes,current?.scopes);assert.notEqual(changedOperation?.authorizationRevision,current?.authorizationRevision,'A different operation claim changes producer revision even when scopes coincide');
   const before=current!.authorizationRevision;await cas(all,await digest(all),null);assert.equal(await fence(all,policy,['todo:read']),false);assert.notEqual((await readCurrentAgentGrant(verifier,all))!.authorizationRevision,before);await cas(all,await digest(all),policy);
  });
  await t.test('exact operation and exact scope claims deny disabled/unregistered same-scope operations while legacy scopes remain unchanged',async()=>{
   const id=await seed();await cas(id,await digest(id),policy);
   const explicit=await seed();await cas(explicit,await digest(explicit),null,session,{todo:['read','write']});
   assert.equal(await fence(id,policy,['todo:read'],owner,space,'createTodo'),false);
   assert.equal(await fence(id,policy,['todo:write','todo:read'],owner,space,'createTodo'),false);
   assert.equal(await fence(id,policy,['todo:read','todo:write'],owner,space,'unknownOperation'),false);
   assert.equal((await admin.query("SELECT lifeos_agent.valid_personal_business_scopes(ARRAY['todo:write']) AS valid")).rows[0].valid,false,'Grant authorization language still requires read with write');
   for(const operationId of ['futureTodoWrite','createTodoHighRisk','eraseTodo'])await assert.rejects(admin.query('INSERT INTO lifeos_agent.business_policy_operation(operation_id,required_scopes,enabled) VALUES($1,$2,true)',[operationId,['todo:write']]),{code:'23514'});
   try{
    await admin.query("UPDATE lifeos_agent.business_policy_operation SET enabled=false WHERE operation_id='createTodo'");
    assert.equal(await fence(id,policy),false);assert.equal(await fence(id,policy,['todo:write'],owner,space,'updateTodo'),true);
    assert.equal(await fence(explicit,null),true,'Explicit grants retain original scoped authorization independent of policy registry');
    await admin.query("DELETE FROM lifeos_agent.business_policy_operation WHERE operation_id='createTodo'");assert.equal(await fence(id,policy),false);
   }finally{await admin.query("INSERT INTO lifeos_agent.business_policy_operation(operation_id,required_scopes,enabled) VALUES('createTodo',ARRAY['todo:write'],true) ON CONFLICT(operation_id) DO UPDATE SET required_scopes=EXCLUDED.required_scopes,enabled=true");}
  });
  const gateChanges={
   'operation-disabled':"UPDATE lifeos_agent.business_policy_operation SET enabled=false WHERE operation_id='createTodo'",
   'operation-unregistered':"DELETE FROM lifeos_agent.business_policy_operation WHERE operation_id='createTodo'",
   'operation-scopes-changed':"UPDATE lifeos_agent.business_policy_operation SET required_scopes=ARRAY['todo:read'] WHERE operation_id='createTodo'",
   'policy-closed':'UPDATE lifeos_agent.business_policy_control SET enabled=false',
  };
  for(const [change,sql]of Object.entries(gateChanges))for(const leader of ['fence','change'] as const)await t.test(`policy gate serializes ${change} with ${leader} first`,async()=>{
   const id=await seed();await cas(id,await digest(id),policy);
   const writer=await runtime.connect(),changer=await admin.connect();
   try{
    await writer.query('BEGIN');await changer.query('BEGIN');await writer.query("SELECT set_config('lifeos.owner_id',$1,true)",[owner]);
    const writerPid=(await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,changerPid=(await changer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const check=()=>writer.query('SELECT lifeos_agent.assert_current_business_grant($1,$2,$3,$4,$5,$6) AS allowed',[id,owner,space,['todo:write'],policy,'createTodo']);
    const blocked=async(waiter:number,holder:number)=>{const deadline=Date.now()+3000;while(!(await admin.query('SELECT $2::int=ANY(pg_blocking_pids($1)) AS blocked',[waiter,holder])).rows[0].blocked){assert.ok(Date.now()<deadline,'Expected exact gate row lock');await new Promise(resolve=>setTimeout(resolve,5));}};
    if(leader==='fence'){
     assert.equal((await check()).rows[0].allowed,true);const pending=changer.query(sql);await blocked(changerPid,writerPid);
     await writer.query('COMMIT');await pending;await changer.query('COMMIT');assert.equal(await fence(id,policy),false);
    }else{
     await changer.query(sql);const pending=check();await blocked(writerPid,changerPid);await changer.query('COMMIT');
     assert.equal((await pending).rows[0].allowed,false);await writer.query('COMMIT');
    }
   }finally{
    await writer.query('ROLLBACK');await changer.query('ROLLBACK');writer.release();changer.release();
    await admin.query("UPDATE lifeos_agent.business_policy_control SET enabled=true; INSERT INTO lifeos_agent.business_policy_operation(operation_id,required_scopes,enabled) VALUES('createTodo',ARRAY['todo:write'],true) ON CONFLICT(operation_id) DO UPDATE SET required_scopes=EXCLUDED.required_scopes,enabled=true");
   }
  });
  await t.test('wrong owner/space, revocation and expiry independently deny and direct roles cannot mutate policy or registry',async()=>{
   assert.equal(await fence(all,policy,['todo:read'],'foreign-owner'),false);assert.equal(await fence(all,policy,['todo:read'],owner,'foreign-space'),false);
   for(const role of [manager,verifier,runtime]){await assert.rejects(role.query('UPDATE lifeos_agent.business_policy_control SET enabled=true'),{code:'42501'});await assert.rejects(role.query('UPDATE lifeos_agent.apikey SET metadata=\'{}\' WHERE id=$1',[all]),{code:'42501'});}
   await admin.query('UPDATE lifeos_agent.apikey SET enabled=false WHERE id=$1',[all]);assert.equal(await fence(all,policy),false);await admin.query('UPDATE lifeos_agent.apikey SET enabled=true,"expiresAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1',[all]);assert.equal(await fence(all,policy),false);
  });
  for(const leader of ['fence','revoke','remove-policy'] as const)await t.test(`authorization row serializes ${leader} against a pending write fence`,async()=>{
   const id=await seed();await cas(id,await digest(id),policy);
   const left=await admin.connect(),right=await runtime.connect();
   try{
    await left.query('BEGIN');await right.query('BEGIN');
    await right.query("SELECT set_config('lifeos.owner_id',$1,true)",[owner]);
    if(leader==='fence'){
     const leftPid=(await left.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
     await right.query('SELECT lifeos_agent.assert_current_business_grant($1,$2,$3,$4,$5,$6)',[id,owner,space,['todo:write'],policy,'createTodo']);
     const change=left.query('UPDATE lifeos_agent.apikey SET enabled=false WHERE id=$1',[id]);
     const rightPid=(await right.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
     const deadline=Date.now()+3000;
     while(!(await admin.query('SELECT $2::int=ANY(pg_blocking_pids($1)) AS blocked',[leftPid,rightPid])).rows[0].blocked){assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,5));}
     await right.query('COMMIT');await change;await left.query('COMMIT');assert.equal(await fence(id,policy),false);
    }else{
     await left.query(leader==='revoke'?'UPDATE lifeos_agent.apikey SET enabled=false WHERE id=$1':"UPDATE lifeos_agent.apikey SET metadata=(metadata::jsonb-'businessDataPolicy')::text WHERE id=$1",[id]);
     const rightPid=(await right.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,leftPid=(await left.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
     const pending=right.query('SELECT lifeos_agent.assert_current_business_grant($1,$2,$3,$4,$5,$6) AS allowed',[id,owner,space,['todo:read'],policy,'getTodo']);
     const deadline=Date.now()+3000;
     while(!(await admin.query('SELECT $2::int=ANY(pg_blocking_pids($1)) AS blocked',[rightPid,leftPid])).rows[0].blocked){assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,5));}
     await left.query('COMMIT');assert.equal((await pending).rows[0].allowed,false);await right.query('COMMIT');
    }
   }finally{await left.query('ROLLBACK');await right.query('ROLLBACK');left.release();right.release();}
  });
  await t.test('policy-aware issuer lists actual policy and issues with explicit selection using existing owner MFA',async()=>{
   const config=readKeyIssuerConfig({socketPath:join(root,'issuer.sock'),baseURL:'https://policy.example.test',databaseURL:ci?.managerURL??'postgresql://lifeos_agent_key_manager:synthetic-unused@127.0.0.1:55449/lifeos_platform_test_local',ownerId:owner,ownerEmail:'policy@example.test',spaceId:space,sessionSecret:'synthetic-policy-session-secret-0000000000',agentSecret:'synthetic-policy-agent-secret-0000000000000',businessScopes:'requirements-v1',businessDataPolicy:policy});
   const issuer=await createPostgresKeyIssuer(config);try{const signature=createHmac('sha256',config.sessionSecret).update(session).digest('base64'),cookie='__Secure-lifeos-platform-candidate.session_token='+encodeURIComponent(session+'.'+signature);
    const result=await issuer.handle('create',cookie,{name:'Synthetic policy key',scopes:['todo:read'],expiresInDays:7,businessDataPolicy:policy});assert.equal(result.status,201);
    const issued=result.body as {key:string;grant:{id:string}};
    const resolver=async()=>({ownerId:owner,spaceId:space,policyEnabled:true,registry:agentOperations,operationAvailable:(id:string)=>['listTodos','snapshotTodos','getTodo','createTodo','updateTodo'].includes(id)});
    const personal={ownerId:owner,ownerEmail:'policy@example.test',spaceId:space,baseURL:config.baseURL,databaseName:'lifeos_platform_test_local',approval:'personal-manual-v1',allowedTypes:['todo']} as const;
    let disableCreateOnGuard=false;
    const handler=createAgentHandler({enabled:true,config:personal,repository:new PostgresPlatformRepository(runtime as SqlPool,true,true,{organization:false,classification:false,businessDataPolicy:true}),fenceWrites:true,
     verify:async key=>key===issued.key?readCurrentAgentGrant(verifier,issued.grant.id,resolver):null,readCurrentGrant:id=>readCurrentAgentGrant(verifier,id,resolver),operationAvailable:()=>true,assertWritable:async()=>{
      if(disableCreateOnGuard){disableCreateOnGuard=false;await admin.query("UPDATE lifeos_agent.business_policy_operation SET enabled=false WHERE operation_id='createTodo'");}
     }});
    const send=(path:string,method='GET',body?:unknown,commandKey='synthetic-policy-replay-00001')=>handler(new Request(config.baseURL+path,{method,headers:{host:'policy.example.test',authorization:'Bearer '+issued.key,'idempotency-key':commandKey,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));
    const write={fields:{title:'Synthetic policy todo',notes:'',status:'open',dueOn:null}};
    const created=await send('/v1/todos','POST',write);assert.equal(created.status,201);const receipt=await created.json();
    const replay=await send('/v1/todos','POST',write);assert.equal(replay.status,200);assert.equal((await replay.json()).duplicate,true);
    const read=await send('/v1/todos/'+receipt.entry.id);assert.equal(read.status,200);assert.equal((await read.json()).revision,receipt.entry.revision);
    disableCreateOnGuard=true;
    try{
     const count=async()=>Number((await admin.query('SELECT count(*) AS n FROM lifeos_platform.platform_record WHERE owner_id=$1',[owner])).rows[0].n);
     const before=await count(),closed=await send('/v1/todos','POST',{fields:{...write.fields,title:'Must not create after operation closure'}},'synthetic-policy-closed-create');
     assert.equal((await admin.query("SELECT enabled FROM lifeos_agent.business_policy_operation WHERE operation_id='updateTodo'")).rows[0].enabled,true);
     assert.equal(closed.status,403,'Closing createTodo after HTTP authority must deny despite updateTodo sharing every scope');
     assert.equal(await count(),before);
    }finally{await admin.query("UPDATE lifeos_agent.business_policy_operation SET enabled=true WHERE operation_id='createTodo'");}
    await cas(issued.grant.id,await digest(issued.grant.id),null);assert.equal((await send('/v1/todos','POST',write)).status,403);
    const page=await issuer.handle('list',cookie,{});assert.equal(page.status,200);const body=page.body as {availablePolicies:string[];keys:{businessDataPolicy?:string}[]};assert.deepEqual(body.availablePolicies,[policy]);assert.ok(body.keys.some(key=>key.businessDataPolicy===policy));
   }finally{await issuer.close();}
  });
  await t.test('storage review registration stays disabled until explicit activation and uses the actual scoped SQL fence',async()=>{
   // Earlier lock tests check out the admin session while querying blockers,
   // creating another pool connection. Bind this migration on one exact client;
   // a later pool.query must not inherit another session's target approval.
   const migration=await admin.connect();
   try{
    await migration.query("SELECT set_config('lifeos.agent_expected_database',$1,false),set_config('lifeos.agent_expected_owner',$2,false),set_config('lifeos.agent_expected_space',$3,false),set_config('lifeos.storage_review_agent_approved','1',false)",['lifeos_platform_test_local',owner,space]);
    const binding=(await migration.query("SELECT current_database() AS database,current_user AS role,current_setting('lifeos.agent_expected_database') AS target,current_setting('lifeos.agent_expected_owner') AS owner,current_setting('lifeos.agent_expected_space') AS space,current_setting('lifeos.storage_review_agent_approved') AS approved")).rows[0];
    assert.deepEqual(binding,{database:'lifeos_platform_test_local',role:'postgres',target:'lifeos_platform_test_local',owner,space,approved:'1'});
    await migration.query(await readFile('db/0019_storage_review_agent_operations.proposed.sql','utf8'));
   }finally{migration.release(true);}
   const reviewIds=['snapshotStorageReviews','getStorageReview','createStorageReview','updateStorageReviewChecklist','updateStorageReviewDecision'];
   const registered=(await readBusinessPolicyCatalog(verifier)).operations.filter(op=>reviewIds.includes(op.id));assert.equal(registered.length,5);assert.ok(registered.every(op=>op.enabled===false));
   await admin.query('UPDATE lifeos_agent.business_policy_operation SET enabled=true WHERE operation_id=ANY($1::text[])',[reviewIds]);
   const id=await seed();await cas(id,await digest(id),policy);
   const resolver=async()=>{const catalog=await readBusinessPolicyCatalog(verifier);return{ownerId:owner,spaceId:space,policyEnabled:catalog.enabled,registry:agentOperations,operationAvailable:(id:string)=>reviewIds.includes(id)&&catalog.operations.some(op=>op.id===id&&op.enabled)};};
   const personal={ownerId:owner,ownerEmail:'policy@example.test',spaceId:space,baseURL:'https://policy.example.test',databaseName:'lifeos_platform_test_local',approval:'personal-manual-v1',allowedTypes:['todo','journal']} as const;
   const modules={organization:false,classification:false,businessDataPolicy:true,storageReview:true};
   const repository=new PostgresPlatformRepository(runtime as SqlPool,true,true,modules),handler=createAgentHandler({enabled:true,config:personal,modules,repository,fenceWrites:true,verify:async()=>readCurrentAgentGrant(verifier,id,resolver),readCurrentGrant:key=>readCurrentAgentGrant(verifier,key,resolver),operationAvailable:async id=>(await resolver()).operationAvailable(id),assertWritable:async()=>{}});
   const send=(path:string,method='GET',body?:unknown,key=randomUUID())=>handler(new Request(personal.baseURL+path,{method,headers:{host:'policy.example.test',authorization:'Bearer synthetic-storage-grant','idempotency-key':key,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));
   const checklist={schema:1,revision:'synthetic-policy-storage-v1',context:{summary:'Synthetic only'},items:[{id:'P-1',title:'Synthetic example',body:'No real paths',question:'Keep?',group:'Synthetic',kind:'file',status:'pending'}]};
   const response=await send('/v1/storage-reviews','POST',{fields:{checklist}});assert.equal(response.status,201);const created=await response.json();
   const args={expectedRevision:1,fields:{checklistRevision:checklist.revision,itemId:'P-1',decision:'keep'}},key=randomUUID();
   const choice=await send('/v1/storage-reviews/'+created.entry.id+'/decisions','PATCH',args,key);assert.equal(choice.status,200);assert.equal((await choice.json()).entry.revision,2);
   const duplicate=await send('/v1/storage-reviews/'+created.entry.id+'/decisions','PATCH',args,key);assert.equal((await duplicate.json()).duplicate,true);
   const current=await send('/v1/storage-reviews/'+created.entry.id);assert.deepEqual((await current.json()).entry.fields.decisions,[{id:'P-1',decision:'keep'}]);
   const actor={grantId:id,ownerId:owner,spaceId:space,businessDataPolicy:'all-personal-business-v1' as const};
   await admin.query("UPDATE lifeos_agent.business_policy_operation SET enabled=false WHERE operation_id='updateStorageReviewDecision'");
   const service=new StorageReviewService(repository,personal);
   await assert.rejects(service.saveDecisionResult(owner,{expectedRevision:2,checklistRevision:checklist.revision,id:'P-1',decision:'defer'},randomUUID(),undefined,tx=>assertAgentGrant(tx,actor,['storage-review:read','storage-review:write'],'updateStorageReviewDecision')),error=>!!error&&typeof error==='object'&&'code'in error&&error.code==='WRITE_GRANT_REVOKED');
   assert.equal((await service.get(owner))?.revision,2);
   await admin.query('UPDATE lifeos_agent.business_policy_operation SET enabled=true WHERE operation_id=ANY($1::text[])',[reviewIds]);
  });
  await t.test('readiness refuses broader function EXECUTE and direct registry access',async()=>{
   await admin.query('GRANT EXECUTE ON FUNCTION lifeos_agent.set_managed_business_grant(text,text,text,jsonb,text) TO PUBLIC');
   await assert.rejects(readBusinessPolicyCatalog(verifier),/qualification unavailable/);
   await admin.query('REVOKE EXECUTE ON FUNCTION lifeos_agent.set_managed_business_grant(text,text,text,jsonb,text) FROM PUBLIC');
   await admin.query('GRANT SELECT ON lifeos_agent.business_policy_operation TO lifeos_agent_verifier');
   await assert.rejects(readBusinessPolicyCatalog(verifier),/qualification unavailable/);
   await admin.query('REVOKE SELECT ON lifeos_agent.business_policy_operation FROM lifeos_agent_verifier');
   assert.equal((await readBusinessPolicyCatalog(verifier)).enabled,true);
  });
  for(const table of ['business_policy_control','business_policy_operation'])for(const [privilege,target]of [
   ['UPDATE','lifeos_agent_issuer'],['INSERT','lifeos_agent_issuer'],['DELETE','lifeos_agent_issuer'],
   ['UPDATE(enabled)','lifeos_agent_issuer'],['UPDATE WITH GRANT OPTION','lifeos_agent_issuer'],
   ['UPDATE(enabled) WITH GRANT OPTION','lifeos_agent_issuer'],['UPDATE','PUBLIC'],
  ] as const)await t.test(`registry readiness rejects ${table} ${privilege} for previously unchecked ${target}`,async()=>{
   const grantOption=privilege.endsWith(' WITH GRANT OPTION'),action=privilege.replace(' WITH GRANT OPTION','');
   try{
    await admin.query(`GRANT ${action} ON lifeos_agent.${table} TO ${target}${grantOption?' WITH GRANT OPTION':''}`);
    await assert.rejects(readBusinessPolicyCatalog(verifier),/qualification unavailable/);
   }finally{
    await admin.query(`REVOKE ALL PRIVILEGES ON lifeos_agent.${table} FROM ${target}; REVOKE ALL PRIVILEGES(enabled) ON lifeos_agent.${table} FROM ${target}`);
   }
   assert.equal((await readBusinessPolicyCatalog(verifier)).enabled,true);
  });
 }finally{
  await Promise.all(pools.map(pool=>pool.end()));if(!ci)execFileSync(join(bin!,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{stdio:'pipe'});
 }
});
