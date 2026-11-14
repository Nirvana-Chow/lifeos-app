import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryAdapter} from 'better-auth/adapters/memory';
import {hashPassword} from 'better-auth/crypto';
import {createPlatformAuth,readOwnerPrincipal,readVerifiedOwnerSession} from '../src/platform/auth.ts';
import {readPlatformConfig} from '../src/platform/config.ts';
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
test('new sessions default to fixed30minutes and honor selected day/custom with matching native cookies',async()=>{
 const f=await fixture();
 for(const [duration,seconds] of [[undefined,1800],[{mode:'fixed',seconds:day},day],[{mode:'fixed',seconds:3*day},3*day]] as const){
  const response=await f.login(duration);assert.equal(response.status,200);const row=f.db.platform_session.at(-1)!;
  assertLifetime(response,row,seconds);assert.equal(row.sessionDurationMode,'fixed');assert.equal(row.sessionDurationSeconds,seconds);
 }
});
test('invalid duration cannot mint a native session',async()=>{
 for(const duration of [{mode:'rolling',seconds:1},{mode:'fixed',seconds:0},{mode:'fixed',seconds:1.5},{mode:'fixed',seconds:366*day},{mode:'forever'},'day']){
  const f=await fixture(),response=await f.login(duration);assert.equal(response.status,400);assert.equal(f.db.platform_session.length,0);
 }
});
test('fixed sessions never slide on GET or deferredPOST and expired cookies cannot restore them',async()=>{
 const f=await fixture(),response=await f.login({mode:'fixed',seconds:day}),cookie=mergeSyntheticAuthCookies(response),row=f.db.platform_session[0];
 row.expiresAt=new Date(Date.now()+60000);const before=new Date(row.expiresAt as Date).valueOf();
 for(const method of ['GET','POST']){const checked=await f.send('get-session',{},cookie,method);assert.equal(checked.status,200);assert.equal(new Date(row.expiresAt as Date).valueOf(),before);assert.ok(!checked.headers.getSetCookie().some(value=>/session_token=.*Max-Age=[1-9]/.test(value)));}
 row.expiresAt=new Date(Date.now()-1);assert.equal(await readOwnerPrincipal(f.auth,f.config,new Headers({cookie})),null);
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
