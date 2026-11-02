import test from'node:test';import assert from'node:assert/strict';import{memoryAdapter}from'better-auth/adapters/memory';import{hashPassword}from'better-auth/crypto';import{createPlatformAuth,authRequest,readOwnerPrincipal}from'../src/platform/auth.ts';import{readPlatformConfig}from'../src/platform/config.ts';
import{tamperSessionToken}from'./helpers/auth-cookie.ts';
test('actual Better Auth validates synthetic credentials/cookies, limits sign-in and revokes sign-out; test memory storage only',async()=>{
 const config=readPlatformConfig({LIFEOS_PLATFORM_CANDIDATE:'1',LIFEOS_PLATFORM_TARGET:'isolated-test',LIFEOS_PLATFORM_BASE_URL:'http://127.0.0.1:3190',LIFEOS_PLATFORM_OWNER_ID:'fixture-owner-a',LIFEOS_PLATFORM_OWNER_EMAIL:'fixture@example.invalid',LIFEOS_PLATFORM_SECRET:'fixture-only-not-a-live-secret-000000000',LIFEOS_PLATFORM_TEST_DATABASE_URL:'postgresql://lifeos_platform_candidate_runtime:fixture-not-live@127.0.0.1:55432/lifeos_platform_test_fixture'})!;
 const now=new Date(),password='Synthetic-only-password-0001',hash=await hashPassword(password);
 const db:Record<string,Record<string,unknown>[]>={platform_user:[{id:config.ownerId,name:'Synthetic owner',email:config.ownerEmail,emailVerified:false,image:null,createdAt:now,updatedAt:now},{id:'fixture-owner-b',name:'Synthetic other',email:'other@example.invalid',emailVerified:false,image:null,createdAt:now,updatedAt:now}],platform_account:[{id:'fixture-account-1',accountId:config.ownerId,providerId:'credential',userId:config.ownerId,password:hash,createdAt:now,updatedAt:now},{id:'fixture-account-2',accountId:'fixture-owner-b',providerId:'credential',userId:'fixture-owner-b',password:hash,createdAt:now,updatedAt:now}],platform_session:[],platform_verification:[],platform_rate_limit:[]};
 const auth=createPlatformAuth(config,memoryAdapter(db));
 const send=(path:string,body:unknown,cookie='')=>authRequest(new Request(config.baseURL+'/api/platform/auth/'+path,{method:'POST',headers:{host:'127.0.0.1:3190',origin:config.baseURL,'content-type':'application/json','x-platform-client':'forged-key',cookie},body:JSON.stringify(body)}),config,r=>auth.handler(r));
 assert.equal((await send('sign-in/email',{email:config.ownerEmail,password:'Wrong-synthetic-password'})).status,401);
 const other=await send('sign-in/email',{email:'other@example.invalid',password});assert.ok(other.status>=400);assert.equal(db.platform_session.length,0);
 const good=await send('sign-in/email',{email:config.ownerEmail,password});assert.equal(good.status,200);const cookies=good.headers.getSetCookie();assert.ok(cookies.length>0);assert.ok(cookies.every(c=>/HttpOnly/i.test(c)&&/SameSite=Strict/i.test(c)));
 const cookie=cookies.map(v=>v.split(';')[0]).join('; ');assert.equal((await readOwnerPrincipal(auth,config,new Headers({cookie})))?.userId,config.ownerId);
 assert.equal(await readOwnerPrincipal(auth,config,new Headers({cookie:tamperSessionToken(cookie)})),null);
 assert.equal((await send('sign-in/email',{email:config.ownerEmail,password})).status,429);
 assert.equal((await send('sign-out',{},cookie)).status,200);assert.equal(await readOwnerPrincipal(auth,config,new Headers({cookie})),null);assert.equal(db.platform_session.length,0);
});
async function ownerFixture(email='fixture@example.invalid'){
 const config=readPlatformConfig({LIFEOS_PLATFORM_CANDIDATE:'1',LIFEOS_PLATFORM_TARGET:'isolated-test',LIFEOS_PLATFORM_BASE_URL:'http://127.0.0.1:3190',LIFEOS_PLATFORM_OWNER_ID:'fixture-owner-a',LIFEOS_PLATFORM_OWNER_EMAIL:'fixture@example.invalid',LIFEOS_PLATFORM_SECRET:'fixture-only-not-a-live-secret-000000000',LIFEOS_PLATFORM_TEST_DATABASE_URL:'postgresql://lifeos_platform_candidate_runtime:fixture-not-live@127.0.0.1:55432/lifeos_platform_test_fixture'})!;
 const now=new Date(),password='Synthetic-only-password-0001',db:Record<string,Record<string,unknown>[]>={platform_user:[{id:config.ownerId,name:'Synthetic owner',email,emailVerified:false,image:null,createdAt:now,updatedAt:now}],platform_account:[{id:'fixture-account-1',accountId:config.ownerId,providerId:'credential',userId:config.ownerId,password:await hashPassword(password),createdAt:now,updatedAt:now}],platform_session:[],platform_verification:[],platform_rate_limit:[]};
 const auth=createPlatformAuth(config,memoryAdapter(db));
 const login=(rememberMe:boolean)=>authRequest(new Request(config.baseURL+'/api/platform/auth/sign-in/email',{method:'POST',headers:{host:'127.0.0.1:3190',origin:config.baseURL,'content-type':'application/json'},body:JSON.stringify({email,password,rememberMe})}),config,r=>auth.handler(r));
 return{config,db,login,auth};
}
test('matching owner ID with a changed stored email cannot mint a session',async()=>{
 const f=await ownerFixture('changed@example.invalid'),response=await f.login(true);assert.ok(response.status>=400,'matching ID alone must not authorize session creation');assert.equal(f.db.platform_session.length,0);
});
test('both rememberMe branches cap stored session expiry at the configured30minutes',async()=>{
 const f=await ownerFixture();for(const rememberMe of [false,true]){const before=Date.now(),response=await f.login(rememberMe);assert.equal(response.status,200);const stored=f.db.platform_session.at(-1)!;const expiry=new Date(stored.expiresAt as string).valueOf();assert.ok(expiry<=Date.now()+f.config.sessionSeconds*1000,'server expiry must honor configured cap for either rememberMe branch');assert.ok(expiry>=before+(f.config.sessionSeconds-1)*1000);}
});
test('rememberMe false cookie tampering changes the session token while preserving the separate remember marker',async()=>{
 const f=await ownerFixture(),signed=await f.login(false);assert.equal(signed.status,200);const cookie=signed.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');assert.ok(cookie.includes('.dont_remember='));const tampered=tamperSessionToken(cookie),rememberMarker=(value:string)=>value.split('; ').find(pair=>pair.startsWith('lifeos-platform-candidate.dont_remember='));assert.equal(rememberMarker(tampered),rememberMarker(cookie));assert.notEqual(tampered,cookie);assert.equal((await readOwnerPrincipal(f.auth,f.config,new Headers({cookie})))?.userId,f.config.ownerId);assert.equal(await readOwnerPrincipal(f.auth,f.config,new Headers({cookie:tampered})),null);
});

