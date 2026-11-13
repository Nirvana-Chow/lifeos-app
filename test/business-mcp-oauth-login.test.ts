import assert from 'node:assert/strict';import test from 'node:test';
import {submitLogin} from '../src/personal-candidate/login-flow.ts';
test('native MFA login retains the signed OAuth continuation without adding it to password or factor payloads',async()=>{
 const calls:unknown[]=[];const query='client_id=https%3A%2F%2Fclient.example%2Fmeta&sig=synthetic-signature&exp=2000000000';
 const result=await submitLogin({personal:true,challenge:false,email:'owner',password:'synthetic-only-password',code:'123456',backup:false,oauthQuery:query},async(url,init)=>{calls.push({url,body:JSON.parse(init.body as string)});return Response.json(url.endsWith('email')?{twoFactorRedirect:true}:{user:{id:'owner'}});});
 assert.deepEqual(result,{kind:'redirect',location:'/personal/oauth/continue?oauth_query='+encodeURIComponent(query)});
 assert.equal(JSON.stringify(calls).includes('synthetic-signature'),false);
});
test('OAuth password-only and backup flows retain the canonical account MFA check',async()=>{
 for(const backup of [false,true]){
  const result=await submitLogin({personal:true,challenge:backup,email:'owner',password:'synthetic-only-password',code:'backup-code',backup,oauthQuery:'signed'},async()=>Response.json({user:{id:'owner'}}));
  assert.deepEqual(result,{kind:'redirect',location:'/account/mfa?oauth_query=signed'});
 }
});
