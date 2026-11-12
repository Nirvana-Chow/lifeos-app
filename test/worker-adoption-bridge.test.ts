import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,writeFile,readFile,cp,readdir,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {agentOperations} from '../src/agent-api/capabilities.ts';
import {requirements} from '../src/platform/requirements.ts';
import {createParentWorkerSlots,launchAdoptedWorker,workerArgvPolicySHA256} from '../src/worker-host-adoption/adoption.ts';
import {sha256} from '../src/worker-host-adoption/private-files.ts';

const assignment={jobId:'11111111-1111-4111-8111-111111111111',requirementId:'LO-REQ-001',sourceId:'22222222-2222-4222-8222-222222222222',workDigest:'a'.repeat(64),holderId:'synthetic-parent',claimKey:'synthetic-original-claim',fence:2};
const recoveryId='33333333-3333-4333-8333-333333333333';
const entrySource=resolve('scripts/lifeos-worker-bridge.mjs');

/** All programs/data are synthetic. The production bootstrap, gate, adapter,
 * assigned channel, original process launcher and official SDK are real. */
async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'worker-adoption-bridge-'))),bundle=join(root,'bundle');
 await mkdir(bundle,{mode:0o700});await mkdir(join(bundle,'public'),{mode:0o700});
 await cp(resolve('src'),join(bundle,'public/src'),{recursive:true,dereference:true});
 await writeFile(join(bundle,'package.json'),'{"type":"module"}');
 await cp(entrySource,join(bundle,'worker-bridge-entry.mjs'));
 await cp(resolve('src/worker-host-adoption/code-guard.mjs'),join(bundle,'code-guard.mjs'));
 const copied=new Set<string>();
 async function dependency(name:string){
  if(copied.has(name))return;copied.add(name);
  const source=await realpath(resolve('node_modules',name)),target=join(bundle,'node_modules',name);
  await mkdir(resolve(target,'..'),{recursive:true});await cp(source,target,{recursive:true,dereference:true});
  const metadata=JSON.parse(await readFile(join(source,'package.json'),'utf8'));
  for(const child of Object.keys(metadata.dependencies??{}))await dependency(child);
 }
 for(const name of ['@modelcontextprotocol/client','@modelcontextprotocol/server','@modelcontextprotocol/core','zod'])await dependency(name);
 const files:Record<string,string>={},directories:string[]=[];
 async function tree(directory:string,prefix:string){
  directories.push(prefix);
  for(const item of await readdir(directory,{withFileTypes:true})){const name=prefix+'/'+item.name,path=join(directory,item.name);if(item.isDirectory())await tree(path,name);else files[name]=sha256(await readFile(path));}
 }
 await tree(join(bundle,'public'),'public');await tree(join(bundle,'node_modules'),'node_modules');
 for(const name of ['package.json','code-guard.mjs','worker-bridge-entry.mjs'])files[name]=sha256(await readFile(join(bundle,name)));
 const manifest=JSON.stringify({schemaVersion:2,closedDirectories:['public','node_modules'],directories:directories.sort(),files,outerPinnedEntries:[]});
 await writeFile(join(bundle,'code-manifest.json'),manifest);
 const pin=async(binary:string)=>({binary,sha256:sha256(await readFile(binary))});
 const node=await pin(await realpath(process.execPath)),trace=join(root,'trace.jsonl'),statePath=join(root,'state.json');
 const lease={id:'44444444-4444-4444-8444-444444444444',requirementId:assignment.requirementId,sourceId:assignment.sourceId,revision:1,workDigest:assignment.workDigest,holderId:assignment.holderId,grantId:'synthetic-grant',fence:assignment.fence,expiresAt:Date.now()+600000};
 const fields={title:'Synthetic accepted ticket',body:'Keep accepted body',phaseId:requirements().roadmap!.phases[0].id,priority:'P2',plannedStartOn:null,plannedEndOn:null,workflow:{state:'planned',purpose:'Synthetic only',nextStep:'Verify'}};
 const state={catalog:{apiVersion:'2',operations:agentOperations.filter(op=>['getRequirement','claimRequirementExecution','updateRequirementExecution'].includes(op.id))},read:{ok:true,status:200,data:{entry:{id:assignment.requirementId,sourceId:assignment.sourceId,revision:1,baselineBinding:null,baselineConflict:false,fields},execution:{requirementId:assignment.requirementId,sourceId:assignment.sourceId,revision:1,workDigest:assignment.workDigest,state:'running',fence:assignment.fence,leaseActive:true,lease}}},lease};
 await writeFile(statePath,JSON.stringify(state));
 const wrapperCode=`import{readFileSync,appendFileSync}from'node:fs';let body='';for await(const c of process.stdin)body+=c;const args=process.argv.slice(2),s=JSON.parse(readFileSync(${JSON.stringify(statePath)},'utf8'));appendFileSync(${JSON.stringify(trace)},JSON.stringify({args,body})+'\\n');if(args[0]==='discover')console.log(JSON.stringify(s.catalog));else if(args[1]==='getRequirement')console.log(JSON.stringify(s.read));else if(args[1]==='claimRequirementExecution')console.log(JSON.stringify({ok:true,status:200,data:{lease:s.lease},verification:{verified:true,state:'CURRENT'}}));else{console.log(JSON.stringify({ok:false,status:0,outcome:'unknown',recovery:{requestId:${JSON.stringify(recoveryId)},exactRetryRequired:true}}));process.exitCode=2;}`;
 await writeFile(join(root,'wrapper.mjs'),wrapperCode);
 const wrapper=join(root,'client'),shell=(path:string)=>`#!/bin/sh\nexec '${node.binary}' '${path}' "$@"\n`;
 await writeFile(wrapper,shell(join(root,'wrapper.mjs')),{mode:0o700});
 const host=join(root,'host'),denied=join(root,'deny-peer');
 await writeFile(join(root,'host.mjs'),`import{existsSync,mkdirSync,writeFileSync}from'node:fs';import{createInterface}from'node:readline';if(process.argv[2]==='attest'){if(existsSync(${JSON.stringify(denied)}))process.exit(78);console.log(JSON.stringify({attested:true,jobId:${JSON.stringify(assignment.jobId)},requirementId:${JSON.stringify(assignment.requirementId)},sourceId:${JSON.stringify(assignment.sourceId)},workDigest:${JSON.stringify(assignment.workDigest)},fence:${assignment.fence}}));}else{for await(const line of createInterface({input:process.stdin})){const s=JSON.parse(line);mkdirSync(process.argv[3],{mode:0o700});writeFileSync(${JSON.stringify(join(root,'launch-spec.json'))},line);console.log(JSON.stringify({event:'process-completed',jobId:s.jobId,state:'exited',groupEmpty:true,outcome:'unknown',reusable:false}));process.exit(0);}}`);
 await writeFile(host,shell(join(root,'host.mjs')),{mode:0o700});
 const jobs=join(root,'jobs'),assignments=join(root,'assignments'),work=join(root,'work'),clientRoot=join(root,'client-root');
 for(const path of [jobs,assignments,work,clientRoot])await mkdir(path,{mode:0o700});await mkdir(join(work,'.git'));
 await writeFile(join(clientRoot,'code-manifest.json'),'synthetic-client-manifest');await writeFile(join(clientRoot,'native'),'synthetic-client-native');
 const clientManifest=await pin(join(clientRoot,'code-manifest.json')),clientBinary=await pin(join(clientRoot,'native'));
 await writeFile(join(clientRoot,'adoption.json'),JSON.stringify({schemaVersion:1,manifestSHA256:clientManifest.sha256,binarySHA256:clientBinary.sha256,origin:'https://lifeos.nirvanachow.com',apiBase:'/api/platform/agent'}),{mode:0o600});
 const runtime={host:await pin(host),cli:await pin(host),node,bridge:{root:bundle,entry:await pin(join(bundle,'worker-bridge-entry.mjs')),manifest:await pin(join(bundle,'code-manifest.json')),gate:await pin(join(bundle,'code-guard.mjs'))},client:{root:clientRoot,entry:await pin(wrapper),manifest:clientManifest,binary:clientBinary},worktree:work,jobsDirectory:jobs,assignmentsDirectory:assignments,maxWallMs:1000,maxOutputBytes:65536};
 const proof=join(root,'synthetic-evidence');await writeFile(proof,'Explicit synthetic qualification fixture, never production authority',{mode:0o600});
 const evidence=await pin(proof),summary=join(root,'provider-summary.json');
 await writeFile(summary,JSON.stringify({schemaVersion:1,cliSHA256:runtime.cli.sha256,argvPolicySHA256:workerArgvPolicySHA256,observedAt:Date.now(),expiresAt:Date.now()+600000,effectiveConfig:evidence,accountProjection:evidence,smokeResult:evidence}),{mode:0o600});
 const binding={schemaVersion:1,assignment,host:runtime.host,jobDirectory:join(jobs,assignment.jobId),clientEntry:runtime.client.entry,root:bundle,manifestSHA256:sha256(manifest),gate:runtime.bridge.gate};
 const bindingPath=join(assignments,'stdio-binding.json'),raw=JSON.stringify(binding);await writeFile(bindingPath,raw,{mode:0o600});
 const calls=async()=>{try{return(await readFile(trace,'utf8')).trim().split('\n').filter(Boolean).map(v=>JSON.parse(v));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return[];throw error;}};
 async function connect(){const transport=new StdioClientTransport({command:node.binary,args:[runtime.bridge.entry.binary,bindingPath,sha256(raw)],stderr:'pipe',env:{PATH:'/usr/bin:/bin'}}),client=new Client({name:'synthetic-adoption-review',version:'1'});await client.connect(transport);return client;}
 return{root,bundle,runtime,bindingPath,raw,denied,state,statePath,calls,connect,providerQualification:await pin(summary),clean:()=>rm(root,{recursive:true,force:true})};
}

