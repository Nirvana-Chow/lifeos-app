import {enrollSyntheticOwnerMfa,syntheticOwnerTotp,mergeSyntheticAuthCookies} from './helpers/owner-mfa-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:https';
import {createHash} from 'node:crypto';
import {fixtureLookup,fixtureErrorCode,fixtureRscPath,fixtureWireResponse} from './helpers/owner-recovery-https-config.ts';
import {hasOwnerShellHeading} from './helpers/owner-shell-heading.ts';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {Pool} from 'pg';
import {readReviewConfig} from '../src/platform/private-config.ts';
import {readPlatformConfig} from '../src/platform/config.ts';
import {ownerOperatorRecovery} from '../src/personal-candidate/owner-email-reset.ts';
import {createPlatformAuth,readOwnerPrincipal} from '../src/platform/auth.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import {PostgresPlatformRepository} from '../src/platform/postgres.ts';
import type {PersonalConfig} from '../src/personal-candidate/config.ts';
import {ownerRecoveryLock,ownerRecoveryRateLimit} from '../src/personal-candidate/owner-recovery-lock.ts';
import {verifyRestrictedPool,type SqlPool} from '../src/platform/postgres.ts';

const enabled=process.env.RUN_OWNER_RECOVERY_HTTPS_TESTS==='1';
const origin='https://review.example.test',path='/api/platform/personal/recover-password';
const fixtureDB='postgresql://lifeos_platform_candidate_runtime:fixture-ci-runtime-never-live@127.0.0.1:55432/lifeos_platform_test_local';
const oldPassword='fixture-personal-initial-password',newPassword='fixture-personal-recovery-password';
function send(route:string,body?:unknown,headers:Record<string,string>={},method?:'PATCH'|'HEAD',rawPath?:string):Promise<{status:number;body:string;bytes:Buffer;cookie:string;location:string;response:Response}>{
 return new Promise((resolve,reject)=>{
  const data=body===undefined?undefined:JSON.stringify(body);
  const req=request(new URL(route,origin),{port:14443,servername:'review.example.test',ca:readFileSync(process.env.RUNNER_TEMP+'/recovery-tls/ca.crt'),...fixtureLookup,...(rawPath?{path:rawPath}:{}),method:method??(data?'POST':'GET'),headers:{host:'review.example.test',...(data?{origin,'content-type':'application/json'}:{}),...headers},timeout:5000},res=>{
   const chunks:Buffer[]=[];res.on('data',(c:Buffer)=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode??0,body:Buffer.concat(chunks).toString('utf8'),bytes:Buffer.concat(chunks),response:fixtureWireResponse(Buffer.concat(chunks),res.rawHeaders,res.statusCode??0),cookie:(res.headers['set-cookie']??[]).map(v=>v.split(';')[0]).join('; '),location:res.headers.location??''}));
  });req.on('error',error=>reject(Error('Synthetic HTTPS request failed: '+fixtureErrorCode(error))));req.on('timeout',()=>req.destroy(Object.assign(Error('Synthetic HTTPS request timed out'),{code:'ETIMEDOUT'})));req.end(data);
 });
}
function replaceApproval(raw:string|undefined){const file='/run/lifeos-platform/runtime.json',env=JSON.parse(readFileSync(file,'utf8'));if(raw===undefined)delete env.LIFEOS_PERSONAL_RECOVERY_APPROVAL;else env.LIFEOS_PERSONAL_RECOVERY_APPROVAL=raw;const temp=file+'.next';writeFileSync(temp,JSON.stringify(env),{mode:0o600});renameSync(temp,file);}

