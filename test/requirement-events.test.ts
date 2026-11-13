import assert from 'node:assert/strict';
import test from 'node:test';
import {RequirementEventService} from '../src/requirement-events/service.ts';
import type {EventActor,EventStore,EventTransaction,Work,WorkEvent} from '../src/requirement-events/contracts.ts';
import {RequirementsService} from '../src/requirements-candidate/service.ts';
import {requirements} from '../src/platform/requirements.ts';
import {MemoryPort} from './helpers/platform.ts';

const actor={kind:'agent-grant',ownerId:'synthetic-owner',spaceId:'synthetic-space',grantId:'synthetic-grant',scopes:['requirements:read','requirements:write']} as unknown as EventActor;
const fields={title:'Synthetic owner ticket',body:'Implement the requested behavior',phaseId:requirements().roadmap!.phases[0].id,priority:'P2',plannedStartOn:null,plannedEndOn:null,workflow:{state:'planned',purpose:'Owner requested',nextStep:'Implement'}} as const;
const id='11111111-1111-4111-8111-111111111111',sourceId='22222222-2222-4222-8222-222222222222';
// Storage/transaction fake only; all admission, expiry, replay and fencing decisions stay in the service.
class Store implements EventStore{
 rows=new Map<string,Work>();claims=new Map<string,{digest:string;lease:import('../src/requirement-events/contracts.ts').ExecutionLease}>();events:WorkEvent[]=[];now=1000;allowed=true;tail:Promise<unknown>=Promise.resolve();
 async transaction<T>(a:EventActor,_op:string,run:(tx:EventTransaction)=>Promise<T>):Promise<T>{
  const job=async()=>{assert.equal(a.ownerId,actor.ownerId);assert.equal(a.spaceId,actor.spaceId);if(!this.allowed)throw Error('ACCESS_DENIED');const rows=structuredClone(this.rows),events=structuredClone(this.events);try{return await run({claimReceipt:async key=>structuredClone(this.claims.get(key)??null),saveClaimReceipt:async(key,value)=>{this.claims.set(key,structuredClone(value));},now:async()=>this.now,get:async key=>structuredClone(this.rows.get(key)??null),put:async work=>{this.rows.set(work.requirementId,structuredClone(work));},replay:async(cursor,limit)=>({events:structuredClone(this.events.filter(x=>BigInt(x.cursor)>BigInt(cursor)).slice(0,limit)),cursor:String(this.events.length),reset:false}),ready:async limit=>structuredClone([...this.rows.values()].slice(0,limit))});}catch(e){this.rows=rows;this.events=events;throw e;}};
  const result=this.tail.then(job);this.tail=result.catch(()=>undefined);return result;
 }
}
const ticket=():Work=>({requirementId:id,sourceId,revision:1,workDigest:'a'.repeat(64),state:'ready',attempts:0,fence:0,lease:null});

