import {PlatformError,validateId,validateIdempotencyKey,validateRevision} from '../platform/domain.ts';
import {canonicalDigest,validateNativeIdentity,validateObservations,validateCapabilities} from './domain.ts';
import type {FieldObservations,NativeIdentity,NativeCapabilities,JsonValue} from './contracts.ts';
import type {BridgeIntent,NativeReadback} from './journal.ts';
import type {ActiveDelivery,DeliveryBinding,DeliveryClaim,DeliveryReceipt,DeliveryRetirement,DeliveryCommandArchive,SyncPrincipal,SyncLease} from './store-contracts.ts';

function fail(code='SYNC_DELIVERY_INVALID'):never{throw new PlatformError(409,code,'同步投递状态无效。');}
const same=(left:unknown,right:unknown)=>canonicalDigest(left)===canonicalDigest(right);
/** Component budgets are checked BEFORE issuance/native execution. A maximum
 * intent plus a complete proof/claim/receipt is below 112 KiB, leaving ample
 * room in the unchanged 256 KiB slot. Proof + capabilities + protocol metadata
 * is below 64 KiB, within the existing 128 KiB HTTP input limit. */
export const deliveryBudgets=Object.freeze({slotBytes:262144,intentBytes:65536,fieldsBytes:24576,identityBytes:4096,capabilitiesBytes:16384,archiveBytes:786432,responseBytes:262144,fieldsDepth:12,fieldsNodes:2048,slotDepth:24,slotNodes:10000,archiveDepth:28,archiveNodes:25000});
function budget(value:unknown,maximum:number):void{if(Buffer.byteLength(JSON.stringify(value),'utf8')>maximum)fail('SYNC_DELIVERY_TOO_LARGE');}
function structureBudget(value:unknown,maxDepth:number,maxNodes:number):void{let nodes=0;const visit=(item:unknown,depth:number)=>{if(depth>maxDepth||++nodes>maxNodes)fail('SYNC_DELIVERY_TOO_LARGE');if(item&&typeof item==='object')for(const child of Object.values(item))visit(child,depth+1);};visit(value,0);}
function copy(value:unknown,maximum:number=deliveryBudgets.slotBytes,maxDepth:number=deliveryBudgets.slotDepth,maxNodes:number=deliveryBudgets.slotNodes):unknown{
 // Validate descriptors/prototypes before stringify or structuredClone can invoke accessors.
 canonicalDigest(value);budget(value,maximum);structureBudget(value,maxDepth,maxNodes);return structuredClone(value);
}
function exact(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key)))fail();return value as Record<string,unknown>;
}
/** Positive canonical decimal; bigint arithmetic, never Number coercion. */
export function validateDeliveryCounter(value:unknown):string{if(typeof value!=='string'||! /^[1-9]\d{0,39}$/.test(value))fail('SYNC_DELIVERY_COUNTER');return value;}
function digest(value:unknown):string{if(typeof value!=='string'||! /^[a-f0-9]{64}$/.test(value))fail();return value;}
function binding(value:unknown):DeliveryBinding{
 const o=exact(value,['ownerId','spaceId','bridgeId','identityEpoch']);
 if(Object.values(o).some(v=>typeof v!=='string'||! /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v)))fail('SYNC_DELIVERY_BINDING');
 if(!/^[A-Za-z0-9_-]{6,80}$/.test(o.ownerId as string))fail('SYNC_DELIVERY_BINDING');return o as unknown as DeliveryBinding;
}
export function validateDeliveryFields(value:unknown):FieldObservations{const fields=validateObservations(value);budget(fields,deliveryBudgets.fieldsBytes);structureBudget(fields,deliveryBudgets.fieldsDepth,deliveryBudgets.fieldsNodes);if(Object.values(fields).some(v=>v.kind!=='known'))fail('SYNC_DELIVERY_UNKNOWN_FIELD');return fields;}
export function validateDeliveryIdentity(value:unknown):NativeIdentity{const identity=validateNativeIdentity(value);budget(identity,deliveryBudgets.identityBytes);return identity;}
/** Use alongside proof/snapshot validation before prepare/claim/native save and
 * when receiving observations/receipts; a full-snapshot flag is not a byte grant. */