test('isolated real Next, Caddy TLS and PostgreSQL recovery',{skip:!enabled?'isolated HTTPS CI not requested':false,timeout:120000},async()=>{
 if(process.env.CI!=='true'||process.env.LIFEOS_FIXTURE_FRESH!=='approved-isolated-fixture'||process.env.LIFEOS_PLATFORM_TEST_DATABASE_URL!==fixtureDB||!process.env.RUNNER_TEMP)throw Error('Exact isolated HTTPS CI target required');
 const env=readReviewConfig('/run/lifeos-platform/runtime.json'),config=readPlatformConfig(env);if(!config||config.ownerId!=='personal-review-user'||config.ownerEmail!=='owner@example.test'||config.baseURL!==origin||config.databaseURL!==fixtureDB)throw Error('Unexpected synthetic owner');
 const pool=new Pool({connectionString:fixtureDB,max:4,connectionTimeoutMillis:2000,statement_timeout:5000,options:'-c search_path=pg_catalog,lifeos_platform'});
 try{
  await verifyRestrictedPool(pool as SqlPool);
  const state=(await pool.query('SELECT current_database() AS db,current_user AS role,inet_server_port() AS port')).rows[0];assert.deepEqual(state,{db:'lifeos_platform_test_local',role:'lifeos_platform_candidate_runtime',port:5432});
  const login=(password:string)=>send('/api/platform/auth/sign-in/email',{email:'owner',password,rememberMe:false});
  let before=await login(oldPassword);assert.equal(before.status,200);assert.ok(before.cookie);
  assert.equal((await send('/api/platform/personal/status',undefined,{cookie:mergeSyntheticAuthCookies(before.response)})).status,401);
  const mfaAuth=createPlatformAuth(config,pool,{requireMfa:true,forceSecureCookies:true,disableSessionRefresh:true});
  const factorRequest=async(path:string,body:Record<string,unknown>,cookie:string)=>(await send('/api/platform/auth/'+path,body,{cookie})).response;
  const enrolled=await enrollSyntheticOwnerMfa(mfaAuth,config.ownerId,oldPassword,factorRequest,mergeSyntheticAuthCookies(before.response));before={...before,cookie:enrolled.cookie};
  const foreign={...config,ownerId:'synthetic-foreign-user',ownerEmail:'foreign@example.test'};let foreignCode='';
  const foreignAuth=createPlatformAuth(foreign,pool,{forceSecureCookies:true,ownerPasswordResetDelivery:async data=>{foreignCode=data.token;}});
  const foreignLogin=await foreignAuth.handler(new Request(origin+'/api/platform/auth/sign-in/email',{method:'POST',headers:{host:'review.example.test',origin,'content-type':'application/json','x-platform-client':'127.0.0.2'},body:JSON.stringify({email:foreign.ownerEmail,password:'fixture-personal-foreign-password',rememberMe:false})}));assert.equal(foreignLogin.status,200);
  const foreignCookie=foreignLogin.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');assert.ok(foreignCookie.length>0);
  assert.equal((await readOwnerPrincipal(foreignAuth,foreign,new Headers({cookie:foreignCookie})))?.userId,foreign.ownerId);
  await foreignAuth.api.requestPasswordReset({body:{email:foreign.ownerEmail}});assert.ok(foreignCode.length>0);
  const foreignContext=await foreignAuth.$context;const foreignVerification=await foreignContext.internalAdapter.findVerificationValue('reset-password:'+foreignCode);assert.equal(foreignVerification?.value,foreign.ownerId);assert.ok(foreignVerification&&new Date(foreignVerification.expiresAt).valueOf()>Date.now());
  const repo=new PostgresPlatformRepository(pool as SqlPool,true),foreignPersonal:PersonalConfig={ownerId:foreign.ownerId,ownerEmail:foreign.ownerEmail,spaceId:'synthetic-foreign-space',databaseName:'lifeos_platform_test_local',allowedTypes:['todo','journal'],approval:'personal-manual-v1',baseURL:origin};
  const foreignService=new PersonalService(repo,foreignPersonal),foreignCreated=await foreignService.mutate(foreign.ownerId,'todo',null,{spaceId:foreignPersonal.spaceId,confirmed:true,fields:{title:'Synthetic foreign record',notes:'',dueOn:null,status:'open'}},'synthetic-foreign-record-001',async()=>{});

  // Actual production Next/TLS resources: discover real assets, never infer existence from a hash-looking name.
  const privateCache=(value:Awaited<ReturnType<typeof send>>)=>{const cache=value.response.headers.get('cache-control')??'';assert.ok(/no-store/i.test(cache)&&!/\bpublic\b/i.test(cache),'CACHE_PRIVATE_BOUNDARY');};
  const publicLogin=await send('/login');assert.equal(publicLogin.status,200);privateCache(publicLogin);
  const assets=[...publicLogin.body.matchAll(/(?:src|href)="([^"<>]+)"/g)].map(match=>{try{const u=new URL(match[1].replaceAll('&amp;','&'),origin);return u.origin===origin&&u.pathname.startsWith('/_next/static/')?u.pathname+u.search:null;}catch{return null;}}).filter((value):value is string=>value!==null);
  const javascript=assets.find(asset=>new URL(asset,origin).pathname.endsWith('.js')),stylesheet=assets.find(asset=>new URL(asset,origin).pathname.endsWith('.css'));assert.ok(javascript&&stylesheet,'CACHE_BUILD_ASSETS_MISSING');
  const csp="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
  assert.ok(publicLogin.response.headers.get('content-security-policy')===csp&&['same-origin','no-referrer'].includes(publicLogin.response.headers.get('referrer-policy')??''),'CACHE_SECURITY_BASELINE');
  for(const asset of [javascript,stylesheet]){
   const anonymous=await send(asset),authenticated=await send(asset,undefined,{cookie:before.cookie}),head=await send(asset,undefined,{},'HEAD');
   for(const response of [anonymous,authenticated,head]){assert.equal(response.status,200);assert.ok(response.response.headers.get('cache-control')==='public, max-age=31536000, immutable','CACHE_NATIVE_STATIC');assert.equal(response.response.headers.getSetCookie().length,0,'CACHE_STATIC_COOKIE');for(const key of ['x-content-type-options','referrer-policy','x-frame-options','content-security-policy'])assert.ok(response.response.headers.get(key)===publicLogin.response.headers.get(key),'CACHE_STATIC_SECURITY');}
   assert.ok(anonymous.response.headers.get('x-content-type-options')==='nosniff'&&anonymous.response.headers.get('x-frame-options')==='DENY','CACHE_STATIC_SECURITY');assert.equal(head.bytes.length,0);assert.ok(anonymous.bytes.length>0,'CACHE_ASSET_EMPTY');assert.ok(createHash('sha256').update(anonymous.bytes).digest('hex')===createHash('sha256').update(authenticated.bytes).digest('hex'),'CACHE_AUTH_BYTES_CHANGED');
  }
  const missing=await send('/_next/static/chunks/not-present-synthetic.abcdef012345.js');assert.equal(missing.status,404);privateCache(missing);assert.equal(missing.response.headers.getSetCookie().length,0);
  const invalidRsc=await send('/personal?_rsc=synthetic',undefined,{cookie:before.cookie,RSC:'1'});assert.equal(invalidRsc.status,307,'CACHE_RSC_INVALID_STATUS');privateCache(invalidRsc);assert.equal(invalidRsc.location,'/personal?_rsc','CACHE_RSC_INVALID_LOCATION');assert.equal(invalidRsc.body,'');assert.equal(invalidRsc.response.headers.has('content-type'),false,'CACHE_RSC_INVALID_TYPE');
  for(const headers of [{},{cookie:before.cookie}] as Record<string,string>[]){
   for(const route of ['/','/login','/account/mfa','/account/password','/personal','/api/platform/personal/status','/api/platform/personal/overview?today=2026-11-02','/api/platform/auth/get-session'])privateCache(await send(route,undefined,headers));
   const rsc=await send(await fixtureRscPath(),undefined,{...headers,RSC:'1'});privateCache(rsc);if(headers.cookie){assert.equal(rsc.status,200,'CACHE_RSC_STATUS');assert.ok((rsc.response.headers.get('content-type')??'').includes('text/x-component'),'CACHE_RSC_NOT_RENDERED');}
  }
  for(const route of ['/_next/image','/_next/data/synthetic/personal.json','/_next/staticity/synthetic.js','/_next/static/../../personal','/_next/static/%2e%2e/%2e%2e/personal'])privateCache(await send(route,undefined,{},undefined,route));
  console.log('STATIC_CACHE_TLS '+JSON.stringify({assets:2,anonymousAuthenticatedBytesMatch:true,missingPrivate:true,privateBoundaries:true}));
  const statusBefore=await send('/api/platform/personal/status',undefined,{cookie:before.cookie});assert.equal(statusBefore.status,200);assert.equal(JSON.parse(statusBefore.body).ownerId,config.ownerId);
  const created=await send('/api/platform/personal/todo',{spaceId:'personal-review-space',confirmed:true,fields:{title:'Synthetic recovery fixture',notes:'',dueOn:null,status:'open'}},{cookie:before.cookie,'idempotency-key':'synthetic-recovery-fixture-001'});assert.equal(created.status,201);
  const id=JSON.parse(created.body).entry.id;assert.match(id,/^[0-9a-f-]{36}$/);const todoPath='/api/platform/personal/todo/'+id;
  const originalTodo=await send(todoPath,undefined,{cookie:before.cookie});assert.equal(originalTodo.status,200);assert.equal(JSON.parse(originalTodo.body).entry.draft.title,'Synthetic recovery fixture');
  // Next can emit either an HTTP redirect or a streamed HTML refresh marker.
  const isLoginRedirect=(response:{status:number;location:string;body:string})=>
   ([302,303,307,308].includes(response.status)&&response.location==='/login')||
   (response.status===200&&/<meta\b(?=[^>]*\bid=["']__next-page-redirect["'])(?=[^>]*\bhttp-equiv=["']refresh["'])(?=[^>]*\bcontent=["'][01];url=\/login["'])[^>]*>/i.test(response.body));
  for(const [page,heading] of [['/personal','总览'],['/personal/edit','待办'],['/account/password','修改密码']] as const){
   for(const headers of [{},{cookie:foreignCookie}] as Record<string,string>[]){
    const denied=await send(page,undefined,headers);assert.ok(isLoginRedirect(denied)||[401,403].includes(denied.status));
    assert.ok(!denied.body.includes('Synthetic recovery fixture')&&!denied.body.includes('Synthetic foreign record'));
   }
   const ownerPage=await send(page,undefined,{cookie:before.cookie});assert.equal(ownerPage.status,200);assert.ok(!isLoginRedirect(ownerPage));assert.ok(hasOwnerShellHeading(ownerPage.body,heading),'owner shell heading '+page);
  }
  let snapshot=JSON.parse(originalTodo.body).entry;const sourceId=snapshot.source.id;
  const update=async(cookie:string,stage:string)=>{const previous=snapshot.revision,title='Synthetic recovery '+stage;
   const changed=await send(todoPath,{spaceId:'personal-review-space',confirmed:true,expectedRevision:previous,fields:{title,notes:'',dueOn:null,status:'open'}},{cookie,'idempotency-key':'synthetic-recovery-update-'+stage},'PATCH');assert.equal(changed.status,200);
   const result=JSON.parse(changed.body).entry;assert.equal(result.id,id);assert.equal(result.source.id,sourceId);assert.equal(result.revision,previous+1);
   const read=await send(todoPath,undefined,{cookie});assert.equal(read.status,200);const current=JSON.parse(read.body).entry;assert.equal(current.id,id);assert.equal(current.source.id,sourceId);assert.equal(current.revision,previous+1);assert.equal(current.draft.title,title);snapshot=current;
  };
  assert.equal((await send(path,{action:'finish',otp:'a'.repeat(32),newPassword})).status,503);
  assert.ok((await send('/account/recover')).body.includes('安全恢复尚未启用'));
  const availability=await send('/api/platform/personal/availability');assert.equal(availability.status,200);
  const spoofedPort=await send('/api/platform/personal/availability',undefined,{'x-forwarded-port':'8443'});assert.equal(spoofedPort.status,200);assert.equal(spoofedPort.body,availability.body);
  replaceApproval('{}');assert.equal((await send(path,{action:'request'})).status,503);assert.equal((await send(todoPath,undefined,{cookie:before.cookie})).body,originalTodo.body);await update(before.cookie,'invalid-policy');
  const proof=JSON.parse(readFileSync('.image-source-proof.json','utf8')),buildId=readFileSync('.next/BUILD_ID','utf8').trim(),now=Date.now();
  const approval={version:1,attestation:'owner-host-recovery-v1',ownerId:config.ownerId,spaceId:'personal-review-space',origin,sourceSha:proof.sourceSha,sourceTreeDigest:proof.sourceTreeDigest,buildId,imageDigest:'sha256:'+'b'.repeat(64),issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+300000).toISOString()};
  for(const invalid of [{...approval,ownerId:'other-synthetic-owner'},{...approval,sourceSha:'c'.repeat(40)},{...approval,expiresAt:new Date(now-1).toISOString()}]){replaceApproval(JSON.stringify(invalid));assert.equal((await send(path,{action:'request'})).status,503);}
  replaceApproval(JSON.stringify(approval));
  assert.ok(!(await send('/account/recover')).body.includes('安全恢复尚未启用'));
  await update(before.cookie,'valid-policy');
  assert.equal((await send('/api/platform/personal/status',undefined,{cookie:before.cookie})).body,statusBefore.body);
  assert.equal((await send('/api/platform/personal/availability')).body,availability.body);
  assert.equal((await send(path,{action:'request'})).status,404);
  assert.equal((await send(path,{action:'finish',otp:'a'.repeat(32),newPassword})).status,400);
  const ownerSnapshot=await repo.exportSnapshot(config.ownerId),foreignSnapshot=await repo.exportSnapshot(foreign.ownerId);
  const passwordState=await pool.query('SELECT id,password FROM lifeos_platform.platform_account WHERE \"userId\"=ANY($1::text[]) ORDER BY id',[[config.ownerId,foreign.ownerId]]);
  const identityState=await pool.query('SELECT id,email,\"emailVerified\" FROM lifeos_platform.platform_user WHERE id=ANY($1::text[]) ORDER BY id',[[config.ownerId,foreign.ownerId]]);
  assert.equal((await send('/api/platform/personal/status',undefined,{'x-owner':config.ownerId})).status,401);
  assert.equal((await send('/api/platform/personal/todo',{ownerId:foreign.ownerId,spaceId:'personal-review-space',confirmed:true,fields:{title:'Synthetic spoof',notes:'',dueOn:null,status:'open'}},{cookie:before.cookie,'idempotency-key':'synthetic-owner-spoof-001'})).status,400);
  assert.equal((await send(todoPath,undefined,{cookie:foreignCookie,'x-owner':config.ownerId})).status,401);
  assert.equal((await send(todoPath,{spaceId:'personal-review-space',confirmed:true,expectedRevision:snapshot.revision,fields:{title:'Synthetic forbidden cross-user edit',notes:'',dueOn:null,status:'open'}},{cookie:foreignCookie,'x-owner':config.ownerId,'idempotency-key':'synthetic-cross-user-denied'},'PATCH')).status,401);
  assert.equal((await send('/api/platform/personal/todo/'+foreignCreated.entry.id,undefined,{cookie:before.cookie})).status,404);
  assert.equal((await send('/api/platform/personal/todo/'+foreignCreated.entry.id,{spaceId:'personal-review-space',confirmed:true,expectedRevision:1,fields:{title:'Synthetic forbidden edit',notes:'',dueOn:null,status:'open'}},{cookie:before.cookie,'idempotency-key':'synthetic-foreign-edit-denied'},'PATCH')).status,404);
  assert.equal((await send(path,{action:'finish',otp:foreignCode,newPassword})).status,400);
  const stillForeign=await foreignContext.internalAdapter.findVerificationValue('reset-password:'+foreignCode);assert.ok(!!stillForeign&&stillForeign.value===foreign.ownerId&&new Date(stillForeign.expiresAt).valueOf()>Date.now());
  assert.equal((await readOwnerPrincipal(foreignAuth,foreign,new Headers({cookie:foreignCookie})))?.userId,foreign.ownerId);
  assert.deepEqual(await repo.exportSnapshot(config.ownerId),ownerSnapshot);assert.deepEqual(await repo.exportSnapshot(foreign.ownerId),foreignSnapshot);
  const afterPasswords=await pool.query('SELECT id,password FROM lifeos_platform.platform_account WHERE \"userId\"=ANY($1::text[]) ORDER BY id',[[config.ownerId,foreign.ownerId]]);assert.ok(JSON.stringify(afterPasswords.rows)===JSON.stringify(passwordState.rows));
  assert.deepEqual((await pool.query('SELECT id,email,\"emailVerified\" FROM lifeos_platform.platform_user WHERE id=ANY($1::text[]) ORDER BY id',[[config.ownerId,foreign.ownerId]])).rows,identityState.rows);

  assert.equal((await send(path,{action:'finish',otp:'a'.repeat(32),newPassword},{origin:'https://other.example.test'})).status,403);
  assert.equal((await send(path,{action:'request'},{host:'other.example.test'})).status,421);
  assert.equal((await send('/api/platform/personal/status')).status,401);
  let code='';const issue=ownerOperatorRecovery(config,pool,{enabled:true,withOwnerLock:ownerRecoveryLock(pool as SqlPool,config.ownerId),limit:ownerRecoveryRateLimit(pool as SqlPool,config.ownerId),delivery:{kind:'trusted-operator',send:async message=>{code=message.code;}}});
  assert.equal((await issue()).status,'issued');assert.ok(code.length>=20);
  assert.equal((await send(path,{action:'finish',otp:code,newPassword})).status,200);
  assert.equal((await send('/api/platform/personal/status',undefined,{cookie:before.cookie})).status,401);
  assert.notEqual((await login(oldPassword)).status,200);const passwordOnly=await login(newPassword);assert.equal(passwordOnly.status,200);assert.equal(JSON.parse(passwordOnly.body).twoFactorRedirect,true);const challenge=mergeSyntheticAuthCookies(passwordOnly.response);assert.equal((await send('/api/platform/personal/status',undefined,{cookie:challenge})).status,401);const second=await factorRequest('two-factor/verify-totp',{code:await syntheticOwnerTotp(mfaAuth,config.ownerId)},challenge);assert.equal(second.status,200);const signed={...passwordOnly,cookie:mergeSyntheticAuthCookies(second,challenge)};assert.ok(signed.cookie);
  await update(signed.cookie,'after-recovery');
  assert.equal((await send('/api/platform/personal/status',undefined,{cookie:signed.cookie})).body,statusBefore.body);
  assert.equal((await send('/api/platform/auth/sign-out',{}, {cookie:signed.cookie})).status,200);
  assert.equal((await send('/api/platform/personal/status',undefined,{cookie:signed.cookie})).status,401);
  assert.notEqual((await send(path,{action:'finish',otp:code,newPassword})).status,200);
 }finally{replaceApproval(undefined);await pool.end();}
});
