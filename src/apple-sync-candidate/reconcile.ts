import {PlatformError} from '../platform/domain.ts';
import {canonicalDigest,validateObservations,validateNativeIdentity,validateCapabilities,validateCoverage} from './domain.ts';
import type {Observation,FieldObservations,EntityKind,NativeCapabilities,NativeIdentity,NativeScope,ScanCoverage,FieldConflict,MergeResult} from './contracts.ts';
export type {FieldConflict,MergeResult} from './contracts.ts';

const missing=():Observation=>({kind:'unavailable',reason:'missing'});
const observation=(fields:FieldObservations,field:string):Observation=>Object.hasOwn(fields,field)?fields[field]:missing();
const same=(a:Observation,b:Observation)=>a.kind==='known'&&b.kind==='known'&&canonicalDigest(a.value)===canonicalDigest(b.value);

/** No wall-clock ordering: only a known baseline can prove a one-sided edit. */
export function mergeFields(base:FieldObservations,server:FieldObservations,native:FieldObservations):MergeResult{
 const b=validateObservations(base),s=validateObservations(server),n=validateObservations(native);
 const fields:Record<string,Observation>={},toServer:Record<string,Observation>={},toNative:Record<string,Observation>={},conflicts:FieldConflict[]=[];
 const keys=[...new Set([...Object.keys(b),...Object.keys(s),...Object.keys(n)])].sort();
 for(const field of keys){
  const before=observation(b,field),web=observation(s,field),apple=observation(n,field);
  if(same(web,apple)){fields[field]=web;continue;}
  if(before.kind!=='known'||web.kind!=='known'||apple.kind!=='known'){
   fields[field]={kind:'unavailable',reason:'conflict'};conflicts.push({field,reason:'unavailable',base:before,server:web,native:apple});continue;
  }
  if(same(before,web)){fields[field]=apple;toServer[field]=structuredClone(apple);}
  else if(same(before,apple)){fields[field]=web;toNative[field]=structuredClone(web);}
  else{fields[field]={kind:'unavailable',reason:'conflict'};conflicts.push({field,reason:'concurrent-change',base:before,server:web,native:apple});}
 }
 return {fields,conflicts,toServer,toNative};
}

type EchoEvidence={mutationId:string;revision:number;payloadHash:string};
export function isVerifiedEcho(expected:EchoEvidence,observed:EchoEvidence):boolean{
 const valid=(value:EchoEvidence)=>{
  if(!value||typeof value!=='object'||Object.keys(value).length!==3||!Object.keys(value).every(key=>['mutationId','revision','payloadHash'].includes(key)))return false;
  canonicalDigest(value);
  return typeof value.mutationId==='string'&&value.mutationId.trim().length>0&&value.mutationId.length<=2048&&!value.mutationId.includes('\0')&&Number.isInteger(value.revision)&&value.revision>=1&&value.revision<=2147483647&&typeof value.payloadHash==='string'&&/^[a-f0-9]{64}$/.test(value.payloadHash);
 };
 try{return valid(expected)&&valid(observed)&&expected.mutationId===observed.mutationId&&expected.revision===observed.revision&&expected.payloadHash===observed.payloadHash;}catch{return false;}
}

function unsupportedNativeField(kind:EntityKind,field:string,value:Observation):boolean{
 const name=field.toLowerCase().replace(/[^a-z]/g,'');
 if(/invitation|invitee|attendee|organizer|participant|participation/.test(name))return true;
 return kind==='event'&&(/cancel/.test(name)||(name==='status'||name==='eventstatus')&&value.kind==='known'&&typeof value.value==='string'&&/^(cancelled|canceled)$/i.test(value.value));
}
export function checkWriteCapabilities(kind:EntityKind,patch:FieldObservations,capabilities:NativeCapabilities,scope:NativeScope='single'):{allowed:boolean;reasons:readonly string[]}{
 const c=validateCapabilities(capabilities),changes=validateObservations(patch);
 if(kind!=='reminder'&&kind!=='event')throw new PlatformError(400,'INVALID_SYNC_ENTITY_KIND','同步记录类型无效。');
 if(!Object.keys(changes).length)return {allowed:true,reasons:[]};
 const reasons=new Set<string>();
 if(!c.fullSnapshot[kind])reasons.add('incomplete-snapshot');
 if(!c.preserveUnchanged)reasons.add('unchanged-preservation-unavailable');
 if(!c.scopes.includes(scope))reasons.add('unsupported-scope');
 for(const [field,value]of Object.entries(changes)){
  if(value.kind!=='known')reasons.add('unavailable-field');
  if(!c.writableFields[kind].includes(field))reasons.add('unsupported-field');
  if(unsupportedNativeField(kind,field,value))reasons.add('unsupported-native-operation');
 }
 return {allowed:reasons.size===0,reasons:[...reasons]};
}

export function assessMissing(identity:NativeIdentity,previous:ScanCoverage,current:ScanCoverage,resolution:{status:'present'|'absent'|'ambiguous'|'unavailable';identityReconciled:boolean}):{candidate:boolean;reason:string}{
 const id=validateNativeIdentity(identity),before=validateCoverage(previous),after=validateCoverage(current);
 const blocked=(reason:string)=>({candidate:false,reason});
 if(!resolution||resolution.status!=='absent')return blocked('absence-unresolved');
 if(resolution.identityReconciled!==true)return blocked('identity-unreconciled');
 if(!before.complete||!after.complete||before.permissions!=='full'||after.permissions!=='full'||before.truncated||after.truncated||before.filtered||after.filtered)return blocked('incomplete-coverage');
 if(before.window!==null||after.window!==null)return blocked('windowed-coverage');
 if(id.storeEpoch!==before.storeEpoch||before.storeEpoch!==after.storeEpoch)return blocked('store-epoch-changed');
 if(before.accountSetHash!==after.accountSetHash)return blocked('account-set-changed');
 if(!before.containerIds.includes(id.containerId)||!after.containerIds.includes(id.containerId))return blocked('container-uncovered');
 if(canonicalDigest([...before.containerIds].sort())!==canonicalDigest([...after.containerIds].sort()))return blocked('container-set-changed');
 return {candidate:true,reason:'verified-absence-candidate'};
}
