import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createWorkerChannel} from '../src/worker-host-candidate/channel.ts';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {LifeOSApiClient} from '../src/mcp-candidate/client.ts';
import {MemoryPort} from './helpers/platform.ts';
import {MemoryRequirementEvents} from './helpers/requirement-events-memory.ts';
import {RequirementEventService} from '../src/requirement-events/service.ts';
import {requirements} from '../src/platform/requirements.ts';
import {Client,InMemoryTransport} from '@modelcontextprotocol/client';
import {createAssignedWorkerMcpServer} from '../src/worker-host-candidate/mcp.ts';

async function fixture(){
 const origin='https://lifeos.nirvanachow.com',owner='synthetic-worker-owner',space='synthetic-worker-space';
 const repo=new MemoryPort(),events=new MemoryRequirementEvents(),service=new RequirementEventService(events);let revoked=false,attested=true;
 const transaction=repo.transaction.bind(repo);repo.readCurrentSnapshot=async()=>structuredClone([...repo.rows.values()]);
 repo.transaction=(id,key,run)=>transaction(id,key,tx=>run({...tx,lockRecordIdentity:async()=>{},lockAgentGrant:async()=>!revoked,
 // The real GET now composes the canonical requirement reader with this port
 // on the original transaction. Projection is read-only; digest is synthetic.
 projectRequirementExecution:async binding=>{
  assert.equal(binding.spaceId,space);
  const work=structuredClone(events.rows.get(binding.requirementId)??{requirementId:binding.requirementId,sourceId:binding.sourceId,revision:binding.revision,workDigest:'a'.repeat(64),state:'candidate' as const,attempts:0,fence:0,lease:null});
  return{...work,leaseActive:work.state==='running'&&!!work.lease&&work.lease.expiresAt>events.now};
 },assertRequirementExecutionLease:async b=>{const row=events.rows.get(b.requirementId);if(!row?.lease||row.lease.id!==b.id||row.fence!==b.fence||row.lease.expiresAt<=events.now)throw Object.assign(Error('expired'),{status:409,code:'EXECUTION_LEASE_LOST'});},write:async(entry,raw,create)=>{await tx.write(entry,raw,create);const work=events.rows.get(entry.id);if(work)work.revision=entry.revision;}}));
 const grant=()=>revoked?null:{ownerId:owner,spaceId:space,grantId:'synthetic-worker-grant',scopes:['requirements:read','requirements:write'] as const};
 const config={ownerId:owner,spaceId:space,ownerEmail:'fixture@example.invalid',baseURL:origin,databaseName:'fixture',approval:'personal-manual-v1',allowedTypes:['todo','journal'],requirementsEnabled:true} as const;
 const handler=createAgentHandler({enabled:true,mountPath:'/api/platform/agent',fenceWrites:true,modules:{organization:false,classification:false,requirements:true,requirementEvents:true},repository:repo,config,verify:async()=>grant(),readCurrentGrant:async()=>grant(),operationAvailable:()=>true,assertWritable:async()=>{},requirementEvents:{service,ready:async()=>true,openNotifications:async()=>({wait:async()=>{throw Error('end');},close:async()=>{}})}});
 const trace:{path:string;method:string;body?:any}[]=[];let lose=false;
 const client=new LifeOSApiClient({origin,credentialProvider:async()=> 'synthetic-worker-token'},async(input,init)=>{const request=new Request(input,init);request.headers.set('host','lifeos.nirvanachow.com');trace.push({path:new URL(request.url).pathname,method:request.method,...(request.method==='GET'?{}:{body:await request.clone().json()})});const response=await handler(request);if(lose&&request.method==='PATCH'){lose=false;throw Error('synthetic lost committed response');}return response;});
 const fields={title:'Accepted synthetic ticket',body:'Accepted body must not change',phaseId:requirements().roadmap!.phases[0].id,priority:'P2',plannedStartOn:null,plannedEndOn:null,workflow:{state:'planned',purpose:'Accepted purpose',nextStep:'Implement'}} as const;
 const created=await client.execute('createRequirement',{fields,idempotencyKey:'synthetic-worker-create'});assert.equal(created.ok,true);const entry=(created.data as any).entry;
 events.rows.set(entry.id,{requirementId:entry.id,sourceId:entry.sourceId,revision:1,workDigest:'a'.repeat(64),state:'ready',attempts:0,fence:0,lease:null});
 const assignment={jobId:randomUUID(),requirementId:entry.id,sourceId:entry.sourceId,workDigest:'a'.repeat(64),holderId:'synthetic-worker-mac',claimKey:'synthetic-worker-claim',fence:1};
 let pending:any=null;const journal={read:async()=>pending,remember:async(value:any)=>{pending=structuredClone(value);},clear:async()=>{pending=null;}};
 const channel=createWorkerChannel({assignment,client,journal,attest:async()=>{if(!attested)throw Error('PEER_REJECTED');}});trace.length=0;
 return{assignment,channel,client,entry,fields,events,trace,repo,journal,revoke:()=>{revoked=true;},denyPeer:()=>{attested=false;},loseNextProgress:()=>{lose=true;}};
}
test('worker fixture GET projects current execution without materializing legacy work or changing the record',async()=>{
 const f=await fixture(),records=structuredClone([...f.repo.rows.values()]),work=structuredClone(f.events.rows.get(f.entry.id)!);
 const read=await f.client.execute('getRequirement',{id:f.entry.id});assert.equal(read.ok,true,JSON.stringify(read));
 assert.deepEqual((read.data as any).execution,{...work,leaseActive:false,admissionEligible:true});
 assert.deepEqual([...f.repo.rows.values()],records);assert.deepEqual(f.events.rows.get(f.entry.id),work);
 f.events.rows.delete(f.entry.id);
 const legacy=await f.client.execute('getRequirement',{id:f.entry.id});assert.equal(legacy.ok,true,JSON.stringify(legacy));
 assert.deepEqual((legacy.data as any).execution,{requirementId:f.entry.id,sourceId:f.entry.sourceId,revision:1,workDigest:f.assignment.workDigest,state:'candidate',attempts:0,fence:0,lease:null,leaseActive:false,admissionEligible:true});
 assert.equal(f.events.rows.size,0,'a GET must not backfill/admit legacy work');assert.deepEqual([...f.repo.rows.values()],records);assert.equal(f.repo.historyRows.length,1);
});
test('worker channel reads only the assigned record, claims and renews with current independent lease readback',async()=>{
 const f=await fixture(),read=await f.channel.handle({command:'read'});assert.equal(read.ok,true);assert.equal((read.data as any).entry.id,f.entry.id);
 const claimed=await f.channel.handle({command:'claim'});assert.equal(claimed.verification?.verified,true,JSON.stringify(claimed));
 const renewed=await f.channel.handle({command:'renew',idempotencyKey:'synthetic-worker-renew'});assert.equal(renewed.verification?.verified,true,JSON.stringify(renewed));
 assert.ok(f.trace.filter(row=>row.method==='POST').every(row=>row.body.requirementId===f.entry.id&&row.body.workDigest===f.assignment.workDigest&&row.body.holderId===f.assignment.holderId));
});
test('workflow-only progress preserves every accepted field and uses the original fenced writer and GET readback',async()=>{
 const f=await fixture();await f.channel.handle({command:'claim'});const workflow={state:'in_progress',purpose:'Implementation purpose',nextStep:'Verify this slice'};
 const result=await f.channel.handle({command:'progress',expectedRevision:1,workflow,idempotencyKey:'synthetic-worker-progress'});assert.equal(result.verification?.verified,true,JSON.stringify(result));
 const saved=(result.data as any).entry;assert.deepEqual(saved.fields,{...f.fields,workflow});assert.equal(saved.revision,2);
 const patch=f.trace.find(row=>row.method==='PATCH')!;assert.equal(patch.body.action,'progress');assert.deepEqual(patch.body.input.fields,{...f.fields,workflow});assert.equal(patch.body.lease.requirementId,f.entry.id);
});
test('worker callers cannot choose a target, owner operation, lease, body, priority, dates or planned state',async()=>{
 const f=await fixture();
 for(const command of [{command:'read',id:randomUUID()},{command:'execute',operationId:'updateRequirement'},{command:'claim',requirementId:randomUUID()},{command:'renew',lease:{},idempotencyKey:'synthetic-wrong-renew'},{command:'progress',expectedRevision:1,workflow:{state:'planned',purpose:'',nextStep:''},idempotencyKey:'synthetic-wrong-state'},{command:'progress',expectedRevision:1,workflow:{state:'done',purpose:'',nextStep:''},fields:{body:'replace accepted work'},idempotencyKey:'synthetic-wrong-body'}])await assert.rejects(f.channel.handle(command));
 assert.equal(f.trace.length,0,'invalid caller input reaches no discovery or business API');
});
test('peer, source, generation, lease and grant changes stop before any progress write',async()=>{
 for(const failure of ['peer','source','digest','lease','grant','revision']){
  const f=await fixture();await f.channel.handle({command:'claim'});f.trace.length=0;
  const row=f.events.rows.get(f.entry.id)!;
  if(failure==='peer')f.denyPeer();if(failure==='source')row.sourceId=randomUUID();if(failure==='digest')row.workDigest='b'.repeat(64);if(failure==='lease')row.fence++;if(failure==='grant')f.revoke();
  await assert.rejects(f.channel.handle({command:'progress',expectedRevision:failure==='revision'?2:1,workflow:{state:'in_progress',purpose:'',nextStep:''},idempotencyKey:'synthetic-blocked-progress'}));
  assert.ok(f.trace.every(row=>row.method==='GET'),failure);
 }
});
test('unknown progress blocks new worker commands and settles only the original client recovery request',async()=>{
 const f=await fixture();await f.channel.handle({command:'claim'});f.loseNextProgress();
 const unknown=await f.channel.handle({command:'progress',expectedRevision:1,workflow:{state:'in_progress',purpose:'',nextStep:'Only original command'},idempotencyKey:'synthetic-unknown-worker'});assert.equal(unknown.outcome,'unknown');assert.ok((await f.journal.read())?.requestId);
 f.trace.length=0;await assert.rejects(f.channel.handle({command:'renew',idempotencyKey:'synthetic-new-command'}));assert.equal(f.trace.length,0);
 const recovered=await f.channel.settlePending();assert.equal(recovered.verification?.verified,true,JSON.stringify(recovered));assert.equal(f.repo.historyRows.length,2);assert.equal(await f.journal.read(),null);
});
test('official SDK exposes exactly four assigned tools and no owner operation or operator recovery',async()=>{
 const f=await fixture(),server=createAssignedWorkerMcpServer(f.channel),client=new Client({name:'synthetic-worker',version:'1'});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
 try{
  const {tools}=await client.listTools();assert.deepEqual(tools.map(t=>t.name),['read_assigned','claim_assigned','renew_assigned','progress_assigned']);
  const read=await client.callTool({name:'read_assigned',arguments:{}});assert.equal(read.isError,false);assert.equal((read.structuredContent as any).data.entry.id,f.entry.id);
  const claimed=await client.callTool({name:'claim_assigned',arguments:{}});assert.equal((claimed.structuredContent as any).verification.verified,true);
  const renewed=await client.callTool({name:'renew_assigned',arguments:{idempotencyKey:'synthetic-mcp-renew'}});assert.equal(renewed.isError,false);
  const progress=await client.callTool({name:'progress_assigned',arguments:{expectedRevision:1,workflow:{state:'in_progress',purpose:'Assigned only',nextStep:'Readback'},idempotencyKey:'synthetic-mcp-progress'}});assert.equal((progress.structuredContent as any).verification.verified,true);
  f.trace.length=0;
  for(const call of [{name:'lifeos_call',arguments:{operationId:'updateRequirement'}},{name:'lifeos_retry',arguments:{requestId:randomUUID()}},{name:'read_assigned',arguments:{id:randomUUID()}},{name:'progress_assigned',arguments:{expectedRevision:2,workflow:{state:'done',purpose:'',nextStep:''},priority:'P0',idempotencyKey:'synthetic-mcp-extra'}}])assert.equal((await client.callTool(call)).isError,true);
  assert.equal(f.trace.length,0);
  f.denyPeer();assert.equal((await client.callTool({name:'read_assigned',arguments:{}})).isError,true);assert.equal(f.trace.length,0);
 }finally{await client.close();await server.close();}
});