export function validateDeliveryCapabilities(value:unknown):NativeCapabilities{const capabilities=validateCapabilities(value);budget(capabilities,deliveryBudgets.capabilitiesBytes);return capabilities;}
/** Pure counterpart of the journal contract; deliberately no runtime fs import. */
export function validateDeliveryIntent(value:unknown):BridgeIntent{
 const o=exact(copy(value,deliveryBudgets.intentBytes),['mutationId','cursor','kind','operation','entityId','sourceId','revision','target','expectedNativeHash','patch','expectedFields','scope']);
 validateIdempotencyKey(o.mutationId);validateId(o.entityId);validateId(o.sourceId);validateRevision(o.revision);validateDeliveryCounter(o.cursor);
 if(!['reminder','event'].includes(o.kind as string)||!['create','update'].includes(o.operation as string)||o.scope!=='single')fail('SYNC_DELIVERY_INTENT');
 const patch=validateDeliveryFields(o.patch),expectedFields=validateDeliveryFields(o.expectedFields);
 if(!Object.keys(expectedFields).length||Object.entries(patch).some(([key,observation])=>!Object.hasOwn(expectedFields,key)||!same(observation,expectedFields[key])))fail('SYNC_DELIVERY_INTENT');
 if(o.operation==='create'){if(o.target!==null||o.expectedNativeHash!==null||!Object.keys(patch).length||!same(patch,expectedFields))fail('SYNC_DELIVERY_INTENT');}
 else{const target=validateDeliveryIdentity(o.target);if(target.seriesId!==null||target.originalOccurrenceDate!==null)fail('SYNC_DELIVERY_INTENT');digest(o.expectedNativeHash);}
 return {...o,patch,expectedFields} as unknown as BridgeIntent;
}
export function validateDeliveryClaim(value:unknown):DeliveryClaim{
 const o=exact(copy(value),['claimId','attemptId','binding','intentHash','claimVersion','executionFence']);
 validateId(o.claimId);validateId(o.attemptId);binding(o.binding);digest(o.intentHash);validateDeliveryCounter(o.claimVersion);validateDeliveryCounter(o.executionFence);return o as unknown as DeliveryClaim;
}
function proof(value:unknown):NativeReadback{
 const o=exact(value,['mutationId','intentHash','identity','fields']);validateIdempotencyKey(o.mutationId);digest(o.intentHash);
 return {mutationId:o.mutationId as string,intentHash:o.intentHash as string,identity:validateDeliveryIdentity(o.identity),fields:validateDeliveryFields(o.fields)};
}
export function validateDeliveryReceipt(value:unknown):DeliveryReceipt{
 const o=exact(copy(value),['receiptKey','attemptId','binding','intentHash','claimId','deliveryVersion','mappingId','mappingVersion','entityId','sourceId','canonicalRevision','proof','nativeHash','receiptHash']);
 validateIdempotencyKey(o.receiptKey);for(const key of ['attemptId','claimId','mappingId','entityId','sourceId'])validateId(o[key]);binding(o.binding);digest(o.intentHash);validateDeliveryCounter(o.deliveryVersion);validateRevision(o.mappingVersion);validateRevision(o.canonicalRevision);
 const nativeProof=proof(o.proof);if(nativeProof.intentHash!==o.intentHash||digest(o.nativeHash)!==canonicalDigest(nativeProof))fail('SYNC_DELIVERY_RECEIPT');
 const {receiptHash,...body}=o;if(digest(receiptHash)!==canonicalDigest(body))fail('SYNC_DELIVERY_RECEIPT');return {...o,proof:nativeProof} as unknown as DeliveryReceipt;
}
function retirement(value:unknown):DeliveryRetirement{
 const o=exact(value,['commandKey','reason','observation','outcome','evidence']);validateIdempotencyKey(o.commandKey);if(o.reason!=='native-precondition-changed'||!['reconciled','conflict'].includes(o.outcome as string))fail();
 const observation=exact(o.observation,['identity','fields']);return {...o,observation:{identity:validateNativeIdentity(observation.identity),fields:o.outcome==='conflict'?validateObservations(observation.fields):validateDeliveryFields(observation.fields)}} as unknown as DeliveryRetirement;
}
export function validateActiveDelivery(value:unknown):ActiveDelivery{
 const o=exact(copy(value),['format','version','attemptId','binding','phase','cursor','canonicalRevision','intent','intentHash','preparedMapping','claim','receipt','retirement']);
 if(o.format!=='lifeos.apple-sync.delivery.v1'||!['issued','claimed','readback-verified','acknowledged','retired-unapplied'].includes(o.phase as string))fail();
 const version=validateDeliveryCounter(o.version),attemptId=validateId(o.attemptId),ownerBinding=binding(o.binding),cursor=validateDeliveryCounter(o.cursor),canonicalRevision=validateRevision(o.canonicalRevision),intent=validateDeliveryIntent(o.intent),intentHash=digest(o.intentHash);
 if(intent.cursor!==cursor||intent.revision!==canonicalRevision||canonicalDigest(intent)!==intentHash)fail('SYNC_DELIVERY_INTENT');
 let preparedMapping:ActiveDelivery['preparedMapping']=null;
 if(o.preparedMapping!==null){const m=exact(o.preparedMapping,['id','version']);preparedMapping={id:validateId(m.id),version:validateRevision(m.version)};}
 if((intent.operation==='create')!==(preparedMapping===null))fail('SYNC_DELIVERY_BINDING');
 const claim=o.claim===null?null:validateDeliveryClaim(o.claim),receipt=o.receipt===null?null:validateDeliveryReceipt(o.receipt),retired=o.retirement===null?null:retirement(o.retirement);
 if(claim&&(claim.attemptId!==attemptId||!same(claim.binding,ownerBinding)||claim.intentHash!==intentHash))fail('SYNC_DELIVERY_CLAIM');
 if(receipt){
  if(!claim||receipt.claimId!==claim.claimId||receipt.attemptId!==attemptId||!same(receipt.binding,ownerBinding)||receipt.intentHash!==intentHash||receipt.entityId!==intent.entityId||receipt.sourceId!==intent.sourceId||receipt.canonicalRevision!==canonicalRevision||receipt.proof.mutationId!==intent.mutationId||!same(receipt.proof.fields,intent.expectedFields)||intent.target!==null&&!same(receipt.proof.identity,intent.target))fail('SYNC_DELIVERY_RECEIPT');
  if(preparedMapping?(receipt.mappingId!==preparedMapping.id||receipt.mappingVersion!==preparedMapping.version+1):receipt.mappingVersion!==1)fail('SYNC_DELIVERY_RECEIPT');
  if(BigInt(receipt.deliveryVersion)!==BigInt(claim.claimVersion)+1n)fail('SYNC_DELIVERY_RECEIPT');
 }
 if(o.phase==='issued'){if(claim||receipt||retired)fail('SYNC_DELIVERY_PHASE');}
 else if(o.phase==='claimed'){if(!claim||claim.claimVersion!==version||receipt||retired)fail('SYNC_DELIVERY_PHASE');}
 else if(o.phase==='readback-verified'||o.phase==='acknowledged'){
  if(!claim||!receipt||retired||BigInt(version)!==BigInt(receipt.deliveryVersion)+(o.phase==='acknowledged'?1n:0n))fail('SYNC_DELIVERY_PHASE');
 }else if(claim||receipt||!retired||intent.target!==null&&retired.outcome==='reconciled'&&!same(retired.observation.identity,intent.target))fail('SYNC_DELIVERY_PHASE');
 return {format:'lifeos.apple-sync.delivery.v1',version,attemptId,binding:ownerBinding,phase:o.phase as ActiveDelivery['phase'],cursor,canonicalRevision,intent,intentHash,preparedMapping,claim,receipt,retirement:retired};
}
/** Fixed archive stored by value at tx.receipt().result for the current command
 * key. The repository must additionally compare archive.delivery with its next
 * CAS value; this validator never substitutes a hash or alternate archive key. */
