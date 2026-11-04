import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHmac,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool,type PoolClient} from 'pg';
import {prepareOrganizationFixture,fixturePool,fixture,fixtureManagerURL} from './helpers/organization-stage-pg.ts';
import {createPostgresKeyIssuer,readKeyIssuerConfig,type KeySummary} from '../src/agent-api/key-issuer.ts';
import {PostgresPlatformRepository,verifyRestrictedPool,type SqlPool} from '../src/platform/postgres.ts';
import {assertAgentGrant} from '../src/agent-api/grant-fence.ts';
import * as runtime from '../src/agent-api/runtime.ts';
import {ownerMaintenanceKey} from '../src/deployment-candidate/owner-maintenance-key.ts';
import type {AgentScope} from '../src/agent-api/scopes.ts';

const all=['todo:read','todo:write','organization:read','organization:write'] as const;
const allPermissions={todo:['read','write'],organization:['read','write']};
const session=randomUUID().replaceAll('-','');
const signed='__Secure-lifeos-platform-candidate.session_token='+encodeURIComponent(session+'.'+createHmac('sha256',fixture.sessionSecret).update(session).digest('base64'));
const config=()=>readKeyIssuerConfig({socketPath:'/tmp/organization-fixture.sock',baseURL:fixture.origin,databaseURL:fixtureManagerURL(),
 ownerId:fixture.ownerId,ownerEmail:fixture.email,spaceId:fixture.spaceId,sessionSecret:fixture.sessionSecret,agentSecret:fixture.agentSecret,businessScopes:'organization-v1'});
async function waitBlocked(admin:Pool,pid:number,blocker:number){
 const deadline=Date.now()+4000;
 while(Date.now()<deadline){
  if((await admin.query('SELECT $2::int=ANY(pg_blocking_pids($1)) AS blocked',[pid,blocker])).rows[0].blocked)return;
  await delay(10);
 }
 assert.fail('Expected deterministic database lock barrier was not observed');
}

