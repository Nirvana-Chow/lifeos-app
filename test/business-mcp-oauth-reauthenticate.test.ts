import assert from 'node:assert/strict';
import test from 'node:test';
import {createBusinessOAuthHttp} from '../src/business-mcp-oauth/http.ts';
import {readOwnerMfaState} from '../src/platform/auth.ts';
import {sessionDurationFixture} from './helpers/session-duration.ts';
import {enrollSyntheticOwnerMfa,mergeSyntheticAuthCookies} from './helpers/owner-mfa-fixture.ts';

const origin='https://lifeos.nirvanachow.com';
const config={resource:origin+'/api/platform/mcp',issuer:origin+'/api/platform/auth',grantId:'synthetic-grant',scopes:['todo:read']};
const query='client_id=https%3A%2F%2Fclient.example%2Fmeta&scope=todo%3Aread&sig=signed%2Bquery%2520&exp=2000000000';

test('OAuth pages distinguish an old but valid owner session from fresh native MFA',async()=>{
 const api=await import('../src/business-mcp-oauth/owner-state.ts').catch(()=>null);assert.ok(api);
 const f=await sessionDurationFixture(true),login=await f.login({mode:'rolling'});
 const enrolled=await enrollSyntheticOwnerMfa(f.auth,f.config.ownerId,f.password,(p,b,c)=>f.send(p,b,c),mergeSyntheticAuthCookies(login));
 const headers=new Headers({cookie:enrolled.cookie});
 assert.equal(await api.readOAuthOwnerState(f.auth,f.config,headers),'ready');
 f.db.platform_session[0].createdAt=new Date(Date.now()-1801*1000);
 assert.equal((await readOwnerMfaState(f.auth,f.config,headers)).kind,'ready','ordinary browsing remains authenticated');
 assert.equal(await api.readOAuthOwnerState(f.auth,f.config,headers),'reauthenticate');
 f.db.platform_session.length=0;
 assert.equal(await api.readOAuthOwnerState(f.auth,f.config,headers),'anonymous');
});

test('a definite owner-MFA HTTP rejection returns to login with the exact signed query and no provider dispatch',async()=>{
 const api=await import('../src/business-mcp-oauth/consent-flow.ts').catch(()=>null);assert.ok(api);
 for(const continuation of [false,true]){
  let posts=0,providerCalls=0;
  const handler=createBusinessOAuthHttp({origin,config,assertReady:async()=>{},owner:async()=>null,handler:async()=>{providerCalls++;return Response.json({});},verifyToken:async()=>null,ledger:{register:async()=>null,approve:async()=>{},revoke:async()=>{}}});
  const result=await api.submitOAuthConsent({query,config,continuation,accept:true},async(path,init)=>{
   assert.ok(init);posts++;return handler(new Request(origin+path,{...init,headers:{...init.headers,host:'lifeos.nirvanachow.com',origin}}));
  });
  assert.deepEqual(result,{kind:'reauthenticate',location:'/login?reauthenticate=1&oauth_query='+encodeURIComponent(query)});
  assert.equal(posts,1);assert.equal(providerCalls,0);
 }
});

test('unconfirmed OAuth results stay unknown and never turn into a repeated consent or automatic login',async()=>{
 const api=await import('../src/business-mcp-oauth/consent-flow.ts').catch(()=>null);assert.ok(api);
 for(const failure of [async()=>{throw Error('connection lost');},async()=>Response.json({error:'OTHER'},{status:401}),async()=>Response.json({error:'OWNER_MFA_REQUIRED'},{status:503}),async()=>Response.json({redirect:true,url:'https://untrusted.invalid/callback'})]){
  let posts=0;
  assert.deepEqual(await api.submitOAuthConsent({query,config,continuation:false,accept:true},async()=>{posts++;return failure();}),{kind:'unknown'});
  assert.equal(posts,1);
 }
});
