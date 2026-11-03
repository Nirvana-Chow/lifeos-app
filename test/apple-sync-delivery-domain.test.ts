import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalDigest} from '../src/apple-sync-candidate/domain.ts';
import {validateActiveDelivery,validateDeliveryClaim,validateDeliveryReceipt,assertDeliveryTransition,assertDeliveryClaimAuthority,validateDeliveryCommandArchive,validateDeliveryCapabilities} from '../src/apple-sync-candidate/delivery-domain.ts';
import type {ActiveDelivery,DeliveryClaim,DeliveryReceipt,SyncPrincipal,SyncLease} from '../src/apple-sync-candidate/store-contracts.ts';
import type {FieldObservations,NativeIdentity,NativeCapabilities} from '../src/apple-sync-candidate/contracts.ts';
const id='11111111-1111-4111-a111-111111111111',source='22222222-2222-4222-a222-222222222222',attempt='33333333-3333-4333-a333-333333333333',mappingId='44444444-4444-4444-a444-444444444444';
const binding={ownerId:'synthetic-owner',spaceId:'synthetic-space',bridgeId:'synthetic-mac',identityEpoch:'epoch-one'};
const identity={storeEpoch:'store-one',sourceId:'synthetic-account',containerId:'synthetic-list',itemId:'synthetic-item',externalId:null,aliases:[],seriesId:null,originalOccurrenceDate:null};
const fields={title:{kind:'known' as const,value:'Synthetic B'},notes:{kind:'known' as const,value:'Synthetic N1'}};
function issued():ActiveDelivery{const intent={mutationId:'synthetic-mutation-one',cursor:'2',kind:'reminder' as const,operation:'create' as const,entityId:id,sourceId:source,revision:3,target:null,expectedNativeHash:null,patch:fields,expectedFields:fields,scope:'single' as const};return{format:'lifeos.apple-sync.delivery.v1',version:'1',attemptId:attempt,binding,phase:'issued',cursor:'2',canonicalRevision:3,intent,intentHash:canonicalDigest(intent),preparedMapping:null,claim:null,receipt:null,retirement:null};}
function claimed(d=issued()):ActiveDelivery{const claim:DeliveryClaim={claimId:'55555555-5555-4555-a555-555555555555',attemptId:d.attemptId,binding:d.binding,intentHash:d.intentHash,claimVersion:'2',executionFence:'7'};return{...d,version:'2',phase:'claimed',claim};}
function verified(d=claimed(),nativeIdentity:NativeIdentity=identity):ActiveDelivery{const proof={mutationId:d.intent.mutationId,intentHash:d.intentHash,identity:nativeIdentity,fields:d.intent.expectedFields},body={receiptKey:'synthetic-receipt-one',attemptId:d.attemptId,binding:d.binding,intentHash:d.intentHash,claimId:d.claim!.claimId,deliveryVersion:'3',mappingId,mappingVersion:1,entityId:id,sourceId:source,canonicalRevision:3,proof,nativeHash:canonicalDigest(proof)},receipt:DeliveryReceipt={...body,receiptHash:canonicalDigest(body)};return{...d,version:'3',phase:'readback-verified',receipt};}
function retired(outcome:'reconciled'|'conflict'='reconciled'):ActiveDelivery{return{...issued(),version:'2',phase:'retired-unapplied',retirement:{commandKey:'synthetic-retirement-one',reason:'native-precondition-changed',observation:{identity,fields},outcome,evidence:{synthetic:true}}};}
const updated=(d:ActiveDelivery,change:Partial<ActiveDelivery>)=>({...structuredClone(d),...change});
test('cursor notification revision and frozen current canonical revision are independent and JSON output is detached',()=>{
 const d=issued(),value=validateActiveDelivery(d);assert.equal(value.cursor,'2');assert.equal(value.canonicalRevision,3);assert.equal(value.intent.revision,3);value.intent.patch={};assert.equal(Object.keys(d.intent.patch).length,2);
});
test('delivery rejects ambiguous shapes, numeric or noncanonical counters, unavailable targets and excessive JSON',()=>{
 for(const value of [{...issued(),unknown:true},{...issued(),version:1},{...issued(),version:'01'},{...issued(),cursor:'0'},{...issued(),version:'9'.repeat(41)},{...issued(),claim:claimed().claim}])assert.throws(()=>validateActiveDelivery(value));
 const d=issued();d.intent.expectedFields={notes:{kind:'unavailable',reason:'not read'}};d.intent.patch={};d.intentHash=canonicalDigest(d.intent);assert.throws(()=>validateActiveDelivery(d));
 const large=retired();large.retirement!.evidence={chunks:Array(8).fill('x'.repeat(40000))};assert.throws(()=>validateActiveDelivery(large));
 let accessed=false;const malicious={...issued()};Object.defineProperty(malicious,'version',{enumerable:true,get(){accessed=true;return'1';}});assert.throws(()=>validateActiveDelivery(malicious));assert.equal(accessed,false);
});
test('empty create, incorrect patch values and substituted immutable intent hashes are invalid',()=>{
 for(const patch of [{},{title:{kind:'known' as const,value:'wrong target'}}] as FieldObservations[]){const d=issued();d.intent.patch=patch;d.intentHash=canonicalDigest(d.intent);assert.throws(()=>validateActiveDelivery(d));}
 assert.throws(()=>validateActiveDelivery({...issued(),intentHash:'a'.repeat(64)}));
 const d=issued();d.intent.cursor='3';d.intentHash=canonicalDigest(d.intent);assert.throws(()=>validateActiveDelivery(d));
});
test('update no-op requires target identity, semantic precondition and prepared mapping',()=>{
 const d=issued();d.intent={...d.intent,operation:'update',target:identity,expectedNativeHash:canonicalDigest({identity,fields}),patch:{}};d.intentHash=canonicalDigest(d.intent);d.preparedMapping={id:mappingId,version:1};assert.equal(validateActiveDelivery(d).intent.operation,'update');
 assert.throws(()=>validateActiveDelivery({...d,preparedMapping:null}));d.intent.target=null;d.intentHash=canonicalDigest(d.intent);assert.throws(()=>validateActiveDelivery(d));
});
test('phase transitions preserve intent and require exact globally monotone CAS versions',()=>{
 assert.doesNotThrow(()=>assertDeliveryTransition(null,null,issued()));assert.doesNotThrow(()=>assertDeliveryTransition(issued(),'1',claimed()));assert.doesNotThrow(()=>assertDeliveryTransition(claimed(),'2',verified()));
 const ack=updated(verified(),{version:'4',phase:'acknowledged'});assert.doesNotThrow(()=>assertDeliveryTransition(verified(),'3',ack));
 assert.throws(()=>assertDeliveryTransition(issued(),'0',claimed()));assert.throws(()=>assertDeliveryTransition(issued(),'1',updated(claimed(),{version:'3'})));assert.throws(()=>assertDeliveryTransition(issued(),'1',verified()));
 const changed=claimed();changed.intent={...changed.intent,revision:4};changed.canonicalRevision=4;changed.intentHash=canonicalDigest(changed.intent);changed.claim={...changed.claim!,intentHash:changed.intentHash};assert.throws(()=>assertDeliveryTransition(issued(),'1',changed));
});
test('claimed uncertainty cannot retire and conflicting retirement cannot prepare another attempt',()=>{
 assert.doesNotThrow(()=>assertDeliveryTransition(issued(),'1',retired()));assert.throws(()=>assertDeliveryTransition(claimed(),'2',updated(retired(),{version:'3'})));
 const replacement=updated(issued(),{version:'3',attemptId:'66666666-6666-4666-a666-666666666666'});replacement.intent={...replacement.intent,mutationId:'synthetic-new-attempt'};replacement.intentHash=canonicalDigest(replacement.intent);
 assert.doesNotThrow(()=>assertDeliveryTransition(retired(),'2',replacement));assert.throws(()=>assertDeliveryTransition(retired('conflict'),'2',replacement));assert.throws(()=>assertDeliveryTransition(retired(),'2',updated(replacement,{version:'1'})));
 const stale=updated(replacement,{intent:issued().intent,intentHash:issued().intentHash});assert.throws(()=>assertDeliveryTransition(retired(),'2',stale));
});
test('terminal replacement retains binding, increments version and distinguishes next cursor from same-cursor retry',()=>{
 const previous=updated(verified(),{version:'4',phase:'acknowledged'}),next=updated(issued(),{version:'5',attemptId:'77777777-7777-4777-a777-777777777777',cursor:'3'});next.intent={...next.intent,cursor:'3',mutationId:'synthetic-next-cursor'};next.intentHash=canonicalDigest(next.intent);
 assert.doesNotThrow(()=>assertDeliveryTransition(previous,'4',next));assert.throws(()=>assertDeliveryTransition(previous,'4',updated(next,{binding:{...binding,identityEpoch:'epoch-two'}})));
 const sameCursor=updated(next,{cursor:'2',intent:{...next.intent,cursor:'2'}});sameCursor.intentHash=canonicalDigest(sameCursor.intent);assert.throws(()=>assertDeliveryTransition(previous,'4',sameCursor));
 const older=updated(next,{canonicalRevision:2,intent:{...next.intent,revision:2}});older.intentHash=canonicalDigest(older.intent);assert.throws(()=>assertDeliveryTransition(previous,'4',older));
});
test('receipts bind the entire proof, business/source/mapping revision and immutable claim',()=>{
 const d=verified();assert.deepEqual(validateDeliveryReceipt(d.receipt),d.receipt);assert.deepEqual(validateDeliveryClaim(d.claim),d.claim);
 const corrupt=structuredClone(d);corrupt.receipt!.proof.fields={title:{kind:'known',value:'Unexpected phone change'}};corrupt.receipt!.nativeHash=canonicalDigest(corrupt.receipt!.proof);const {receiptHash,...body}=corrupt.receipt!;corrupt.receipt!.receiptHash=canonicalDigest(body);assert.throws(()=>validateActiveDelivery(corrupt));
 const wrong=structuredClone(d);wrong.receipt!.sourceId=id;const {receiptHash:ignored,...other}=wrong.receipt!;void ignored;wrong.receipt!.receiptHash=canonicalDigest(other);assert.throws(()=>validateActiveDelivery(wrong));
 assert.throws(()=>validateDeliveryReceipt({...d.receipt,mappingVersion:0}));assert.throws(()=>validateDeliveryClaim({...d.claim,executionFence:'07'}));
});
test('historical claim parsing never reauthorizes an expired fence, retired attempt or read-only principal',()=>{
 const d=claimed(),p:SyncPrincipal={...binding,scopes:['sync:read','sync:write']},lease:SyncLease={...binding,fence:'7',expiresAt:'2026-11-03T00:01:00.000Z',ackCursor:'1'},now='2026-11-03T00:00:00.000Z';
 assert.doesNotThrow(()=>assertDeliveryClaimAuthority(d,d.claim!,p,lease,now));assert.doesNotThrow(()=>validateDeliveryClaim(d.claim));
 assert.throws(()=>assertDeliveryClaimAuthority(d,d.claim!,p,{...lease,fence:'8'},now));assert.throws(()=>assertDeliveryClaimAuthority(d,d.claim!,{...p,scopes:['sync:read']},lease,now));assert.throws(()=>assertDeliveryClaimAuthority(d,d.claim!,p,lease,'2026-11-03T00:01:00.000Z'));assert.throws(()=>assertDeliveryClaimAuthority(retired(),d.claim!,p,lease,now));
});
test('issuance rejects an intent whose later legitimate readback would exceed the unchanged slot limit',()=>{
 const d=issued(),largeFields={one:{kind:'known' as const,value:'x'.repeat(50000)},two:{kind:'known' as const,value:'y'.repeat(50000)}};d.intent={...d.intent,patch:largeFields,expectedFields:largeFields};d.intentHash=canonicalDigest(d.intent);
 assert.ok(Buffer.byteLength(JSON.stringify(d))<262144);assert.ok(Buffer.byteLength(JSON.stringify(verified(claimed(d))))>262144);
 assert.throws(()=>validateActiveDelivery(d),'must reject before exposing an executable intent, not after native save');
});
test('issuance reserves nesting capacity for later proof and command-archive wrappers',()=>{
 let nested:unknown='synthetic';for(let i=0;i<28;i++)nested={child:nested};const d=issued(),deep={opaque:{kind:'known' as const,value:nested as any}};d.intent={...d.intent,patch:deep,expectedFields:deep};d.intentHash=canonicalDigest(d.intent);
 assert.throws(()=>validateActiveDelivery(d),'valid issued JSON must not become impossible to archive after adding proof wrappers');
});
test('near-limit accepted fields and identity leave room for every delivery phase and HTTP receipt body',()=>{
 const d=issued(),overhead=Buffer.byteLength(JSON.stringify({notes:{kind:'known',value:''}})),boundedFields={notes:{kind:'known' as const,value:'x'.repeat(24576-overhead)}};d.intent={...d.intent,patch:boundedFields,expectedFields:boundedFields};d.intentHash=canonicalDigest(d.intent);const native={...identity,aliases:['a'.repeat(1800),'b'.repeat(1800)]};
 const c=claimed(d),v=verified(c,native),a={...v,version:'4',phase:'acknowledged' as const};for(const state of [d,c,v,a])assert.doesNotThrow(()=>validateActiveDelivery(state));
 const fieldNames=Array.from({length:120},(_,i)=>'f'+String(i).padStart(3,'0')+'x'.repeat(124));const capabilities:NativeCapabilities={protocolVersion:1,adapterId:'synthetic',adapterVersion:'1',platform:'synthetic',fullSnapshot:{reminder:true,event:true},writableFields:{reminder:fieldNames,event:[]},preserveUnchanged:true,scopes:['single'],nativeEventCancellationWrite:false,invitationWrite:false};assert.doesNotThrow(()=>validateDeliveryCapabilities(capabilities));
 assert.ok(Buffer.byteLength(JSON.stringify(v))<120000);const request={fence:'7',attemptId:attempt,intentHash:d.intentHash,expectedDeliveryVersion:'2',claimId:c.claim!.claimId,proof:v.receipt!.proof,capabilities};assert.ok(Buffer.byteLength(JSON.stringify(request))<131072);
 assert.throws(()=>validateDeliveryCapabilities({...capabilities,writableFields:{reminder:fieldNames,event:fieldNames}}));
 const overflow=structuredClone(d);overflow.intent.expectedFields={notes:{kind:'known',value:boundedFields.notes.value+'x'}};overflow.intent.patch=overflow.intent.expectedFields;overflow.intentHash=canonicalDigest(overflow.intent);assert.throws(()=>validateActiveDelivery(overflow));
 const tooLargeIdentity=verified(c,{...identity,aliases:Array.from({length:4},(_,i)=>String(i)+'x'.repeat(1500))});assert.throws(()=>validateActiveDelivery(tooLargeIdentity));
});
test('conflict retirement preserves unavailable native fields but never permits reprepare or treats them as null',()=>{
 const d=retired('conflict');d.retirement!.observation.fields={notes:{kind:'unavailable',reason:'permission changed'}};
 assert.deepEqual(validateActiveDelivery(d).retirement!.observation.fields,{notes:{kind:'unavailable',reason:'permission changed'}});
 assert.throws(()=>validateActiveDelivery({...d,retirement:{...d.retirement!,outcome:'reconciled'}}));
 const replacement=updated(issued(),{version:'3',attemptId:'66666666-6666-4666-a666-666666666666'});replacement.intent={...replacement.intent,mutationId:'synthetic-retry-conflict'};replacement.intentHash=canonicalDigest(replacement.intent);assert.throws(()=>assertDeliveryTransition(d,'2',replacement));
});
test('current-command archive retains full state by value and rejects wrong operation phase or alternate paths',()=>{
 const state=verified(),archive={format:'lifeos.apple-sync.delivery-command.v1',operation:'receipt',delivery:state,response:{receipt:state.receipt}};
 const validated=validateDeliveryCommandArchive(archive);assert.deepEqual(validated.delivery.receipt!.proof.fields,fields);state.receipt!.proof.fields={};assert.deepEqual(validated.delivery.receipt!.proof.fields,fields);
 assert.throws(()=>validateDeliveryCommandArchive({...archive,delivery:verified(),operation:'claim'}));assert.throws(()=>validateDeliveryCommandArchive({format:archive.format,operation:'receipt',deliveryHash:canonicalDigest(verified()),response:{}}));assert.throws(()=>validateDeliveryCommandArchive({...archive,delivery:verified(),archiveKey:'other-key'}));assert.throws(()=>validateDeliveryCommandArchive({...archive,delivery:verified(),format:'other'}));
});
