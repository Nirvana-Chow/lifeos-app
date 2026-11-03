import {PlatformError} from '../../src/platform/domain.ts';
import {canonicalDigest} from '../../src/apple-sync-candidate/domain.ts';
import {assertDeliveryTransition,validateDeliveryCommandArchive} from '../../src/apple-sync-candidate/delivery-domain.ts';
import {MemoryPort} from './platform.ts';
import {CalendarMemoryPort} from '../calendar-candidate-helpers.test.ts';
import type {SyncRepository,SyncTransaction,SyncPrincipal,SyncMapping,SyncLease,SyncCommandReceipt,SyncOutboxItem,SyncConflict,ActiveDelivery} from '../../src/apple-sync-candidate/store-contracts.ts';
import type {PersonalConfig} from '../../src/personal-candidate/config.ts';
import type {FieldObservations,NativeCapabilities,NativeIdentity} from '../../src/apple-sync-candidate/contracts.ts';
export const syntheticPersonalConfig:PersonalConfig={ownerId:'synthetic-owner',ownerEmail:'owner@example.invalid',spaceId:'synthetic-space',databaseName:'lifeos_platform_test_local',allowedTypes:['todo','journal'],approval:'personal-manual-v1',baseURL:'https://lifeos.example.invalid'};
export const syntheticPrincipal:SyncPrincipal={ownerId:syntheticPersonalConfig.ownerId,spaceId:syntheticPersonalConfig.spaceId,bridgeId:'synthetic-mac',identityEpoch:'epoch-one',scopes:['sync:read','sync:write']};
export const syntheticNativeIdentity:NativeIdentity={storeEpoch:'store-one',sourceId:'account-one',containerId:'list-one',itemId:'native-one',externalId:null,aliases:[],seriesId:null,originalOccurrenceDate:null};
export const syntheticCapabilities:NativeCapabilities={protocolVersion:1,adapterId:'synthetic',adapterVersion:'1',platform:'synthetic',fullSnapshot:{reminder:true,event:true},writableFields:{reminder:['title','notes','dueOn','status'],event:['title','notes','schedule','status']},preserveUnchanged:true,scopes:['single'],nativeEventCancellationWrite:false,invitationWrite:false};
export const syntheticTodoFields=(title='Synthetic title',notes='Synthetic notes',status='open'):FieldObservations=>({title:{kind:'known',value:title},notes:{kind:'known',value:notes},dueOn:{kind:'known',value:null},status:{kind:'known',value:status}});
function fail(code:string):never{throw new PlatformError(409,code,code);}
/** Synthetic storage port, not PostgreSQL/capture evidence. Outbox must be
 * manually seeded by each test. Real business services own all CRUD validation. */
