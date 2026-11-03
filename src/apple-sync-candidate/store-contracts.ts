import type {PlatformRepository} from '../platform/contracts.ts';
import type {CalendarRepository} from '../calendar-candidate/contracts.ts';
import type {NativeIdentity,FieldObservations,JsonValue} from './contracts.ts';
import type {BridgeIntent,NativeReadback} from './journal.ts';
/** Trusted authentication output; never populate from a request body. */
export interface SyncPrincipal {ownerId:string;spaceId:string;bridgeId:string;identityEpoch:string;scopes:readonly ('sync:read'|'sync:write')[]}
export interface SyncLease {ownerId:string;spaceId:string;bridgeId:string;identityEpoch:string;fence:string;expiresAt:string;ackCursor:string}
export interface SyncOutboxItem {cursor:string;kind:'todo'|'calendar';entityId:string;sourceId:string;revision:number;commandKey:string;snapshot:unknown}
export interface SyncMapping {id:string;ownerId:string;spaceId:string;bridgeId:string;kind:'todo'|'calendar';entityId:string;sourceId:string;version:number;businessRevision:number;nativeIdentity:NativeIdentity;baseline:FieldObservations;nativeHash:string;status:'active'|'conflict'|'missing';evidence:JsonValue}
export interface SyncCommandReceipt {digest:string;result:JsonValue}
export interface SyncConflict {id:string;mappingId:string|null;kind:string;evidence:JsonValue;createdAt:string}
export interface DeliveryBinding {ownerId:string;spaceId:string;bridgeId:string;identityEpoch:string}
export interface DeliveryClaim {
 claimId:string;attemptId:string;binding:DeliveryBinding;intentHash:string;
 /** Immutable version at issued -> claimed, not the latest slot version. */
 claimVersion:string;executionFence:string;
}
export interface DeliveryReceipt {
 receiptKey:string;attemptId:string;binding:DeliveryBinding;intentHash:string;claimId:string;
 /** Slot version at claimed -> readback-verified. */
 deliveryVersion:string;mappingId:string;mappingVersion:number;
 entityId:string;sourceId:string;canonicalRevision:number;
 proof:NativeReadback;nativeHash:string;receiptHash:string;
}
export interface DeliveryRetirement {
 commandKey:string;reason:'native-precondition-changed';
 observation:{identity:NativeIdentity;fields:FieldObservations};
 outcome:'reconciled'|'conflict';evidence:JsonValue;
}
export interface ActiveDelivery {
 format:'lifeos.apple-sync.delivery.v1';version:string;attemptId:string;binding:DeliveryBinding;
 phase:'issued'|'claimed'|'readback-verified'|'acknowledged'|'retired-unapplied';
 cursor:string;canonicalRevision:number;intent:BridgeIntent;intentHash:string;
 preparedMapping:{id:string;version:number}|null;
 claim:DeliveryClaim|null;receipt:DeliveryReceipt|null;retirement:DeliveryRetirement|null;
}
export interface DeliveryCommandArchive {
 format:'lifeos.apple-sync.delivery-command.v1';
 operation:'prepare'|'claim'|'retire'|'receipt'|'ack';
 delivery:ActiveDelivery;response:JsonValue;
}
export interface SyncTransaction {
 readonly platform:PlatformRepository;readonly calendar:CalendarRepository;
 claimLease(now:string,ttlSeconds:number):Promise<SyncLease>;requireLease(fence:string,now:string):Promise<SyncLease>;
 pull(after:string,limit:number):Promise<SyncOutboxItem[]>;receipt():Promise<SyncCommandReceipt|null>;saveReceipt(value:SyncCommandReceipt):Promise<void>;
 getMapping(id:string):Promise<SyncMapping|null>;findMapping(kind:'todo'|'calendar',entityId:string):Promise<SyncMapping|null>;saveMapping(value:SyncMapping,expectedVersion:number|null):Promise<void>;
 saveConflict(value:SyncConflict):Promise<void>;advanceCursor(fence:string,cursor:string,now:string):Promise<SyncLease>;
 /** Same locked lease/owner-space transaction. Null only before the first attempt. */
 readDelivery():Promise<ActiveDelivery|null>;
 /** Monotone CAS; no deletion/reset. BEFORE this call, saveReceipt in this SAME
  * transaction/current command key must persist result:DeliveryCommandArchive
  * (format lifeos.apple-sync.delivery-command.v1), with archive.delivery fully
  * equal to next. No alternative archive key/path. Reject a missing/mismatched
  * archive; archive + CAS roll back together. HTTP/replay returns only response. */
 saveDelivery(expectedVersion:string|null,next:ActiveDelivery):Promise<void>;
}
export interface SyncRepository {transaction<T>(principal:SyncPrincipal,key:string,fn:(tx:SyncTransaction)=>Promise<T>):Promise<T>}