export function validateDeliveryCommandArchive(value:unknown):DeliveryCommandArchive{
 const o=exact(copy(value,deliveryBudgets.archiveBytes,deliveryBudgets.archiveDepth,deliveryBudgets.archiveNodes),['format','operation','delivery','response']);
 if(o.format!=='lifeos.apple-sync.delivery-command.v1'||!['prepare','claim','retire','receipt','ack'].includes(o.operation as string))fail('SYNC_DELIVERY_ARCHIVE');
 const delivery=validateActiveDelivery(o.delivery),phases={prepare:'issued',claim:'claimed',retire:'retired-unapplied',receipt:'readback-verified',ack:'acknowledged'} as const;
 if(delivery.phase!==phases[o.operation as keyof typeof phases])fail('SYNC_DELIVERY_ARCHIVE');
 return {format:'lifeos.apple-sync.delivery-command.v1',operation:o.operation as DeliveryCommandArchive['operation'],delivery,response:copy(o.response,deliveryBudgets.responseBytes) as JsonValue};
}
function immutable(value:ActiveDelivery){return{attemptId:value.attemptId,binding:value.binding,cursor:value.cursor,canonicalRevision:value.canonicalRevision,intent:value.intent,intentHash:value.intentHash,preparedMapping:value.preparedMapping};}
/** Validate a mutation, not a replay: historical command replay performs no save.
 * Repository must also retain the old value in immutable command receipts. */
