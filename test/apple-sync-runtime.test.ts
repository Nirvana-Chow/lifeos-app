import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeAppleSync} from '../src/apple-sync-candidate/runtime.ts';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {MemoryPort} from './helpers/platform.ts';
import type {PersonalConfig} from '../src/personal-candidate/config.ts';
import {applyReviewEnvironment,validateReviewConfig} from '../src/platform/private-config.ts';
const personal:PersonalConfig={ownerId:'synthetic-owner',ownerEmail:'owner@example.invalid',spaceId:'synthetic-space',databaseName:'lifeos_platform_test_local',allowedTypes:['todo'],approval:'personal-manual-v1',baseURL:'https://review.example.test'};
const request=(path='apple-sync/capabilities')=>new Request(personal.baseURL+'/api/platform/personal/'+path,{method:'POST',headers:{host:'review.example.test','content-type':'application/json','idempotency-key':'synthetic-runtime-command'},body:'{}'});

test('source flag alone never provisions identity, connects storage, captures writes or consumes a body',async()=>{
 let connected=0,identities=0;const pool={connect:async()=>{connected++;throw Error('No PG allowed');}};
 for(const value of [undefined,'0','source-v1','invalid']){
  for(const dependencies of [{},{principalReader:async()=>{identities++;return null;}}]){
   const runtime=await initializeAppleSync({LIFEOS_APPLE_SYNC_CANDIDATE:value},pool,personal,dependencies);
   assert.equal(runtime.capture,undefined);let read=false;const stream=new ReadableStream({pull(){read=true;throw Error('Body must stay unread');}},{highWaterMark:0});
   const response=await runtime.handler(new Request(request().url,{method:'POST',headers:request().headers,body:stream,duplex:'half'} as RequestInit));assert.equal(response.status,503);assert.equal(read,false);
  }
 }
 assert.equal(connected,0);assert.equal(identities,0);
});
test('the real assertWritable-only injection stays closed for every operation even with an owner cookie',async()=>{
 let sql=0,writes=0;const pool={connect:async()=>{sql++;throw Error('No PG allowed');}};
 const runtime=await initializeAppleSync({LIFEOS_APPLE_SYNC_CANDIDATE:'source-v1'},pool,{...personal,businessWriteMode:'owner-managed'},{assertWritable:async()=>{writes++;}});
 assert.equal(runtime.capture,undefined);
 for(const operation of ['capabilities','preview','lease','pull','prepare','claim','authorize-save','retire','observation','receipt','ack']){
  const base=request('apple-sync/'+operation),headers=new Headers(base.headers);headers.set('cookie','synthetic-owner-session=not-a-device-grant');
  const response=await runtime.handler(new Request(base.url,{method:'POST',headers,body:'{}'}));assert.equal(response.status,503);assert.equal((await response.json()).error.code,'SYNC_UNAVAILABLE');
 }
 assert.equal(sql,0);assert.equal(writes,0);
});
test('personal routing keeps bridge requests independent of owner browser sessions and legacy APIs',async()=>{
 let sessions=0,bridgeCalls=0;const make=(appleSync?:((r:Request)=>Promise<Response>))=>createPersonalPlatformHandler({repository:new MemoryPort(),sessions:{read:async()=>{sessions++;return null;}},config:personal,storageVerified:true,assertWritable:async()=>{throw Error('No permit');},appleSync});
 const closed=await make()(request());assert.equal(closed.status,503);assert.equal((await closed.json()).error.code,'SYNC_UNAVAILABLE');assert.equal(sessions,0);
 const injected=make(async r=>{bridgeCalls++;assert.equal(r.headers.has('cookie'),false);return new Response(null,{status:204});});assert.equal((await injected(request())).status,204);assert.equal(sessions,0);assert.equal(bridgeCalls,1);
 for(const path of ['apple-syncing/capabilities','todo'])assert.equal((await injected(request(path))).status,401);assert.equal(bridgeCalls,1);
 const foreign=new Request('https://foreign.invalid/api/platform/personal/apple-sync/capabilities',{method:'POST',headers:{host:'foreign.invalid'},body:'{}'});assert.equal((await injected(foreign)).status,403);assert.equal(bridgeCalls,1);
});
test('review launcher clears inherited source activation and accepts only a validated explicit flag',()=>{
 const base={LIFEOS_PLATFORM_CANDIDATE:'1',LIFEOS_PLATFORM_TARGET:'isolated-test',LIFEOS_PLATFORM_BASE_URL:'http://127.0.0.1:3002',LIFEOS_PLATFORM_OWNER_ID:'fixture-owner-a',LIFEOS_PLATFORM_OWNER_EMAIL:'fixture@example.invalid',LIFEOS_PLATFORM_SECRET:'synthetic-only-not-real-secret-000000000000',LIFEOS_PLATFORM_TEST_DATABASE_URL:'postgresql://lifeos_platform_candidate_runtime:synthetic-not-real@127.0.0.1:55432/lifeos_platform_test_local'};
 const inherited:Record<string,string|undefined>={LIFEOS_APPLE_SYNC_CANDIDATE:'source-v1'};applyReviewEnvironment(base,inherited);assert.equal(inherited.LIFEOS_APPLE_SYNC_CANDIDATE,undefined);
 applyReviewEnvironment({...base,LIFEOS_APPLE_SYNC_CANDIDATE:'source-v1'},inherited);assert.equal(inherited.LIFEOS_APPLE_SYNC_CANDIDATE,'source-v1');
 assert.throws(()=>validateReviewConfig({...base,LIFEOS_APPLE_SYNC_CANDIDATE:'true'}));
});
