import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {buildWorkerArgv,assertProjectConfigAbsent,createParentWorkerSlots,createWorkerAdoption,workerArgvPolicySHA256} from '../src/worker-host-adoption/adoption.ts';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const assignment={jobId:'11111111-1111-4111-8111-111111111111',requirementId:'LO-REQ-001',sourceId:'22222222-2222-4222-8222-222222222222',workDigest:'a'.repeat(64),holderId:'parent-holder',claimKey:'original-parent-key',fence:2};
test('fixed CLI argv keeps workspace editing and exactly four assigned business MCP tools without user config inheritance',()=>{
 const args=buildWorkerArgv({cli:'/synthetic/cli',node:'/synthetic/node',bridgeEntry:'/synthetic/entry.mjs',bindingPath:'/synthetic/binding.json',bindingSHA256:'b'.repeat(64),worktree:'/synthetic/worktree'});
 assert.equal(args[0],'/synthetic/cli');assert.ok(args.includes('--ignore-user-config'));assert.ok(args.includes('workspace-write'));assert.ok(!args.includes('danger-full-access'));
 assert.ok(args.includes('features.multi_agent=false'));assert.ok(args.includes('features.fast_mode=false'));assert.ok(!args.includes('features.shell_tool=false'));
 const mcp=args.find(v=>v.startsWith('mcp_servers='))!;for(const name of ['read_assigned','claim_assigned','renew_assigned','progress_assigned'])assert.match(mcp,new RegExp(name));
 assert.doesNotMatch(mcp,/lifeos_call|lifeos_retry|bearer|token|api_key/i);assert.deepEqual(args.slice(-2),['lifeos-requirement-worker','-']);
 assert.match(workerArgvPolicySHA256,/^[a-f0-9]{64}$/);
});
test('project config rejection stops at the actual .git project root and does not reject the ignored user ancestor',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'worker-project-')));try{
  const work=join(root,'work'),nested=join(work,'nested');await mkdir(join(root,'.codex'));await writeFile(join(root,'.codex/config.toml'),'synthetic-user=true');await mkdir(work);await mkdir(join(work,'.git'));await mkdir(nested);
  await assertProjectConfigAbsent(nested);await mkdir(join(work,'.codex'));await writeFile(join(work,'.codex/config.toml'),'synthetic-project=true');
  await assert.rejects(assertProjectConfigAbsent(nested),/WORKER_PROJECT_CONFIG_UNQUALIFIED/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('default parent slots reject before provider/client access; reservations cannot be reused or reassigned',async()=>{
 const closed=createParentWorkerSlots();assert.throws(()=>closed.reserve(assignment),/WORKER_SLOT_UNAVAILABLE/);
 const slots=createParentWorkerSlots({capacity:4,occupied:3}),permit=slots.reserve(assignment);
 assert.throws(()=>slots.reserve({...assignment,jobId:'33333333-3333-4333-8333-333333333333'}),/WORKER_SLOT_UNAVAILABLE/);
 await assert.rejects(createWorkerAdoption({assignment,slots,reservation:permit,runtime:{} as any,providerQualification:{binary:'/missing/provider',sha256:'c'.repeat(64)}}).prepare({...assignment,fence:3}),/WORKER_BINDING_REJECTED/);
});
