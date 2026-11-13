import assert from 'node:assert/strict';
import test from 'node:test';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {MemoryPort} from './helpers/platform.ts';

const config={ownerId:'synthetic-owner',ownerEmail:'owner@example.invalid',spaceId:'synthetic-space',databaseName:'synthetic',baseURL:'https://synthetic.example.test',allowedTypes:['todo','journal'],approval:'personal-manual-v1'} as const;
test('owner status advertises storage review only when the existing service is available and never bypasses owner checks',async()=>{
 for(const verified of [false,true]){
  let owner:{userId:string;email:string}|null={userId:config.ownerId,email:config.ownerEmail};
  const handler=createPersonalPlatformHandler({config,repository:new MemoryPort(),storageVerified:verified,sessions:{read:async()=>owner},assertWritable:async()=>{throw Error('synthetic read only');}});
  const request=()=>new Request(config.baseURL+'/api/platform/personal/status',{headers:{host:'synthetic.example.test'}});
  const status=await handler(request());assert.equal(status.status,200);assert.equal(status.headers.get('cache-control'),'private, no-store');
  const body=await status.json();assert.equal(body.storageReviewEnabled,verified);assert.equal(body.writable,false);
  owner=null;assert.equal((await handler(request())).status,401);
  owner={userId:'other',email:config.ownerEmail};assert.equal((await handler(request())).status,403);
 }
});
