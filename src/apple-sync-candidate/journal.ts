import {constants,closeSync,existsSync,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,realpathSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {PlatformError,validateIdempotencyKey} from '../platform/domain.ts';
import {canonicalDigest} from './domain.ts';
import {validateActiveDelivery,validateDeliveryIntent,validateDeliveryClaim,validateDeliveryReceipt,validateDeliveryIdentity,validateDeliveryFields,validateDeliveryCapabilities} from './delivery-domain.ts';
import type {EntityKind,FieldObservations,NativeIdentity,NativeScope,NativeCapabilities} from './contracts.ts';
import type {ActiveDelivery,DeliveryClaim,DeliveryReceipt} from './store-contracts.ts';
export type BridgeBinding={ownerId:string;spaceId:string;bridgeId:string;identityEpoch:string;storeEpoch:string};
export type BridgeIntent={mutationId:string;cursor:string;kind:EntityKind;operation:'create'|'update';entityId:string;sourceId:string;revision:number;target:NativeIdentity|null;expectedNativeHash:string|null;patch:FieldObservations;expectedFields:FieldObservations;scope:NativeScope};
export type NativeReadback={mutationId:string;intentHash:string;identity:NativeIdentity;fields:FieldObservations};
export type NativeAcknowledgement={mutationId:string;cursor:string;nativeHash:string;receiptHash:string};
export type ClaimBody={attemptId:string;intentHash:string;expectedDeliveryVersion:string};
export type SaveAuthorizationBody={attemptId:string;intentHash:string;claimId:string;claimVersion:string;executionFence:string};
export type RetireBody=ClaimBody&{observation:{identity:NativeIdentity;fields:FieldObservations;capabilities:NativeCapabilities}};
export type RetireResult={delivery:ActiveDelivery;reconciliation:{status:string;entityId:string;revision:number}};
export type ReceiptBody=ClaimBody&{claimId:string;proof:NativeReadback;capabilities:NativeCapabilities};
export type ServerReceipt={receipt:DeliveryReceipt;acknowledgement:NativeAcknowledgement};
export type AckBody={receiptKey:string;attemptId:string;acknowledgement:NativeAcknowledgement};
export type DurableRequest<T>={key:string;body:T};
export type JournalPhase='prepared'|'claim-pending'|'claimed'|'retiring'|'retired'|'applying'|'unknown'|'native-verified'|'acknowledged'|'blocked';
export type JournalRecord={format:'lifeos.apple-sync.intent.v2';id:string;binding:BridgeBinding;originalDelivery:ActiveDelivery;intent:BridgeIntent;intentHash:string;sequence:number;phase:JournalPhase;claimRequest:DurableRequest<ClaimBody>;claim:DeliveryClaim|null;retireRequest:DurableRequest<RetireBody>|null;retireResult:RetireResult|null;nativeReadback:NativeReadback|null;nativeHash:string|null;receiptRequest:DurableRequest<ReceiptBody>|null;serverReceipt:ServerReceipt|null;ackRequest:DurableRequest<AckBody>|null;ackReceiptHash:string|null;reason:string|null};
function fail(code:string):never{throw new PlatformError(409,code,code);}
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const keys=(v:unknown,allowed:readonly string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===allowed.length&&Object.keys(v).every(k=>allowed.includes(k));
const same=(a:unknown,b:unknown)=>canonicalDigest(a)===canonicalDigest(b);
const copy=<T>(v:T):T=>{canonicalDigest(v);return structuredClone(v);};
const command=(operation:string,id:string)=>'sync-'+operation+'-'+id;
const recordKeys=['format','id','binding','originalDelivery','intent','intentHash','sequence','phase','claimRequest','claim','retireRequest','retireResult','nativeReadback','nativeHash','receiptRequest','serverReceipt','ackRequest','ackReceiptHash','reason'];
function bindingValue(value:BridgeBinding):BridgeBinding{if(!keys(value,['ownerId','spaceId','bridgeId','identityEpoch','storeEpoch'])||Object.values(value).some(v=>typeof v!=='string'||!v.trim()||v.length>256||/[\u0000-\u001f]/.test(v)))fail('SYNC_JOURNAL_BINDING');return copy(value);}
export const validateBridgeIntent=(value:BridgeIntent):BridgeIntent=>validateDeliveryIntent(value);
function claimBody(delivery:ActiveDelivery):ClaimBody{return{attemptId:delivery.attemptId,intentHash:delivery.intentHash,expectedDeliveryVersion:delivery.version};}
export function assertNativeAcknowledgement(record:JournalRecord,ack:NativeAcknowledgement):void{
 if(!keys(ack,['mutationId','cursor','nativeHash','receiptHash'])||ack.mutationId!==record.intent.mutationId||ack.cursor!==record.intent.cursor||ack.nativeHash!==record.nativeHash||!hash(ack.receiptHash)||record.ackReceiptHash!==null&&record.ackReceiptHash!==ack.receiptHash)fail('SYNC_ACK_MISMATCH');
}
function proofValue(r:JournalRecord,input:NativeReadback):NativeReadback{
 try{if(!keys(input,['mutationId','intentHash','identity','fields']))fail('SYNC_NATIVE_READBACK_MISMATCH');const p={mutationId:input.mutationId,intentHash:input.intentHash,identity:validateDeliveryIdentity(input.identity),fields:validateDeliveryFields(input.fields)};
  if(p.mutationId!==r.intent.mutationId||p.intentHash!==r.intentHash||p.identity.storeEpoch!==r.binding.storeEpoch||!same(p.fields,r.intent.expectedFields)||r.intent.target&&!same(p.identity,r.intent.target))fail('SYNC_NATIVE_READBACK_MISMATCH');return p;
 }catch{return fail('SYNC_NATIVE_READBACK_MISMATCH');}
}
function claimValue(r:JournalRecord,input:DeliveryClaim):DeliveryClaim{
 const c=validateDeliveryClaim(input);if(c.attemptId!==r.originalDelivery.attemptId||c.intentHash!==r.intentHash||!same(c.binding,r.originalDelivery.binding)||BigInt(c.claimVersion)!==BigInt(r.originalDelivery.version)+1n)fail('SYNC_CLAIM_MISMATCH');return c;
}
function receiptValue(r:JournalRecord,input:ServerReceipt):ServerReceipt{
 if(!keys(input,['receipt','acknowledgement'])||!r.claim||!r.nativeReadback)fail('SYNC_ACK_MISMATCH');
 const receipt=validateDeliveryReceipt(input.receipt);validateActiveDelivery({...r.originalDelivery,phase:'readback-verified',version:receipt.deliveryVersion,claim:r.claim,receipt});
 if(!same(receipt.proof,r.nativeReadback)||receipt.nativeHash!==r.nativeHash)fail('SYNC_ACK_MISMATCH');assertNativeAcknowledgement(r,input.acknowledgement);
 if(input.acknowledgement.receiptHash!==receipt.receiptHash)fail('SYNC_ACK_MISMATCH');return copy(input);
}
function safeDirectory(path:string){try{const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o077)!==0)fail('SYNC_JOURNAL_UNSAFE');}catch(error){if(error instanceof PlatformError)throw error;fail('SYNC_JOURNAL_UNSAFE');}}
function syncDirectory(path:string){let fd:number|undefined;try{fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);fsyncSync(fd);}catch{return fail('SYNC_JOURNAL_IO');}finally{if(fd!==undefined)closeSync(fd);}}
function readPrivate(path:string):unknown{
 let fd:number|undefined;try{const before=lstatSync(path);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.uid!==process.getuid?.()||(before.mode&0o077)!==0)fail('SYNC_JOURNAL_UNSAFE');fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const s=fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.uid!==before.uid||s.dev!==before.dev||s.ino!==before.ino||s.size>2_097_152)fail('SYNC_JOURNAL_UNSAFE');return JSON.parse(readFileSync(fd,'utf8'));}catch(error){if(error instanceof PlatformError)throw error;return fail('SYNC_JOURNAL_CORRUPT');}finally{if(fd!==undefined)closeSync(fd);}
}
function durableWrite(directory:string,name:string,value:unknown,assertWriter:()=>void){
 assertWriter();safeDirectory(directory);const destination=join(directory,name);if(existsSync(destination))readPrivate(destination);
 const temporary=join(directory,'.sync-'+randomUUID()+'.tmp');let fd:number|undefined;
 try{fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);writeFileSync(fd,JSON.stringify(value)+'\n','utf8');fsyncSync(fd);closeSync(fd);fd=undefined;assertWriter();renameSync(temporary,destination);const dir=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(dir);}finally{closeSync(dir);}}
 catch(error){if(error instanceof PlatformError)throw error;return fail('SYNC_JOURNAL_IO');}
 finally{if(fd!==undefined)closeSync(fd);if(existsSync(temporary))unlinkSync(temporary);}
}
/** The original shared native writer must remain held. This journal supplies
 * durability, not another Apple writer lock or an iPhone concurrency lock. */