test('actual bridge bootstrap rejects an untrusted binding before loading business code',()=>{
 const run=spawnSync(process.execPath,[entrySource,'/missing/synthetic-binding.json','a'.repeat(64)],{encoding:'utf8',env:{PATH:'/usr/bin:/bin'},timeout:3000});
 assert.equal(run.status,78);assert.equal(run.stdout,'');assert.equal(run.stderr.trim(),'WORKER_BRIDGE_REJECTED');
});

test('actual guarded stdio adapter uses only four tools and the original wrapper, retaining unknown recovery across restart',{timeout:30000},async()=>{
 const f=await fixture();try{
  await mkdir(join(f.runtime.jobsDirectory,assignment.jobId),{mode:0o700});
  let client=await f.connect();
  try{
   assert.deepEqual((await client.listTools()).tools.map(t=>t.name),['read_assigned','claim_assigned','renew_assigned','progress_assigned']);
   assert.equal((await client.callTool({name:'read_assigned',arguments:{}})).isError,false);
   assert.equal((await client.callTool({name:'claim_assigned',arguments:{}})).isError,false);
   const workflow={state:'in_progress',purpose:'Synthetic work',nextStep:'Keep original receipt'},result=await client.callTool({name:'progress_assigned',arguments:{expectedRevision:1,workflow,idempotencyKey:'synthetic-progress-key'}});
   assert.equal((result.structuredContent as any).outcome,'unknown');assert.equal((result.structuredContent as any).recovery.requestId,recoveryId);
   const seen=(await f.calls()).find(row=>row.args[1]==='updateRequirementExecution');assert.deepEqual(JSON.parse(seen.body).input.fields,{...f.state.read.data.entry.fields,workflow});assert.equal(JSON.parse(seen.body).idempotencyKey,'synthetic-progress-key');
  }finally{await client.close();}
  const count=(await f.calls()).length;client=await f.connect();
  try{
   for(const call of [{name:'claim_assigned',arguments:{}},{name:'lifeos_call',arguments:{operationId:'updateRequirement'}},{name:'lifeos_retry',arguments:{requestId:recoveryId}},{name:'read_assigned',arguments:{id:'LO-REQ-002'}}])assert.equal((await client.callTool(call)).isError,true);
   assert.equal((await f.calls()).length,count);
   await writeFile(f.denied,'synthetic peer revoked');assert.equal((await client.callTool({name:'read_assigned',arguments:{}})).isError,true);assert.equal((await f.calls()).length,count);
  }finally{await client.close();}
  const pending=JSON.parse(await readFile(join(f.runtime.jobsDirectory,assignment.jobId,'business-pending.json'),'utf8'));assert.equal(pending.pending.requestId,recoveryId);
 }finally{await f.clean();}
});

