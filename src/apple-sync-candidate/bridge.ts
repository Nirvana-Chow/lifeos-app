import {PlatformError} from '../platform/domain.ts';
import {canonicalDigest} from './domain.ts';
import {validateActiveDelivery,validateDeliveryCapabilities,validateDeliveryIdentity,validateDeliveryFields} from './delivery-domain.ts';
import {checkWriteCapabilities} from './reconcile.ts';
import {validateBridgeIntent,SyncJournal,type BridgeIntent,type JournalRecord,type ClaimBody,type SaveAuthorizationBody,type RetireBody,type RetireResult,type ReceiptBody,type ServerReceipt,type AckBody,type NativeAcknowledgement} from './journal.ts';
import type {NativeCapabilities,NativeIdentity,FieldObservations} from './contracts.ts';
import type {ActiveDelivery,DeliveryClaim} from './store-contracts.ts';

export type NativeSnapshot={identity:NativeIdentity;fields:FieldObservations};
export type NativeResolution={status:'found'|'not-found'|'ambiguous';snapshot?:NativeSnapshot};
export interface NativeAdapter{
 capabilities():Promise<NativeCapabilities>;
 snapshot(identity:NativeIdentity):Promise<NativeSnapshot|null>;
 /** Resolve only this immutable operation. Absence never authorizes re-create. */
 resolveIntent(intent:BridgeIntent,intentHash:string):Promise<NativeResolution>;
 /** An activated adapter MUST repeat all guards immediately before save, preserve
  * untouched fields and check expectedNativeHash in its native lane. Mac fencing
  * does not lock concurrent edits on an iPhone. No real adapter is installed. */
 apply(intent:BridgeIntent,guards:{intentHash:string;assertWriter:()=>void;assertLease:()=>Promise<void>;assertClaim:()=>Promise<void>}):Promise<void>;
}
/** Trusted transport supplies the current fence for EACH request. Fence is not
 * part of the immutable request/key. authorizeSave is always a fresh call and
 * MUST NOT be served from a historical idempotency receipt or response cache. */
export interface BridgeServerPort{
 assertLease():Promise<void>;
 claim(key:string,body:ClaimBody):Promise<{claim:DeliveryClaim}>;
 authorizeSave(body:SaveAuthorizationBody):Promise<{authorized:true}&SaveAuthorizationBody>;
 retire(key:string,body:RetireBody):Promise<RetireResult>;
 receipt(key:string,body:ReceiptBody):Promise<ServerReceipt>;
 acknowledge(key:string,body:AckBody):Promise<{acknowledgement:NativeAcknowledgement}>;
}
export type BridgeServer=BridgeServerPort;
export type BridgeOptions={journal:SyncJournal;native:NativeAdapter;server:BridgeServerPort;assertWriter:()=>void;manualWriteEnabled?:boolean;macOSWriteApproved?:boolean};
function fail(code:string):never{throw new PlatformError(409,code,code);}
const same=(a:unknown,b:unknown)=>canonicalDigest(a)===canonicalDigest(b);
function snapshotValue(value:NativeSnapshot):NativeSnapshot{
 canonicalDigest(value);if(!value||Object.keys(value).sort().join(',')!=='fields,identity')return fail('SYNC_NATIVE_PRECONDITION');
 return{identity:validateDeliveryIdentity(value.identity),fields:validateDeliveryFields(value.fields)};
}
export const nativeSnapshotHash=(value:NativeSnapshot)=>canonicalDigest(snapshotValue(value));
// Shared by canonical realpath across instances. Additional scheduling, never a
// replacement for the deployed cross-process shared native writer fence.
const lanes=new Map<string,Promise<void>>();
async function inLane<T>(directory:string,operation:()=>Promise<T>):Promise<T>{
 const previous=lanes.get(directory)??Promise.resolve();let release!:()=>void;const current=new Promise<void>(resolve=>{release=resolve;});lanes.set(directory,current);
 await previous;try{return await operation();}finally{release();if(lanes.get(directory)===current)lanes.delete(directory);}
}
/** Manual injectable candidate. No credentials, daemon, HTTP client, listener,
 * native binary, device identity or alternate Apple writer is provisioned. */
