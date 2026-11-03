import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,chmodSync,symlinkSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonicalDigest} from '../src/apple-sync-candidate/domain.ts';
import {SyncJournal,type BridgeBinding,type BridgeIntent,type NativeReadback} from '../src/apple-sync-candidate/journal.ts';
import type {ActiveDelivery,DeliveryClaim,DeliveryReceipt} from '../src/apple-sync-candidate/store-contracts.ts';
const binding:BridgeBinding={ownerId:'synthetic-owner',spaceId:'synthetic-space',bridgeId:'synthetic-mac',identityEpoch:'identity-1',storeEpoch:'store-1'};
const fields={title:{kind:'known',value:'合成标题'},notes:{kind:'known',value:'保留中文'}} as const;
function intent():BridgeIntent{return{mutationId:'synthetic-native-create-1',cursor:'1',kind:'reminder',operation:'create',entityId:'11111111-1111-4111-8111-111111111111',sourceId:'22222222-2222-4222-8222-222222222222',revision:1,target:null,expectedNativeHash:null,patch:fields,expectedFields:fields,scope:'single'};}
function delivery(value=intent()):ActiveDelivery{const {storeEpoch:_,...owner}=binding;return{format:'lifeos.apple-sync.delivery.v1',version:'1',attemptId:'33333333-3333-4333-8333-333333333333',binding:owner,phase:'issued',cursor:value.cursor,canonicalRevision:value.revision,intent:value,intentHash:canonicalDigest(value),preparedMapping:null,claim:null,receipt:null,retirement:null};}
function claim(value=delivery()):DeliveryClaim{return{claimId:'44444444-4444-4444-8444-444444444444',attemptId:value.attemptId,binding:value.binding,intentHash:value.intentHash,claimVersion:'2',executionFence:'1'};}
function evidence(value:BridgeIntent):NativeReadback{return{mutationId:value.mutationId,intentHash:canonicalDigest(value),identity:{storeEpoch:'store-1',sourceId:'native-account',containerId:'native-list',itemId:'native-item',externalId:null,aliases:[],seriesId:null,originalOccurrenceDate:null},fields};}
function fixture(){const directory=mkdtempSync(join(tmpdir(),'lifeos-synthetic-sync-'));let held=true;const assertWriter=()=>{if(!held)throw Error('SYNTHETIC_FENCE_LOST');};return{directory,assertWriter,loseFence:()=>{held=false;},open:()=>SyncJournal.open(directory,binding,{create:true,assertWriter}),close:()=>rmSync(directory,{recursive:true,force:true})};}
const fails=(code:string)=>(e:unknown)=>e instanceof Error&&'code'in e&&e.code===code;
function applying(j:SyncJournal){const first=j.prepare(delivery());j.markClaimRequested(first.id);j.saveClaim(first.id,claim());return j.markApplying(first.id);}
function serverReceipt(value=delivery()){const proof=evidence(value.intent),body={receiptKey:'synthetic-receipt-1',attemptId:value.attemptId,binding:value.binding,intentHash:value.intentHash,claimId:claim(value).claimId,deliveryVersion:'3',mappingId:'55555555-5555-4555-8555-555555555555',mappingVersion:1,entityId:value.intent.entityId,sourceId:value.intent.sourceId,canonicalRevision:value.canonicalRevision,proof,nativeHash:canonicalDigest(proof)};const receipt:DeliveryReceipt={...body,receiptHash:canonicalDigest(body)};return{receipt,acknowledgement:{mutationId:value.intent.mutationId,cursor:value.cursor,nativeHash:receipt.nativeHash,receiptHash:receipt.receiptHash}};}
const caps={protocolVersion:1,adapterId:'synthetic',adapterVersion:'1',platform:'synthetic',fullSnapshot:{reminder:true,event:true},writableFields:{reminder:['title','notes'],event:['title','notes']},preserveUnchanged:true,scopes:['single'],nativeEventCancellationWrite:false,invitationWrite:false} as const;