export class SyncMemory implements SyncRepository{
 platform=new MemoryPort();calendar=new CalendarMemoryPort();mappings=new Map<string,SyncMapping>();receipts=new Map<string,SyncCommandReceipt>();conflicts:SyncConflict[]=[];outbox:SyncOutboxItem[]=[];
 lease:SyncLease={ownerId:syntheticPrincipal.ownerId,spaceId:syntheticPrincipal.spaceId,bridgeId:syntheticPrincipal.bridgeId,identityEpoch:syntheticPrincipal.identityEpoch,fence:'1',expiresAt:'2099-01-01T00:00:00.000Z',ackCursor:'0'};
 delivery:ActiveDelivery|null=null;failReceipt=false;failDelivery=false;private tail:Promise<unknown>=Promise.resolve();
 async transaction<T>(p:SyncPrincipal,key:string,fn:(tx:SyncTransaction)=>Promise<T>):Promise<T>{
  const run=async()=>{
   if(p.ownerId!==syntheticPrincipal.ownerId||p.spaceId!==syntheticPrincipal.spaceId)fail('SYNC_PRINCIPAL_INVALID');
   const saved=structuredClone({mappings:this.mappings,receipts:this.receipts,conflicts:this.conflicts,lease:this.lease,delivery:this.delivery,rows:this.platform.rows,history:this.platform.historyRows,commands:this.platform.receipts,events:this.platform.events,calendarRows:this.calendar.rows,calendarHistory:this.calendar.revisions,calendarCommands:this.calendar.receipts});
   const receiptKey=JSON.stringify([p.ownerId,p.spaceId,p.bridgeId,p.identityEpoch,key]);let verified=false;
   const write=()=>{if(!p.scopes.includes('sync:write')||!verified)fail('SYNC_SCOPE_REQUIRED');};
   const check=async(fence:string,now:string)=>{if(fence!==this.lease.fence||p.bridgeId!==this.lease.bridgeId||p.identityEpoch!==this.lease.identityEpoch||Date.parse(this.lease.expiresAt)<=Date.parse(now))fail('SYNC_LEASE_STALE');verified=true;return structuredClone(this.lease);};
   const tx:SyncTransaction={
    platform:this.platform,calendar:this.calendar,
    claimLease:async(now,ttl)=>{if(!p.scopes.includes('sync:write'))fail('SYNC_SCOPE_REQUIRED');if(p.bridgeId!==this.lease.bridgeId||p.identityEpoch!==this.lease.identityEpoch)fail('SYNC_BINDING_HANDOVER_DENIED');if(Date.parse(this.lease.expiresAt)<=Date.parse(now))this.lease.fence=String(BigInt(this.lease.fence)+1n);this.lease.expiresAt=new Date(Date.parse(now)+ttl*1000).toISOString();verified=true;return structuredClone(this.lease);},requireLease:check,
    pull:async(after,limit)=>structuredClone(this.outbox.filter(o=>BigInt(o.cursor)>BigInt(after)).slice(0,limit)),
    receipt:async()=>structuredClone(this.receipts.get(receiptKey)??null),
    saveReceipt:async r=>{write();if(this.failReceipt)throw Error('synthetic receipt failure');const old=this.receipts.get(receiptKey);if(old&&canonicalDigest(old)!==canonicalDigest(r))fail('SYNC_COMMAND_REPLAY_MISMATCH');this.receipts.set(receiptKey,structuredClone(r));},
    getMapping:async id=>structuredClone(this.mappings.get(id)??null),findMapping:async(kind,id)=>structuredClone([...this.mappings.values()].find(m=>m.kind===kind&&m.entityId===id&&m.bridgeId===p.bridgeId)??null),
    saveMapping:async(m,version)=>{write();if((this.mappings.get(m.id)?.version??null)!==version)fail('SYNC_MAPPING_CAS');this.mappings.set(m.id,structuredClone(m));},saveConflict:async c=>{write();this.conflicts.push(structuredClone(c));},
    advanceCursor:async(fence,cursor,now)=>{write();await check(fence,now);if(cursor!==this.lease.ackCursor&&this.outbox.find(o=>BigInt(o.cursor)>BigInt(this.lease.ackCursor))?.cursor!==cursor)fail('SYNC_ACK_NOT_NEXT');this.lease.ackCursor=cursor;return structuredClone(this.lease);},
    readDelivery:async()=>structuredClone(this.delivery),
    saveDelivery:async(version,next)=>{write();const receipt=this.receipts.get(receiptKey);if(!receipt)fail('SYNC_DELIVERY_ARCHIVE');const archive=validateDeliveryCommandArchive(receipt.result);if(canonicalDigest(archive.delivery)!==canonicalDigest(next))fail('SYNC_DELIVERY_ARCHIVE');assertDeliveryTransition(this.delivery,version,next);if(this.failDelivery)throw Error('synthetic delivery failure');this.delivery=structuredClone(next);},
   };
   try{return await fn(tx);}catch(error){this.mappings=saved.mappings;this.receipts=saved.receipts;this.conflicts=saved.conflicts;this.lease=saved.lease;this.delivery=saved.delivery;this.platform.rows=saved.rows;this.platform.historyRows=saved.history;this.platform.receipts=saved.commands;this.platform.events=saved.events;this.calendar.rows=saved.calendarRows;this.calendar.revisions=saved.calendarHistory;this.calendar.receipts=saved.calendarCommands;throw error;}
  };
  const result=this.tail.then(run);this.tail=result.catch(()=>undefined);return result;
 }
}
