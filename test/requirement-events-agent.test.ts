import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {agentOperations} from '../src/agent-api/capabilities.ts';
import {LifeOSApiClient} from '../src/mcp-candidate/client.ts';
import {RequirementEventService} from '../src/requirement-events/service.ts';
import {MemoryRequirementEvents} from './helpers/requirement-events-memory.ts';
import {MemoryPort} from './helpers/platform.ts';
import {requirements} from '../src/platform/requirements.ts';
const origin='https://lifeos.nirvanachow.com',owner='synthetic-event-owner',space='synthetic-event-space';
function fixture(){
 const repo=new MemoryPort(),events=new MemoryRequirementEvents(),service=new RequirementEventService(events);let revoked=false,ready=true,write=true;
 const transaction=repo.transaction.bind(repo);repo.readCurrentSnapshot=async()=>structuredClone([...repo.rows.values()]);
 repo.transaction=(id,key,run)=>transaction(id,key,tx=>run({...tx,lockRecordIdentity:async()=>{},lockAgentGrant:async()=>!revoked&&write,assertRequirementExecutionLease:async b=>{const row=events.rows.get(b.requirementId);if(!row?.lease||row.lease.id!==b.id||row.fence!==b.fence||row.lease.expiresAt<=events.now)throw Object.assign(Error('expired'),{status:409,code:'EXECUTION_LEASE_LOST'});},write:async(entry,raw,create)=>{await tx.write(entry,raw,create);const work=events.rows.get(entry.id);if(work)work.revision=entry.revision;}}));
 const grant=()=>revoked?null:{ownerId:owner,spaceId:space,grantId:'synthetic-event-grant',scopes:write?['requirements:read','requirements:write'] as const:['requirements:read'] as const};
 const config={ownerId:owner,spaceId:space,ownerEmail:'fixture@example.invalid',baseURL:origin,databaseName:'fixture',approval:'personal-manual-v1',allowedTypes:['todo','journal'],requirementsEnabled:true} as const;
 const handler=createAgentHandler({enabled:true,mountPath:'/api/platform/agent',fenceWrites:true,modules:{organization:false,classification:false,requirements:true,requirementEvents:true},repository:repo,config,verify:async()=>grant(),readCurrentGrant:async()=>grant(),operationAvailable:()=>ready,assertWritable:async()=>{},requirementEvents:{service,ready:async()=>ready,openNotifications:async()=>({wait:async()=>{throw Error('synthetic-end');},close:async()=>{}})}});
 const fetcher:typeof fetch=async(input,init)=>{const r=new Request(input,init);r.headers.set('host','lifeos.nirvanachow.com');return handler(r);};
 const client=new LifeOSApiClient({origin,credentialProvider:async()=> 'synthetic-event-token'},fetcher);
 return{repo,events,client,handler,fetcher,set:(value:{revoked?:boolean;ready?:boolean;write?:boolean})=>{revoked=value.revoked??revoked;ready=value.ready??ready;write=value.write??write;}};
}
const fields={title:'Synthetic execution ticket',body:'Synthetic only',phaseId:requirements().roadmap!.phases[0].id,priority:'P2',plannedStartOn:null,plannedEndOn:null,workflow:{state:'planned',purpose:'Synthetic',nextStep:'Implement'}} as const;
test('Agent discovery separates the scoped SSE transport from executable JSON/MCP operations',async()=>{
 const f=fixture(),r=await f.fetcher(origin+'/api/platform/agent/v2/capabilities',{headers:{authorization:'Bearer synthetic-event-token'}}),catalog=await r.json();
 assert.equal(catalog.eventTransports[0].id,'streamRequirementEvents');assert.equal(catalog.eventTransports[0].transport,'sse');assert.equal(catalog.operations.some((x:any)=>x.id==='streamRequirementEvents'),false);
 assert.ok(catalog.operations.some((x:any)=>x.id==='claimRequirementExecution'));assert.ok((await f.client.discover()).operations.some(x=>x.id==='updateRequirementExecution'));
 assert.equal((await f.client.execute('streamRequirementEvents',{})).ok,false);
 f.set({write:false});const readOnly=await(await f.fetcher(origin+'/api/platform/agent/v2/capabilities',{headers:{authorization:'Bearer synthetic-event-token'}})).json();assert.equal(readOnly.eventTransports.length,1);assert.equal(readOnly.operations.some((x:any)=>x.id==='claimRequirementExecution'),false);
 f.set({ready:false});const closed=await(await f.fetcher(origin+'/api/platform/agent/v2/capabilities',{headers:{authorization:'Bearer synthetic-event-token'}})).json();assert.equal(closed.eventTransports.length,0);
});
test('claim renew and fenced progress have durable original-key receipts and independent current requirement GET',async()=>{
 const f=fixture(),created=await f.client.execute('createRequirement',{fields,idempotencyKey:'synthetic-event-create'});assert.equal(created.ok,true);const entry=(created.data as any).entry;
 f.events.rows.set(entry.id,{requirementId:entry.id,sourceId:entry.sourceId,revision:1,workDigest:'a'.repeat(64),state:'ready',attempts:0,fence:0,lease:null});
 const args={requirementId:entry.id,workDigest:'a'.repeat(64),holderId:'synthetic-mac',idempotencyKey:'synthetic-event-claim'};
 const claim=await f.client.execute('claimRequirementExecution',args);assert.equal(claim.verification?.verified,true,JSON.stringify(claim));const lease=(claim.data as any).lease;
 const renewed=await f.client.execute('updateRequirementExecution',{id:lease.id,action:'renew',lease,idempotencyKey:'synthetic-event-renew'});assert.equal(renewed.verification?.verified,true,JSON.stringify(renewed));
 const progress={id:lease.id,action:'progress',lease,input:{fields:{...fields,workflow:{...fields.workflow,state:'in_progress',nextStep:'Synthetic progress'}},expectedRevision:1,baselineBinding:null},idempotencyKey:'synthetic-event-progress'};
 const saved=await f.client.execute('updateRequirementExecution',progress);assert.equal(saved.verification?.verified,true,JSON.stringify(saved));assert.equal((saved.data as any).entry.revision,2);
 assert.equal((await f.client.execute('getRequirement',{id:entry.id})).data?.execution!==undefined,true);
});

