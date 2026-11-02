import test from 'node:test';import assert from 'node:assert/strict';
import {createPlatformAuth,readOwnerPrincipal,authRequest} from '../src/platform/auth.ts';import {readPlatformConfig} from '../src/platform/config.ts';
const env={LIFEOS_PLATFORM_CANDIDATE:'1',LIFEOS_PLATFORM_TARGET:'isolated-test',LIFEOS_PLATFORM_BASE_URL:'http://127.0.0.1:3190',LIFEOS_PLATFORM_OWNER_ID:'fixture-owner-a',LIFEOS_PLATFORM_OWNER_EMAIL:'fixture@example.invalid',LIFEOS_PLATFORM_SECRET:'fixture-only-not-a-live-secret-000000000',LIFEOS_PLATFORM_TEST_DATABASE_URL:'postgresql://lifeos_platform_candidate_runtime:fixture-not-live@127.0.0.1:55432/lifeos_platform_test_fixture'};
test('the actual Better Auth candidate options close signup and keep server-backed strict sessions',()=>{
 let touched=0;const db={query:async()=>{touched++;throw Error('test database must not be touched');},connect:async()=>{touched++;throw Error('test database must not be touched');}};
 const auth=createPlatformAuth(readPlatformConfig(env)!,db as never),o=auth.options;
 assert.equal(touched,0);assert.equal(o.emailAndPassword?.disableSignUp,true);assert.equal(o.session?.cookieCache?.enabled,false);assert.equal(o.session?.storeSessionInDatabase,true);assert.equal(o.advanced?.defaultCookieAttributes?.httpOnly,true);assert.equal(o.advanced?.defaultCookieAttributes?.sameSite,'strict');assert.equal(o.advanced?.useSecureCookies,false);assert.equal(o.rateLimit?.storage,'database');
});
test('owner session reads reject wrong IDs/emails and do not trust client identity headers',async()=>{
 const config=readPlatformConfig(env)!,headers=new Headers({'x-owner':config.ownerId});let result:unknown=null;
 const auth={api:{getSession:async()=>result}};
 assert.equal(await readOwnerPrincipal(auth as never,config,headers),null);
 result={user:{id:'another-owner',email:config.ownerEmail}};assert.equal(await readOwnerPrincipal(auth as never,config,headers),null);
 result={user:{id:config.ownerId,email:'other@example.invalid'}};assert.equal(await readOwnerPrincipal(auth as never,config,headers),null);
 result={user:{id:config.ownerId,email:config.ownerEmail.toUpperCase()}};assert.deepEqual(await readOwnerPrincipal(auth as never,config,headers),{userId:config.ownerId,email:config.ownerEmail.toUpperCase()});
});
test('auth boundary denies signup, unknown paths, foreign origins and spoofed IP keys before auth',async()=>{
 let calls=0,ip='';const handler=async(r:Request)=>{calls++;ip=r.headers.get('x-platform-client')??'';return Response.json({ok:true});};const base=env.LIFEOS_PLATFORM_BASE_URL;
 const req=(path:string,method='GET',origin=base)=>authRequest(new Request(base+'/api/platform/auth/'+path,{method,headers:{host:'127.0.0.1:3190',origin,'content-type':'application/json','x-platform-client':'spoofed-ip'},...(method==='POST'?{body:JSON.stringify({email:'fixture@example.invalid',password:'fixture-not-live-password'})}:{})}),readPlatformConfig(env)!,handler);
 assert.equal((await req('sign-up/email','POST')).status,404);assert.equal((await req('update-user','POST')).status,404);assert.equal((await req('sign-in/email','POST','https://evil.invalid')).status,403);assert.equal(calls,0);
 assert.equal((await req('sign-in/email','POST')).status,200);assert.equal(ip,'127.0.0.1');assert.equal((await req('sign-out','POST')).status,200);assert.equal((await req('get-session')).status,200);
 assert.equal((await req('sign-in/email')).status,405);assert.equal(calls,3);
});