export function assertDeliveryTransition(previous:ActiveDelivery|null,expectedVersion:string|null,next:ActiveDelivery):void{
 const n=validateActiveDelivery(next);
 if(previous===null){if(expectedVersion!==null||n.version!=='1'||n.phase!=='issued')fail('SYNC_DELIVERY_CAS');return;}
 const p=validateActiveDelivery(previous);
 if(expectedVersion!==p.version||BigInt(n.version)!==BigInt(p.version)+1n)fail('SYNC_DELIVERY_CAS');
 if(!same(p.binding,n.binding))fail('SYNC_DELIVERY_BINDING');
 if(p.attemptId!==n.attemptId){
  if(n.phase!=='issued'||p.intent.mutationId===n.intent.mutationId)fail('SYNC_DELIVERY_TRANSITION');
  if(p.phase==='acknowledged'){if(BigInt(n.cursor)<=BigInt(p.cursor)||n.intent.kind===p.intent.kind&&n.intent.entityId===p.intent.entityId&&(n.intent.sourceId!==p.intent.sourceId||n.canonicalRevision<p.canonicalRevision))fail('SYNC_DELIVERY_TRANSITION');}
  else if(p.phase==='retired-unapplied'&&p.retirement?.outcome==='reconciled'){if(n.cursor!==p.cursor||n.intent.entityId!==p.intent.entityId||n.intent.sourceId!==p.intent.sourceId||n.intent.kind!==p.intent.kind||n.canonicalRevision<p.canonicalRevision)fail('SYNC_DELIVERY_TRANSITION');}
  else fail('SYNC_DELIVERY_TRANSITION');return;
 }
 if(!same(immutable(p),immutable(n)))fail('SYNC_DELIVERY_IMMUTABLE');
 if(p.phase==='issued'&&(n.phase==='claimed'||n.phase==='retired-unapplied'))return;
 if(p.phase==='claimed'&&n.phase==='readback-verified'&&same(p.claim,n.claim))return;
 if(p.phase==='readback-verified'&&n.phase==='acknowledged'&&same(p.claim,n.claim)&&same(p.receipt,n.receipt))return;
 fail('SYNC_DELIVERY_TRANSITION');
}
export function assertDeliveryBinding(value:ActiveDelivery,principal:SyncPrincipal):void{
 const d=validateActiveDelivery(value);if(!same(d.binding,{ownerId:principal.ownerId,spaceId:principal.spaceId,bridgeId:principal.bridgeId,identityEpoch:principal.identityEpoch}))fail('SYNC_DELIVERY_BINDING');
}
function timestamp(value:string):number{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))fail('SYNC_DELIVERY_AUTHORITY');const time=Date.parse(value);if(!Number.isFinite(time)||new Date(time).toISOString()!==value)fail('SYNC_DELIVERY_AUTHORITY');return time;}
/** Pure final checks only. Caller still MUST re-read live lease, verify the
 * independent business permit and hold the original shared native writer fence. */
export function assertDeliveryClaimAuthority(value:ActiveDelivery,input:DeliveryClaim,principal:SyncPrincipal,lease:SyncLease,now:string):void{
 const d=validateActiveDelivery(value),claim=validateDeliveryClaim(input);assertDeliveryBinding(d,principal);
 if(!Array.isArray(principal.scopes)||!principal.scopes.includes('sync:read')||!principal.scopes.includes('sync:write')||principal.scopes.some(scope=>scope!=='sync:read'&&scope!=='sync:write'))fail('SYNC_DELIVERY_AUTHORITY');
 if(!same(d.binding,{ownerId:lease.ownerId,spaceId:lease.spaceId,bridgeId:lease.bridgeId,identityEpoch:lease.identityEpoch})||d.phase!=='claimed'||!same(d.claim,claim)||claim.claimVersion!==d.version||claim.executionFence!==validateDeliveryCounter(lease.fence)||timestamp(lease.expiresAt)<=timestamp(now))fail('SYNC_DELIVERY_AUTHORITY');
}