test('lost fenced progress replays its exact original receipt after lease expiry without a second write',async()=>{
 const f=fixture(),created=await f.client.execute('createRequirement',{fields,idempotencyKey:'synthetic-unknown-create'}),entry=(created.data as any).entry;
 f.events.rows.set(entry.id,{requirementId:entry.id,sourceId:entry.sourceId,revision:1,workDigest:'b'.repeat(64),state:'ready',attempts:0,fence:0,lease:null});
 const claimed=await f.client.execute('claimRequirementExecution',{requirementId:entry.id,workDigest:'b'.repeat(64),holderId:'synthetic-mac',idempotencyKey:'synthetic-unknown-claim'}),lease=(claimed.data as any).lease;let lose=true;
 const client=new LifeOSApiClient({origin,credentialProvider:async()=> 'synthetic-event-token'},async(input,init)=>{const response=await f.fetcher(input,init);if(init?.method==='PATCH'&&lose){lose=false;throw Error('synthetic lost committed progress');}return response;});
 const args={id:lease.id,action:'progress',lease,input:{fields:{...fields,workflow:{...fields.workflow,state:'in_progress',nextStep:'Only original write'}},expectedRevision:1,baselineBinding:null},idempotencyKey:'synthetic-unknown-progress'};
 const first=await client.execute('updateRequirementExecution',args);assert.equal(first.outcome,'unknown');assert.ok(first.recovery?.requestId);f.events.now+=120001;
 const recovered=await client.retry(first.recovery.requestId);assert.equal(recovered.ok,true,JSON.stringify(recovered));assert.equal(recovered.verification?.verified,true);assert.equal((recovered.data as any).duplicate,true);assert.equal(f.repo.historyRows.length,2);
 f.set({revoked:true});assert.equal((await client.execute('getRequirement',{id:entry.id})).ok,false);
});
test('MCP receives only JSON execution operations and validates the same lease readback',async()=>{
 const {HttpBusinessClient}=await import('../src/mcp-http/business-client.ts');const f=fixture(),created=await f.client.execute('createRequirement',{fields,idempotencyKey:'synthetic-mcp-event-create'}),entry=(created.data as any).entry;
 f.events.rows.set(entry.id,{requirementId:entry.id,sourceId:entry.sourceId,revision:1,workDigest:'c'.repeat(64),state:'ready',attempts:0,fence:0,lease:null});
 const client=new HttpBusinessClient(origin,'synthetic-event-token',f.handler,new AbortController().signal);assert.equal((await client.discover()).operations.some(x=>x.id==='streamRequirementEvents'),false);
 const result=await client.execute('claimRequirementExecution',{requirementId:entry.id,workDigest:'c'.repeat(64),holderId:'synthetic-mac',idempotencyKey:'synthetic-mcp-event-claim'});assert.equal(result.verification?.verified,true,JSON.stringify(result));
 const lease=(result.data as any).lease;const progress=await client.execute('updateRequirementExecution',{id:lease.id,action:'progress',lease,input:{fields:{...fields,workflow:{...fields.workflow,state:'in_progress'}},expectedRevision:1,baselineBinding:null},idempotencyKey:'synthetic-mcp-event-progress'});assert.equal(progress.verification?.verified,true,JSON.stringify(progress));
});