test('concrete prepare reaches the original owned launcher with fixed argv and never interprets process exit as business completion',{timeout:30000},async()=>{
 const f=await fixture();try{
  const slots=createParentWorkerSlots({capacity:4,occupied:3}),reservation=slots.reserve(assignment),options={assignment,runtime:f.runtime,providerQualification:f.providerQualification,slots,reservation};
  const run=await launchAdoptedWorker(options);assert.deepEqual(await run.done,{outcome:'unknown',processCompleted:true,quarantined:false,reusable:false});
  const spec=JSON.parse(await readFile(join(f.root,'launch-spec.json'),'utf8'));assert.equal(spec.reservedSlots,1);assert.deepEqual(spec.channelPeer.args.slice(0,2),[f.runtime.node.binary,f.runtime.bridge.entry.binary]);assert.equal(spec.args[0],f.runtime.cli.binary);assert.ok(spec.args.includes('workspace-write'));assert.equal(spec.fence,assignment.fence);
  await assert.rejects(launchAdoptedWorker(options),/WORKER_SLOT_UNAVAILABLE/);
  const calls=await f.calls();assert.ok(calls.every(row=>row.args[0]==='discover'||row.args[1]==='getRequirement'));
 }finally{await f.clean();}
});

test('bootstrap rejects a changed binding, gate, module or extra code before wrapper or peer work',{timeout:30000},async()=>{
 const f=await fixture();try{
  const launch=(digest=sha256(f.raw))=>spawnSync(f.runtime.node.binary,[f.runtime.bridge.entry.binary,f.bindingPath,digest],{encoding:'utf8',input:'',env:{PATH:'/usr/bin:/bin'},timeout:5000});
  const rejected=(run:ReturnType<typeof launch>)=>{assert.equal(run.status,78,run.stderr);assert.equal(run.stdout,'');assert.equal(run.stderr.trim(),'WORKER_BRIDGE_REJECTED');};
  rejected(launch('0'.repeat(64)));
  const gate=f.runtime.bridge.gate.binary,originalGate=await readFile(gate);await writeFile(gate,Buffer.concat([originalGate,Buffer.from('\n// changed synthetic gate')]));rejected(launch());await writeFile(gate,originalGate);
  const module=join(f.bundle,'public/src/worker-host-adoption/bridge.ts'),originalModule=await readFile(module);await writeFile(module,Buffer.concat([originalModule,Buffer.from('\n// changed synthetic module')]));rejected(launch());await writeFile(module,originalModule);
  const extra=join(f.bundle,'extra.mjs');await writeFile(extra,'throw Error("must never execute")');rejected(launch());await rm(extra);
  assert.deepEqual(await f.calls(),[]);
 }finally{await f.clean();}
});

