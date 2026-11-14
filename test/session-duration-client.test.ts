import test from 'node:test';import assert from 'node:assert/strict';
import {checkDeviceSession,safeSessionReturn} from '../src/session-duration/client.ts';
const value=(mode='fixed',needsRefresh=false)=>({user:{id:'fixture-owner'},session:{mfaVerified:true,sessionDurationMode:mode,sessionDurationSeconds:mode==='fixed'?1800:400*86400,expiresAt:new Date(Date.now()+60000).toISOString()},needsRefresh});
test('fixed active session needs one read while only an explicit rolling refresh needs a POST',async()=>{
 for(const rolling of [false,true]){const calls:string[]=[];const state=await checkDeviceSession((async(_url,init)=>{calls.push(init?.method??'GET');return Response.json(value(rolling?'rolling':'fixed',rolling&&calls.length===1));}) as typeof fetch);assert.equal(state.kind,'active');assert.deepEqual(calls,rolling?['GET','POST']:['GET']);}
});
test('expiration, revocation, unverifiedMFA and unknown refresh lock without an automatic replay',async()=>{
 for(const response of [null,{...value(),session:{...value().session,expiresAt:new Date(0).toISOString()}},{...value(),session:{...value().session,mfaVerified:false}}])assert.deepEqual(await checkDeviceSession((async()=>Response.json(response)) as typeof fetch),{kind:'locked'});
 let calls=0;const state=await checkDeviceSession((async()=>{calls++;if(calls===1)return Response.json(value('rolling',true));throw Error('synthetic unknown');}) as typeof fetch);assert.equal(state.kind,'locked');assert.equal(calls,2);
});
test('return paths remain inside personal pages and retain exact safe query, never an API or external origin',()=>{
 assert.equal(safeSessionReturn('/personal?page=tasks&create=todo'),'/personal?page=tasks&create=todo');assert.equal(safeSessionReturn('/personal/edit?type=journal&id=fixture'),'/personal/edit?type=journal&id=fixture');
 for(const input of ['https://foreign.invalid','//foreign.invalid','/api/platform/auth/sign-out','/personal/../api/platform','/personal\\evil','/personal#fragment','/personal%2f..%2fapi','/personal'+'?x='.repeat(1000)])assert.equal(safeSessionReturn(input),'/personal');
});
test('a superseded monitor cannot send a renewal after its read completes',async()=>{
 const controller=new AbortController();let calls=0;const state=await checkDeviceSession((async()=>{calls++;controller.abort();return Response.json(value('rolling',true));}) as typeof fetch,controller.signal);assert.equal(state.kind,'locked');assert.equal(calls,1);
});
