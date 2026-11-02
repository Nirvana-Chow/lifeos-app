import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {createPlatformAuth} from '../src/platform/auth.ts';
import {ownerEmailReset} from '../src/personal-candidate/owner-email-reset.ts';
import {ownerRecoveryLock} from '../src/personal-candidate/owner-recovery-lock.ts';
import {verifyRestrictedPool,PostgresPlatformRepository,type SqlPool} from '../src/platform/postgres.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import type {PersonalConfig} from '../src/personal-candidate/config.ts';
import {validateAcceptanceEnvironment,acceptancePasswords,acceptancePool} from './helpers/platform-pg.ts';

const enabled=process.env.RUN_OWNER_RECOVERY_POSTGRES_TESTS==='1';
const target='postgresql://lifeos_platform_candidate_runtime:fixture-ci-runtime-never-live@127.0.0.1:55439/lifeos_platform_test_local';
const origin='http://127.0.0.1:3190';
const send=(body:unknown)=>new Request(origin+'/api/platform/personal/recover-password',{method:'POST',headers:{origin,host:'127.0.0.1:3190','content-type':'application/json'},body:JSON.stringify(body)});

test('isolated real PG native recovery rollback, identity guard and delivery boundaries',{skip:!enabled?'isolated synthetic PG not requested':false,timeout:270000},async()=>{
 if(process.env.CI!=='true'||process.env.LIFEOS_PLATFORM_TEST_DATABASE_URL!==target||process.env.LIFEOS_PLATFORM_TEST_APPROVAL!=='approved-isolated-fixtures')throw Error('Exact synthetic CI target required');
 const config=validateAcceptanceEnvironment(process.env,process.execArgv),passwords=acceptancePasswords();
 const pool=acceptancePool(target),admin=new Pool({host:'127.0.0.1',port:55439,user:'postgres',password:'fixture-ci-admin-never-live',database:'lifeos_platform_test_local',max:1,connectionTimeoutMillis:2000,statement_timeout:5000});
 const faultPools:Pool[]=[];
 try{
  await verifyRestrictedPool(pool as SqlPool);
  const targetInfo=await admin.query("SELECT current_database() AS db,current_user AS role,version() AS version");assert.equal(targetInfo.rows[0].db,'lifeos_platform_test_local');assert.equal(targetInfo.rows[0].role,'postgres');assert.match(targetInfo.rows[0].version,/^PostgreSQL 17\.11 /);
  const grants=await pool.query(`SELECT has_column_privilege(current_user,'lifeos_platform.platform_verification','expiresAt','UPDATE') AS expiry,has_column_privilege(current_user,'lifeos_platform.platform_verification','updatedAt','UPDATE') AS updated,has_column_privilege(current_user,'lifeos_platform.platform_account','password','UPDATE') AS password,has_column_privilege(current_user,'lifeos_platform.platform_account','updatedAt','UPDATE') AS account_updated,has_table_privilege(current_user,'lifeos_platform.platform_verification','DELETE') AS verification_delete`);
  assert.deepEqual(grants.rows[0],{expiry:true,updated:true,password:true,account_updated:true,verification_delete:true});
  const owner=config.ownerId,accountId='fixture-account-a';
  const repository=new PostgresPlatformRepository(pool as SqlPool,true);
  const personal:PersonalConfig={ownerId:owner,ownerEmail:config.ownerEmail,spaceId:'synthetic-recovery-space',databaseName:'lifeos_platform_test_local',allowedTypes:['todo','journal'],approval:'personal-manual-v1',baseURL:config.baseURL};
  const service=new PersonalService(repository,personal);
  const created=await service.mutate(owner,'todo',null,{spaceId:personal.spaceId,confirmed:true,fields:{title:'Synthetic recovery record',notes:'',dueOn:null,status:'open'}},'synthetic-owner-recovery-record',async()=>{});
  assert.equal(created.entry.revision,1);
  const businessSnapshot=async()=>{const client=await pool.connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query("SELECT set_config('lifeos.owner_id',$1,true)",[owner]);const snapshot:Record<string,unknown[]>={};for(const table of ['platform_source','platform_record','platform_history','platform_command'] as const)snapshot[table]=(await client.query(`SELECT to_jsonb(t) AS row FROM lifeos_platform.${table} t WHERE owner_id=$1 ORDER BY to_jsonb(t)::text`,[owner])).rows.map(r=>r.row);await client.query('COMMIT');return snapshot;}catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}};
  const businessBefore=await businessSnapshot();for(const rows of Object.values(businessBefore))assert.equal(rows.length,1);
  const identity=async()=>({users:(await admin.query('SELECT id,name,email,"emailVerified" FROM lifeos_platform.platform_user ORDER BY id')).rows,accounts:(await admin.query('SELECT id,"userId","accountId","providerId" FROM lifeos_platform.platform_account ORDER BY id')).rows});
  const identityBefore=await identity();assert.equal(identityBefore.users.length,2);assert.equal(identityBefore.accounts.length,2);

  const original=(await admin.query('SELECT password FROM lifeos_platform.platform_account WHERE id=$1 AND "userId"=$2',[accountId,owner])).rows[0]?.password;assert.equal(typeof original,'string');
  await admin.query('INSERT INTO lifeos_platform.platform_session(id,token,"userId","expiresAt") VALUES($1,$2,$3,now()+interval \'30 minutes\')',['fixture-recovery-session','fixture-session-token-recovery',owner]);
  let code='';const lock=ownerRecoveryLock(pool as SqlPool,owner);
  const make=(db:Pool,delivery=async(m:{code:string})=>{code=m.code;})=>ownerEmailReset(config,db,{enabled:true,withOwnerLock:lock,limit:async()=>{},delivery:{recipient:'owner@example.invalid',send:delivery}});
  const handler=make(pool);
  // Missing or duplicate credentials are synthetic administrator fixtures, never product migrations.
  assert.equal((await handler(send({action:'request'}))).status,200);assert.ok(code.length>0);
  await admin.query('DELETE FROM lifeos_platform.platform_account WHERE id=$1',[accountId]);
  assert.ok((await handler(send({action:'request'}))).status>=400);assert.ok((await handler(send({action:'finish',otp:code,newPassword:'fixture-missing-new-password'}))).status>=400);assert.equal((await admin.query('SELECT count(*)::int AS n FROM lifeos_platform.platform_account WHERE "userId"=$1',[owner])).rows[0].n,0);
  await admin.query('INSERT INTO lifeos_platform.platform_account(id,"userId","accountId","providerId",password) VALUES($1,$2,$2,\'credential\',$3)',[accountId,owner,original]);
  await admin.query('INSERT INTO lifeos_platform.platform_account(id,"userId","accountId","providerId",password) VALUES($1,$2,$3,\'credential\',$4)',['fixture-duplicate',owner,'fixture-other-account',original]);
  assert.ok((await handler(send({action:'request'}))).status>=400);assert.ok((await handler(send({action:'finish',otp:code,newPassword:'fixture-duplicate-new-password'}))).status>=400);assert.equal((await admin.query('SELECT count(*)::int AS n FROM lifeos_platform.platform_account WHERE "userId"=$1',[owner])).rows[0].n,2);
  await admin.query('DELETE FROM lifeos_platform.platform_account WHERE id=$1',['fixture-duplicate']);
  let rejectedCode='';const rejected=make(pool,async m=>{rejectedCode=m.code;throw Error('synthetic delivery rejection');});
  assert.ok((await rejected(send({action:'request'}))).status>=400);assert.ok(rejectedCode.length>0);
  const nativeRejected=await createPlatformAuth(config,pool,{ownerPasswordResetDelivery:async()=>{}}).$context;
  const rejectedVerification=await nativeRejected.internalAdapter.findVerificationValue('reset-password:'+rejectedCode);
  assert.ok(!rejectedVerification||new Date(rejectedVerification.expiresAt).valueOf()<=Date.now());
  assert.ok((await handler(send({action:'finish',otp:rejectedCode,newPassword:'fixture-rejected-new-password'}))).status>=400);
  await new Promise(resolve=>setTimeout(resolve,61000));
  for(const fault of ['consume','session','password']){
   code='';assert.equal((await handler(send({action:'request'}))).status,200);assert.ok(code.length>0);
   const faultPool=new Pool({connectionString:target,max:2,connectionTimeoutMillis:2000,statement_timeout:5000,options:`-c search_path=pg_catalog,lifeos_platform -c lifeos.fixture_fault=${fault}`});faultPools.push(faultPool);
   const broken=make(faultPool);assert.ok((await broken(send({action:'finish',otp:code,newPassword:'fixture-synthetic-new-password'}))).status>=400);
   const state=await admin.query('SELECT (SELECT password FROM lifeos_platform.platform_account WHERE id=$1)=$2 AS same_password,EXISTS(SELECT 1 FROM lifeos_platform.platform_session WHERE id=$3) AS session_exists,EXISTS(SELECT 1 FROM lifeos_platform.platform_verification WHERE value=$4 AND "expiresAt">now()) AS active_code',[accountId,original,'fixture-recovery-session',owner]);
   assert.deepEqual(state.rows[0],{same_password:true,session_exists:true,active_code:true});const native=await createPlatformAuth(config,pool,{ownerPasswordResetDelivery:async()=>{}}).$context;const retained=await native.internalAdapter.findVerificationValue('reset-password:'+code);assert.equal(retained?.value,owner);assert.ok(retained&&new Date(retained.expiresAt).valueOf()>Date.now());
  }
  // Better Auth native request and finish limiters recover naturally; the custom gateway limiter is stubbed in this fixture and tested separately. No counters are deleted.
  await new Promise(resolve=>setTimeout(resolve,61000));
  code='';assert.equal((await handler(send({action:'request'}))).status,200);assert.equal((await handler(send({action:'finish',otp:code,newPassword:passwords.ownerB}))).status,200);
  const after=await admin.query('SELECT (SELECT password FROM lifeos_platform.platform_account WHERE id=$1)<>$2 AS changed,NOT EXISTS(SELECT 1 FROM lifeos_platform.platform_session WHERE "userId"=$3) AS sessions_gone,NOT EXISTS(SELECT 1 FROM lifeos_platform.platform_verification WHERE value=$3) AS codes_gone',[accountId,original,owner]);assert.deepEqual(after.rows[0],{changed:true,sessions_gone:true,codes_gone:true});
  code='';const removed=make(pool,async m=>{code=m.code;await admin.query('DELETE FROM lifeos_platform.platform_verification WHERE value=$1',[owner]);});assert.ok((await removed(send({action:'request'}))).status>=400);assert.ok(code.length>0);assert.ok((await handler(send({action:'finish',otp:code,newPassword:'fixture-synthetic-other-password'}))).status>=400);
  let childStatus=0;const pending=make(pool,async m=>{code=m.code;const row=await admin.query('SELECT "expiresAt"<=now() AS expired FROM lifeos_platform.platform_verification WHERE value=$1',[owner]);assert.equal(row.rows.length,1);assert.equal(row.rows[0].expired,true);
   const child=fork(fileURLToPath(new URL('./helpers/owner-recovery-worker.ts',import.meta.url)),[],{execArgv:[],stdio:['ignore','ignore','ignore','ipc']});
   try{childStatus=await new Promise<number>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('synthetic worker timeout')),8000);child.once('message',(message:{status?:number})=>{clearTimeout(timer);typeof message.status==='number'?resolve(message.status):reject(Error('synthetic worker failed'));});child.once('error',e=>{clearTimeout(timer);reject(e);});child.send({code});});}finally{child.kill();}
  });
  assert.equal((await pending(send({action:'request'}))).status,200);assert.equal(childStatus,409);
  await new Promise(resolve=>setTimeout(resolve,61000));
  let release!:()=>void;const later=new Promise<void>(r=>{release=r;});code='';const late=make(pool,async m=>{code=m.code;await later;});
  const lateResponse=await late(send({action:'request'}));assert.ok(lateResponse.status>=400);assert.ok(code.length>0);release();await new Promise(r=>setImmediate(r));
  assert.ok((await handler(send({action:'finish',otp:code,newPassword:'fixture-synthetic-late-password'}))).status>=400);
  // Both codes are issued by Better Auth, individually activated and then race under the owner lock.
  const activeCodes:string[]=[];for(let i=0;i<2;i++){
   let active='';const issued=make(pool,async m=>{active=m.code;});assert.equal((await issued(send({action:'request'}))).status,200);assert.ok(active.length>0);activeCodes.push(active);
  }
  assert.ok(activeCodes[0]!==activeCodes[1]);
  const native=await createPlatformAuth(config,pool,{ownerPasswordResetDelivery:async()=>{}}).$context;
  for(const active of activeCodes){const verification=await native.internalAdapter.findVerificationValue('reset-password:'+active);assert.equal(verification?.value,owner);assert.ok(verification&&new Date(verification.expiresAt).valueOf()>Date.now());}
  const race=await Promise.all(activeCodes.map((active,i)=>handler(send({action:'finish',otp:active,newPassword:'fixture-concurrent-password-'+i}))));
  assert.equal(race.filter(r=>r.status===200).length,1);assert.ok(race.every(r=>r.status===200||r.status===409||r.status===400));
  for(const active of activeCodes)assert.ok((await native.internalAdapter.findVerificationValue('reset-password:'+active))===null);
  assert.deepEqual(await identity(),identityBefore);assert.deepEqual(await businessSnapshot(),businessBefore);


 }finally{await Promise.all(faultPools.map(p=>p.end()));await pool.end();await admin.end();}
});
