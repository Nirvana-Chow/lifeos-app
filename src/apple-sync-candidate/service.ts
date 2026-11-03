import {randomUUID} from 'node:crypto';
import {PlatformError,object,validateId,validateIdempotencyKey,validateRevision,validateTodo,type TodoDraft} from '../platform/domain.ts';
import {PersonalService} from '../personal-candidate/service.ts';
import type {PersonalConfig} from '../personal-candidate/config.ts';
import {CalendarService} from '../calendar-candidate/service.ts';
import {validateCalendarDraft} from '../calendar-candidate/domain.ts';
import type {PublicEntry} from '../platform/contracts.ts';
import type {PublicCalendarEntry} from '../calendar-candidate/contracts.ts';
import {canonicalDigest,validateObservations,validateNativeIdentity,validateCapabilities} from './domain.ts';
import {mergeFields,checkWriteCapabilities} from './reconcile.ts';
import type {FieldObservations,JsonValue,NativeIdentity,NativeCapabilities} from './contracts.ts';
import type {SyncRepository,SyncTransaction,SyncPrincipal,SyncMapping,SyncOutboxItem,ActiveDelivery,DeliveryCommandArchive,DeliveryReceipt} from './store-contracts.ts';
import {validateActiveDelivery,validateDeliveryCommandArchive,validateDeliveryCounter,validateDeliveryFields,validateDeliveryIdentity,validateDeliveryCapabilities,assertDeliveryBinding,assertDeliveryClaimAuthority} from './delivery-domain.ts';
import type {BridgeIntent,NativeReadback,NativeAcknowledgement} from './journal.ts';

function fail(code:string,status=409):never{throw new PlatformError(status,code,'同步候选请求未通过。');}
const copyJSON=(value:unknown):JsonValue=>{canonicalDigest(value);return structuredClone(value) as JsonValue;};
const exact=(input:unknown,keys:readonly string[]):Record<string,unknown>=>{canonicalDigest(input);const result=object(input,keys);if(Object.keys(result).length!==keys.length)fail('SYNC_INPUT_INVALID',400);return result;};
const decimal=(value:unknown):string=>{if(typeof value!=='string'||! /^(0|[1-9]\d{0,39})$/.test(value))fail('SYNC_CURSOR_INVALID',400);return value as string;};
const hash=(value:unknown):string=>{if(typeof value!=='string'||! /^[a-f0-9]{64}$/.test(value))fail('SYNC_HASH_INVALID',400);return value as string;};
const known=(value:JsonValue)=>({kind:'known' as const,value});
const keysFor=(kind:'todo'|'calendar')=>kind==='todo'?['title','notes','dueOn','status']:['title','notes','schedule','status'];
const same=(a:unknown,b:unknown)=>canonicalDigest(a)===canonicalDigest(b);
/** A renewed lease changes transport authority, not an immutable command.
 * Call only after requireLease; identity epochs remain part of command identity. */
function commandDigest(p:SyncPrincipal,operation:string,input:unknown):string{
 const {fence,...payload}=input as Record<string,unknown>;void fence;
 return canonicalDigest({operation,binding:{ownerId:p.ownerId,spaceId:p.spaceId,bridgeId:p.bridgeId,identityEpoch:p.identityEpoch},payload});
}
/** Pending receipts pin the mapping version until their exact ACK commits.
 * New commands must wait; successful command replays return before this gate. */
