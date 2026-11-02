import {createPlatformAuth} from '../src/platform/auth.ts';
import {enrollSyntheticOwnerMfa,syntheticOwnerTotp,mergeSyntheticAuthCookies} from './helpers/owner-mfa-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:https';
import {Pool} from 'pg';
import {verifyRestrictedPool,type SqlPool} from '../src/platform/postgres.ts';
import {mkdirSync,readFileSync,rmdirSync} from 'node:fs';
import {readReviewConfig} from '../src/platform/private-config.ts';
import {readPlatformConfig} from '../src/platform/config.ts';
import {readPersonalConfig} from '../src/personal-candidate/config.ts';
import {personalPermitBinding,personalPermitPath} from '../src/personal-candidate/runtime-http.ts';
import {activateWritePermit,revokeWritePermit} from '../src/deployment-candidate/write-permit.ts';
import {fixtureLookup,fixtureErrorCode} from './helpers/owner-recovery-https-config.ts';
const enabled=process.env.RUN_OWNER_PERMIT_HTTPS_TESTS==='1',origin='https://review.example.test';
const target='postgresql://lifeos_platform_candidate_runtime:fixture-ci-runtime-never-live@127.0.0.1:55432/lifeos_platform_test_local';
function send(route:string,body?:unknown,headers:Record<string,string>={}):Promise<{status:number;body:string;cookie:string;response:Response}>{return new Promise((resolve,reject)=>{
 const data=body===undefined?undefined:JSON.stringify(body),req=request(new URL(route,origin),{port:14443,servername:'review.example.test',ca:readFileSync(process.env.RUNNER_TEMP+'/recovery-tls/ca.crt'),...fixtureLookup,method:data?'POST':'GET',headers:{host:'review.example.test',...(data?{origin,'content-type':'application/json'}:{}),...headers},timeout:5000},res=>{const chunks:Buffer[]=[];res.on('data',(v:Buffer)=>chunks.push(v));res.on('end',()=>resolve({status:res.statusCode??0,body:Buffer.concat(chunks).toString('utf8'),response:(()=>{const h=new Headers();for(const cookie of res.headers['set-cookie']??[])h.append('set-cookie',cookie);return new Response(Buffer.concat(chunks).toString('utf8'),{status:res.statusCode??0,headers:h});})(),cookie:(res.headers['set-cookie']??[]).map(v=>v.split(';')[0]).join('; ')}));});req.on('error',error=>reject(Error('Synthetic HTTPS request failed: '+fixtureErrorCode(error))));req.on('timeout',()=>req.destroy(Object.assign(Error('timeout'),{code:'ETIMEDOUT'})));req.end(data);
});}
test('isolated Next permits logout after a previously valid business permit is revoked',{skip:!enabled?'isolated permit HTTPS CI not requested':false,timeout:45000},async()=>{
 if(process.env.CI!=='true'||process.env.LIFEOS_FIXTURE_FRESH!=='approved-isolated-fixture'||process.env.LIFEOS_PLATFORM_TEST_DATABASE_URL!==target||!process.env.RUNNER_TEMP||!/^[0-9a-f]{40}$/.test(process.env.LIFEOS_REVIEW_GIT_SHA??''))throw Error('Exact isolated permit fixture required');
 const env=readReviewConfig('/run/lifeos-platform/runtime.json'),config=readPlatformConfig(env),personal=config&&readPersonalConfig(env,config);if(!personal||!config||config.ownerId!=='personal-review-user'||config.ownerEmail!=='owner@example.test'||config.baseURL!==origin||config.databaseURL!==target||personal.businessWriteMode||personal.readonlyLoginApproved)throw Error('Permit-bound synthetic runtime required');
 const pool=new Pool({connectionString:target,max:3,connectionTimeoutMillis:2000,statement_timeout:5000,options:'-c search_path=pg_catalog,lifeos_platform'});
 const snapshot=async()=>{const client=await pool.connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query("SELECT set_config('lifeos.owner_id',$1,true)",[config.ownerId]);const data:Record<string,unknown[]>={};for(const table of ['platform_source','platform_record','platform_history','platform_command'] as const)data[table]=(await client.query(`SELECT to_jsonb(t) AS row FROM lifeos_platform.${table} t WHERE owner_id=$1 ORDER BY to_jsonb(t)::text`,[config.ownerId])).rows.map(row=>row.row);await client.query('COMMIT');return data;}catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}};
 const directory='/run/lifeos-platform/write-gate';let directoryReady=false;
 try{
  await verifyRestrictedPool(pool as SqlPool);mkdirSync(directory,{mode:0o700});directoryReady=true;
  await activateWritePermit(personalPermitPath,personalPermitBinding(personal,process.env.LIFEOS_REVIEW_GIT_SHA!),{targetReadOnlyHealthy:async()=>true,recheck:async()=>true});
  let signed=await send('/api/platform/auth/sign-in/email',{email:'owner',password:'fixture-personal-initial-password',rememberMe:false});assert.equal(signed.status,200);assert.ok(signed.cookie);
  const passwordCookie=mergeSyntheticAuthCookies(signed.response);assert.equal((await send('/api/platform/personal/status',undefined,{cookie:passwordCookie})).status,401);
  const auth=createPlatformAuth(config,pool,{requireMfa:true,forceSecureCookies:true,disableSessionRefresh:true}),factorRequest=async(path:string,body:Record<string,unknown>,cookie:string)=>(await send('/api/platform/auth/'+path,body,{cookie})).response;
  const enrolled=await enrollSyntheticOwnerMfa(auth,config.ownerId,'fixture-personal-initial-password',factorRequest,passwordCookie);signed={...signed,cookie:enrolled.cookie};
  const status=await send('/api/platform/personal/status',undefined,{cookie:signed.cookie});assert.equal(status.status,200);assert.equal(JSON.parse(status.body).writable,true);
  const body={spaceId:personal.spaceId,confirmed:true,fields:{title:'Synthetic permit record',notes:'',dueOn:null,status:'open'}};
  const created=await send('/api/platform/personal/todo',body,{cookie:signed.cookie,'idempotency-key':'synthetic-permit-record-001'});assert.equal(created.status,201);const id=JSON.parse(created.body).entry.id;assert.match(id,/^[0-9a-f-]{36}$/);
  const original=await send('/api/platform/personal/todo/'+id,undefined,{cookie:signed.cookie});assert.equal(original.status,200);
  const pgBefore=await snapshot();for(const rows of Object.values(pgBefore))assert.equal(rows.length,1);
  revokeWritePermit(personalPermitPath);const afterRevoke=await send('/api/platform/personal/status',undefined,{cookie:signed.cookie});assert.equal(afterRevoke.status,200);assert.equal(JSON.parse(afterRevoke.body).writable,false);
  const denied=await send('/api/platform/personal/todo',body,{cookie:signed.cookie,'idempotency-key':'synthetic-permit-record-002'});assert.equal(denied.status,503);
  assert.equal((await send('/api/platform/personal/todo/'+id,undefined,{cookie:signed.cookie})).body,original.body);assert.deepEqual(await snapshot(),pgBefore);
  assert.equal((await send('/api/platform/auth/sign-out',{}, {cookie:signed.cookie})).status,200);assert.equal((await send('/api/platform/personal/status',undefined,{cookie:signed.cookie})).status,401);
 }finally{try{if(directoryReady){revokeWritePermit(personalPermitPath);rmdirSync(directory);}}finally{await pool.end();}}
});