test('OPT-IN reviewed fixed legacy client ignores event transport metadata and retains requirement CRUD',{
 skip:process.env.RUN_AGENT_LEGACY_EVENT_CONTRACT_TESTS!=='1'&&'Reviewed fixed client source not selected',
},async()=>{
 const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto'),{pathToFileURL}=await import('node:url');
 const path=process.env.LIFEOS_REVIEWED_LEGACY_CLIENT;assert.ok(path);assert.ok(path.startsWith('/')&&path.endsWith('/src/mcp-candidate/client.ts'));
 assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),'28939f3719f59a5fe57f3d936cbc5cab6e35b6a9e20eedde63b9a07017fdf474');
 const {LifeOSApiClient:Legacy}=await import(pathToFileURL(path).href),f=fixture();
 const legacy=new Legacy({origin,credentialProvider:async()=> 'synthetic-event-token'},f.fetcher),catalog=await legacy.discover();assert.ok(catalog.operations.some((x:any)=>x.id==='getRequirement'));assert.equal(catalog.operations.some((x:any)=>x.id==='claimRequirementExecution'),false);
 const result=await legacy.execute('createRequirement',{fields,idempotencyKey:'synthetic-legacy-event-create'});assert.equal(result.verification?.verified,true,JSON.stringify(result));
 assert.equal((await legacy.execute('getRequirement',{id:result.data.entry.id})).ok,true);assert.equal((await legacy.execute('streamRequirementEvents',{})).ok,false);
});

test('a restarted durable client recovers an expired historical claim without acquiring a new lease',async()=>{
 const {DurableStore}=await import('../src/mcp-candidate/native-store.mjs'),{mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');const directory=await mkdtemp(join(tmpdir(),'lifeos-event-receipt-'));
 try{
  const f=fixture(),created=await f.client.execute('createRequirement',{fields,idempotencyKey:'synthetic-durable-event-create'}),entry=(created.data as any).entry;
  f.events.rows.set(entry.id,{requirementId:entry.id,sourceId:entry.sourceId,revision:1,workDigest:'d'.repeat(64),state:'ready',attempts:0,fence:0,lease:null});let lost=true,posts=0;
  const transport:typeof fetch=async(input,init)=>{const response=await f.fetcher(input,init);if(init?.method==='POST'&&String(input).endsWith('/claims')){posts++;if(lost){lost=false;throw Error('synthetic lost claim');}}return response;};
  const client=()=>new LifeOSApiClient({origin,credentialProvider:async()=> 'synthetic-event-token',durable:new DurableStore(directory,'e'.repeat(64))},transport);
  const args={requirementId:entry.id,workDigest:'d'.repeat(64),holderId:'synthetic-original-mac',idempotencyKey:'synthetic-durable-event-claim'};
  const unknown=await client().execute('claimRequirementExecution',args);assert.equal(unknown.outcome,'unknown');assert.ok(unknown.recovery?.requestId);args.holderId='synthetic-mutated-mac';f.events.now+=120001;
  const recovered=await client().retry(unknown.recovery.requestId);assert.equal(recovered.ok,true,JSON.stringify(recovered));assert.equal((recovered.data as any).lease.holderId,'synthetic-original-mac');assert.equal(recovered.verification?.verified,false);assert.equal(recovered.verification?.state,'LEASE_NOT_ACTIVE');assert.equal(f.events.rows.get(entry.id)?.attempts,1);
  const again=await client().retry(unknown.recovery.requestId);assert.equal(again.ok,true);assert.equal(posts,2,'confirmed historical receipt recovery after restart uses GET only');
 }finally{await rm(directory,{recursive:true,force:true});}
});
