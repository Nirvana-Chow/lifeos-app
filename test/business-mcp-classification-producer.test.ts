import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthorityService} from '../src/agent-authority/service.ts';
import {ClassificationService} from '../src/personal-candidate/classification-service.ts';
import type {ClassificationTransaction} from '../src/platform/contracts.ts';
import type {PersonalConfig} from '../src/personal-candidate/config.ts';
import {fixture} from './helpers/classification-service-fixture.ts';
import {sameOAuthFence,type OAuthGrantFence} from '../src/business-mcp-oauth/contracts.ts';
const config={ownerId:'fixture-owner',spaceId:'fixture-space',ownerEmail:'fixture@example.invalid',databaseName:'fixture',approval:'personal-manual-v1',baseURL:'https://fixture.example.invalid',allowedTypes:['todo','project','domain','topic','journal']} as PersonalConfig;
const now=Date.parse('2026-11-05T00:00:00.000Z');
const fence:OAuthGrantFence={tokenId:'d'.repeat(64),bindingId:'fixture-binding',bindingRevision:1,expiresAt:now/1000+300,policy:'all-personal-business-v1'};
/** In-memory service counterexamples only; real SQL/ACL/locking is a separate gate. */
async function oauthFixture(metadata=true){
 const f=await fixture();let active=true,available=true,currentFence={...fence};const links=new Map<string,unknown>();
 const legacy={ownerId:config.ownerId,spaceId:config.spaceId,grantId:'fixture-grant',scopes:['todo:read','organization:read'] as const,authorizationRevision:'a'.repeat(64),businessDataPolicy:'all-personal-business-v1' as const,allowedOperationIds:['previewTodoClassification']};
 const oauth=()=>active?{...legacy,allowedOperationIds:available?legacy.allowedOperationIds:[],authorizationRevision:'classification-oauth-v1:'+'b'.repeat(64),oauthFence:{...currentFence}}:null;
 const authority=new AuthorityService({...config,verifyOwner:async()=>({ownerId:config.ownerId,spaceId:config.spaceId,sessionRef:'owner-session'}),verifyAgent:async key=>key==='oauth'?oauth():legacy,readCurrentAgent:async(_id,expected)=>expected?active&&sameOAuthFence(expected,currentFence)?oauth():null:legacy});
 f.port.grantFence=async(binding)=>!binding.oauthFence||active&&sameOAuthFence(binding.oauthFence,currentFence);
 const original=f.port.classificationTransaction.bind(f.port);
 f.port.classificationTransaction=(owner,space,key,fn)=>original(owner,space,key,async tx=>{
  const before=structuredClone(links);try{return await fn({...tx,...(metadata?{
   classificationOAuthProducer:async(id:string)=>structuredClone(links.get(id)??null),
   saveClassificationOAuthProducer:async(value:unknown)=>{const v=value as {planId:string};if(links.has(v.planId))throw Error('immutable producer');links.set(v.planId,structuredClone(v));},
  }:{})} as ClassificationTransaction);}catch(error){links.clear();for(const [k,v]of before)links.set(k,v);throw error;}
 });
 const service=new ClassificationService(f.port,config,{authority,assertReady:async()=>{},assertWritable:async()=>{},policyRevision:()=> 'policy-v1',now:()=>now});
 const agent=(await authority.resolveAgentActor('oauth'))!,owner=(await authority.resolveOwnerActor(new Headers()))!;
 return{...f,service,authority,agent,owner,links,setOAuthActive:(v:boolean)=>{active=v;},setAvailable:(v:boolean)=>{available=v;},setBindingRevision:(v:number)=>{currentFence={...currentFence,bindingRevision:v};}};
}
const body=(p:{planId:string;digest:string})=>({planId:p.planId,digest:p.digest,confirmed:true});
test('OAuth preview persists exact producer authority beside the original unchanged plan',async()=>{
 const f=await oauthFixture(),p=await f.service.preview(f.agent,{changes:f.changes});
 const plan=[...f.port.plans.values()][0];assert.equal(plan.producerAuthorizationRevision,'classification-oauth-v1:'+'b'.repeat(64));
 assert.deepEqual(Object.keys(plan).sort(),['schemaVersion','proposalRevision','ownerId','spaceId','grantId','producerAuthorizationRevision','policyRevision','referenceObservationDigest','createdAt','preview'].sort());
 const link=f.links.get(p.planId) as Record<string,unknown>;assert.ok(link);assert.equal(link.planId,p.planId);assert.equal(link.digest,p.digest);assert.equal(link.proposalRevision,1);assert.equal(link.expiresAt,p.expiresAt);assert.deepEqual(link.oauthFence,fence);
 assert.equal(p.expiresAt,new Date(fence.expiresAt*1000).toISOString());
});
test('OAuth preview fails closed when the transaction cannot bind producer metadata',async()=>{
 const f=await oauthFixture(false);await assert.rejects(f.service.preview(f.agent,{changes:f.changes}));assert.equal(f.port.plans.size,0);
});
for(const change of ['revoked','binding-replaced'] as const)test('owner approval cannot escape '+change+' OAuth producer using its still-live original API grant',async()=>{
 const f=await oauthFixture(),p=await f.service.preview(f.agent,{changes:f.changes});await f.service.approve(f.owner,body(p));
 if(change==='revoked')f.setOAuthActive(false);else f.setBindingRevision(2);
 const before=structuredClone(f.port.rows);await assert.rejects(f.service.commit(f.owner,body(p),'oauth-producer-command'));
 assert.deepEqual(f.port.rows,before);assert.equal(f.port.classificationReceipts.size,0);
});
test('owner review selection retains the exact OAuth producer and original expiry',async()=>{
 const f=await oauthFixture(),p=await f.service.preview(f.agent,{changes:f.changes});
 assert.equal((await f.service.review(f.owner,p.planId)).stale,false);
 const selected=await f.service.previewSelection(f.owner,p.planId,{selectedTodoIds:[f.todos[0].id]});
 assert.equal(selected.expiresAt,p.expiresAt);assert.equal(selected.changes.length,1);assert.notEqual(selected.planId,p.planId);
 const link=f.links.get(selected.planId) as Record<string,unknown>;assert.equal(link.digest,selected.digest);assert.deepEqual(link.oauthFence,fence);
 await f.service.approve(f.owner,body(selected));assert.equal((await f.service.commit(f.owner,body(selected),'selected-oauth-command')).entries.length,1);
});
for(const patch of [null,{planId:'00000000-0000-4000-8000-000000000088'},{digest:'e'.repeat(64)},{proposalRevision:2},{expiresAt:new Date(now+600000).toISOString()},{producerAuthorizationRevision:'classification-oauth-v1:'+'f'.repeat(64)}])test('missing or substituted OAuth plan metadata cannot authorize an owner commit: '+JSON.stringify(patch),async()=>{
 const f=await oauthFixture(),p=await f.service.preview(f.agent,{changes:f.changes});await f.service.approve(f.owner,body(p));
 if(patch===null)f.links.delete(p.planId);else f.links.set(p.planId,{...f.links.get(p.planId) as object,...patch});
 const before=structuredClone(f.port.rows);await assert.rejects(f.service.commit(f.owner,body(p),'substituted-oauth-command'));assert.deepEqual(f.port.rows,before);assert.equal(f.port.classificationReceipts.size,0);
});
test('the original API key cannot stand in for an OAuth producer with the same grant ID',async()=>{
 const f=await oauthFixture(),p=await f.service.preview(f.agent,{changes:f.changes});await f.service.approve(f.owner,body(p));
 const original=(await f.authority.resolveAgentActor('original-key'))!;
 await assert.rejects(f.service.commit(original,body(p),'wrong-producer-command'));assert.equal(f.port.classificationReceipts.size,0);
});
test('current module unavailability rejects the owner plan even when original key and OAuth tuple remain unchanged',async()=>{
 const f=await oauthFixture(),p=await f.service.preview(f.agent,{changes:f.changes});await f.service.approve(f.owner,body(p));f.setAvailable(false);
 await assert.rejects(f.service.commit(f.owner,body(p),'unavailable-preview-command'));assert.equal(f.port.classificationReceipts.size,0);
});
