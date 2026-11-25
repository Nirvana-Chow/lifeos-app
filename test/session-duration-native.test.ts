import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryAdapter} from 'better-auth/adapters/memory';
import {authRequest,createPlatformAuth,readOwnerMfaState,readOwnerPrincipal,readVerifiedOwnerSession} from '../src/platform/auth.ts';
import {submitLogin} from '../src/personal-candidate/login-flow.ts';
import type {SessionDuration} from '../src/session-duration/policy.ts';
import {mergeSyntheticAuthCookies,enrollSyntheticOwnerMfa,syntheticOwnerTotp} from './helpers/owner-mfa-fixture.ts';
const day=86400;
import {sessionDurationFixture as fixture} from './helpers/session-duration.ts';
function assertLifetime(response:Response,row:Record<string,unknown>,seconds:number){
 const remaining=(new Date(row.expiresAt as string).valueOf()-Date.now())/1000;
 assert.ok(remaining>seconds-3&&remaining<=seconds+1,`server expiry ${remaining} must match ${seconds}`);
 const cookie=response.headers.getSetCookie().find(value=>value.startsWith('lifeos-platform-candidate.session_token='));
 assert.ok(cookie,'native signed session cookie required');
 assert.match(cookie,/HttpOnly/i);assert.match(cookie,/SameSite=Strict/i);
 const maxAge=Number(/Max-Age=(\d+)/i.exec(cookie)?.[1]);assert.ok(Math.abs(maxAge-seconds)<=2,`cookie Max-Age ${maxAge} must match server ${seconds}`);
}
test('new sessions default to fixed 30 days and honor selected day/custom with matching native cookies',async()=>{
 for(const [duration,seconds] of [[undefined,30*day],[{mode:'fixed',seconds:1800},1800],[{mode:'fixed',seconds:day},day],[{mode:'fixed',seconds:3*day},3*day]] as const){
  const f=await fixture();
  const response=await f.login(duration);assert.equal(response.status,200);const row=f.db.platform_session.at(-1)!;
  assertLifetime(response,row,seconds);assert.equal(row.sessionDurationMode,'fixed');assert.equal(row.sessionDurationSeconds,seconds);
 }
});
test('invalid duration cannot mint a native session',async()=>{
 for(const duration of [{mode:'rolling',seconds:1},{mode:'fixed',seconds:0},{mode:'fixed',seconds:1.5},{mode:'fixed',seconds:366*day},{mode:'forever'},'day']){
  const f=await fixture(),response=await f.login(duration);assert.equal(response.status,400);assert.equal(f.db.platform_session.length,0);
 }
});
test('default 30-day session never slides and expires at its original deadline',async t=>{
 const f=await fixture(),response=await f.login(),cookie=mergeSyntheticAuthCookies(response),row=f.db.platform_session[0];
 const before=new Date(row.expiresAt as Date).valueOf();
 assert.equal(before-new Date(row.createdAt as Date).valueOf(),30*day*1000);
 t.mock.timers.enable({apis:['Date'],now:before-60000});
 for(const method of ['GET','POST']){const checked=await f.send('get-session',{},cookie,method);assert.equal(checked.status,200);const current=(await checked.json()).session;assert.equal(current.id,row.id);assert.equal(new Date(current.expiresAt).valueOf(),before);assert.equal(new Date(f.db.platform_session[0].expiresAt as Date).valueOf(),before);assert.ok(!checked.headers.getSetCookie().some(value=>/session_token=.*Max-Age=[1-9]/.test(value)));}
 t.mock.timers.setTime(before+1);assert.equal(await readOwnerPrincipal(f.auth,f.config,new Headers({cookie})),null);
});
test('only rollingPOST refreshes both server/native cookie while GET and read-only auth stay unchanged',async()=>{
 const f=await fixture(),response=await f.login({mode:'rolling'}),cookie=mergeSyntheticAuthCookies(response),row=f.db.platform_session[0];assertLifetime(response,row,400*day);
 row.expiresAt=new Date(Date.now()+398*day*1000);row.createdAt=new Date(Date.now()-2*day*1000);const original=JSON.stringify(f.db.platform_session);
 const get=await f.send('get-session',{},cookie,'GET');assert.equal(get.status,200);assert.equal(JSON.stringify(f.db.platform_session),original);assert.equal((await get.json()).needsRefresh,true);
 const readAuth=createPlatformAuth(f.config,memoryAdapter(f.db),{sessionDuration:true,readOnlySessions:true,disableSessionRefresh:true});
 const readonlyGet=await f.send('get-session',{},cookie,'GET',readAuth);assert.equal((await readonlyGet.json()).needsRefresh,true,'read-only GET must advertise a needed POST without renewing');
 const readonly=await f.send('get-session',{},cookie,'POST',readAuth);assert.equal(readonly.status,200);assert.equal(JSON.stringify(f.db.platform_session),original);
 const refreshed=await f.send('get-session',{},cookie);assert.equal(refreshed.status,200);const renewed=f.db.platform_session[0];assertLifetime(refreshed,renewed,400*day);assert.equal(new Date(renewed.createdAt as Date).valueOf(),new Date(row.createdAt as Date).valueOf());
 const out=await f.send('sign-out',{},cookie);assert.equal(out.status,200);assert.equal(await readOwnerPrincipal(f.auth,f.config,new Headers({cookie})),null);assert.equal(f.db.platform_session.length,0);
});
test('concurrent device choices remain request-scoped',async()=>{
 const f=await fixture(),responses=await Promise.all([f.login({mode:'fixed',seconds:day}),f.login({mode:'rolling'})]);assert.deepEqual(responses.map(r=>r.status),[200,200]);
 assert.deepEqual(f.db.platform_session.map(row=>row.sessionDurationSeconds).sort((a,b)=>Number(a)-Number(b)),[day,400*day]);
 assert.ok(responses[0].headers.getSetCookie().some(c=>c.includes('Max-Age=86400')));assert.ok(responses[1].headers.getSetCookie().some(c=>c.includes('Max-Age=34560000')));
});
test('MFA challenge and native rotation retain the duration; old MFA cannot authorize sensitive access',async()=>{
 const f=await fixture(true),first=await f.login({mode:'fixed',seconds:7*day});assert.equal(first.status,200);
 const setup=await enrollSyntheticOwnerMfa(f.auth,f.config.ownerId,f.password,(p,b,c)=>f.send(p,b,c),mergeSyntheticAuthCookies(first));
 await f.send('sign-out',{},setup.cookie);f.db.platform_rate_limit.length=0;
 const password=await f.login({mode:'rolling'});assert.equal((await password.json()).twoFactorRedirect,true);
 const verified=await f.send('two-factor/verify-totp',{code:await syntheticOwnerTotp(f.auth,f.config.ownerId),trustDevice:false,sessionDuration:{mode:'rolling'}},mergeSyntheticAuthCookies(password));assert.equal(verified.status,200);
 const cookie=mergeSyntheticAuthCookies(verified),row=f.db.platform_session.at(-1)!;assertLifetime(verified,row,400*day);assert.equal(row.mfaVerified,true);
 assert.ok(await readVerifiedOwnerSession(f.auth,f.config,new Headers({cookie})));
 row.createdAt=new Date(Date.now()-1801*1000);
 assert.equal((await readOwnerPrincipal(f.auth,f.config,new Headers({cookie})))?.userId,f.config.ownerId,'ordinary session remains valid');assert.equal(await readVerifiedOwnerSession(f.auth,f.config,new Headers({cookie})),null,'sensitive authority expires separately');
});