export class ManualSyncBridge{
 private readonly options:BridgeOptions;
 constructor(options:BridgeOptions){this.options=options;}
 async preview(input:BridgeIntent){
  const intent=validateBridgeIntent(input),capabilities=validateDeliveryCapabilities(await this.options.native.capabilities()),result=checkWriteCapabilities(intent.kind,intent.patch,capabilities,intent.scope);
  if(!capabilities.fullSnapshot[intent.kind])return{allowed:false,reasons:['incomplete-snapshot'],platform:capabilities.platform,operation:intent.operation,fieldCount:Object.keys(intent.patch).length};
  return{...result,platform:capabilities.platform,operation:intent.operation,fieldCount:Object.keys(intent.patch).length};
 }
 private async guard(){this.options.assertWriter();await this.options.server.assertLease();this.options.assertWriter();}
 private async assertClaim(record:JournalRecord){
  if(!record.claim)fail('SYNC_CLAIM_REQUIRED');const claim=record.claim!,body:SaveAuthorizationBody={attemptId:claim.attemptId,intentHash:claim.intentHash,claimId:claim.claimId,claimVersion:claim.claimVersion,executionFence:claim.executionFence};
  await this.guard();const result=await this.options.server.authorizeSave(copy(body));if(!same(result,{authorized:true,...body}))fail('SYNC_CLAIM_AUTHORITY');this.options.assertWriter();
 }
 async execute(input:ActiveDelivery):Promise<JournalRecord>{return inLane(this.options.journal.directory,()=>this.executeOnce(input));}
 private async retire(record:JournalRecord):Promise<JournalRecord>{
  const request=record.retireRequest;if(!request)fail('SYNC_JOURNAL_TRANSITION');let result:RetireResult;
  try{await this.guard();result=await this.options.server.retire(request!.key,copy(request!.body));}catch{return this.options.journal.get(record.id);}
  return this.options.journal.saveRetirement(record.id,result);
 }
 private async precondition(record:JournalRecord):Promise<NativeSnapshot|null>{
  if(record.intent.operation!=='update')return null;
  const snapshot=await this.options.native.snapshot(copy(record.intent.target!));return snapshot===null?null:snapshotValue(snapshot);
 }
 private matches(record:JournalRecord,snapshot:NativeSnapshot|null):boolean{return record.intent.operation==='create'||snapshot!==null&&same(snapshot.identity,record.intent.target)&&nativeSnapshotHash(snapshot)===record.intent.expectedNativeHash;}
 private async executeOnce(input:ActiveDelivery):Promise<JournalRecord>{
  if(this.options.manualWriteEnabled!==true)fail('SYNC_MANUAL_WRITE_DISABLED');
  const delivery=validateActiveDelivery(input),intent=delivery.intent,capabilities=validateDeliveryCapabilities(await this.options.native.capabilities());
  if(!capabilities.fullSnapshot[intent.kind]||!checkWriteCapabilities(intent.kind,intent.patch,capabilities,intent.scope).allowed)fail('SYNC_NATIVE_CAPABILITY_REQUIRED');
  if(capabilities.platform==='macos'&&this.options.macOSWriteApproved!==true)fail('SYNC_MACOS_WRITE_CLOSED');
  await this.guard();let record=this.options.journal.prepare(delivery);
  if(['acknowledged','retired','blocked'].includes(record.phase))return record;
  if(record.phase==='retiring')return this.retire(record);
  if(record.phase==='prepared'){
   const before=await this.precondition(record);
   if(!this.matches(record,before)){
    if(!before||!same(before.identity,intent.target)||!same(Object.keys(before.fields).sort(),Object.keys(intent.expectedFields).sort()))fail('SYNC_NATIVE_PRECONDITION');
    record=this.options.journal.prepareRetirement(record.id,{...before,capabilities});return this.retire(record);
   }
   await this.guard();record=this.options.journal.markClaimRequested(record.id);
  }
  if(record.phase==='claim-pending'){
   let result:{claim:DeliveryClaim};try{await this.guard();const q=record.claimRequest;result=await this.options.server.claim(q.key,copy(q.body));}catch{return this.options.journal.get(record.id);}
   if(!result||!same(Object.keys(result),['claim']))fail('SYNC_CLAIM_MISMATCH');record=this.options.journal.saveClaim(record.id,result.claim);
  }
  if(record.phase==='claimed'){
   let before:NativeSnapshot|null;try{before=await this.precondition(record);}catch{return this.options.journal.markBlocked(record.id,'claimed-precondition');}
   if(!this.matches(record,before))return this.options.journal.markBlocked(record.id,'claimed-precondition');
   try{await this.assertClaim(record);}catch{return this.options.journal.markBlocked(record.id,'claim-authority');}
   record=this.options.journal.markApplying(record.id);
   try{if(Object.keys(intent.patch).length)await this.options.native.apply(copy(intent),{intentHash:record.intentHash,assertWriter:this.options.assertWriter,assertLease:()=>this.options.server.assertLease(),assertClaim:()=>this.assertClaim(record)});}
   catch{return this.options.journal.markUnknown(record.id,'native-transport');}
  }
  if(record.phase==='applying'||record.phase==='unknown'){
   let readback:NativeSnapshot|null=null;
   try{if(intent.operation==='update')readback=await this.options.native.snapshot(copy(intent.target!));else{const resolution=await this.options.native.resolveIntent(copy(intent),record.intentHash);if(resolution.status==='found'&&resolution.snapshot)readback=resolution.snapshot;}}
   catch{return this.options.journal.markUnknown(record.id,'native-readback');}
   if(!readback)return this.options.journal.markUnknown(record.id,'native-readback');
   try{record=this.options.journal.verifyNative(record.id,{mutationId:intent.mutationId,intentHash:record.intentHash,...snapshotValue(readback)});}
   catch(error){if(error instanceof PlatformError&&error.code==='SYNC_NATIVE_READBACK_MISMATCH')return this.options.journal.markUnknown(record.id,'native-readback');throw error;}
  }
  if(record.phase!=='native-verified'||!record.nativeReadback)fail('SYNC_JOURNAL_TRANSITION');
  if(!record.serverReceipt){
   record=this.options.journal.prepareReceipt(record.id,capabilities);const q=record.receiptRequest!;let receipt:ServerReceipt;
   try{await this.guard();receipt=await this.options.server.receipt(q.key,copy(q.body));}catch{return this.options.journal.get(record.id);}
   try{record=this.options.journal.saveServerReceipt(record.id,receipt);}catch(error){if(error instanceof PlatformError)return this.options.journal.get(record.id);throw error;}
  }
  const q=record.ackRequest!;let response:{acknowledgement:NativeAcknowledgement};
  try{await this.guard();response=await this.options.server.acknowledge(q.key,copy(q.body));}catch{return this.options.journal.get(record.id);}
  if(!response||!same(Object.keys(response),['acknowledgement']))fail('SYNC_ACK_MISMATCH');return this.options.journal.acknowledge(record.id,response.acknowledgement);
 }
}
function copy<T>(value:T):T{return structuredClone(value);}