export class SyncJournal{
 readonly directory:string;readonly binding:BridgeBinding;private assertWriter?:()=>void;
 private constructor(directory:string,binding:BridgeBinding,assertWriter?:()=>void){this.directory=directory;this.binding=binding;this.assertWriter=assertWriter;}
 static open(directory:string,binding:BridgeBinding,options:{create?:boolean;assertWriter?:()=>void}={}):SyncJournal{
  const expected=bindingValue(binding),verify=()=>{if(!options.assertWriter)return fail('SYNC_SHARED_WRITER_REQUIRED');options.assertWriter();};
  if(!existsSync(directory)){if(!options.create)fail('SYNC_JOURNAL_CORRUPT');verify();mkdirSync(directory,{mode:0o700});}
  safeDirectory(directory);directory=realpathSync(directory);syncDirectory(dirname(directory));
  const header=join(directory,'binding.json'),intents=join(directory,'intents');
  if(!existsSync(header)){if(!options.create||readdirSync(directory).length!==0)fail('SYNC_JOURNAL_CORRUPT');verify();durableWrite(directory,'binding.json',{format:'lifeos.apple-sync.journal.v2',binding:expected,bindingHash:canonicalDigest(expected)},verify);mkdirSync(intents,{mode:0o700});syncDirectory(directory);}
  const meta=readPrivate(header) as Record<string,unknown>;
  if(!keys(meta,['format','binding','bindingHash'])||meta.format!=='lifeos.apple-sync.journal.v2'||meta.bindingHash!==canonicalDigest(meta.binding))fail('SYNC_JOURNAL_CORRUPT');
  if(!same(meta.binding,expected))fail('SYNC_JOURNAL_BINDING');safeDirectory(intents);return new SyncJournal(directory,Object.freeze(expected),options.assertWriter);
 }
 private writable(){if(!this.assertWriter)fail('SYNC_SHARED_WRITER_REQUIRED');this.assertWriter!();}
 private persist(record:JournalRecord){this.writable();durableWrite(join(this.directory,'intents'),record.id+'.json',{record,hash:canonicalDigest(record)},()=>this.writable());return copy(record);}
 get(id:string):JournalRecord{
  if(!hash(id))fail('SYNC_JOURNAL_INTENT');safeDirectory(this.directory);safeDirectory(join(this.directory,'intents'));
  const envelope=readPrivate(join(this.directory,'intents',id+'.json')) as Record<string,unknown>,r=envelope?.record as JournalRecord;
  try{
   if(!keys(envelope,['record','hash'])||!keys(r,recordKeys)||envelope.hash!==canonicalDigest(r)||r.format!=='lifeos.apple-sync.intent.v2'||r.id!==id||!same(r.binding,this.binding)||!Number.isSafeInteger(r.sequence)||r.sequence<0)fail('SYNC_JOURNAL_CORRUPT');
   const d=validateActiveDelivery(r.originalDelivery);if(d.phase!=='issued'||r.id!==canonicalDigest({binding:r.binding,attemptId:d.attemptId})||!same(r.intent,d.intent)||r.intentHash!==d.intentHash||d.intent.target&&d.intent.target.storeEpoch!==r.binding.storeEpoch)fail('SYNC_JOURNAL_CORRUPT');
   const {storeEpoch:_,...owner}=r.binding;if(!same(owner,d.binding)||!same(r.claimRequest,{key:command('claim',id),body:claimBody(d)}))fail('SYNC_JOURNAL_CORRUPT');
   if(!['prepared','claim-pending','claimed','retiring','retired','applying','unknown','native-verified','acknowledged','blocked'].includes(r.phase))fail('SYNC_JOURNAL_CORRUPT');
   if(r.claim)claimValue(r,r.claim);
   if(['prepared','claim-pending','retiring','retired'].includes(r.phase)?r.claim!==null:r.claim===null)fail('SYNC_JOURNAL_CORRUPT');
   if((r.phase==='retiring'||r.phase==='retired')!==(r.retireRequest!==null)||r.phase==='retired'!==(r.retireResult!==null))fail('SYNC_JOURNAL_CORRUPT');
   if(r.retireRequest){const q=r.retireRequest;if(!keys(q,['key','body'])||q.key!==command('retire',id)||!keys(q.body,['attemptId','intentHash','expectedDeliveryVersion','observation'])||!same({attemptId:q.body.attemptId,intentHash:q.body.intentHash,expectedDeliveryVersion:q.body.expectedDeliveryVersion},claimBody(d)))fail('SYNC_JOURNAL_CORRUPT');this.validateRetirementObservation(q.body.observation);}
   if(r.retireResult)this.retirementValue(r,r.retireResult);
   if(r.nativeReadback!==null){proofValue(r,r.nativeReadback);if(r.nativeHash!==canonicalDigest(r.nativeReadback))fail('SYNC_JOURNAL_CORRUPT');}else if(r.nativeHash!==null)fail('SYNC_JOURNAL_CORRUPT');
   if(['native-verified','acknowledged'].includes(r.phase)!==(r.nativeReadback!==null))fail('SYNC_JOURNAL_CORRUPT');
   if(r.receiptRequest){if(!r.nativeReadback||!r.claim)fail('SYNC_JOURNAL_CORRUPT');const caps=validateDeliveryCapabilities(r.receiptRequest.body.capabilities);if(!same(r.receiptRequest,this.receiptRequest(r,caps)))fail('SYNC_JOURNAL_CORRUPT');}
   if(r.serverReceipt){if(!r.receiptRequest)fail('SYNC_JOURNAL_CORRUPT');receiptValue(r,r.serverReceipt);if(!same(r.ackRequest,this.ackRequest(r,r.serverReceipt)))fail('SYNC_JOURNAL_CORRUPT');}else if(r.ackRequest!==null)fail('SYNC_JOURNAL_CORRUPT');
   if(r.ackReceiptHash!==null&&!hash(r.ackReceiptHash)||r.phase==='acknowledged'&&(!r.serverReceipt||r.ackReceiptHash!==r.serverReceipt.acknowledgement.receiptHash)||r.phase!=='acknowledged'&&r.ackReceiptHash!==null)fail('SYNC_JOURNAL_CORRUPT');
   if(r.reason!==null&&!['native-transport','native-readback','claimed-precondition','claim-authority'].includes(r.reason))fail('SYNC_JOURNAL_CORRUPT');return copy(r);
  }catch{return fail('SYNC_JOURNAL_CORRUPT');}
 }
 list():JournalRecord[]{safeDirectory(join(this.directory,'intents'));return readdirSync(join(this.directory,'intents')).filter(name=>!/^\.sync-[0-9a-f-]+\.tmp$/.test(name)).sort().map(name=>{if(!/^[0-9a-f]{64}\.json$/.test(name))fail('SYNC_JOURNAL_CORRUPT');return this.get(name.slice(0,-5));});}
 prepare(input:ActiveDelivery):JournalRecord{
  this.writable();const delivery=validateActiveDelivery(input),{storeEpoch:_,...owner}=this.binding;
  if(!same(delivery.binding,owner)||delivery.intent.target&&delivery.intent.target.storeEpoch!==this.binding.storeEpoch)fail('SYNC_JOURNAL_BINDING');
  const prior=this.list().find(r=>r.originalDelivery.attemptId===delivery.attemptId||r.intent.mutationId===delivery.intent.mutationId);
  if(prior){const original=prior.originalDelivery;if(delivery.attemptId!==original.attemptId||!same({...delivery,phase:'issued',version:original.version,claim:null,receipt:null,retirement:null},original))fail('SYNC_JOURNAL_COMMAND_CONFLICT');return prior;}
  if(delivery.phase!=='issued')fail('SYNC_JOURNAL_HISTORY_REQUIRED');
  const id=canonicalDigest({binding:this.binding,attemptId:delivery.attemptId});
  return this.persist({format:'lifeos.apple-sync.intent.v2',id,binding:copy(this.binding),originalDelivery:delivery,intent:delivery.intent,intentHash:delivery.intentHash,sequence:0,phase:'prepared',claimRequest:{key:command('claim',id),body:claimBody(delivery)},claim:null,retireRequest:null,retireResult:null,nativeReadback:null,nativeHash:null,receiptRequest:null,serverReceipt:null,ackRequest:null,ackReceiptHash:null,reason:null});
 }
 markClaimRequested(id:string):JournalRecord{this.writable();const r=this.get(id);if(r.phase==='claim-pending')return r;if(r.phase!=='prepared'||r.retireRequest)fail('SYNC_JOURNAL_TRANSITION');return this.persist({...r,sequence:r.sequence+1,phase:'claim-pending'});}
 saveClaim(id:string,input:DeliveryClaim):JournalRecord{this.writable();const r=this.get(id),c=claimValue(r,input);if(r.claim){if(!same(r.claim,c))fail('SYNC_CLAIM_MISMATCH');return r;}if(r.phase!=='claim-pending')fail('SYNC_JOURNAL_TRANSITION');return this.persist({...r,sequence:r.sequence+1,phase:'claimed',claim:c});}
 markApplying(id:string):JournalRecord{this.writable();const r=this.get(id);if(r.phase!=='claimed'||!r.claim)fail('SYNC_JOURNAL_TRANSITION');return this.persist({...r,sequence:r.sequence+1,phase:'applying'});}
 markBlocked(id:string,reason:'claimed-precondition'|'claim-authority'):JournalRecord{this.writable();const r=this.get(id);if(r.phase!=='claimed'&&r.phase!=='blocked')fail('SYNC_JOURNAL_TRANSITION');return this.persist({...r,sequence:r.sequence+1,phase:'blocked',reason});}
 markUnknown(id:string,reason:'native-transport'|'native-readback'):JournalRecord{this.writable();const r=this.get(id);if(!['applying','unknown'].includes(r.phase))fail('SYNC_JOURNAL_TRANSITION');if(r.phase==='unknown'&&r.reason===reason)return r;return this.persist({...r,sequence:r.sequence+1,phase:'unknown',reason});}
 private validateRetirementObservation(input:RetireBody['observation']){if(!keys(input,['identity','fields','capabilities']))fail('SYNC_NATIVE_PRECONDITION');return{identity:validateDeliveryIdentity(input.identity),fields:validateDeliveryFields(input.fields),capabilities:validateDeliveryCapabilities(input.capabilities)};}
 prepareRetirement(id:string,input:RetireBody['observation']):JournalRecord{
  this.writable();const r=this.get(id);if(r.phase==='retiring')return r;if(r.phase!=='prepared'||r.claim)fail('SYNC_JOURNAL_TRANSITION');const observation=this.validateRetirementObservation(input);
  if(!r.intent.target||!same(observation.identity,r.intent.target)||observation.identity.storeEpoch!==r.binding.storeEpoch)fail('SYNC_NATIVE_PRECONDITION');
  return this.persist({...r,sequence:r.sequence+1,phase:'retiring',retireRequest:{key:command('retire',id),body:{...claimBody(r.originalDelivery),observation}}});
 }
 private retirementValue(r:JournalRecord,result:RetireResult):RetireResult{
  if(!keys(result,['delivery','reconciliation'])||!keys(result.reconciliation,['status','entityId','revision'])||!r.retireRequest)fail('SYNC_RETIRE_MISMATCH');const d=validateActiveDelivery(result.delivery);
  if(d.phase!=='retired-unapplied'||d.attemptId!==r.originalDelivery.attemptId||d.intentHash!==r.intentHash||!same(d.intent,r.intent)||!same(d.binding,r.originalDelivery.binding)||BigInt(d.version)!==BigInt(r.originalDelivery.version)+1n||d.retirement?.commandKey!==r.retireRequest.key||!same(d.retirement.observation,{identity:r.retireRequest.body.observation.identity,fields:r.retireRequest.body.observation.fields})||result.reconciliation.entityId!==r.intent.entityId||!Number.isInteger(result.reconciliation.revision)||result.reconciliation.revision<1||!['applied','unchanged','conflict','unsupported'].includes(result.reconciliation.status))fail('SYNC_RETIRE_MISMATCH');return copy(result);
 }
 saveRetirement(id:string,input:RetireResult):JournalRecord{this.writable();const r=this.get(id);if(r.phase!=='retiring'&&r.phase!=='retired')fail('SYNC_JOURNAL_TRANSITION');const result=this.retirementValue(r,input);if(r.retireResult){if(!same(r.retireResult,result))fail('SYNC_RETIRE_MISMATCH');return r;}return this.persist({...r,sequence:r.sequence+1,phase:'retired',retireResult:result});}
 verifyNative(id:string,input:NativeReadback):JournalRecord{
  this.writable();const r=this.get(id);if(!['applying','unknown','native-verified'].includes(r.phase))fail('SYNC_JOURNAL_TRANSITION');const proof=proofValue(r,input),nativeHash=canonicalDigest(proof);
  if(r.phase==='native-verified'){if(r.nativeHash!==nativeHash)fail('SYNC_NATIVE_READBACK_MISMATCH');return r;}return this.persist({...r,sequence:r.sequence+1,phase:'native-verified',nativeReadback:proof,nativeHash,reason:null});
 }
 private receiptRequest(r:JournalRecord,capabilities:NativeCapabilities):DurableRequest<ReceiptBody>{if(!r.claim||!r.nativeReadback)fail('SYNC_JOURNAL_TRANSITION');return{key:command('receipt',r.id),body:{attemptId:r.originalDelivery.attemptId,intentHash:r.intentHash,expectedDeliveryVersion:r.claim.claimVersion,claimId:r.claim.claimId,proof:r.nativeReadback,capabilities}};}
 prepareReceipt(id:string,input:NativeCapabilities):JournalRecord{this.writable();const r=this.get(id);if(r.phase!=='native-verified')fail('SYNC_JOURNAL_TRANSITION');if(r.receiptRequest)return r;return this.persist({...r,sequence:r.sequence+1,receiptRequest:this.receiptRequest(r,validateDeliveryCapabilities(input))});}
 private ackRequest(r:JournalRecord,input:ServerReceipt):DurableRequest<AckBody>{return{key:command('ack',input.receipt.receiptHash),body:{receiptKey:input.receipt.receiptKey,attemptId:r.originalDelivery.attemptId,acknowledgement:input.acknowledgement}};}
 saveServerReceipt(id:string,input:ServerReceipt):JournalRecord{this.writable();const r=this.get(id);if(!['native-verified','acknowledged'].includes(r.phase)||!r.receiptRequest)fail('SYNC_JOURNAL_TRANSITION');const receipt=receiptValue(r,input);if(r.serverReceipt){if(!same(r.serverReceipt,receipt))fail('SYNC_RECEIPT_MISMATCH');return r;}return this.persist({...r,sequence:r.sequence+1,serverReceipt:receipt,ackRequest:this.ackRequest(r,receipt)});}
 acknowledge(id:string,ack:NativeAcknowledgement):JournalRecord{this.writable();const r=this.get(id);if(!['native-verified','acknowledged'].includes(r.phase))fail('SYNC_JOURNAL_TRANSITION');assertNativeAcknowledgement(r,ack);if(!r.serverReceipt||!r.ackRequest||!same(r.serverReceipt.acknowledgement,ack))fail('SYNC_ACK_RECEIPT_REQUIRED');if(r.phase==='acknowledged')return r;return this.persist({...r,sequence:r.sequence+1,phase:'acknowledged',ackReceiptHash:ack.receiptHash,reason:null});}
}
