import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdtemp,readFile,writeFile,mkdir,rm,realpath} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {prepareOwnedWorker,startPreparedWorker} from '../src/worker-host-candidate/owned-process.ts';

test('OPT-IN actual macOS worker host start handshake, owned cancellation and orphan quarantine',{
 skip:process.platform!=='darwin'||process.env.RUN_WORKER_HOST_NATIVE_TESTS!=='1'?'Requires explicit synthetic native macOS qualification':false,timeout:90000,
},async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'lifeos-worker-host-native-'))),repo=resolve('.'),host=join(root,'host'),fault=join(root,'fault-host'),target=join(root,'synthetic-target');
 const common=['native/worker-host/WorkerHostCore.swift','native/worker-host/WorkerProcess.swift','native/worker-host/WorkerAttestation.swift'];
 const handles:ChildProcessWithoutNullStreams[]=[],ownedGroups=new Set<number>();
 t.after(async()=>{for(const child of handles){if(child.exitCode===null)child.kill('SIGKILL');}for(const pgid of ownedGroups){try{process.kill(-pgid,'SIGKILL');}catch{}}await rm(root,{recursive:true,force:true});});
 const compile=(files:string[],output:string)=>{const r=spawnSync('/usr/bin/swiftc',['-parse-as-library',...files.map(p=>join(repo,p)),'-o',output],{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);};
 compile([...common,'native/worker-host/WorkerHostMain.swift'],host);compile([...common,'test/fixtures/worker-host-fault-main.swift'],fault);compile(['test/fixtures/worker-host-target.swift'],target);
 const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
 const probe=(pid:number)=>{const r=spawnSync(fault,['probe',String(pid)],{encoding:'utf8',timeout:3000});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 const until=async(run:()=>Promise<boolean>|boolean)=>{for(let i=0;i<200;i++){if(await run())return;await delay(10);}assert.fail('native fixture condition did not settle');};
 async function spec(mode='normal'){
  const jobId=randomUUID(),directory=join(root,jobId),workingDirectory=join(root,'work-'+jobId);await mkdir(workingDirectory,{mode:0o700});
  return{directory,value:{schemaVersion:1,jobId,requirementId:'LO-REQ-001',sourceId:randomUUID(),workDigest:'a'.repeat(64),fence:1,code:{binary:target,sha256:hash(target)},args:[target,mode,directory],channelPeer:null as null|{code:{binary:string;sha256:string};entry:{binary:string;sha256:string};args:string[]},workingDirectory,reservedSlots:1,maxWallMs:10000,maxOutputBytes:65536}};
 }
 async function launch(binary:string,mode='normal',adjust:(value:Awaited<ReturnType<typeof spec>>['value'])=>void=()=>{}){
  const job=await spec(mode);adjust(job.value);const child=spawn(binary,['run',job.directory],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',NODE_ENV:'test'}});handles.push(child);let stdout='',stderr='';child.stdout.on('data',b=>stdout+=String(b));child.stderr.on('data',b=>stderr+=String(b));child.stdin.write(JSON.stringify(job.value)+'\n');
  const exit=new Promise<number|null>(accept=>child.once('close',code=>accept(code)));
  return{...job,child,exit,output:()=>({stdout,stderr}),ledger:async()=>JSON.parse(await readFile(join(job.directory,'ledger.json'),'utf8'))};
 }
 const inspect=(directory:string)=>{const r=spawnSync(host,['inspect',directory],{encoding:'utf8',timeout:3000});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 await t.test('missing reserved slot stops before any child launch',async()=>{
  const job=await spec();job.value.reservedSlots=0;const r=spawnSync(host,['run',job.directory],{input:JSON.stringify(job.value)+'\n',encoding:'utf8',timeout:3000});assert.equal(r.status,78);assert.equal(existsSync(join(job.directory,'target-started')),false);
 });
 await t.test('a changed code pin, argv binding, fence or unknown key cannot execute even the synthetic target',async()=>{
  for(const patch of [{code:{binary:target,sha256:'0'.repeat(64)}},{args:['/foreign/command']},{fence:0},{headers:{authorization:'synthetic-private-sentinel'}}]){
   const job=await spec(),r=spawnSync(host,['run',job.directory],{input:JSON.stringify({...job.value,...patch})+'\n',encoding:'utf8',timeout:3000});assert.equal(r.status,78);assert.equal(existsSync(join(job.directory,'target-started')),false);assert.doesNotMatch(r.stdout+r.stderr,/synthetic-private-sentinel/);
  }
 });
 await t.test('output saturation is bounded and cannot block owned cancellation or leak target stdout',async()=>{
  const run=await launch(host,'flood',v=>{v.maxOutputBytes=1024;});await until(()=>existsSync(join(run.directory,'target-child.json')));const child=JSON.parse(await readFile(join(run.directory,'target-child.json'),'utf8'));assert.equal(await run.exit,0);assert.equal((await run.ledger()).groupEmpty,true);await until(()=>!probe(child.pid).running);assert.ok(run.output().stdout.length<8192);
 });
 await t.test('native attestation binds the actual peer code/argv/ancestry to this running job and fence',async()=>{
  const run=await launch(host,'attest',value=>{value.args.push(host);value.channelPeer={code:value.code,entry:value.code,args:[...value.args]};});
  await until(()=>existsSync(join(run.directory,'peer-attestation.json')));const attestation=JSON.parse(await readFile(join(run.directory,'peer-attestation.json'),'utf8'));
  assert.deepEqual(attestation,{attested:true,jobId:run.value.jobId,requirementId:run.value.requirementId,sourceId:run.value.sourceId,workDigest:run.value.workDigest,fence:1});
  const foreign=spawnSync(host,['attest',run.directory],{encoding:'utf8',timeout:3000});assert.equal(foreign.status,78);assert.match(foreign.stdout,/PEER_REJECTED/);
  run.child.stdin.end();assert.equal(await run.exit,0);
  const after=spawnSync(host,['attest',run.directory],{encoding:'utf8',timeout:3000});assert.equal(after.status,78);
 });
 await t.test('typed adopted seam drives the real host once, cancels by pipe and never upgrades exit0 to verified',async()=>{
  const job=await spec();job.value.channelPeer={code:job.value.code,entry:job.value.code,args:[...job.value.args]};const {jobId,requirementId,sourceId,workDigest,fence}=job.value;
  const prepared=await prepareOwnedWorker({jobId,requirementId,sourceId,workDigest,fence},{adoption:{prepare:async()=>({host:{binary:host,sha256:hash(host)},jobDirectory:job.directory,spec:job.value})}});
  const abort=new AbortController(),run=startPreparedWorker(prepared,abort.signal);assert.throws(()=>startPreparedWorker(prepared));
  await until(()=>existsSync(join(job.directory,'target-child.json')));const child=JSON.parse(await readFile(join(job.directory,'target-child.json'),'utf8'));abort.abort();
  assert.deepEqual(await run.done,{outcome:'unknown',processCompleted:true,quarantined:false,reusable:false});await until(()=>!probe(child.pid).running);
 });
 await t.test('control pipe cancellation stops the actual owned leader and sleep child; exit is not business verification',async()=>{
  const run=await launch(host);await until(()=>existsSync(join(run.directory,'target-child.json')));await until(async()=>(await run.ledger()).state==='running');const ledger=await run.ledger(),child=JSON.parse(await readFile(join(run.directory,'target-child.json'),'utf8'));ownedGroups.add(ledger.worker.pgid);
  assert.equal(probe(ledger.worker.pid).running,true);assert.equal(probe(child.pid).running,true);run.child.stdin.write('{"command":"cancel"}\n');assert.equal(await run.exit,0);
  const final=await run.ledger();assert.equal(final.groupEmpty,true);assert.equal(final.outcome,'unknown');assert.equal(final.reusable,false);await until(()=>!probe(child.pid).running);assert.equal(probe(ledger.worker.pid).running,false);ownedGroups.delete(ledger.worker.pgid);
  assert.doesNotMatch(run.output().stdout,/fixture_private_stdout/);
 });
 await t.test('supervisor EOF and early leader exit both close the real owned process group',async()=>{
  for(const mode of ['normal','early']){const run=await launch(host,mode);await until(()=>existsSync(join(run.directory,'target-child.json')));const child=JSON.parse(await readFile(join(run.directory,'target-child.json'),'utf8'));if(mode==='normal')run.child.stdin.end();assert.equal(await run.exit,0,mode+JSON.stringify(run.output()));const final=await run.ledger();assert.equal(final.groupEmpty,true);assert.equal(final.outcome,'unknown');await until(()=>!probe(child.pid).running);}
 });
 await t.test('closed supervisor output cannot SIGPIPE the host before owned cleanup',async()=>{
  const run=await launch(host);await until(()=>existsSync(join(run.directory,'target-child.json')));const child=JSON.parse(await readFile(join(run.directory,'target-child.json'),'utf8'));run.child.stdout.destroy();run.child.stdin.end();assert.equal(await run.exit,0);assert.equal((await run.ledger()).groupEmpty,true);await until(()=>!probe(child.pid).running);
 });
 await t.test('a failed ledger write after target release still cleans the actual owned group',async()=>{
  const run=await launch(host);await until(()=>existsSync(join(run.directory,'target-child.json')));await until(async()=>(await run.ledger()).state==='running');const ledger=await run.ledger(),child=JSON.parse(await readFile(join(run.directory,'target-child.json'),'utf8'));ownedGroups.add(ledger.worker.pgid);
  await rm(join(run.directory,'ledger.json'));await mkdir(join(run.directory,'ledger.json'),{mode:0o700});run.child.stdin.write('{"command":"cancel"}\n');assert.equal(await run.exit,78);
  await until(()=>!probe(child.pid).running);assert.equal(probe(ledger.worker.pid).running,false);ownedGroups.delete(ledger.worker.pgid);
 });
 await t.test('hard host crash immediately after wrapper spawn cannot execute the target before durable PID ledger',async()=>{
  const run=await launch(fault);assert.equal(await run.exit,91,JSON.stringify(run.output()));const observation=JSON.parse(await readFile(join(run.directory,'fault-observed.json'),'utf8'));
  await until(()=>!probe(observation.pid).running);assert.equal(existsSync(join(run.directory,'target-started')),false);const state=inspect(run.directory);assert.equal(state.state,'quarantined');assert.equal(state.mayRestart,false);assert.equal(state.signalsSent,0);
 });
 await t.test('a hard host crash after release quarantines live orphans without killing or restarting them',async()=>{
  const run=await launch(host);await until(()=>existsSync(join(run.directory,'target-child.json')));const ledger=await run.ledger();ownedGroups.add(ledger.worker.pgid);run.child.kill('SIGKILL');await run.exit;
  const state=inspect(run.directory);assert.equal(state.state,'quarantined');assert.equal(state.identityMatches,true);assert.equal(state.mayRestart,false);assert.equal(state.signalsSent,0);assert.equal(probe(ledger.worker.pid).running,true);
  process.kill(-ledger.worker.pgid,'SIGKILL');await until(()=>!probe(ledger.worker.pid).running);ownedGroups.delete(ledger.worker.pgid);
 });
 await t.test('PID-start or pgid reuse cannot turn a new actual process into an old recovery kill target',async()=>{
  const run=await launch(host);await until(()=>existsSync(join(run.directory,'target-child.json')));run.child.stdin.end();await run.exit;const ledger=await run.ledger();
  const newer=spawn(target,run.value.args.slice(1),{detached:true,stdio:['pipe','pipe','pipe']});handles.push(newer);ownedGroups.add(newer.pid!);await until(()=>probe(newer.pid!).running);const actual=probe(newer.pid!);
  for(const mutation of ['start','pgid']){const worker={...actual,startSeconds:mutation==='start'?actual.startSeconds-1:actual.startSeconds,pgid:mutation==='pgid'?actual.pgid+100000:actual.pgid};await writeFile(join(run.directory,'ledger.json'),JSON.stringify({...ledger,state:'running',worker}),{mode:0o600});const state=inspect(run.directory);assert.equal(state.identityMatches,false);assert.equal(state.signalsSent,0);assert.equal(state.mayRestart,false);assert.equal(probe(newer.pid!).running,true);}
  process.kill(-newer.pid!,'SIGKILL');ownedGroups.delete(newer.pid!);
 });
 await t.test('detached synthetic child is not claimed cleaned or killed through an uncertain group',async()=>{
  const run=await launch(host,'escape');await until(()=>existsSync(join(run.directory,'escaped-child.json')));const escaped=JSON.parse(await readFile(join(run.directory,'escaped-child.json'),'utf8'));run.child.stdin.end();await run.exit;const ledger=await run.ledger();
  assert.equal(ledger.state,'quarantined');assert.equal(ledger.reusable,false);assert.equal(ledger.outcome,'unknown');assert.equal(probe(escaped.pid).running,true);const current=probe(escaped.pid);assert.equal(current.pgid,escaped.pid);process.kill(-escaped.pid,'SIGKILL');await until(()=>!probe(escaped.pid).running);
 });
});