test('expired devices can sign in again, sign out independently, and use a backup code only once',async t=>{
 const f=await fixture(true),context=await f.auth.$context;
 const readAuth=createPlatformAuth(f.config,memoryAdapter(f.db),{requireMfa:true,sessionDuration:true,readOnlySessions:true,disableSessionRefresh:true});
 const guards={
  requireMfa:true,sessionDuration:true,
  readMfaState:(headers:Headers)=>readOwnerMfaState(readAuth,f.config,headers),
  withOwnerLock:async <T,>(run:()=>Promise<T>)=>run(), // This memory fixture issues requests serially.
  trustedDeviceCookieNames:[context.createAuthCookie('trust_device').name],
  sessionCookieNames:[context.authCookies.sessionToken.name],
  twoFactorCookieNames:[context.createAuthCookie('two_factor').name],
 };
 const send=(path:string,body:Record<string,unknown>,cookie:string,method='POST')=>authRequest(new Request(f.config.baseURL+'/api/platform/auth/'+path,{
  method,headers:{host:new URL(f.config.baseURL).host,origin:f.config.baseURL,'content-type':'application/json',cookie},
  ...(method==='POST'?{body:JSON.stringify(body)}:{}),
 }),f.config,request=>(method==='GET'?readAuth:f.auth).handler(request),guards);
 const state=(cookie:string)=>readOwnerMfaState(readAuth,f.config,new Headers({cookie}));
 const owner=(cookie:string)=>readVerifiedOwnerSession(readAuth,f.config,new Headers({cookie}));
 const initial=await send('sign-in/email',{email:f.config.ownerEmail,password:f.password},'');
 assert.equal(initial.status,200);
 const {cookie:expiredCookie,backupCodes}=await enrollSyntheticOwnerMfa(f.auth,f.config.ownerId,f.password,send,mergeSyntheticAuthCookies(initial));
 const first=await owner(expiredCookie);
 assert.ok(first);
 const firstRow=f.db.platform_session.find(row=>row.id===first.sessionRef)!;
 assert.equal(firstRow.sessionDurationSeconds,30*day);

 const returnTo='/personal?page=tasks&create=todo';
 async function login(sessionDuration:SessionDuration,cookie=''){
  const code=await syntheticOwnerTotp(f.auth,f.config.ownerId);
  const steps:Array<[string,SessionDuration]>=[];
  let factor:Response|undefined;
  const result=await submitLogin({personal:true,challenge:false,email:f.config.ownerEmail,password:f.password,code,backup:false,sessionDuration,returnTo},async(url,init)=>{
   const path=url.slice('/api/platform/auth/'.length),body=JSON.parse(String(init.body));
   steps.push([path,body.sessionDuration]);
   const response=await send(path,body,cookie);
   cookie=mergeSyntheticAuthCookies(response,cookie);
   assert.equal(response.status,200);
   if(path==='sign-in/email')assert.deepEqual(await state(cookie),{kind:'anonymous'});
   else factor=response;
   return response;
  });
  assert.deepEqual(steps,[['sign-in/email',sessionDuration],['two-factor/verify-totp',sessionDuration]]);
  assert.deepEqual(result,{kind:'redirect',location:returnTo});
  assert.ok(factor);
  return {cookie,factor};
 }

 t.mock.timers.enable({apis:['Date'],now:new Date(firstRow.createdAt as Date).valueOf()+31*60*1000});
 assert.equal((await state(expiredCookie)).kind,'ready');
 assert.equal(await owner(expiredCookie),null,'ordinary access remains active while sensitive operations require fresh MFA');
 const second=await login({mode:'rolling'});
 const secondSession=await owner(second.cookie);
 assert.ok(secondSession);
 assert.notEqual(secondSession.sessionRef,first.sessionRef);

 t.mock.timers.setTime(new Date(firstRow.expiresAt as Date).valueOf()+1);
 assert.deepEqual(await state(expiredCookie),{kind:'anonymous'});
 const fixed={mode:'fixed',seconds:3*day} as const;
 const replacement=await login(fixed,expiredCookie);
 const replacementSession=await owner(replacement.cookie);
 assert.ok(replacementSession);
 assert.notEqual(replacementSession.sessionRef,first.sessionRef);
 const replacementRow=f.db.platform_session.find(row=>row.id===replacementSession.sessionRef)!;
 assert.equal(replacementRow.sessionDurationSeconds,fixed.seconds);
 assertLifetime(replacement.factor,replacementRow,fixed.seconds);
 assert.deepEqual(await state(expiredCookie),{kind:'anonymous'});

 const signedOut=await send('sign-out',{},replacement.cookie);
 assert.equal(signedOut.status,200);
 assert.equal(mergeSyntheticAuthCookies(signedOut,replacement.cookie),'');
 assert.deepEqual(await state(replacement.cookie),{kind:'anonymous'});
 assert.equal(f.db.platform_session.some(row=>row.id===replacementSession.sessionRef),false);
 assert.equal((await state(second.cookie)).kind,'ready');
 const readSecond=await send('get-session',{},second.cookie,'GET');
 assert.equal(readSecond.status,200);
 assert.equal((await readSecond.json()).session.id,secondSession.sessionRef);

 const backupCode=backupCodes[0];
 assert.ok(backupCode);
 const fallback=async()=>{
  let cookie='',passwordStatus=0,factorStatus=0;
  const result=await submitLogin({personal:true,challenge:false,email:f.config.ownerEmail,password:f.password,code:backupCode,backup:true,sessionDuration:fixed,returnTo},async(url,init)=>{
   const path=url.slice('/api/platform/auth/'.length);
   const response=await send(path,JSON.parse(String(init.body)),cookie);
   cookie=mergeSyntheticAuthCookies(response,cookie);
   if(path==='sign-in/email')passwordStatus=response.status;
   else factorStatus=response.status;
   return response;
  });
  assert.equal(passwordStatus,200);
  return {result,cookie,factorStatus};
 };
 t.mock.timers.tick(61_000);
 const recovered=await fallback();
 assert.equal(recovered.factorStatus,200);
 assert.deepEqual(recovered.result,{kind:'redirect',location:'/account/mfa?return_to='+encodeURIComponent(returnTo)});
 const recoveredOwner=await owner(recovered.cookie);
 assert.ok(recoveredOwner);
 assert.equal(f.db.platform_session.find(row=>row.id===recoveredOwner.sessionRef)?.sessionDurationSeconds,fixed.seconds);
 const reuse=await fallback();
 assert.ok([400,401].includes(reuse.factorStatus),`unexpected backup-code reuse status ${reuse.factorStatus}`);
 assert.equal(reuse.result.kind,'challenge');
 assert.deepEqual(await state(reuse.cookie),{kind:'anonymous'});
});
