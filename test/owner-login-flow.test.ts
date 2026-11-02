import test from 'node:test';
import assert from 'node:assert/strict';
// Synthetic credentials only. The injected transport replaces the external HTTP boundary.
import {submitLogin} from '../src/personal-candidate/login-flow.ts';
const credentials={personal:true,challenge:false,email:'fixture@example.invalid',password:'synthetic-password',code:'123456',backup:false};
function transport(replies:Array<Response|Error>){
 const calls:Array<{url:string;body:unknown}>=[];
 const fetcher=async(url:string,init:RequestInit)=>{calls.push({url,body:JSON.parse(init.body as string)});const reply=replies.shift();assert.ok(reply,'Unexpected duplicate authentication request');if(reply instanceof Error)throw reply;return reply;};
 return {calls,fetcher};
}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
test('password rejection never submits the supplied second factor',async()=>{
 assert.equal(typeof submitLogin,'function','Login must expose its real request orchestration');
 const t=transport([json({code:'INVALID_EMAIL_OR_PASSWORD'},401)]),result=await submitLogin(credentials,t.fetcher);
 assert.equal(result.kind,'error');assert.equal(result.challenge,false);assert.deepEqual(t.calls,[{url:'/api/platform/auth/sign-in/email',body:{email:'fixture@example.invalid',password:'synthetic-password',rememberMe:false}}]);
});
test('one submit follows the native password challenge with TOTP directly to the guarded personal page',async()=>{
 const t=transport([json({twoFactorRedirect:true}),json({token:'synthetic-session',user:{id:'synthetic-owner'}})]);
 assert.deepEqual(await submitLogin(credentials,t.fetcher),{kind:'redirect',location:'/personal'});
 assert.deepEqual(t.calls.map(call=>call.url),['/api/platform/auth/sign-in/email','/api/platform/auth/two-factor/verify-totp']);
 assert.deepEqual(t.calls[1].body,{code:'123456',trustDevice:false});
});
test('empty code permits initial enrollment and requests same-card input only after a challenge',async()=>{
 const first=transport([json({user:{id:'synthetic-owner'}})]);
 assert.deepEqual(await submitLogin({...credentials,code:''},first.fetcher),{kind:'redirect',location:'/account/mfa'});assert.equal(first.calls.length,1);
 const challenge=transport([json({twoFactorRedirect:true})]),result=await submitLogin({...credentials,code:''},challenge.fetcher);
 assert.equal(result.kind,'challenge');assert.equal(result.challenge,true);assert.equal(challenge.calls.length,1);
});
test('wrong, expired and rate-limited codes can be corrected without resubmitting a password',async()=>{
 for(const status of [400,401,429]){
  const t=transport([json({code:'INVALID_CODE'},status),json({user:{id:'synthetic-owner'}})]);
  const failed=await submitLogin({...credentials,challenge:true},t.fetcher);
  assert.equal(failed.kind,'challenge');assert.equal(failed.challenge,true);assert.ok('message'in failed&&failed.message.length>0);
  assert.deepEqual(await submitLogin({...credentials,challenge:true,code:'654321'},t.fetcher),{kind:'redirect',location:'/personal'});
  assert.deepEqual(t.calls.map(call=>call.url),['/api/platform/auth/two-factor/verify-totp','/api/platform/auth/two-factor/verify-totp']);
  assert.deepEqual(t.calls[1].body,{code:'654321',trustDevice:false});
 }
});
test('backup verification stays native and never requests trusted-device bypass',async()=>{
 const t=transport([json({user:{id:'synthetic-owner'}})]);
 assert.deepEqual(await submitLogin({...credentials,challenge:true,backup:true,code:'synthetic-backup-code'},t.fetcher),{kind:'redirect',location:'/account/mfa'});
 assert.deepEqual(t.calls,[{url:'/api/platform/auth/two-factor/verify-backup-code',body:{code:'synthetic-backup-code',trustDevice:false}}]);
});
test('unknown transport or malformed response never automatically replays authentication',async()=>{
 for(const challenge of [false,true]){
  const t=transport([new Error('synthetic disconnect')]),result=await submitLogin({...credentials,challenge},t.fetcher);
  assert.equal(result.kind,'unknown');assert.equal(result.challenge,challenge);assert.equal(t.calls.length,1);
  assert.doesNotMatch(JSON.stringify(result),/synthetic-password|123456|synthetic disconnect/);
 }
 const t=transport([new Response('not-json')]),result=await submitLogin(credentials,t.fetcher);
 assert.equal(result.kind,'unknown');assert.equal(t.calls.length,1);
});
test('synthetic capability retains its existing private review destination',async()=>{
 const t=transport([json({user:{id:'fixture-owner-a'}})]);
 assert.deepEqual(await submitLogin({...credentials,personal:false,code:''},t.fetcher),{kind:'redirect',location:'/review/admin'});
});

test('only personal TOTP success skips the MFA document for fresh and existing challenges',async()=>{
 for(const [personal,backup,wanted] of [[true,false,'/personal'],[true,true,'/account/mfa'],[false,false,'/account/mfa'],[false,true,'/account/mfa']] as const)for(const challenge of [false,true]){
  const t=transport([...(challenge?[]:[json({twoFactorRedirect:true})]),json({user:{id:'synthetic-owner'}})]);
  assert.deepEqual(await submitLogin({...credentials,personal,backup,challenge},t.fetcher),{kind:'redirect',location:wanted});
  assert.deepEqual(t.calls.map(c=>c.url),[...(challenge?[]:['/api/platform/auth/sign-in/email']),'/api/platform/auth/two-factor/'+(backup?'verify-backup-code':'verify-totp')]);assert.deepEqual(t.calls.at(-1)!.body,{code:'123456',trustDevice:false});
 }
});
