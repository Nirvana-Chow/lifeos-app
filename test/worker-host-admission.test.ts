import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prepareOwnedWorker} from '../src/worker-host-candidate/owned-process.ts';
const binding=()=>({jobId:randomUUID(),requirementId:'LO-REQ-001',sourceId:randomUUID(),workDigest:'a'.repeat(64),fence:1});
test('worker launch has no adopted client/provider/slot port by default and cannot prepare a process',async()=>{
 await assert.rejects(prepareOwnedWorker(binding()),/WORKER_ADOPTION_REQUIRED/);
});
test('invalid assignment reaches neither adoption nor process/filesystem ports',async()=>{
 let calls=0;const adoption={prepare:async()=>{calls++;throw Error('must not prepare');}};
 for(const patch of [{fence:0},{fence:2.5},{requirementId:'foreign/path'},{workDigest:'x'},{ownerOperation:'updateRequirement'}])await assert.rejects(prepareOwnedWorker({...binding(),...patch},{adoption}));
 assert.equal(calls,0);
});
test('a prepared child cannot switch the assigned job/source/digest/fence, omit its narrow peer or acquire an unreserved slot',async()=>{
 const original=binding();let pinReads=0;
 const base={schemaVersion:1,...original,code:{binary:'/synthetic/worker',sha256:'b'.repeat(64)},args:['/synthetic/worker'],channelPeer:{code:{binary:'/synthetic/node',sha256:'c'.repeat(64)},entry:{binary:'/synthetic/peer.ts',sha256:'d'.repeat(64)},args:['/synthetic/node','/synthetic/peer.ts']},workingDirectory:'/synthetic/work',reservedSlots:1,maxWallMs:1000,maxOutputBytes:4096};
 for(const patch of [{jobId:randomUUID()},{sourceId:randomUUID()},{workDigest:'e'.repeat(64)},{fence:2},{reservedSlots:0},{channelPeer:null}]){
  await assert.rejects(prepareOwnedWorker(original,{adoption:{prepare:async()=>({host:{binary:'/synthetic/host',sha256:'f'.repeat(64)},jobDirectory:'/synthetic/'+original.jobId,spec:{...base,...patch}})},verifyPins:async()=>{pinReads++;}}));
 }
 assert.equal(pinReads,0,'binding and closed prerequisites are checked before executable IO');
});