test('expired provider evidence, unadopted client, missing discovery and stale fence cannot reach the owned launcher',{timeout:30000},async()=>{
 const f=await fixture();try{
  const slots=()=>{const value=createParentWorkerSlots({capacity:4,occupied:3});return{slots:value,reservation:value.reserve(assignment)};};
  const launch=()=>launchAdoptedWorker({assignment,runtime:f.runtime,providerQualification:f.providerQualification,...slots()});
  const summaryPath=f.providerQualification.binary,summary=await readFile(summaryPath,'utf8'),expired={...JSON.parse(summary),expiresAt:Date.now()-1};
  await writeFile(summaryPath,JSON.stringify(expired));const originalPin=f.providerQualification.sha256;f.providerQualification.sha256=sha256(JSON.stringify(expired));
  await assert.rejects(launch(),/WORKER_PROVIDER_UNQUALIFIED/);assert.deepEqual(await f.calls(),[]);
  await writeFile(summaryPath,summary);f.providerQualification.sha256=originalPin;
  const markerPath=join(f.runtime.client.root,'adoption.json'),marker=await readFile(markerPath);await rm(markerPath);await assert.rejects(launch());assert.deepEqual(await f.calls(),[]);await writeFile(markerPath,marker,{mode:0o600});
  const currentCatalog=f.state.catalog;f.state.catalog={...currentCatalog,operations:currentCatalog.operations.filter(op=>op.id!=='claimRequirementExecution')};await writeFile(f.statePath,JSON.stringify(f.state));
  await assert.rejects(launch(),/WORKER_DISCOVERY_REJECTED/);assert.ok((await f.calls()).every(row=>row.args[0]==='discover'));
  f.state.catalog=currentCatalog;f.state.read.data.execution.fence++;await writeFile(f.statePath,JSON.stringify(f.state));await assert.rejects(launch(),/WORKER_LIVE_FENCE_REJECTED/);
  await assert.rejects(readFile(join(f.root,'launch-spec.json')),/ENOENT/);
  assert.ok((await f.calls()).every(row=>row.args[0]==='discover'||row.args[1]==='getRequirement'));
 }finally{await f.clean();}
});
