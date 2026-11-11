import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableRequirementQueue,RequirementDispatcher,codexWorkerCommand,runCodexWorker} from '../src/requirement-events/mac-dispatcher.ts';
const id='11111111-1111-4111-8111-111111111111',sourceId='22222222-2222-4222-8222-222222222222';
const work={requirementId:id,sourceId,revision:1,workDigest:'a'.repeat(64),state:'ready',attempts:0,fence:0,lease:null} as const;
const executionLease={id,requirementId:id,sourceId,revision:1,workDigest:work.workDigest,holderId:'synthetic-mac',grantId:'synthetic-grant',fence:1,expiresAt:Date.now()+120000};
async function fixture(run:(dir:string)=>Promise<void>){const dir=await mkdtemp(join(tmpdir(),'lifeos-events-synthetic-'));try{await run(dir);}finally{await rm(dir,{recursive:true,force:true});}}
test('durable cursor and deduplicated work survive restart; overflow retains original cursor',()=>fixture(async dir=>{
 const queue=new DurableRequirementQueue(dir,2);await queue.ingest({cursor:'8',ready:[work,work]});
 const restarted=new DurableRequirementQueue(dir,2);assert.equal((await restarted.snapshot()).cursor,'8');assert.equal((await restarted.snapshot()).pending.length,1);
 await restarted.ingest({cursor:'9',ready:[{...work,requirementId:'33333333-3333-4333-8333-333333333333'}]});
 await assert.rejects(restarted.ingest({cursor:'10',ready:[{...work,requirementId:'44444444-4444-4444-8444-444444444444'}]}),/QUEUE_FULL/);
 assert.equal((await restarted.snapshot()).cursor,'9');
}));
test('no slot or no executable ticket starts zero models; claim precedes launch and duplicate events do not relaunch',()=>fixture(async dir=>{
 const queue=new DurableRequirementQueue(dir),trace:string[]=[];const api={claim:async(ticket:unknown)=>{trace.push('claim');return{id,requirementId:id,sourceId,revision:1,workDigest:work.workDigest,fence:1,holderId:'synthetic-mac',grantId:'synthetic-grant',expiresAt:Date.now()+120000};},renew:async(lease:import('../src/requirement-events/contracts.ts').ExecutionLease)=>lease};
 const worker=async()=>{trace.push('worker');return{outcome:'verified' as const};};
 await queue.ingest({cursor:'1',ready:[work]});
 assert.equal(await new RequirementDispatcher({queue,api,worker,holderId:'synthetic-mac'}).drain(),0);assert.deepEqual(trace,[]);
 const dispatcher=new RequirementDispatcher({queue,api,worker,holderId:'synthetic-mac',slots:1});assert.equal(await dispatcher.drain(),1);assert.deepEqual(trace,['claim','worker']);
 await queue.ingest({cursor:'2',ready:[work]});assert.equal(await dispatcher.drain(),0);
}));
test('uncertain launch recovery does not start another model, and revoked/changed claims stop before launch',()=>fixture(async dir=>{
 const queue=new DurableRequirementQueue(dir);await queue.ingest({cursor:'1',ready:[work]});
 const state=await queue.snapshot();state.pending[0].state='running';await writeFile(join(dir,'queue.json'),JSON.stringify(state),{mode:0o600});
 let starts=0;const dispatcher=new RequirementDispatcher({queue:new DurableRequirementQueue(dir),api:{claim:async()=>{throw Error('ACCESS_DENIED');},renew:async()=>{throw Error('ACCESS_DENIED');}},worker:async()=>{starts++;return{outcome:'verified'};},holderId:'synthetic-mac',slots:1});
 assert.equal(await dispatcher.drain(),0);assert.equal(starts,0);
}));
test('Codex candidate uses fixed stdin argv and per-invocation subagent disable; only a synthetic executable runs',()=>fixture(async dir=>{
 const command=codexWorkerCommand({binary:'/usr/bin/false',workingDirectory:dir},work);assert.equal(command.args.includes('--json'),true);assert.equal(command.args.includes('agents.enabled=false'),true);assert.equal(command.args.includes('--sandbox'),true);assert.equal(command.args.at(-1),'-');assert.doesNotMatch(command.prompt,/Bearer|body|Implement the requested/);
 const stub=join(dir,'synthetic-codex');await writeFile(stub,'#!/usr/bin/env node\nlet s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>{process.stdout.write(JSON.stringify({type:"turn.completed"})+"\\n")});\n',{mode:0o700});
 const result=await runCodexWorker({binary:stub,workingDirectory:dir,executionLease},work,new AbortController().signal);assert.equal(result.outcome,'unknown');assert.equal(result.processCompleted,true);
}));

