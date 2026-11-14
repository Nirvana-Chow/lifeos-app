import test from 'node:test';import assert from 'node:assert/strict';
import {authRequest} from '../src/platform/auth.ts';import {readPlatformConfig} from '../src/platform/config.ts';
import {submitLogin} from '../src/personal-candidate/login-flow.ts';
const base='http://127.0.0.1:32142',config=readPlatformConfig({LIFEOS_PLATFORM_CANDIDATE:'1',LIFEOS_PLATFORM_TARGET:'isolated-test',LIFEOS_PLATFORM_BASE_URL:base,LIFEOS_PLATFORM_OWNER_ID:'fixture-owner',LIFEOS_PLATFORM_OWNER_EMAIL:'fixture@example.invalid',LIFEOS_PLATFORM_SECRET:'synthetic-duration-secret-never-production-0000',LIFEOS_PLATFORM_TEST_DATABASE_URL:'postgresql://lifeos_platform_candidate_runtime:fixture@127.0.0.1:55432/lifeos_platform_test_fixture'})!;
const request=(path:string,method='POST',body:unknown={},origin=base)=>new Request(base+'/api/platform/auth/'+path,{method,headers:{host:new URL(base).host,origin,'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})});
test('refresh opens only an explicit same-originPOST; disabled capability, GET bodies and unknown fields stay closed',async()=>{
 let calls=0;const handler=async()=>{calls++;return Response.json({ok:true});};
 assert.equal((await authRequest(request('get-session'),config,handler)).status,405);
 assert.equal((await authRequest(request('get-session'),config,handler,{sessionDuration:true})).status,200);
 assert.equal((await authRequest(request('get-session','POST',{},'https://foreign.invalid'),config,handler,{sessionDuration:true})).status,403);
 assert.equal((await authRequest(request('get-session','POST',{sessionDuration:{mode:'rolling'}}),config,handler,{sessionDuration:true})).status,400);
 assert.equal(calls,1);
});
test('selection must be a validated duration on a qualified login and factor endpoint',async()=>{
 let calls=0;const handler=async()=>{calls++;return Response.json({ok:true});};
 const body={email:config.ownerEmail,password:'synthetic-password',sessionDuration:{mode:'fixed',seconds:86400}};
 assert.equal((await authRequest(request('sign-in/email','POST',body),config,handler)).status,400);
 assert.equal((await authRequest(request('sign-in/email','POST',body),config,handler,{sessionDuration:true})).status,200);
 assert.equal((await authRequest(request('sign-in/email','POST',{...body,sessionDuration:{mode:'forever'}}),config,handler,{sessionDuration:true})).status,400);assert.equal(calls,1);
});
test('one actual login orchestration carries the same selection across password and MFA with OAuth continuation',async()=>{
 const calls:Array<Record<string,unknown>>=[];
 const result=await submitLogin({personal:true,challenge:false,email:'fixture@example.invalid',password:'synthetic',code:'123456',backup:false,sessionDuration:{mode:'fixed',seconds:86400},oauthQuery:'signed-fixture'},async(_url,init)=>{calls.push(JSON.parse(init.body as string));return Response.json(calls.length===1?{twoFactorRedirect:true}:{user:{id:'fixture-owner'}});});
 assert.equal(result.kind,'redirect');assert.ok('location'in result&&result.location.includes('oauth_query='));assert.deepEqual(calls.map(c=>c.sessionDuration),[{mode:'fixed',seconds:86400},{mode:'fixed',seconds:86400}]);assert.equal(calls[0].rememberMe,true);assert.equal(calls[1].trustDevice,false);
});
test('session duration configuration is default closed and requires the exact reviewed activation value',()=>{
 const env={LIFEOS_PLATFORM_CANDIDATE:'1',LIFEOS_PLATFORM_TARGET:'isolated-test',LIFEOS_PLATFORM_BASE_URL:base,LIFEOS_PLATFORM_OWNER_ID:'fixture-owner',LIFEOS_PLATFORM_OWNER_EMAIL:'fixture@example.invalid',LIFEOS_PLATFORM_SECRET:'synthetic-duration-secret-never-production-0000',LIFEOS_PLATFORM_TEST_DATABASE_URL:'postgresql://lifeos_platform_candidate_runtime:fixture@127.0.0.1:55432/lifeos_platform_test_fixture'};
 assert.equal(readPlatformConfig(env)?.sessionDuration,undefined);assert.equal(readPlatformConfig({...env,LIFEOS_PERSONAL_SESSION_DURATION:'native-device-v1'})?.sessionDuration,'native-device-v1');assert.throws(()=>readPlatformConfig({...env,LIFEOS_PERSONAL_SESSION_DURATION:'1'}));
});