test('OPT-IN isolated business grant qualification',{
 skip:process.env.RUN_ORGANIZATION_POSTGRES_TESTS!=='1'&&'No explicitly declared isolated organization fixture',timeout:90000,
},async t=>{
 await prepareOrganizationFixture();
 const admin=fixturePool('admin'),manager=fixturePool('manager'),business=fixturePool('runtime',3),verifier=fixturePool('verifier');
 const binding=(id:string)=>({grantId:id,ownerId:fixture.ownerId,spaceId:fixture.spaceId});
 const digest=async(id:string)=>(await manager.query('SELECT lifeos_agent.managed_grant_digest($1) AS digest',[id])).rows[0].digest as string;
 const seed=async(permissions:unknown=allPermissions,expiry='1 hour')=>{
  const id=randomUUID();
  await admin.query(`INSERT INTO lifeos_agent.apikey(id,"configId","referenceId",key,enabled,"createdAt","updatedAt","expiresAt",metadata,permissions)
    VALUES($1,'default',$2,$3,true,clock_timestamp(),clock_timestamp(),clock_timestamp()+$4::interval,$5,$6)`,
   [id,fixture.ownerId,'synthetic-digest-'+id,expiry,JSON.stringify({spaceId:fixture.spaceId}),JSON.stringify(permissions)]);
  return id;
 };
 const cas=async(id:string,expected:string,permissions:unknown,token=session,client:Pool|PoolClient=manager)=>
  client.query('SELECT lifeos_agent.set_managed_grant_scopes($1,$2,$3,$4::jsonb) AS digest',[token,id,expected,JSON.stringify(permissions)]);
 const repo=new PostgresPlatformRepository(business as SqlPool,true,true,{organization:true,classification:false});
 try{
  await admin.query('INSERT INTO lifeos_platform.platform_session(id,token,"userId","expiresAt","mfaVerified") VALUES($1,$2,$3,clock_timestamp()+interval \'1 hour\',true)',[randomUUID(),session,fixture.ownerId]);
  await t.test('same-key scope CAS preserves identity expiry and secret; usage does not alter grant digest; audit is secret-free',async()=>{
   const id=await seed({todo:['read']});const before=await digest(id);
   assert.match(before,/^[a-f0-9]{64}$/);
   const identity=(await admin.query('SELECT id,key,"referenceId",metadata,"createdAt","expiresAt" FROM lifeos_agent.apikey WHERE id=$1',[id])).rows[0];
   await verifier.query('UPDATE lifeos_agent.apikey SET "requestCount"=1,"lastRequest"=clock_timestamp(),"updatedAt"=clock_timestamp() WHERE id=$1',[id]);
   assert.equal(await digest(id),before);
   await cas(id,before,allPermissions);
   const after=await digest(id);assert.notEqual(after,before);
   const current=(await admin.query('SELECT id,key,"referenceId",metadata,"createdAt","expiresAt" FROM lifeos_agent.apikey WHERE id=$1',[id])).rows[0];
   assert.ok(JSON.stringify(identity)===JSON.stringify(current),'Grant identity, owner, expiry and secret remain unchanged');
   await cas(id,after,allPermissions);
   const audits=(await admin.query('SELECT * FROM lifeos_agent.grant_scope_audit WHERE grant_id=$1',[id])).rows;
   assert.equal(audits.length,1);assert.equal(audits[0].owner_id,fixture.ownerId);assert.equal(audits[0].space_id,fixture.spaceId);
   assert.deepEqual(audits[0].before_permissions,{todo:['read']});assert.deepEqual(audits[0].after_permissions,allPermissions);
   assert.equal(audits[0].before_digest,before);assert.equal(audits[0].after_digest,after);
   assert.ok(!JSON.stringify(audits).includes(session)&&!JSON.stringify(audits).includes(identity.key));
   const fresh=fixturePool('manager');try{assert.equal((await fresh.query('SELECT lifeos_agent.managed_grant_digest($1) AS digest',[id])).rows[0].digest,after);}finally{await fresh.end();}
  });
  await t.test('MFA, expiry, revoke, fixed binding, stale digest and malformed permissions reject scope changes',async()=>{
   const id=await seed();const before=await digest(id);
   await assert.rejects(cas(id,'0'.repeat(64),{todo:['read']}),{code:'LG409'});
   await assert.rejects(cas(id,before,{todo:['read']},'synthetic-no-session'),{code:'LG401'});
   for(const permissions of [{},{todo:['write']},{organization:['write']},{unknown:['read']},{todo:['read','read']},null,[]])
    await assert.rejects(cas(id,before,permissions),{code:'LG400'});
   await admin.query('UPDATE lifeos_platform.platform_session SET "mfaVerified"=false WHERE token=$1',[session]);
   try{await assert.rejects(cas(id,before,{todo:['read']}),{code:'LG401'});}finally{await admin.query('UPDATE lifeos_platform.platform_session SET "mfaVerified"=true WHERE token=$1',[session]);}
   await admin.query('UPDATE lifeos_platform.platform_session SET "expiresAt"=clock_timestamp()-interval \'1 second\' WHERE token=$1',[session]);
   try{await assert.rejects(cas(id,before,{todo:['read']}),{code:'LG401'});}finally{await admin.query('UPDATE lifeos_platform.platform_session SET "expiresAt"=clock_timestamp()+interval \'1 hour\' WHERE token=$1',[session]);}
   await admin.query('UPDATE lifeos_agent.apikey SET enabled=false WHERE id=$1',[id]);
   await assert.rejects(cas(id,await digest(id),{todo:['read']}),{code:'LG403'});
   const expired=await seed(allPermissions,'-1 second');await assert.rejects(cas(expired,await digest(expired),{todo:['read']}),{code:'LG403'});
   const foreign=await seed();await admin.query('UPDATE lifeos_agent.apikey SET metadata=$2 WHERE id=$1',[foreign,JSON.stringify({spaceId:'synthetic-foreign-space'})]);
   assert.equal(await digest(foreign),null);await assert.rejects(cas(foreign,'0'.repeat(64),{todo:['read']}),{code:'LG403'});
   assert.equal((await admin.query('SELECT count(*)::int AS n FROM lifeos_agent.grant_scope_audit WHERE grant_id=$1',[id])).rows[0].n,0);
  });
  await t.test('manager has narrow EXECUTE only; verifier cannot manage grants or access business data',async()=>{
   const id=await seed();
   for(const [column,value]of [['permissions','{}'],['metadata','{}'],['key','synthetic-replacement'],['expiresAt','2030-01-01'],['referenceId','synthetic-foreign']])
    await assert.rejects(manager.query(`UPDATE lifeos_agent.apikey SET "${column}"=$2 WHERE id=$1`,[id,value]),{code:'42501'});
   for(const pool of [manager,verifier])await assert.rejects(pool.query('SELECT * FROM lifeos_platform.platform_record'),{code:'42501'});
   await assert.rejects(verifier.query('SELECT lifeos_agent.set_managed_grant_scopes($1,$2,$3,$4)',[session,id,await digest(id),'{}']),{code:'42501'});
   await assert.rejects(verifier.query('SELECT lifeos_agent.managed_grant_digest($1)',[id]),{code:'42501'});
   await assert.rejects(manager.query('SELECT * FROM lifeos_agent.grant_scope_audit'),{code:'42501'});
   await assert.rejects(business.query('SELECT * FROM lifeos_agent.apikey'),{code:'42501'});
   await verifyRestrictedPool(business as SqlPool);
  });
  await t.test('read-only producer fence permits preview and rejects empty unknown insufficient or forged requirements',async()=>{
   const id=await seed({todo:['read'],organization:['read']});
   await repo.transaction(fixture.ownerId,randomUUID(),async tx=>{
    await assertAgentGrant(tx,binding(id),['todo:read','organization:read']);
    for(const required of [[],['unknown:read'],['organization:write'],['organization:read','organization:write']])
      await assert.rejects(assertAgentGrant(tx,binding(id),required as AgentScope[]),{status:403});
    await assert.rejects(assertAgentGrant(tx,{...binding(id),spaceId:'synthetic-foreign-space'},['organization:read']),{status:403});
    await assert.rejects(assertAgentGrant(tx,{...binding(id),ownerId:'synthetic-foreign-owner'},['organization:read']),{status:403});
   });
  });
  // Both sides use dedicated connections; pg_blocking_pids proves the waiting query is actually blocked.
  for(const preview of [true,false])for(const mutation of ['reduce','revoke'] as const)for(const producerFirst of [true,false]){
   await t.test(`${preview?'read-only preview':'business write'} fence serializes ${mutation}: ${producerFirst?'producer':'management'} wins`,async()=>{
    const id=await seed(preview?{todo:['read'],organization:['read']}:allPermissions),expected=await digest(id);
    const left=await business.connect(),right=await manager.connect();
    let waiting:Promise<unknown>|undefined;
    const scopes=preview?['todo:read','organization:read']:all;
    const command=randomUUID();const record=randomUUID();const source=randomUUID();
    const produce=async()=>{
     const allowed=(await left.query('SELECT lifeos_agent.assert_business_grant($1,$2,$3,$4::text[]) AS allowed',[id,fixture.ownerId,fixture.spaceId,scopes])).rows[0].allowed;
     if(!allowed)return false;
     if(preview){await left.query('SELECT id FROM lifeos_platform.platform_record WHERE owner_id=$1',[fixture.ownerId]);return true;}
     await left.query(`INSERT INTO lifeos_platform.platform_source(owner_id,id,system,external_id,version,as_of,original) VALUES($1,$2::uuid,'website',$2::text,1,clock_timestamp(),'{}')`,[fixture.ownerId,source]);
     await left.query(`INSERT INTO lifeos_platform.platform_record(owner_id,id,kind,source_id,draft,revision,created_at,updated_at) VALUES($1,$2,'todo',$3,'{"title":"Synthetic fence write","status":"open"}',1,clock_timestamp(),clock_timestamp())`,[fixture.ownerId,record,source]);
     await left.query('INSERT INTO lifeos_platform.platform_history(owner_id,record_id,revision,raw,snapshot,created_at) VALUES($1,$2,1,\'{}\',\'{}\',clock_timestamp())',[fixture.ownerId,record]);
     await left.query('INSERT INTO lifeos_platform.platform_command(owner_id,command_key,digest,response) VALUES($1,$2,repeat(\'a\',64),\'{}\')',[fixture.ownerId,command]);
     return true;
    };
    const manage=()=>mutation==='reduce'?cas(id,expected,{todo:['read']},session,right):right.query('UPDATE lifeos_agent.apikey SET enabled=false WHERE id=$1',[id]);
    try{
     await left.query('BEGIN');await left.query("SELECT set_config('lifeos.owner_id',$1,true)",[fixture.ownerId]);
     await left.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))',[ownerMaintenanceKey(fixture.ownerId)]);
     await left.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([fixture.ownerId,command])]);
     await right.query('BEGIN');
     const lp=(await left.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,rp=(await right.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
     if(producerFirst){
      assert.equal(await produce(),true);waiting=manage();await waitBlocked(admin,rp,lp);await left.query('COMMIT');await waiting;await right.query('COMMIT');
     }else{
      await manage();waiting=produce();await waitBlocked(admin,lp,rp);await right.query('COMMIT');assert.equal(await waiting,false);await left.query('COMMIT');
     }
     const fresh=fixturePool('admin');try{
      const counts=(await fresh.query(`SELECT (SELECT count(*)::int FROM lifeos_platform.platform_record WHERE id=$1) AS records,
       (SELECT count(*)::int FROM lifeos_platform.platform_history WHERE record_id=$1) AS history,
       (SELECT count(*)::int FROM lifeos_platform.platform_command WHERE command_key=$2) AS commands`,[record,command])).rows[0];
      const n=!preview&&producerFirst?1:0;assert.deepEqual(counts,{records:n,history:n,commands:n});
      if(preview&&!producerFirst)await repo.transaction(fixture.ownerId,randomUUID(),async tx=>assert.rejects(assertAgentGrant(tx,binding(id),['todo:read','organization:read']),{status:403}));
     }finally{await fresh.end();}
    }finally{await right.query('ROLLBACK').catch(()=>{});await left.query('ROLLBACK').catch(()=>{});await waiting?.catch(()=>{});left.release();right.release();}
   });
  }
  await t.test('fence and scope CAS recheck wall-clock expiry after waiting for the grant lock',async()=>{
   for(const target of ['fence','cas']){
    const id=await seed(allPermissions,'1 second'),expected=await digest(id);const blocker=await admin.connect(),waiter=await (target==='fence'?business:manager).connect();let pending:Promise<unknown>|undefined;
    try{
     await blocker.query('BEGIN');await blocker.query('SELECT id FROM lifeos_agent.apikey WHERE id=$1 FOR UPDATE',[id]);
     await waiter.query('BEGIN');await waiter.query("SELECT set_config('lifeos.owner_id',$1,true)",[fixture.ownerId]);
     const bp=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,wp=(await waiter.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
     pending=target==='fence'?waiter.query('SELECT lifeos_agent.assert_business_grant($1,$2,$3,$4) AS allowed',[id,fixture.ownerId,fixture.spaceId,['organization:read']]):cas(id,expected,{todo:['read']},session,waiter);
     const outcome=pending.then(value=>({value,error:null}),error=>({value:null,error}));
     await waitBlocked(admin,wp,bp);
     while(!(await blocker.query('SELECT "expiresAt"<=clock_timestamp() AS expired FROM lifeos_agent.apikey WHERE id=$1',[id])).rows[0].expired)await delay(10);
     await blocker.query('COMMIT');const result=await outcome;
     if(target==='fence'){assert.equal(result.error,null);assert.equal((result.value as {rows:{allowed:boolean}[]}).rows[0].allowed,false);}
     else assert.equal(result.error?.code,'LG403');
    }finally{await blocker.query('ROLLBACK');await waiter.query('ROLLBACK');await pending?.catch(()=>{});blocker.release();waiter.release();}
   }
  });
  await t.test('legacy todo repository fence executes the original pre-business function',async()=>{
   const id=await seed({todo:['read','write']});const client=await admin.connect();
   try{
    await client.query('BEGIN');
    const original=await readFile('db/0006_agent_api.proposed.sql','utf8');
    const start=original.indexOf('CREATE FUNCTION lifeos_agent.assert_todo_write_grant');
    const end=original.indexOf('REVOKE ALL ON FUNCTION',start);
    assert.ok(start>0&&end>start);
    await client.query(original.slice(start,end).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'));
    await client.query('SET LOCAL ROLE lifeos_platform_candidate_runtime');
    await client.query("SELECT set_config('lifeos.owner_id',$1,true)",[fixture.ownerId]);
    assert.equal((await client.query('SELECT lifeos_agent.assert_todo_write_grant($1,$2,$3) AS allowed',[id,fixture.ownerId,fixture.spaceId])).rows[0].allowed,true);
    assert.equal((await client.query('SELECT lifeos_agent.assert_todo_write_grant($1,$2,$3) AS allowed',[id,fixture.ownerId,'synthetic-foreign-space'])).rows[0].allowed,false);
   }finally{await client.query('ROLLBACK');client.release();}
  });
  await t.test('real issuer accepts organization create and same-key CAS, defaults remain todo-only',async()=>{
   const issuer=await createPostgresKeyIssuer(config());
   try{
    const created=await issuer.handle('create',signed,{name:'Synthetic organization grant',scopes:all,expiresInDays:7});assert.equal(created.status,201);
    const {grant}=created.body as {grant:KeySummary};assert.match(grant.grantDigest??'',/^[a-f0-9]{64}$/);
    const result=await issuer.handle('setScopes',signed,{id:grant.id,expectedGrantDigest:grant.grantDigest,scopes:['organization:read']});assert.equal(result.status,200);
    assert.deepEqual((result.body as {grant:KeySummary}).grant.scopes,['organization:read']);
    assert.equal((await issuer.handle('setScopes',signed,{id:grant.id,expectedGrantDigest:grant.grantDigest,scopes:all})).status,409);
    assert.deepEqual(Object.keys(result.body as object),['grant']);
   }finally{await issuer.close();}
   const {businessScopes:_,...legacyConfig}=config();const legacy=await createPostgresKeyIssuer(legacyConfig);
   try{assert.equal((await legacy.handle('create',signed,{name:'Synthetic closed',scopes:['organization:read'],expiresInDays:7})).status,400);assert.equal((await legacy.handle('setScopes',signed,{})).status,503);}finally{await legacy.close();}
  });
  await t.test('business readiness rejects tampered owner search_path PUBLIC EXECUTE and role ACL with 503',async()=>{
   assert.equal(typeof runtime.verifyAgentBusinessReadiness,'function');
   await runtime.verifyAgentBusinessReadiness(business);
   const changes=[
    ['ALTER FUNCTION lifeos_agent.assert_business_grant(text,text,text,text[]) OWNER TO lifeos_agent_issuer','ALTER FUNCTION lifeos_agent.assert_business_grant(text,text,text,text[]) OWNER TO postgres'],
    ["ALTER FUNCTION lifeos_agent.assert_business_grant(text,text,text,text[]) SET search_path=public,pg_catalog","ALTER FUNCTION lifeos_agent.assert_business_grant(text,text,text,text[]) SET search_path=pg_catalog,pg_temp"],
    ['GRANT EXECUTE ON FUNCTION lifeos_agent.set_managed_grant_scopes(text,text,text,jsonb) TO PUBLIC','REVOKE EXECUTE ON FUNCTION lifeos_agent.set_managed_grant_scopes(text,text,text,jsonb) FROM PUBLIC'],
    ['GRANT UPDATE(enabled) ON lifeos_agent.apikey TO lifeos_agent_verifier','REVOKE UPDATE(enabled) ON lifeos_agent.apikey FROM lifeos_agent_verifier'],
    ['GRANT UPDATE(permissions) ON lifeos_agent.apikey TO lifeos_agent_key_manager','REVOKE UPDATE(permissions) ON lifeos_agent.apikey FROM lifeos_agent_key_manager'],
    ['GRANT EXECUTE ON FUNCTION lifeos_agent.set_managed_grant_scopes(text,text,text,jsonb) TO lifeos_agent_verifier','REVOKE EXECUTE ON FUNCTION lifeos_agent.set_managed_grant_scopes(text,text,text,jsonb) FROM lifeos_agent_verifier'],
   ];
   for(const [breakSQL,restore]of changes){await admin.query(breakSQL);try{await assert.rejects(runtime.verifyAgentBusinessReadiness(business),{status:503});await assert.rejects(createPostgresKeyIssuer(config()));}finally{await admin.query(restore);}}
   await runtime.verifyAgentBusinessReadiness(business);
  });
 }finally{await Promise.all([admin.end(),manager.end(),business.end(),verifier.end()]);}
});
