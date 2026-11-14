import test from 'node:test';
import assert from 'node:assert/strict';
import {agentOperations} from '../src/agent-api/capabilities.ts';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {AuthorityService} from '../src/agent-authority/service.ts';
import {ClassificationService} from '../src/personal-candidate/classification-service.ts';
import type {ClassificationTransaction} from '../src/platform/contracts.ts';
import {MemoryPort} from './helpers/platform.ts';
import {fixture} from './helpers/classification-service-fixture.ts';
import {classificationQueries} from '../src/personal-candidate/classification-postgres.ts';
const config={ownerId:'fixture-owner',spaceId:'fixture-space',ownerEmail:'fixture@example.test',databaseName:'fixture',baseURL:'https://lifeos.nirvanachow.com',approval:'personal-manual-v1',allowedTypes:['todo','journal','project','domain','topic'],financeEnabled:true,requirementsEnabled:true,requirementSupportEnabled:true} as const;
const fence={tokenId:'d'.repeat(64),bindingId:'fixture-binding',bindingRevision:1,expiresAt:2000000000,policy:'all-personal-business-v1'} as const;
const revision='classification-oauth-v1:'+'b'.repeat(64);
const operations=agentOperations.filter(op=>'policyClass'in op&&op.policyClass==='personal-business-data');
const grant={grantId:'fixture-grant',ownerId:config.ownerId,spaceId:config.spaceId,scopes:[...new Set(operations.flatMap(op=>op.requiredScopes))],allowedOperationIds:operations.map(op=>op.id),businessDataPolicy:'all-personal-business-v1' as const,authorizationRevision:revision,oauthFence:fence};
test('same-client producer port binds the exact current SQL state and refuses tuple/version/scope substitution',async()=>{
 const good={...grant,scopes:['personal-business:all'],producerAuthorizationRevision:revision};
 for(const [value,expected]of [[good,revision],[null,null],[{...good,grantId:'other-grant'},null],[{...good,ownerId:'other-owner'},null],[{...good,oauthFence:{...fence,bindingRevision:2}},null],[{...good,producerAuthorizationRevision:'a'.repeat(64)},null],[{...good,scopes:['personal-business:all','todo:read']},null]] as const){
  const calls:string[]=[],client={query:async(sql:string)=>{calls.push(sql);return{rows:[{value}],rowCount:1};},release(){throw Error('Caller owns the original transaction');}};
  const port=classificationQueries(client,config.ownerId,config.spaceId,'producer-port-command');assert.equal(await port.classificationOAuthProducerRevision!(grant.grantId,fence),expected);assert.equal(calls.length,1);assert.match(calls[0],/lifeos_agent\.read_policy_oauth_business_token\(/);
 }
});
/** Fail-fast lock ports reproduce the second-connection wait, not PostgreSQL. */
test('OAuth classification preview reads producer revision on its held original client without external ledger self-wait',async()=>{
 const f=await fixture();let held=false,sameClientReads=0,externalWhileHeld=0;const links=new Map<string,unknown>();
 const authority=new AuthorityService({...config,verifyOwner:async()=>null,verifyAgent:async()=>grant,readCurrentAgent:async()=>{if(held){externalWhileHeld++;throw Error('WOULD_WAIT_ON_OWN_OAUTH_LOCK');}return grant;}});
 const native=f.port.classificationTransaction.bind(f.port);
 f.port.classificationTransaction=(owner,space,key,run)=>native(owner,space,key,async tx=>{try{return await run({...tx,lockAgentGrant:async()=>{held=true;return true;},classificationOAuthProducerRevision:async()=>{sameClientReads++;return revision;},classificationOAuthProducer:async(id:string)=>links.get(id)??null,saveClassificationOAuthProducer:async(value:unknown)=>{links.set((value as {planId:string}).planId,value);}} as ClassificationTransaction);}finally{held=false;}});
 const service=new ClassificationService(f.port,config,{authority,assertReady:async()=>{},assertWritable:async()=>{},policyRevision:()=> 'policy-v1',now:()=>Date.parse('2026-11-05T00:00:00.000Z')});
 const actor=(await authority.resolveAgentActor('synthetic'))!,p=await service.preview(actor,{changes:f.changes});
 assert.ok(p.planId);assert.equal(externalWhileHeld,0);assert.ok(sameClientReads>0);assert.equal(links.size,1);
});
for(const [name,path,fields]of [
 ['journal','/v1/records/journal',{title:'Synthetic',text:'Only test text',occurredOn:null,personal:null}],
 ['finance','/v1/records/finance',{kind:'expense',amountMinor:1234,currency:'CNY',occurredOn:'2030-11-05',category:'Synthetic',fromAccountRef:'cash',toAccountRef:null,originalEntryId:null,notes:'Synthetic'}],
 ['feedback','/v1/feedback',{text:'Synthetic',sourceLabel:'Test only'}],
 ['storage','/v1/storage-reviews',{checklist:{schema:1,revision:'synthetic-v1',context:{summary:'Test only'},items:[{id:'S-1',title:'Synthetic',body:'No actual path',question:'Keep?',group:'Test',kind:'file',status:'pending'}]}}],
] as const)test('OAuth '+name+' native mutation keeps current SQL fences without a second locked ledger connection',async()=>{
 const repository=new MemoryPort(),native=repository.transaction.bind(repository);let held=false,externalWhileHeld=0,fences=0;
 repository.readCurrentSnapshot=async()=>structuredClone([...repository.rows.values()]);
 repository.transaction=(owner,key,run)=>native(owner,key,async tx=>{try{return await run({...tx,lockRecordIdentity:async()=>{},lockAgentGrant:async()=>{held=true;fences++;return true;}});}finally{held=false;}});
 const handler=createAgentHandler({enabled:true,mountPath:'/api/platform/agent',fenceWrites:true,modules:{organization:false,classification:false,businessDataPolicy:true,personalRecords:true,storageReview:true},config,repository,verify:async()=>grant,readCurrentGrant:async()=>{if(held){externalWhileHeld++;throw Error('WOULD_WAIT_ON_OWN_OAUTH_LOCK');}return grant;},operationAvailable:()=>true,assertWritable:async()=>{}});
 const response=await handler(new Request(config.baseURL+'/api/platform/agent'+path,{method:'POST',headers:{host:'lifeos.nirvanachow.com',authorization:'Bearer synthetic.oauth.token','content-type':'application/json','idempotency-key':'same-client-'+name},body:JSON.stringify({fields})}));
 assert.equal(response.status,201,JSON.stringify(await response.json()));assert.equal(externalWhileHeld,0);assert.ok(fences>=2);assert.equal(repository.rows.size,1);
});
for(const module of ['journal','storage'] as const)for(const expiresAt of ['receipt','write','saveReceipt'] as const)test(module+' OAuth expiry at '+expiresAt+' rolls back the original transaction without an external ledger read',async()=>{
 const repository=new MemoryPort(),native=repository.transaction.bind(repository);let held=false,valid=true,externalWhileHeld=0;
 repository.transaction=(owner,key,run)=>native(owner,key,async tx=>{try{return await run({...tx,lockRecordIdentity:async()=>{},lockAgentGrant:async()=>{held=true;return valid;},
  receipt:async()=>{const value=await tx.receipt();if(expiresAt==='receipt')valid=false;return value;},
  write:async(...args)=>{await tx.write(...args);if(expiresAt==='write')valid=false;},
  saveReceipt:async value=>{await tx.saveReceipt(value);if(expiresAt==='saveReceipt')valid=false;},
 });}finally{held=false;}});
 const handler=createAgentHandler({enabled:true,mountPath:'/api/platform/agent',fenceWrites:true,modules:{organization:false,classification:false,businessDataPolicy:true,personalRecords:true,storageReview:true},config,repository,verify:async()=>grant,readCurrentGrant:async()=>{if(held){externalWhileHeld++;throw Error('SECOND_LEDGER_CONNECTION');}return grant;},operationAvailable:()=>true,assertWritable:async()=>{}});
 const path=module==='journal'?'/v1/records/journal':'/v1/storage-reviews',fields=module==='journal'?{title:'Synthetic',text:'Only test text',occurredOn:null,personal:null}:{checklist:{schema:1,revision:'synthetic-v1',context:{summary:'Test only'},items:[{id:'S-1',title:'Synthetic',body:'No actual path',question:'Keep?',group:'Test',kind:'file',status:'pending'}]}};
 const response=await handler(new Request(config.baseURL+'/api/platform/agent'+path,{method:'POST',headers:{host:'lifeos.nirvanachow.com',authorization:'Bearer synthetic.oauth.token','content-type':'application/json','idempotency-key':'expire-'+module+'-'+expiresAt},body:JSON.stringify({fields})}));
 assert.equal(response.status,403);assert.equal(externalWhileHeld,0);assert.equal(repository.rows.size,0);assert.equal(repository.historyRows.length,0);assert.equal(repository.receipts.size,0);
});