test('native listener reconnects with its durable cursor and empty heartbeats start zero dispatches',()=>fixture(async dir=>{
 const {listenForRequirementEvents,decodeNativeEventLines}=await import('../src/requirement-events/mac-listener.ts');
 const queue=new DurableRequirementQueue(dir),abort=new AbortController();let connects=0,dispatches=0;
 await listenForRequirementEvents({enabled:true,queue,signal:abort.signal,dispatcher:{drain:async()=>{dispatches++;return 0;}} as never,channel:{async *connect(input){connects++;if(connects===1){assert.equal(input.cursor,'0');yield{cursor:'9',ready:[]};throw Error('offline');}assert.equal(input.cursor,'9');abort.abort();}},wait:async()=>{}});
 assert.equal(connects,2);assert.equal(dispatches,0);
 const frames=[];for await(const frame of decodeNativeEventLines((async function*(){yield new TextEncoder().encode('{"cursor":"9","ready":');yield new TextEncoder().encode('[]}\n');})()))frames.push(frame);assert.equal(frames.length,1);
 await assert.rejects(async()=>{for await(const _ of decodeNativeEventLines((async function*(){yield new TextEncoder().encode('{"cursor":"9"}');})())){}},/TRUNCATED/);
}));

test('worker cancellation waits for its owned synthetic child to stop instead of leaving it running',()=>fixture(async dir=>{
 const stub=join(dir,'synthetic-stubborn-codex');await writeFile(stub,'#!/usr/bin/env node\nrequire("node:fs").writeFileSync("stub.pid",String(process.pid));process.on("SIGTERM",()=>{});process.stdin.resume();setInterval(()=>{},1000);\n',{mode:0o700});
 const abort=new AbortController(),pending=runCodexWorker({binary:stub,workingDirectory:dir,executionLease},work,abort.signal);let pid=0;
 for(let i=0;i<500;i++){try{pid=Number(await readFile(join(dir,'stub.pid'),'utf8'));break;}catch{await new Promise(resolve=>setTimeout(resolve,10));}}
 abort.abort();await pending.catch(()=>{});assert.ok(pid>0);
 let live=false;try{process.kill(pid,0);live=true;}catch{}
 if(live)process.kill(pid,'SIGKILL'); // Own synthetic child only; clean up the expected RED probe.
 assert.equal(live,false);
}));

test('historical claim receipt must renew under the current server fence before any worker starts',()=>fixture(async dir=>{
 const queue=new DurableRequirementQueue(dir);await queue.ingest({cursor:'1',ready:[work]});let starts=0;
 const dispatcher=new RequirementDispatcher({queue,holderId:'synthetic-mac',slots:1,api:{claim:async()=>({id,requirementId:id,sourceId,revision:1,workDigest:work.workDigest,holderId:'synthetic-mac',grantId:'synthetic-grant',fence:1,expiresAt:Date.now()+60000}),renew:async()=>{throw Object.assign(Error('reclaimed'),{status:409,code:'EXECUTION_LEASE_LOST'});}},worker:async()=>{starts++;return{outcome:'verified'};}});
 assert.equal(await dispatcher.drain(),0);assert.equal(starts,0);
}));