test('intent is durable before claiming and an exact restart reuses one immutable request',()=>{
 const f=fixture();try{const j=f.open(),first=j.prepare(delivery());assert.equal(first.phase,'prepared');assert.equal(first.sequence,0);assert.deepEqual(SyncJournal.open(f.directory,binding,{assertWriter:f.assertWriter}).get(first.id),first);assert.deepEqual(j.prepare(delivery()),first);assert.equal(j.list().length,1);assert.equal(readFileSync(join(f.directory,'intents',first.id+'.json'),'utf8').includes('保留中文'),true);assert.equal(first.claimRequest.body.expectedDeliveryVersion,'1');assert.equal(first.originalDelivery.attemptId,delivery().attemptId);assert.throws(()=>j.markApplying(first.id),fails('SYNC_JOURNAL_TRANSITION'));}finally{f.close();}
});
test('native readback and exact durable server receipt and ACK request are required before completion',()=>{
 const f=fixture();try{const j=f.open(),first=j.prepare(delivery());assert.throws(()=>j.acknowledge(first.id,serverReceipt().acknowledgement),fails('SYNC_JOURNAL_TRANSITION'));applying(j);const verified=j.verifyNative(first.id,evidence(intent()));assert.equal(verified.phase,'native-verified');const result=serverReceipt();assert.throws(()=>j.acknowledge(first.id,result.acknowledgement),fails('SYNC_ACK_RECEIPT_REQUIRED'));j.prepareReceipt(first.id,caps);j.saveServerReceipt(first.id,result);assert.throws(()=>j.saveServerReceipt(first.id,{...result,receipt:{...result.receipt,receiptKey:'synthetic-receipt-2'}}));assert.ok(j.get(first.id).ackRequest?.key);const done=j.acknowledge(first.id,result.acknowledgement);assert.equal(done.phase,'acknowledged');assert.deepEqual(j.acknowledge(first.id,result.acknowledgement),done);assert.equal(f.open().get(first.id).phase,'acknowledged');}finally{f.close();}
});
test('a timed-out applying intent survives restart and never becomes a fresh prepared request',()=>{
 const f=fixture();try{const j=f.open(),first=applying(j);const resumed=f.open();assert.equal(resumed.prepare(delivery()).phase,'applying');resumed.markUnknown(first.id,'native-transport');assert.equal(f.open().get(first.id).phase,'unknown');const verified=resumed.verifyNative(first.id,evidence(intent()));assert.equal(verified.phase,'native-verified');assert.throws(()=>resumed.markApplying(first.id),fails('SYNC_JOURNAL_TRANSITION'));}finally{f.close();}
});
test('wrong operation identity, native epoch, fields and acknowledgement cannot advance state',()=>{
 const f=fixture();try{const j=f.open(),value=intent(),first=applying(j);for(const bad of [{...evidence(value),mutationId:'other-operation'},{...evidence(value),identity:{...evidence(value).identity,storeEpoch:'other-store'}},{...evidence(value),fields:{...fields,notes:{kind:'known' as const,value:'foreign'}}}])assert.throws(()=>j.verifyNative(first.id,bad),fails('SYNC_NATIVE_READBACK_MISMATCH'));assert.equal(j.get(first.id).phase,'applying');j.verifyNative(first.id,evidence(value));assert.throws(()=>j.acknowledge(first.id,{...serverReceipt().acknowledgement,cursor:'2'}),fails('SYNC_ACK_MISMATCH'));assert.equal(j.get(first.id).phase,'native-verified');}finally{f.close();}
});
test('changed request reusing a mutation or attempt identity conflicts rather than creating another intent',()=>{
 const f=fixture();try{const j=f.open();j.prepare(delivery());const changed={...intent(),patch:{title:{kind:'known' as const,value:'changed'},notes:fields.notes},expectedFields:{...fields,title:{kind:'known' as const,value:'changed'}}};assert.throws(()=>j.prepare(delivery(changed)),fails('SYNC_JOURNAL_COMMAND_CONFLICT'));assert.equal(j.list().length,1);}finally{f.close();}
});
test('a missing shared writer or lost fence prevents mutation and keeps prior durable state',()=>{
 const f=fixture();try{const j=f.open(),first=j.prepare(delivery()),readonly=SyncJournal.open(f.directory,binding);assert.throws(()=>readonly.markClaimRequested(first.id),fails('SYNC_SHARED_WRITER_REQUIRED'));f.loseFence();assert.throws(()=>j.markClaimRequested(first.id),/SYNTHETIC_FENCE_LOST/);assert.equal(SyncJournal.open(f.directory,binding).get(first.id).phase,'prepared');}finally{f.close();}
});
test('corrupt state, changed bridge/store binding and unsafe filesystem entries block recovery',()=>{
 const f=fixture();try{const j=f.open(),first=j.prepare(delivery());for(const key of ['ownerId','bridgeId','identityEpoch','storeEpoch'] as const)assert.throws(()=>SyncJournal.open(f.directory,{...binding,[key]:'changed'}),fails('SYNC_JOURNAL_BINDING'));const path=join(f.directory,'intents',first.id+'.json'),original=readFileSync(path,'utf8');writeFileSync(path,original.replace('合成标题','被改动'));assert.throws(()=>j.get(first.id),fails('SYNC_JOURNAL_CORRUPT'));writeFileSync(path,original);chmodSync(path,0o644);assert.throws(()=>j.get(first.id),fails('SYNC_JOURNAL_UNSAFE'));chmodSync(path,0o600);const link=join(f.directory,'intents','a'.repeat(64)+'.json');symlinkSync(path,link);assert.throws(()=>j.list(),fails('SYNC_JOURNAL_UNSAFE'));}finally{f.close();}
});
test('state cannot be silently reinitialized after its binding file disappears',()=>{
 const f=fixture();try{const j=f.open();j.prepare(delivery());rmSync(join(f.directory,'binding.json'));assert.throws(()=>f.open(),fails('SYNC_JOURNAL_CORRUPT'));assert.ok(readdirSync(join(f.directory,'intents')).length>0);}finally{f.close();}
});
test('legacy journal format is rejected in place without automatic migration or overwrite',()=>{
 const f=fixture();try{f.open();const path=join(f.directory,'binding.json'),old=readFileSync(path,'utf8').replace('journal.v2','journal.v1');writeFileSync(path,old);assert.throws(()=>f.open(),fails('SYNC_JOURNAL_CORRUPT'));assert.equal(readFileSync(path,'utf8'),old);}finally{f.close();}
});
test('claim-pending restart retains exact request and never permits issued retirement or fresh applying',()=>{
 const f=fixture();try{const j=f.open(),first=j.prepare(delivery());const pending=j.markClaimRequested(first.id);assert.equal(f.open().get(first.id).phase,'claim-pending');assert.deepEqual(f.open().get(first.id).claimRequest,first.claimRequest);assert.throws(()=>j.prepareRetirement(first.id,{...evidence(intent()),capabilities:caps} as any));assert.throws(()=>j.markApplying(first.id));j.saveClaim(first.id,claim());assert.deepEqual(f.open().get(first.id).claim,claim());assert.throws(()=>j.saveClaim(first.id,{...claim(),executionFence:'2'}));assert.deepEqual(pending.claim,null);}finally{f.close();}
});
test('first execution cannot adopt a claimed attempt without its original local intent history',()=>{
 const f=fixture();try{const j=f.open();assert.throws(()=>j.prepare({...delivery(),phase:'claimed',version:'2',claim:claim()}),fails('SYNC_JOURNAL_HISTORY_REQUIRED'));assert.equal(j.list().length,0);assert.throws(()=>j.prepare({...delivery(),binding:{...delivery().binding,bridgeId:'another-mac'}}),fails('SYNC_JOURNAL_BINDING'));}finally{f.close();}
});
