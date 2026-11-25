import test from 'node:test';import assert from 'node:assert/strict';
import {checkDeviceSession,checkOwnerPageAccess,personalLoginHref,safeSessionReturn} from '../src/session-duration/client.ts';
const value=(mode='fixed',needsRefresh=false)=>({user:{id:'fixture-owner'},session:{mfaVerified:true,sessionDurationMode:mode,sessionDurationSeconds:mode==='fixed'?1800:400*86400,expiresAt:new Date(Date.now()+60000).toISOString()},needsRefresh});
test('fixed active session needs one read while only an explicit rolling refresh needs a POST',async()=>{
 for(const rolling of [false,true]){const calls:string[]=[];const state=await checkDeviceSession((async(_url,init)=>{calls.push(init?.method??'GET');return Response.json(value(rolling?'rolling':'fixed',rolling&&calls.length===1));}) as typeof fetch);assert.equal(state.kind,'active');assert.deepEqual(calls,rolling?['GET','POST']:['GET']);}
});
test('explicit expiration, revocation and missing MFA require reauthentication',async()=>{
 for(const response of [null,{...value(),session:{...value().session,expiresAt:new Date(0).toISOString()}},{...value(),session:{...value().session,mfaVerified:false}}])assert.deepEqual(await checkDeviceSession((async()=>Response.json(response)) as typeof fetch),{kind:'locked'});
 for(const status of [401,403])assert.equal((await checkDeviceSession(async()=>new Response(null,{status}))).kind,'locked');
});
test('service, network and malformed responses are unavailable, including unknown renewal',async()=>{
 for(const response of [()=>new Response(null,{status:503}),()=>new Response('not JSON'),()=>Response.json({unexpected:true}),()=>{throw Error('synthetic offline');}]) {
  assert.equal((await checkDeviceSession(async()=>response())).kind,'unavailable');
 }
 let calls=0;const state=await checkDeviceSession(async()=>{calls++;if(calls===1)return Response.json(value('rolling',true));throw Error('synthetic unknown');});assert.equal(state.kind,'unavailable');assert.equal(calls,2);
 for(const status of [403,503]){
  const methods:string[]=[];
  const rejected=await checkDeviceSession(async(_url,init)=>{
   methods.push(init?.method??'GET');
   return init?.method==='GET'?Response.json(value('rolling',true)):new Response(null,{status});
  });
  assert.equal(rejected.kind,'unavailable');
  assert.deepEqual(methods,['GET','POST']);
 }
});
test('return paths remain inside personal pages and retain exact safe query, never an API or external origin',()=>{
 assert.equal(safeSessionReturn('/personal?page=tasks&create=todo'),'/personal?page=tasks&create=todo');assert.equal(safeSessionReturn('/personal/edit?type=journal&id=fixture'),'/personal/edit?type=journal&id=fixture');
 for(const input of ['https://foreign.invalid','//foreign.invalid','/api/platform/auth/sign-out','/personal/../api/platform','/personal\\evil','/personal#fragment','/personal%2f..%2fapi','/personal'+'?x='.repeat(1000)])assert.equal(safeSessionReturn(input),'/personal');
});
test('a superseded monitor cannot send a renewal after its read completes',async()=>{
 const controller=new AbortController();let calls=0;const state=await checkDeviceSession((async()=>{calls++;controller.abort();return Response.json(value('rolling',true));}) as typeof fetch,controller.signal);assert.equal(state.kind,'unavailable');assert.equal(calls,1);
});
test('legacy private page checks distinguish explicit denial from a failed read',async()=>{
 for(const [status,expected] of [[200,'active'],[401,'locked'],[403,'locked'],[429,'unavailable'],[503,'unavailable']] as const){
  assert.equal(await checkOwnerPageAccess(async(url,options)=>{
   assert.equal(url,'/api/platform/status');
   assert.equal(options?.credentials,'same-origin');
   assert.equal(options?.cache,'no-store');
   assert.equal(options?.method,undefined,'privacy recheck remains a read');
   return Response.json({scope:'isolated-synthetic-review'},{status});
  }),expected);
 }
 assert.equal(await checkOwnerPageAccess(async()=>new Response('<html>temporary gateway</html>')),'unavailable');
 assert.equal(await checkOwnerPageAccess(async()=>{throw Error('synthetic offline');}),'unavailable');
});

test('a direct login redirect preserves a safe personal destination and repeated query values',()=>{
 assert.equal(personalLoginHref('/personal',{}),'/login');
 const url=new URL(personalLoginHref('/personal/journal',{record:'one',person:['a','b']}),'https://fixture.invalid');
 assert.equal(url.pathname,'/login');
 assert.equal(url.searchParams.get('return_to'),'/personal/journal?record=one&person=a&person=b');
 assert.equal(personalLoginHref('/personal/../api/platform',{}),'/login');
});