function assertNoPendingAck(mapping:SyncMapping):void{
 const evidence=mapping.evidence;
 if(evidence&&typeof evidence==='object'&&!Array.isArray(evidence)&&Object.hasOwn(evidence,'pending'))fail('SYNC_PENDING_ACK');
}
function nativeMappingId(p:SyncPrincipal,kind:'todo'|'calendar',id:NativeIdentity):string{
 const digest=canonicalDigest({owner:p.ownerId,space:p.spaceId,bridge:p.bridgeId,kind,storeEpoch:id.storeEpoch,source:id.sourceId,container:id.containerId,item:id.itemId,occurrence:id.originalOccurrenceDate});
 return digest.slice(0,8)+'-'+digest.slice(8,12)+'-5'+digest.slice(13,16)+'-a'+digest.slice(17,20)+'-'+digest.slice(20,32);
}
function projected(kind:'todo'|'calendar',entry:PublicEntry|PublicCalendarEntry):FieldObservations{
 if(kind==='todo'){const d=validateTodo((entry as PublicEntry).draft);return {title:known(d.title),notes:known(d.notes),dueOn:known(d.dueOn),status:known(d.status)};}
 const e=entry as PublicCalendarEntry,d=validateCalendarDraft({title:e.title,notes:e.notes,schedule:e.schedule});return {title:known(d.title),notes:known(d.notes),schedule:known(copyJSON(d.schedule)),status:known(e.status)};
}
/** Extra/unknown native fields remain evidence, never inferred to be empty. */
function unsupported(kind:'todo'|'calendar',fields:FieldObservations,identity:NativeIdentity):string[]{
 const keys=keysFor(kind),reasons:string[]=[];
 for(const key of new Set([...keys,...Object.keys(fields)]))if(!keys.includes(key)||fields[key]?.kind!=='known')reasons.push(key);
 if(identity.seriesId!==null||identity.originalOccurrenceDate!==null)reasons.push('recurrence-scope');
 const state=fields.status;if(state?.kind==='known'&&!(kind==='todo'?['open','done']:['planned']).includes(String(state.value)))reasons.push('terminal-status');
 // All-day date or explicit absence only; native date components are not coerced.
 if(kind==='todo'&&fields.dueOn?.kind==='known'&&fields.dueOn.value!==null&&(typeof fields.dueOn.value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(fields.dueOn.value)))reasons.push('dueOn');
 return [...new Set(reasons)];
}
function values(fields:FieldObservations):Record<string,JsonValue>{return Object.fromEntries(Object.entries(fields).map(([key,value])=>{if(value.kind!=='known')fail('SYNC_UNKNOWN_FIELD');return [key,value.value];}));}
type ObservationInput={fence:string;kind:'todo'|'calendar';mappingId:string|null;entityId:string|null;sourceId:string|null;expectedRevision:number|null;identity:NativeIdentity;fields:FieldObservations;capabilities:NativeCapabilities};
function observationInput(input:unknown):ObservationInput{
 const o=exact(input,['fence','kind','mappingId','entityId','sourceId','expectedRevision','identity','fields','capabilities']);
 if(o.kind!=='todo'&&o.kind!=='calendar')fail('SYNC_KIND_INVALID',400);
 const mappingId=o.mappingId===null?null:validateId(o.mappingId),entityId=o.entityId===null?null:validateId(o.entityId),sourceId=o.sourceId===null?null:validateId(o.sourceId),expectedRevision=o.expectedRevision===null?null:validateRevision(o.expectedRevision);
 if((entityId===null)!==(sourceId===null)||(entityId===null)!==(expectedRevision===null)||mappingId!==null&&entityId===null)fail('SYNC_BINDING_INVALID',400);
 return {fence:decimal(o.fence),kind:o.kind as 'todo'|'calendar',mappingId,entityId,sourceId,expectedRevision,identity:validateNativeIdentity(o.identity),fields:validateObservations(o.fields),capabilities:validateCapabilities(o.capabilities)};
}
export class AppleSyncService{
 private readonly repository:SyncRepository;private readonly personal:PersonalConfig;private readonly assertWritable:()=>Promise<void>;private readonly now:()=>Date;
 constructor(options:{repository:SyncRepository;personal:PersonalConfig;assertWritable?:()=>Promise<void>;now?:()=>Date}){this.repository=options.repository;this.personal=structuredClone(options.personal);this.assertWritable=options.assertWritable??(async()=>fail('SYNC_WRITES_LOCKED',503));this.now=options.now??(()=>new Date());}
 private principal(p:SyncPrincipal,write:boolean){
  if(!p||p.ownerId!==this.personal.ownerId||p.spaceId!==this.personal.spaceId||typeof p.bridgeId!=='string'||! /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(p.bridgeId)||typeof p.identityEpoch!=='string'||! /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(p.identityEpoch)||!Array.isArray(p.scopes)||p.scopes.some(s=>s!=='sync:read'&&s!=='sync:write')||!p.scopes.includes('sync:read')||write&&!p.scopes.includes('sync:write'))fail('SYNC_PRINCIPAL_DENIED',403);
 }
 private bound(p:SyncPrincipal,m:SyncMapping){if(m.ownerId!==p.ownerId||m.spaceId!==p.spaceId||m.bridgeId!==p.bridgeId)fail('SYNC_MAPPING_BINDING');}
 private async get(tx:SyncTransaction,p:SyncPrincipal,kind:'todo'|'calendar',id:string){return kind==='todo'?new PersonalService(tx.platform,this.personal).get(p.ownerId,'todo',id):new CalendarService(tx.calendar).get(p.ownerId,id);}
 private async active(tx:SyncTransaction,p:SyncPrincipal):Promise<ActiveDelivery|null>{const raw=await tx.readDelivery();if(!raw)return null;const d=validateActiveDelivery(raw);assertDeliveryBinding(d,p);return d;}
 private async archive(tx:SyncTransaction,digest:string,operation:DeliveryCommandArchive['operation'],previous:ActiveDelivery|null,next:ActiveDelivery,response:unknown):Promise<JsonValue>{
  const archive=validateDeliveryCommandArchive({format:'lifeos.apple-sync.delivery-command.v1',operation,delivery:next,response:copyJSON(response)});
  await this.assertWritable();await tx.saveReceipt({digest,result:copyJSON(archive)});await tx.saveDelivery(previous?.version??null,archive.delivery);return archive.response;
 }
 private references(d:ActiveDelivery|null,o:Record<string,unknown>):ActiveDelivery{
  validateId(o.attemptId);hash(o.intentHash);validateDeliveryCounter(o.expectedDeliveryVersion);
  if(!d||d.attemptId!==o.attemptId||d.intentHash!==o.intentHash||d.version!==o.expectedDeliveryVersion)fail('SYNC_DELIVERY_CAS');return d;
 }
 async dispatch(p:SyncPrincipal,operation:string,input:unknown,key:string):Promise<JsonValue>{
  const write=!['capabilities','preview','pull'].includes(operation);this.principal(p,write);validateIdempotencyKey(key);
  const observationShape=['fence','kind','mappingId','entityId','sourceId','expectedRevision','identity','fields','capabilities'];
  const shapes:Record<string,readonly string[]>={capabilities:[],lease:['ttlSeconds'],pull:['fence','after','limit'],preview:observationShape,observation:observationShape,prepare:['fence','cursor','expectedDeliveryVersion'],claim:['fence','attemptId','intentHash','expectedDeliveryVersion'],'authorize-save':['fence','attemptId','intentHash','claimId','claimVersion','executionFence'],retire:['fence','attemptId','intentHash','expectedDeliveryVersion','observation'],receipt:['fence','attemptId','intentHash','expectedDeliveryVersion','claimId','proof','capabilities'],ack:['fence','receiptKey','attemptId','acknowledgement']};
  if(!Object.hasOwn(shapes,operation))fail('SYNC_OPERATION_DENIED',404);const o=exact(input,shapes[operation]);
  if(operation==='capabilities')return {protocolVersion:1,candidateOnly:true,liveEnabled:false,supportedFields:{todo:keysFor('todo'),calendar:keysFor('calendar')},unsupported:['native-date-components','recurrence','alarms','invitations','cancellation','deletion'],operations:Object.keys(shapes)};
  if(write)await this.assertWritable();
  return this.repository.transaction(p,key,async tx=>{
   const now=this.now().toISOString();
   if(operation==='lease'){if(!Number.isInteger(o.ttlSeconds)||(o.ttlSeconds as number)<5||(o.ttlSeconds as number)>300)fail('SYNC_LEASE_TTL_INVALID',400);await this.assertWritable();return copyJSON(await tx.claimLease(now,o.ttlSeconds as number));}
   const fence=decimal(o.fence),lease=await tx.requireLease(fence,now),digest=commandDigest(p,operation,input);
   // The live authority gate precedes historical replay. Replays never restore slots.
   if(write&&operation!=='authorize-save'){const prior=await tx.receipt();if(prior){if(prior.digest!==digest)fail('SYNC_COMMAND_CONFLICT');const r=prior.result;if(r&&typeof r==='object'&&!Array.isArray(r)&&r.format==='lifeos.apple-sync.delivery-command.v1')return validateDeliveryCommandArchive(r).response;return r;}}
   if(operation==='pull'){
    if(decimal(o.after)!==lease.ackCursor||!Number.isInteger(o.limit)||(o.limit as number)<1||(o.limit as number)>100)fail('SYNC_PULL_INVALID',400);
    const items=(await tx.pull(lease.ackCursor,1)).map(({cursor,kind,entityId,sourceId,revision})=>({cursor,kind,entityId,sourceId,revision})),d=await this.active(tx,p);
    return copyJSON({items,ackCursor:lease.ackCursor,delivery:d?{version:d.version,attemptId:d.attemptId,phase:d.phase,cursor:d.cursor,canonicalRevision:d.canonicalRevision,intentHash:d.intentHash}:null});
   }
   if(operation==='observation'||operation==='preview'){
    const result=await this.observe(tx,p,observationInput(input),operation,key,now,false);if(write){await this.assertWritable();await tx.saveReceipt({digest,result});}return result;
   }
   const active=await this.active(tx,p);
   if(operation==='prepare'){
    const cursor=validateDeliveryCounter(o.cursor);if(o.expectedDeliveryVersion!==null)validateDeliveryCounter(o.expectedDeliveryVersion);
    if((active?.version??null)!==o.expectedDeliveryVersion)fail('SYNC_DELIVERY_CAS');
    const item=(await tx.pull(lease.ackCursor,1))[0];if(!item||item.cursor!==cursor)fail('SYNC_ACK_NOT_NEXT');
    if(active&&['issued','claimed','readback-verified'].includes(active.phase)){
     if(active.cursor!==cursor)fail('SYNC_DELIVERY_ACTIVE');const result=copyJSON({delivery:active});await tx.saveReceipt({digest,result});return result;
    }
    if(active?.phase==='retired-unapplied'&&active.retirement?.outcome!=='reconciled')fail('SYNC_UNRESOLVED_CONFLICT');
    const current=await this.get(tx,p,item.kind,item.entityId);if(current.source.id!==item.sourceId||current.revision<item.revision)fail('SYNC_SOURCE_BINDING');
    const mapping=await tx.findMapping(item.kind,item.entityId);if(mapping){this.bound(p,mapping);if(mapping.sourceId!==item.sourceId)fail('SYNC_SOURCE_BINDING');assertNoPendingAck(mapping);}
    const attemptId=randomUUID(),intent=this.intent(item,current,mapping,attemptId),next=validateActiveDelivery({format:'lifeos.apple-sync.delivery.v1',version:active?String(BigInt(active.version)+1n):'1',attemptId,binding:{ownerId:p.ownerId,spaceId:p.spaceId,bridgeId:p.bridgeId,identityEpoch:p.identityEpoch},phase:'issued',cursor,canonicalRevision:current.revision,intent,intentHash:canonicalDigest(intent),preparedMapping:mapping?{id:mapping.id,version:mapping.version}:null,claim:null,receipt:null,retirement:null});
    return this.archive(tx,digest,'prepare',active,next,{delivery:next});
   }
   if(operation==='authorize-save'){
    if(!active||!active.claim)fail('SYNC_DELIVERY_AUTHORITY');const c=active.claim;
    if(o.attemptId!==active.attemptId||o.intentHash!==active.intentHash||o.claimId!==c.claimId||o.claimVersion!==c.claimVersion||o.executionFence!==c.executionFence)fail('SYNC_DELIVERY_AUTHORITY');
    await this.assertWritable();assertDeliveryClaimAuthority(active,c,p,lease,now);return copyJSON({authorized:true,attemptId:active.attemptId,intentHash:active.intentHash,claimId:c.claimId,claimVersion:c.claimVersion,executionFence:c.executionFence});
   }
   if(operation==='ack')return this.ack(tx,p,o,key,digest,active,lease.ackCursor,now);
   // A second receipt key cannot replace a pending proof.
   if(operation==='receipt'&&active?.phase==='readback-verified')fail('SYNC_PENDING_ACK');
   const d=this.references(active,o),version=String(BigInt(d.version)+1n);
   if(operation==='claim'){
    if(d.phase!=='issued')fail('SYNC_DELIVERY_PHASE');const claim={claimId:randomUUID(),attemptId:d.attemptId,binding:d.binding,intentHash:d.intentHash,claimVersion:version,executionFence:fence};
    const next=validateActiveDelivery({...d,version,phase:'claimed',claim});return this.archive(tx,digest,'claim',d,next,{claim});
   }
   if(operation==='retire'){
    if(d.phase!=='issued'||d.intent.target===null)fail('SYNC_DELIVERY_PHASE');
    const preparedMapping=await tx.getMapping(d.preparedMapping!.id);if(!preparedMapping||preparedMapping.version!==d.preparedMapping!.version||preparedMapping.entityId!==d.intent.entityId||preparedMapping.sourceId!==d.intent.sourceId||!same(preparedMapping.nativeIdentity,d.intent.target))fail('SYNC_MAPPING_BINDING');this.bound(p,preparedMapping);
    const observation=exact(o.observation,['identity','fields','capabilities']),identity=validateDeliveryIdentity(observation.identity),fields=validateObservations(observation.fields),capabilities=validateDeliveryCapabilities(observation.capabilities);
    if(!same(identity,d.intent.target))fail('SYNC_MAPPING_BINDING');const kind=d.intent.kind==='reminder'?'todo':'calendar',current=await this.get(tx,p,kind,d.intent.entityId);
    const result=await this.observe(tx,p,{fence,kind,mappingId:d.preparedMapping!.id,entityId:d.intent.entityId,sourceId:d.intent.sourceId,expectedRevision:current.revision,identity,fields,capabilities},'observation',key,now,true) as Record<string,JsonValue>;
    const next=validateActiveDelivery({...d,version,phase:'retired-unapplied',retirement:{commandKey:key,reason:'native-precondition-changed',observation:{identity,fields},outcome:result.status==='applied'?'reconciled':'conflict',evidence:result}});
    return this.archive(tx,digest,'retire',d,next,{delivery:next,reconciliation:{status:result.status,entityId:result.entityId,revision:result.revision}});
   }
   return this.receipt(tx,p,o,key,digest,d,now);
  });
 }
 private async observe(tx:SyncTransaction,p:SyncPrincipal,o:ObservationInput,operation:'observation'|'preview',key:string,now:string,allowActive:boolean):Promise<JsonValue>{
   const active=allowActive?null:await this.active(tx,p);
   const block=(entityId:string)=>{if(active&&active.intent.entityId===entityId&&active.intent.kind===(o.kind==='todo'?'reminder':'event')&&['issued','claimed','readback-verified'].includes(active.phase))fail(active.phase==='readback-verified'?'SYNC_PENDING_ACK':'SYNC_DELIVERY_ACTIVE');};
   if(o.entityId)block(o.entityId);
   const nativeId=nativeMappingId(p,o.kind,o.identity),nativeMapping=await tx.getMapping(nativeId);
   if(nativeMapping){
    block(nativeMapping.entityId);this.bound(p,nativeMapping);if(nativeMapping.kind!==o.kind||!same(nativeMapping.nativeIdentity,o.identity)||o.entityId!==null&&o.entityId!==nativeMapping.entityId||o.sourceId!==null&&o.sourceId!==nativeMapping.sourceId||o.mappingId!==null&&o.mappingId!==nativeMapping.id)fail('SYNC_MAPPING_BINDING');
    assertNoPendingAck(nativeMapping);
    if(o.entityId===null){
     const observation=(nativeMapping.evidence as Record<string,JsonValue>).observation as Record<string,JsonValue>|undefined;
     if(!same(observation?.fields??nativeMapping.baseline,o.fields))fail('SYNC_MAPPING_REQUIRED');
     const result=copyJSON({status:'mapped',mappingId:nativeMapping.id,entityId:nativeMapping.entityId,revision:nativeMapping.businessRevision});return result;
    }
   }
   const mapping=o.mappingId?await tx.getMapping(o.mappingId):o.entityId?await tx.findMapping(o.kind,o.entityId):null;
   if(mapping){this.bound(p,mapping);if(mapping.kind!==o.kind||mapping.entityId!==o.entityId||mapping.sourceId!==o.sourceId||!same(mapping.nativeIdentity,o.identity))fail('SYNC_MAPPING_BINDING');assertNoPendingAck(mapping);}else if(o.mappingId)fail('SYNC_MAPPING_BINDING');
   const entry=o.entityId?await this.get(tx,p,o.kind,o.entityId):null;
   if(entry&&(entry.source.id!==o.sourceId||entry.revision!==o.expectedRevision))fail(entry.source.id!==o.sourceId?'SYNC_SOURCE_BINDING':'REVISION_CONFLICT');
   const server=entry?projected(o.kind,entry):{},base=mapping?.baseline??{};
   const merge=entry?mergeFields(base,server,o.fields):{fields:o.fields,toServer:o.fields,toNative:{},conflicts:[]};
   const reasons=unsupported(o.kind,o.fields,o.identity);if(entry)reasons.push(...unsupported(o.kind,server,o.identity).map(reason=>'server-'+reason));if(!o.capabilities.fullSnapshot[o.kind==='todo'?'reminder':'event'])reasons.push('incomplete-snapshot');
   const nativeWrite=checkWriteCapabilities(o.kind==='todo'?'reminder':'event',merge.toNative,o.capabilities);reasons.push(...nativeWrite.reasons);
   const evidence=copyJSON({identity:o.identity,base,server,native:o.fields,conflicts:merge.conflicts,unsupported:reasons});
   if(operation==='preview')return copyJSON({status:reasons.length||merge.conflicts.length?'conflict':'ready',merge,evidence,writesPerformed:0});
   let current=entry;const hasConflict=reasons.length>0||merge.conflicts.length>0;
   if(!reasons.length&&Object.keys(merge.toServer).length){
    await this.assertWritable();const patch=values(merge.toServer);
    if(o.kind==='todo'){
     const old=entry?(entry as PublicEntry).draft as TodoDraft:null;
     const result=await new PersonalService(tx.platform,this.personal).mutate(p.ownerId,'todo',o.entityId,{spaceId:p.spaceId,confirmed:true,fields:{...(old??{}),...patch},...(entry?{expectedRevision:entry.revision}:{})},key,()=>this.assertWritable());current=result.entry;
    }else{
     const service=new CalendarService(tx.calendar),{status,...draft}=patch;void status;
     current=entry?(await service.update(p.ownerId,entry.id,{...draft,expectedRevision:entry.revision},key)).entry:(await service.create(p.ownerId,draft,key)).entry;
    }
   }
   let mappingId=mapping?.id??null;
   if(current){mappingId??=nativeId;const updated:SyncMapping={id:mappingId,ownerId:p.ownerId,spaceId:p.spaceId,bridgeId:p.bridgeId,kind:o.kind,entityId:current.id,sourceId:current.source.id,version:(mapping?.version??0)+1,businessRevision:current.revision,nativeIdentity:o.identity,baseline:mapping?.baseline??{},nativeHash:mapping?.nativeHash??canonicalDigest({identity:o.identity,fields:{}}),status:hasConflict?'conflict':'active',evidence:copyJSON({observation:{identity:o.identity,fields:o.fields},detail:evidence})};await tx.saveMapping(updated,mapping?.version??null);}
   if(hasConflict)await tx.saveConflict({id:randomUUID(),mappingId,kind:'field-conflict',evidence,createdAt:now});
   const result=copyJSON({status:hasConflict?'conflict':'applied',mappingId,entityId:current?.id??null,revision:current?.revision??null,merge,evidence});return result;
 }
 private intent(item:SyncOutboxItem,current:PublicEntry|PublicCalendarEntry,mapping:SyncMapping|null,attemptId:string):BridgeIntent{
  if(mapping&&mapping.status!=='active')fail('SYNC_UNRESOLVED_CONFLICT');
  const expectedFields=validateDeliveryFields(projected(item.kind,current)),identity=mapping?.nativeIdentity??{storeEpoch:'unbound',sourceId:'unbound',containerId:'unbound',itemId:'unbound',externalId:null,aliases:[],seriesId:null,originalOccurrenceDate:null};
  if(unsupported(item.kind,expectedFields,identity).length)fail('SYNC_UNSUPPORTED_OUTBOX');
  const evidence=mapping?.evidence as Record<string,JsonValue>|undefined,observed=evidence?.observation as Record<string,JsonValue>|undefined;
  const nativeFields=mapping?validateDeliveryFields(observed?.fields??mapping.baseline):{};
  if(mapping&&unsupported(item.kind,nativeFields,identity).length)fail('SYNC_UNSUPPORTED_OUTBOX');
  const patch=Object.fromEntries(Object.entries(expectedFields).filter(([k,v])=>!nativeFields[k]||!same(v,nativeFields[k])));
  return {mutationId:'sync-'+attemptId,cursor:item.cursor,kind:item.kind==='todo'?'reminder':'event',operation:mapping?'update':'create',entityId:item.entityId,sourceId:item.sourceId,revision:current.revision,target:mapping?validateDeliveryIdentity(identity):null,expectedNativeHash:mapping?canonicalDigest({identity,fields:nativeFields}):null,patch,expectedFields,scope:'single'};
 }
 private async receipt(tx:SyncTransaction,p:SyncPrincipal,o:Record<string,unknown>,key:string,digest:string,d:ActiveDelivery,now:string):Promise<JsonValue>{
  void now;if(d.phase!=='claimed'||!d.claim||o.claimId!==d.claim.claimId)fail('SYNC_DELIVERY_PHASE');
  const raw=exact(o.proof,['mutationId','intentHash','identity','fields']),identity=validateDeliveryIdentity(raw.identity),fields=validateDeliveryFields(raw.fields),capabilities=validateDeliveryCapabilities(o.capabilities),intent=d.intent;
  if(raw.mutationId!==intent.mutationId||raw.intentHash!==d.intentHash||intent.target&&!same(intent.target,identity)||!same(fields,intent.expectedFields))fail('SYNC_NATIVE_READBACK_MISMATCH');
  const kind=intent.kind==='reminder'?'todo':'calendar';if(unsupported(kind,fields,identity).length||!capabilities.fullSnapshot[intent.kind]||!checkWriteCapabilities(intent.kind,intent.patch,capabilities).allowed)fail('SYNC_UNSUPPORTED_READBACK');
  const current=await this.get(tx,p,kind,intent.entityId);if(current.source.id!==intent.sourceId||current.revision<d.canonicalRevision)fail('SYNC_SOURCE_BINDING');
  const mapping=await tx.findMapping(kind,intent.entityId);if(mapping){this.bound(p,mapping);assertNoPendingAck(mapping);}
  if(d.preparedMapping?(!mapping||mapping.id!==d.preparedMapping.id||mapping.version!==d.preparedMapping.version||mapping.sourceId!==intent.sourceId||!same(mapping.nativeIdentity,identity)):mapping!==null)fail('SYNC_MAPPING_BINDING');
  const nativeId=nativeMappingId(p,kind,identity),existing=await tx.getMapping(nativeId);if(existing&&existing.id!==mapping?.id)fail('SYNC_MAPPING_BINDING');
  const proof:NativeReadback={mutationId:intent.mutationId,intentHash:d.intentHash,identity,fields},mappingId=mapping?.id??nativeId,mappingVersion=(mapping?.version??0)+1,version=String(BigInt(d.version)+1n);
  const body={receiptKey:key,attemptId:d.attemptId,binding:d.binding,intentHash:d.intentHash,claimId:d.claim.claimId,deliveryVersion:version,mappingId,mappingVersion,entityId:intent.entityId,sourceId:intent.sourceId,canonicalRevision:d.canonicalRevision,proof,nativeHash:canonicalDigest(proof)},receipt:DeliveryReceipt={...body,receiptHash:canonicalDigest(body)};
  const next=validateActiveDelivery({...d,version,phase:'readback-verified',receipt}),acknowledgement:NativeAcknowledgement={mutationId:intent.mutationId,cursor:d.cursor,nativeHash:receipt.nativeHash,receiptHash:receipt.receiptHash};
  await this.assertWritable();await tx.saveMapping({id:mappingId,ownerId:p.ownerId,spaceId:p.spaceId,bridgeId:p.bridgeId,kind,entityId:intent.entityId,sourceId:intent.sourceId,version:mappingVersion,businessRevision:Math.max(mapping?.businessRevision??0,d.canonicalRevision),nativeIdentity:identity,baseline:mapping?.baseline??{},nativeHash:mapping?.nativeHash??canonicalDigest({identity,fields:{}}),status:'active',evidence:copyJSON({pending:{attemptId:d.attemptId,key,receiptHash:receipt.receiptHash},observation:{identity,fields}})},mapping?.version??null);
  return this.archive(tx,digest,'receipt',d,next,{receipt,acknowledgement});
 }
 private async ack(tx:SyncTransaction,p:SyncPrincipal,o:Record<string,unknown>,key:string,digest:string,d:ActiveDelivery|null,ackCursor:string,now:string):Promise<JsonValue>{
  void key;validateIdempotencyKey(o.receiptKey);validateId(o.attemptId);const a=exact(o.acknowledgement,['mutationId','cursor','nativeHash','receiptHash']);validateIdempotencyKey(a.mutationId);decimal(a.cursor);hash(a.nativeHash);hash(a.receiptHash);
  if(!d||d.phase!=='readback-verified'||!d.receipt||d.attemptId!==o.attemptId||d.receipt.receiptKey!==o.receiptKey)fail('SYNC_ACK_MISMATCH');
  const r=d.receipt,acknowledgement:NativeAcknowledgement={mutationId:d.intent.mutationId,cursor:d.cursor,nativeHash:r.nativeHash,receiptHash:r.receiptHash};if(!same(a,acknowledgement))fail('SYNC_ACK_MISMATCH');
  const item=(await tx.pull(ackCursor,1))[0],mapping=await tx.getMapping(r.mappingId);if(!item||item.cursor!==d.cursor||!mapping||mapping.version!==r.mappingVersion||mapping.entityId!==r.entityId||mapping.sourceId!==r.sourceId||mapping.kind!==(d.intent.kind==='reminder'?'todo':'calendar')||!same(mapping.nativeIdentity,r.proof.identity))fail('SYNC_ACK_MISMATCH');this.bound(p,mapping);
  const current=await this.get(tx,p,mapping.kind,mapping.entityId);if(current.source.id!==r.sourceId||current.revision<d.canonicalRevision)fail('SYNC_SOURCE_BINDING');
  await this.assertWritable();await tx.saveMapping({...mapping,version:mapping.version+1,baseline:r.proof.fields,nativeHash:canonicalDigest({identity:r.proof.identity,fields:r.proof.fields}),status:'active',evidence:copyJSON({acknowledgement,observation:{identity:r.proof.identity,fields:r.proof.fields}})},mapping.version);await tx.advanceCursor(decimal(o.fence),d.cursor,now);
  const next=validateActiveDelivery({...d,version:String(BigInt(d.version)+1n),phase:'acknowledged'});return this.archive(tx,digest,'ack',d,next,{acknowledgement});
 }
}