test('expired running work cannot be claimed before old execution reconciliation',async()=>{
 const store=new Store(),work=ticket();store.rows.set(id,work);const service=new RequirementEventService(store);
 const [first,second]=await Promise.allSettled([service.claim(actor,{requirementId:id,workDigest:work.workDigest,holderId:'synthetic-mac',requestId:'claim-request-001'}),service.claim(actor,{requirementId:id,workDigest:work.workDigest,holderId:'other-mac',requestId:'claim-request-002'})]);
 assert.equal(first.status,'fulfilled');assert.equal(second.status,'rejected');if(first.status!=='fulfilled')throw Error('missing claim');
 const lease=first.value;assert.deepEqual(await service.claim(actor,{requirementId:id,workDigest:work.workDigest,holderId:'synthetic-mac',requestId:'claim-request-001'}),lease);
 store.now+=120001;const expired=structuredClone(store.rows.get(id)),claimsBefore=structuredClone(store.claims);
 await assert.rejects(service.claim(actor,{requirementId:id,workDigest:work.workDigest,holderId:'other-mac',requestId:'claim-request-003'}),{code:'EXECUTION_RECONCILIATION_REQUIRED'});
 assert.deepEqual(store.rows.get(id),expired,'expiry alone must not change attempt, fence, old lease or state');assert.deepEqual(store.claims,claimsBefore,'no replacement claim receipt is created');
 await assert.rejects(service.renew(actor,lease),{code:'EXECUTION_LEASE_LOST'});
 assert.deepEqual(await service.claim(actor,{requirementId:id,workDigest:work.workDigest,holderId:'synthetic-mac',requestId:'claim-request-001'}),lease,'lost old claim returns its historical receipt, never silently acquires a new lease');
 assert.equal((await service.inspect(actor,id))?.leaseActive,false);assert.deepEqual(store.rows.get(id),expired);
});
test('stream replay excludes expired running work while preserving its last lease',async()=>{
 const store=new Store();store.rows.set(id,ticket());const service=new RequirementEventService(store);
 const initial=await service.batch(actor,'0');assert.equal(initial.ready.length,1);
 const lease=await service.claim(actor,{requirementId:id,workDigest:ticket().workDigest,holderId:'synthetic-mac',requestId:'claim-request-001'});
 assert.equal((await service.batch(actor,'0')).ready.length,0);store.now+=120001;assert.equal((await service.batch(actor,'0')).ready.length,0);
 assert.deepEqual(store.rows.get(id)?.lease,lease);assert.equal(store.rows.get(id)?.state,'running');
 store.allowed=false;await assert.rejects(service.batch(actor,'0'));await assert.rejects(service.renew(actor,lease));
});
test('already-ready work retains prior attempt and fencing budget on its final permitted claim',async()=>{
 const store=new Store(),work={...ticket(),attempts:2,fence:7};store.rows.set(id,work);const service=new RequirementEventService(store);
 const lease=await service.claim(actor,{requirementId:id,workDigest:work.workDigest,holderId:'synthetic-mac',requestId:'claim-request-final'});
 assert.equal(lease.fence,8);assert.equal(store.rows.get(id)?.attempts,3);await service.renew(actor,lease);
 store.now+=120001;await assert.rejects(service.claim(actor,{requirementId:id,workDigest:work.workDigest,holderId:'other-mac',requestId:'claim-request-over-budget'}),{code:'EXECUTION_ATTEMPTS_EXHAUSTED'});
 assert.equal(store.rows.get(id)?.attempts,3);assert.equal(store.rows.get(id)?.fence,8);
});
test('fenced progress uses the original requirement writer and permits historical receipt recovery after lease expiry',async()=>{
 const repo=new MemoryPort(),transaction=repo.transaction.bind(repo);let live=true,checks=0;
 repo.transaction=(owner,key,run)=>transaction(owner,key,tx=>run({...tx,lockRecordIdentity:async()=>{},assertRequirementExecutionLease:async()=>{checks++;if(!live)throw Object.assign(Error('expired'),{code:'EXECUTION_LEASE_LOST'});}}));
 const config={ownerId:actor.ownerId,ownerEmail:'fixture@example.invalid',spaceId:actor.spaceId,databaseName:'fixture',baseURL:'https://fixture.invalid',approval:'personal-manual-v1',allowedTypes:['todo','journal'],requirementsEnabled:true} as const;
 const service=new RequirementsService(repo,config),created=await service.mutate(actor.ownerId,null,{spaceId:actor.spaceId,confirmed:true,fields},'create-synthetic-requirement');
 const lease={id,holderId:'synthetic-mac',grantId:actor.grantId,fence:1,workDigest:'a'.repeat(64)};
 const body={spaceId:actor.spaceId,confirmed:true,fields:{...fields,workflow:{...fields.workflow,state:'in_progress'}},expectedRevision:1,baselineBinding:null};
 const guard=async()=>{if(!storeAllowed)throw Error('grant revoked');};let storeAllowed=true;
 const originalTransaction=repo.transaction.bind(repo);let loseProgress=true;repo.transaction=async(owner,key,run)=>{const result=await originalTransaction(owner,key,run);if(key==='progress-original-key-001'&&loseProgress){loseProgress=false;throw Error('synthetic response lost after commit');}return result;};
 await assert.rejects(service.mutate(actor.ownerId,created.entry.id,body,'progress-original-key-001',guard,async()=>{},lease));
 assert.equal((await service.get(actor.ownerId,created.entry.id)).revision,2);assert.equal(checks,1);live=false;
 const replay=await service.mutate(actor.ownerId,created.entry.id,body,'progress-original-key-001',guard,async()=>{},lease);assert.equal(replay.duplicate,true);assert.equal(checks,1);
 await assert.rejects(service.mutate(actor.ownerId,created.entry.id,{...body,expectedRevision:2},'progress-new-key-002',guard,async()=>{},lease),{code:'EXECUTION_LEASE_LOST'});
 assert.equal((await service.get(actor.ownerId,created.entry.id)).revision,2);
 storeAllowed=false;await assert.rejects(service.mutate(actor.ownerId,created.entry.id,body,'progress-original-key-001',guard,async()=>{},lease));
});