test('expired business permit still revokes the actual stored session and cookie replay fails',async()=>{
 const f=await ownerFixture();let permitted=true;
 const auth=createPlatformAuth(f.config,memoryAdapter(f.db),{disableSessionRefresh:true,assertSessionWrite:async()=>{if(!permitted)throw Error('expired');}});
 const send=(path:string,cookie='')=>authRequest(new Request(f.config.baseURL+'/api/platform/auth/'+path,{method:'POST',headers:{host:'127.0.0.1:3190',origin:f.config.baseURL,'content-type':'application/json',cookie},body:JSON.stringify(path==='sign-in/email'?{email:f.config.ownerEmail,password:'Synthetic-only-password-0001'}:{})}),f.config,r=>auth.handler(r),{assertWrite:async()=>{if(!permitted)throw Error('expired');}});
 const signed=await send('sign-in/email');assert.equal(signed.status,200);const cookie=signed.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');assert.equal(f.db.platform_session.length,1);
 permitted=false;assert.equal((await send('sign-in/email')).status,503);assert.equal((await send('sign-out',cookie)).status,200);assert.equal(f.db.platform_session.length,0);assert.equal(await readOwnerPrincipal(auth,f.config,new Headers({cookie})),null);
});

test('explicit readonly authentication uses actual session create/revoke without a business permit',async()=>{
 const {personalAuthPolicy}=await import('../src/personal-candidate/auth-policy.ts');const f=await ownerFixture();let businessChecks=0;
 const denied=async()=>{businessChecks++;throw Error('expired');},policy=personalAuthPolicy({LIFEOS_PERSONAL_READONLY_LOGIN:'owner-session-v1'},denied);
 const auth=createPlatformAuth(f.config,memoryAdapter(f.db),{disableSessionRefresh:true,forceSecureCookies:true,assertSessionWrite:policy.assertSessionWrite});
 const send=(path:string,cookie='',origin=f.config.baseURL)=>authRequest(new Request(f.config.baseURL+'/api/platform/auth/'+path,{method:'POST',headers:{host:'127.0.0.1:3190',origin,'content-type':'application/json',cookie},body:JSON.stringify(path==='sign-in/email'?{email:f.config.ownerEmail,password:'Synthetic-only-password-0001'}:{})}),f.config,r=>auth.handler(r),{assertWrite:policy.assertSessionWrite});
 assert.equal((await send('sign-in/email','','https://foreign.invalid')).status,403);
 const signed=await send('sign-in/email');assert.equal(signed.status,200);assert.equal(businessChecks,0);assert.equal(f.db.platform_session.length,1);assert.ok(signed.headers.getSetCookie().every(c=>/Secure/i.test(c)&&/HttpOnly/i.test(c)&&/SameSite=Strict/i.test(c)));
 const cookie=signed.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');assert.equal((await readOwnerPrincipal(auth,f.config,new Headers({cookie})))?.userId,f.config.ownerId);await assert.rejects(denied(),/expired/);
 assert.equal((await send('sign-out',cookie)).status,200);assert.equal(f.db.platform_session.length,0);assert.equal(await readOwnerPrincipal(auth,f.config,new Headers({cookie})),null);assert.equal(auth.options.session?.expiresIn,1800);assert.equal(auth.options.session?.cookieCache?.enabled,false);assert.equal(auth.options.rateLimit?.storage,'database');
});
