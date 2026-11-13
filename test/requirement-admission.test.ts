import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {RequirementsService,requirementBinding,requirementIdentity} from '../src/requirements-candidate/service.ts';
import {LifeOSApiClient} from '../src/mcp-candidate/client.ts';
import {RequirementEventService} from '../src/requirement-events/service.ts';
import {MemoryPort} from './helpers/platform.ts';
import {MemoryRequirementEvents} from './helpers/requirement-events-memory.ts';
import {requirements} from '../src/platform/requirements.ts';
const owner='synthetic-admission-owner',space='synthetic-admission-space',origin='https://lifeos.nirvanachow.com',hash='a'.repeat(64);
const fields={title:'Synthetic existing owner ticket',body:'Existing ordinary work',phaseId:requirements().roadmap!.phases[0].id,priority:'P2',plannedStartOn:null,plannedEndOn:null,workflow:{state:'planned',purpose:'Explicit owner request',nextStep:'Implement'}} as const;
async function fixture(workflow:unknown=fields.workflow,options:{publicOverlay?:boolean;conflict?:boolean}={}){
 const repo=new MemoryPort(),events=new MemoryRequirementEvents();let revoked=false,failReceipt=false,revokeAfterCommit=false,inTransaction=false,rejectNestedReadiness=false,nestedReadiness=0;const commands=new Map<string,{digest:string;response:unknown}>(),outbox:unknown[]=[];
 const eventTransaction=events.transaction.bind(events);events.transaction=(actor,id,run)=>eventTransaction(actor,id,tx=>run({...tx,claimReceipt:async key=>{const receipt=commands.get(key);return receipt?{digest:receipt.digest,lease:receipt.response as never}:null;},saveClaimReceipt:async(key,receipt)=>{commands.set(key,{digest:receipt.digest,response:receipt.lease});}}));
 const transaction=repo.transaction.bind(repo);repo.readCurrentSnapshot=async()=>structuredClone([...repo.rows.values()]);
 repo.transaction=async(id,key,run)=>{const result=await transaction(id,key,async tx=>{
  inTransaction=true;
  const beforeRows=structuredClone(events.rows),beforeCommands=structuredClone(commands),beforeOutbox=structuredClone(outbox);
  try{return await run({...tx,lockRecordIdentity:async()=>{},lockAgentGrant:async()=>!revoked,
   assertRequirementExecutionLease:async b=>{assert.equal(events.rows.get(b.requirementId)?.lease?.id,b.id);},
   readRequirementExecutionCommand:async b=>structuredClone(commands.get(b.key)??null),
   projectRequirementExecution:async b=>structuredClone(events.rows.get(b.requirementId)??{requirementId:b.requirementId,sourceId:b.sourceId,revision:b.revision,workDigest:hash,state:'candidate',attempts:0,fence:0,lease:null}),
   admitRequirementExecution:async b=>{const {admissionTransition}=await import('../src/requirement-events/admission.ts');const changed=admissionTransition(events.rows.get(b.projection.requirementId)??null,b.projection);events.rows.set(changed.work.requirementId,structuredClone(changed.work));if(changed.changed)outbox.push(changed.work);if(failReceipt)throw Error('synthetic receipt failure');const result={admission:changed.work,duplicate:false};commands.set(b.key,{digest:b.digest,response:{kind:'admission-v1',result:structuredClone(result)}});return result;}
  });}catch(error){events.rows=beforeRows;commands.clear();for(const pair of beforeCommands)commands.set(...pair);outbox.splice(0,outbox.length,...beforeOutbox);throw error;}finally{inTransaction=false;}
 });if(revokeAfterCommit&&!key.startsWith('event-projection:'))revoked=true;return result;};
 const config={ownerId:owner,spaceId:space,ownerEmail:'fixture@example.invalid',baseURL:origin,databaseName:'fixture',approval:'personal-manual-v1',allowedTypes:['todo','journal'],requirementsEnabled:true} as const;
 const baseline=structuredClone(requirements());if(options.conflict)baseline.baselineVersion='synthetic-prior-baseline';const publicId=baseline.requirements[0].id;
 const requirementsService=new RequirementsService(repo,config,()=>baseline),entry=(await requirementsService.mutate(owner,options.publicOverlay?publicId:null,{spaceId:space,confirmed:true,fields:{...fields,workflow},...(options.publicOverlay?{expectedRevision:0,baselineBinding:requirementBinding(baseline,publicId)}:{})},'synthetic-existing-create')).entry;
 const grant=()=>revoked?null:{ownerId:owner,spaceId:space,grantId:'synthetic-admission-grant',scopes:['requirements:read','requirements:write'] as const};
 const assertNoNestedReadiness=()=>{if(inTransaction&&rejectNestedReadiness){nestedReadiness++;throw Error('synthetic bounded business pool has no nested connection');}};
 const handler=createAgentHandler({enabled:true,mountPath:'/api/platform/agent',fenceWrites:true,config,repository:repo,modules:{organization:false,classification:false,requirements:true,requirementEvents:true},verify:async()=>grant(),readCurrentGrant:async()=>{assertNoNestedReadiness();return grant();},operationAvailable:()=>true,assertWritable:async()=>{},requirementEvents:{service:new RequirementEventService(events),ready:async()=>{assertNoNestedReadiness();return true;},openNotifications:async()=>({wait:async()=>{throw Error('synthetic-end');},close:async()=>{}})}});
 const send=(path:string,method='GET',body?:unknown,key='synthetic-admission-command')=>handler(new Request(origin+'/api/platform/agent'+path,{method,headers:{host:'lifeos.nirvanachow.com',authorization:'Bearer synthetic-admission-token','idempotency-key':key,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));
 const command={action:'admit',requirementId:entry.id,sourceId:entry.sourceId,expectedRevision:entry.revision,workDigest:hash};
 const fetcher:typeof fetch=async(input,init)=>{const request=new Request(input,init);request.headers.set('host','lifeos.nirvanachow.com');return handler(request);};
 return{repo,events,commands,outbox,entry,send,command,requirementsService,fetcher,client:new LifeOSApiClient({origin,credentialProvider:async()=> 'synthetic-admission-token'},fetcher),revoke:()=>{revoked=true;},revokeAfterCommit:()=>{revokeAfterCommit=true;},failReceipt:()=>{failReceipt=true;},forbidNestedReadiness:()=>{rejectNestedReadiness=true;},nestedReadiness:()=>nestedReadiness};
}
test('reading a persisted ordinary legacy ticket provides a digest without admitting it; explicit action queues once',async()=>{
 const f=await fixture(),before=await(await f.send('/v1/requirements/'+f.entry.id)).json();assert.equal(before.execution.admissionEligible,true);assert.equal(f.events.rows.size,0);assert.equal(f.outbox.length,0);
 const response=await f.send('/v1/requirement-events/claims','POST',f.command);assert.equal(response.status,200);const result=await response.json();assert.equal(result.admission.state,'ready');assert.equal(f.outbox.length,1);
 const after=await(await f.send('/v1/requirements/'+f.entry.id)).json();assert.equal(after.entry.revision,1);assert.equal(after.entry.sourceId,f.entry.sourceId);assert.equal(after.execution.state,'ready');
 const replay=await(await f.send('/v1/requirement-events/claims','POST',f.command)).json();assert.equal(replay.duplicate,true);assert.equal(f.outbox.length,1);assert.equal(f.repo.historyRows.length,1);
});
test('post-commit authority loss stays unknown with the original command while unauthorized recovery cannot read its receipt',async()=>{
 const f=await fixture();f.revokeAfterCommit();const saved=await f.client.execute('claimRequirementExecution',{...f.command,idempotencyKey:'synthetic-post-commit-revoke'});assert.equal(saved.outcome,'unknown',JSON.stringify(saved));assert.ok(saved.recovery?.requestId);assert.equal(f.outbox.length,1);
 const refused=await f.client.retry(saved.recovery.requestId);assert.equal(refused.ok,false);assert.equal(refused.outcome,'unknown');assert.equal(f.outbox.length,1);
});
test('business HTTP MCP cannot admit work; the separately scoped API preserves its original receipt and later-state readback',async()=>{
 const {HttpBusinessClient}=await import('../src/mcp-http/business-client.ts'),f=await fixture();let dispatched=0;
 const client=new HttpBusinessClient(origin,'synthetic-admission-token',request=>{dispatched++;return f.fetcher(request);},new AbortController().signal),args={...f.command,idempotencyKey:'synthetic-mcp-admission'};
 const before=structuredClone(f.repo.rows),beforeHistory=structuredClone(f.repo.historyRows);
 assert.deepEqual(await client.execute('claimRequirementExecution',args),{ok:false,status:403,error:'OPERATION_UNAVAILABLE'});
 assert.equal(dispatched,0);assert.deepEqual(f.repo.rows,before);assert.deepEqual(f.repo.historyRows,beforeHistory);assert.equal(f.events.rows.size,0);assert.equal(f.outbox.length,0);assert.equal(f.commands.size,0);
 const result=await f.client.execute('claimRequirementExecution',args);assert.equal(result.verification?.verified,true,JSON.stringify(result));f.events.rows.get(f.entry.id)!.state='paused';
 const replay=await f.client.execute('claimRequirementExecution',args);assert.equal(replay.ok,true);assert.equal((replay.data as any).duplicate,true);assert.equal(replay.verification?.state,'ADMISSION_LATER_STATE');assert.equal(f.outbox.length,1);
});
test('fenced progress committed before authority loss retains an unknown original command',async()=>{
 const f=await fixture();await f.send('/v1/requirement-events/claims','POST',f.command);const lease=(await(await f.send('/v1/requirement-events/claims','POST',{requirementId:f.entry.id,workDigest:hash,holderId:'synthetic-progress-holder'},'synthetic-before-revoke')).json()).lease;
 f.revokeAfterCommit();const saved=await f.client.execute('updateRequirementExecution',{id:lease.id,action:'progress',lease,input:{fields:{...fields,workflow:{...fields.workflow,state:'in_progress'}},expectedRevision:1,baselineBinding:null},idempotencyKey:'synthetic-progress-post-commit-revoke'});assert.equal(saved.outcome,'unknown',JSON.stringify(saved));assert.ok(saved.recovery?.requestId);assert.equal(f.repo.historyRows.length,2);
});
test('admission GET and fenced progress do not recursively borrow a metadata connection inside their business transaction',async()=>{
 const f=await fixture();f.forbidNestedReadiness();assert.equal((await f.send('/v1/requirements/'+f.entry.id)).status,200);
 assert.equal((await f.send('/v1/requirement-events/claims','POST',f.command)).status,200);
 const claimed=await(await f.send('/v1/requirement-events/claims','POST',{requirementId:f.entry.id,workDigest:hash,holderId:'synthetic-progress-holder'},'synthetic-nested-claim')).json();assert.ok(claimed.lease);
 assert.equal((await f.send('/v1/requirement-events/claims/'+claimed.lease.id,'PATCH',{action:'progress',lease:claimed.lease,input:{fields:{...fields,workflow:{...fields.workflow,state:'in_progress'}},expectedRevision:1,baselineBinding:null}},'synthetic-nested-progress')).status,200);assert.equal(f.nestedReadiness(),0);
});
test('persisted public overlay uses its stable public identity; virtual and conflicted baselines never create or admit records',async()=>{
 const f=await fixture(fields.workflow,{publicOverlay:true}),storedId=requirementIdentity(owner,space,f.entry.id);assert.ok(f.entry.id.startsWith('LO-'));assert.ok(f.repo.rows.has(storedId));
 const before=structuredClone([...f.repo.rows.values()]);const admitted=await f.client.execute('claimRequirementExecution',{...f.command,idempotencyKey:'synthetic-public-admission'});assert.equal(admitted.verification?.verified,true,JSON.stringify(admitted));assert.deepEqual([...f.repo.rows.values()],before);
 const virtualId=requirements().requirements.find(item=>item.id!==f.entry.id)!.id,virtual=await(await f.send('/v1/requirements/'+virtualId)).json();assert.equal(virtual.entry.revision,0);assert.equal(virtual.execution,null);
 assert.equal((await f.send('/v1/requirement-events/claims','POST',{...f.command,requirementId:virtualId},'synthetic-no-virtual-create')).status,409);assert.equal(f.repo.rows.size,1);
 const conflict=await fixture(fields.workflow,{publicOverlay:true,conflict:true}),view=await(await conflict.send('/v1/requirements/'+conflict.entry.id)).json();assert.equal(view.entry.baselineConflict,true);assert.equal(view.execution.admissionEligible,false);
 assert.equal((await conflict.send('/v1/requirement-events/claims','POST',conflict.command)).status,409);assert.equal(conflict.events.rows.size,0);
});
test('all actions share the grant command key; ready no-op does not publish again and receipt failure rolls admission back',async()=>{
 const f=await fixture();assert.equal((await f.send('/v1/requirement-events/claims','POST',f.command)).status,200);
 assert.equal((await f.send('/v1/requirement-events/claims','POST',{requirementId:f.entry.id,workDigest:hash,holderId:'synthetic-holder'})).status,409);
 assert.equal((await f.send('/v1/requirement-events/claims','POST',f.command,'synthetic-ready-noop')).status,200);assert.equal(f.outbox.length,1);assert.equal(f.events.rows.get(f.entry.id)?.attempts,0);
 const failed=await fixture();failed.failReceipt();assert.equal((await failed.send('/v1/requirement-events/claims','POST',failed.command)).status,503);assert.equal(failed.events.rows.size,0);assert.equal(failed.outbox.length,0);assert.equal(failed.commands.size,0);assert.equal(failed.repo.historyRows.length,1);
});
test('lost admission survives a client restart with original body/key; later state is separate and settled recovery is GET only',async()=>{
 const {DurableStore}=await import('../src/mcp-candidate/native-store.mjs'),{mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),directory=await mkdtemp(join(tmpdir(),'lifeos-admission-receipt-'));
 try{
  const f=await fixture();let lost=true,posts=0;const payloads:string[]=[];
  const transport:typeof fetch=async(input,init)=>{const response=await f.fetcher(input,init);if(init?.method==='POST'&&String(input).endsWith('/claims')){posts++;payloads.push(String(init.body));if(lost){lost=false;throw Error('synthetic committed admission response lost');}}return response;};
  const client=()=>new LifeOSApiClient({origin,credentialProvider:async()=> 'synthetic-admission-token',durable:new DurableStore(directory,'e'.repeat(64))},transport),args={...f.command,idempotencyKey:'synthetic-lost-admission'};
  const unknown=await client().execute('claimRequirementExecution',args);assert.equal(unknown.outcome,'unknown');assert.ok(unknown.recovery?.requestId);args.workDigest='b'.repeat(64);
  await f.requirementsService.mutate(owner,f.entry.id,{spaceId:space,confirmed:true,fields:{...fields,workflow:{...fields.workflow,state:'in_progress',nextStep:'Later authorized progress'}},expectedRevision:1,baselineBinding:null},'synthetic-later-progress');f.events.rows.get(f.entry.id)!.revision=2;f.events.rows.get(f.entry.id)!.state='paused';
  const recovered=await client().retry(unknown.recovery.requestId);assert.equal(recovered.ok,true,JSON.stringify(recovered));assert.equal((recovered.data as any).duplicate,true);assert.equal(recovered.verification?.state,'ADMISSION_LATER_STATE');assert.equal(recovered.verification?.verified,false);assert.equal(f.outbox.length,1);assert.equal(f.events.rows.get(f.entry.id)?.state,'paused');assert.equal(payloads[0],payloads[1]);
  await client().retry(unknown.recovery.requestId);assert.equal(posts,2,'confirmed original receipt is recovered by current GET only');
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('candidate intent, paused/cancelled, terminal workflow and exhausted same-generation budgets remain unchanged',async()=>{
 for(const workflow of [null,{...fields.workflow,state:'done'},{...fields.workflow,state:'blocked'},{...fields.workflow,state:'awaiting_review'}]){const f=await fixture(workflow);assert.equal((await f.send('/v1/requirement-events/claims','POST',f.command)).status,409);assert.equal(f.events.rows.size,0);assert.equal(f.outbox.length,0);}
 for(const state of ['paused','cancelled']){const f=await fixture();f.events.rows.set(f.entry.id,{requirementId:f.entry.id,sourceId:f.entry.sourceId!,revision:1,workDigest:hash,state:state as never,attempts:2,fence:2,lease:null});assert.equal((await f.send('/v1/requirement-events/claims','POST',f.command)).status,409);assert.equal(f.events.rows.get(f.entry.id)?.state,state);}
 const f=await fixture();f.events.rows.set(f.entry.id,{requirementId:f.entry.id,sourceId:f.entry.sourceId!,revision:1,workDigest:hash,state:'candidate',attempts:2,fence:2,lease:null});
 const accepted=await(await f.send('/v1/requirement-events/claims','POST',f.command)).json();assert.equal(accepted.admission.attempts,2);assert.equal(accepted.admission.fence,2);
 const current=f.events.rows.get(f.entry.id)!;current.state='candidate';current.attempts=3;assert.equal((await f.send('/v1/requirement-events/claims','POST',f.command,'new-synthetic-admission-key')).status,409);assert.equal(current.attempts,3);
});
test('source revision and work digest CAS reject stale admission; revoked authority cannot recover a receipt',async()=>{
 const f=await fixture();for(const changes of [{expectedRevision:2},{sourceId:'22222222-2222-4222-8222-222222222222'},{workDigest:'b'.repeat(64)}])assert.equal((await f.send('/v1/requirement-events/claims','POST',{...f.command,...changes})).status,409);
 assert.equal(f.outbox.length,0);assert.equal((await f.send('/v1/requirement-events/claims','POST',f.command)).status,200);f.revoke();assert.equal((await f.send('/v1/requirement-events/claims','POST',f.command)).status,401);assert.equal(f.outbox.length,1);
});
