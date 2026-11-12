import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createPinnedWorkerClient} from '../src/worker-host-adoption/business-client.ts';
import {createWorkerPendingJournal} from '../src/worker-host-adoption/pending-journal.ts';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const id='11111111-1111-4111-8111-111111111111';
test('actual pinned wrapper receives only the fixed business command and retains its original unknown result',{timeout:35000},async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'worker-client-')));try{
  const trace=join(root,'trace.json'),script=`#!/bin/sh\nexec '${process.execPath}' '${join(root,'fixture.mjs')}' "$@"\n`;
  await writeFile(join(root,'client'),script,{mode:0o700});
  await writeFile(join(root,'fixture.mjs'),`import{writeFileSync}from'node:fs';let raw='';for await(const c of process.stdin)raw+=c;writeFileSync(${JSON.stringify(trace)},JSON.stringify({args:process.argv.slice(2),body:raw,nodeEnv:process.env.NODE_ENV}));console.log(JSON.stringify({ok:false,status:0,outcome:'unknown',recovery:{requestId:${JSON.stringify(id)},exactRetryRequired:true}}));process.exitCode=2;`);
  const client=createPinnedWorkerClient({entry:{binary:join(root,'client'),sha256:hash(script)},timeoutMs:30000});
  const input={requirementId:'LO-REQ-001',workDigest:'a'.repeat(64),holderId:'synthetic-holder',idempotencyKey:'original-claim-key'};
  const result=await client.execute('claimRequirementExecution',input);
  assert.equal(result.outcome,'unknown');assert.equal(result.recovery?.requestId,id);
  const seen=JSON.parse(await readFile(trace,'utf8'));assert.deepEqual(seen.args,['call','claimRequirementExecution']);assert.deepEqual(JSON.parse(seen.body),input);
  assert.equal(seen.nodeEnv,'production');
  await assert.rejects(client.execute('updateRequirement',{id}),/WORKER_OPERATION_REJECTED/);
  assert.deepEqual(JSON.parse(await readFile(trace,'utf8')),seen);
  await client.retry(id);assert.deepEqual(JSON.parse(await readFile(trace,'utf8')).args,['retry',id]);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('changed wrapper pin is rejected before spawn; bounded write transport loss stays unknown without invented recovery',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'worker-client-')));try{
  const path=join(root,'client'),script='#!/bin/sh\nexec /bin/sleep 2\n';await writeFile(path,script,{mode:0o700});
  const client=createPinnedWorkerClient({entry:{binary:path,sha256:hash(script)},timeoutMs:50});
  const result=await client.execute('claimRequirementExecution',{requirementId:'LO-REQ-001',workDigest:'a'.repeat(64),holderId:'holder',idempotencyKey:'original-key'});
  assert.equal(result.outcome,'unknown');assert.equal(result.recovery,undefined);
  await writeFile(path,script+'# changed\n');await assert.rejects(client.execute('getRequirement',{id:'LO-REQ-001'}),/WORKER_CODE_REJECTED/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('pending metadata survives another journal instance and refuses changed binding, replacement or type tampering',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'worker-pending-')));try{
  const binding={jobId:id,requirementId:'LO-REQ-001',sourceId:'22222222-2222-4222-8222-222222222222',workDigest:'a'.repeat(64),fence:1};
  const journal=createWorkerPendingJournal(root,binding),pending={operationId:'claimRequirementExecution',requestId:id,reason:'unknown' as const};
  assert.equal(await journal.read(),null);await journal.remember(pending);
  assert.deepEqual(await createWorkerPendingJournal(root,binding).read(),pending);
  await assert.rejects(journal.remember({...pending,requestId:null}),/WORKER_PENDING_CHANGED/);
  await assert.rejects(createWorkerPendingJournal(root,{...binding,fence:2}).read(),/WORKER_PENDING_REJECTED/);
  const path=join(root,'business-pending.json'),original=await readFile(path,'utf8');await writeFile(path,original.replace('"unknown"','0'));
  await assert.rejects(journal.read(),/WORKER_PENDING_REJECTED/);
  await writeFile(path,original);await journal.clear();assert.equal(await journal.read(),null);
  const unsafe=join(root,'unsafe');await mkdir(unsafe,{mode:0o755});await assert.rejects(createWorkerPendingJournal(unsafe,binding).read(),/WORKER_PRIVATE_PATH_REJECTED/);
 }finally{await rm(root,{recursive:true,force:true});}
});
