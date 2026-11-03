/** Loss-aware protocol evidence. These fields do not define a business schema. */
export type JsonValue=null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};
export type Observation={kind:'known';value:JsonValue}|{kind:'unavailable';reason:string};
export type FieldObservations=Readonly<Record<string,Observation>>;
export type EntityKind='reminder'|'event';
export type NativeIdentity={storeEpoch:string;sourceId:string;containerId:string;itemId:string;externalId:string|null;aliases:readonly string[];seriesId:string|null;originalOccurrenceDate:string|null};
export type NativeScope='single'|'occurrence'|'future'|'series';
export type NativeCapabilities={protocolVersion:1;adapterId:string;adapterVersion:string;platform:'synthetic'|'macos';fullSnapshot:{reminder:boolean;event:boolean};writableFields:{reminder:readonly string[];event:readonly string[]};preserveUnchanged:boolean;scopes:readonly NativeScope[];nativeEventCancellationWrite:false;invitationWrite:false};
export type ScanCoverage={storeEpoch:string;accountSetHash:string;containerIds:readonly string[];complete:boolean;permissions:'full'|'limited'|'denied';window:{from:string;to:string}|null;truncated:boolean;filtered:boolean};
export type FieldConflict={field:string;reason:'concurrent-change'|'unavailable';base:Observation;server:Observation;native:Observation};
export type MergeResult={fields:FieldObservations;conflicts:readonly FieldConflict[];toServer:FieldObservations;toNative:FieldObservations};
