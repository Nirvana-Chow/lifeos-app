import {createHash} from 'node:crypto';
import {PlatformError} from '../platform/domain.ts';
import type {JsonValue,FieldObservations,Observation,NativeIdentity,NativeCapabilities,NativeScope,ScanCoverage} from './contracts.ts';

const forbidden=new Set(['__proto__','prototype','constructor']);
const bad=(code:string):never=>{throw new PlatformError(400,code,'同步证据格式无效或超出候选协议限制。');};
const jsonBad=():never=>bad('INVALID_SYNC_JSON');

/** Canonical JSON is bounded before hashing and never invokes accessors/toJSON. */
function canonicalJson(input:unknown):string{
 const ancestors=new Set<object>();let nodes=0,bytes=0;
 const emit=(text:string)=>{bytes+=Buffer.byteLength(text);if(bytes>1_048_576)jsonBad();return text;};
 const visit=(value:unknown,depth:number):string=>{
  if(depth>32||++nodes>50_000)jsonBad();
  if(value===null)return emit('null');
  if(typeof value==='string'){if(value.length>65_536)jsonBad();return emit(JSON.stringify(value));}
  if(typeof value==='boolean')return emit(String(value));
  if(typeof value==='number'){if(!Number.isFinite(value))jsonBad();return emit(JSON.stringify(value));}
  if(typeof value!=='object'||!value) return jsonBad();
  if(ancestors.has(value))jsonBad();ancestors.add(value);
  try{
   if(Array.isArray(value)){
    if(Object.getPrototypeOf(value)!==Array.prototype||value.length>4096||Reflect.ownKeys(value).length!==value.length+1)return jsonBad();
    const values:string[]=[];emit('[');for(let i=0;i<value.length;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!('value'in d)||!d.enumerable)return jsonBad();if(i)emit(',');values.push(visit(d.value,depth+1));}emit(']');return '['+values.join(',')+']';
   }
   const proto=Object.getPrototypeOf(value);if(proto!==Object.prototype&&proto!==null)jsonBad();
   const keys=Reflect.ownKeys(value);if(keys.length>1024||keys.some(key=>typeof key!=='string'))jsonBad();
   const values:string[]=[];emit('{');for(const key of (keys as string[]).sort()){
    if(forbidden.has(key)||key.length>1024)jsonBad();const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!('value'in d)||!d.enumerable)return jsonBad();
    if(values.length)emit(',');values.push(emit(JSON.stringify(key))+emit(':')+visit(d.value,depth+1));
   }emit('}');return '{'+values.join(',')+'}';
  }finally{ancestors.delete(value);}
 };
 try{return visit(input,0);}catch{return jsonBad();}
}
export function canonicalDigest(value:unknown):string{return createHash('sha256').update(canonicalJson(value)).digest('hex');}
function jsonCopy(value:unknown):JsonValue{return JSON.parse(canonicalJson(value)) as JsonValue;}
function record(value:unknown,keys:readonly string[],code:string):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return bad(code);
 const actual=Object.keys(value);if(actual.length!==keys.length||actual.some(key=>!keys.includes(key)))return bad(code);
 return value as Record<string,unknown>;
}
function text(value:unknown,code:string,max=2048):string{if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\0'))return bad(code);return value;}
function list(value:unknown,code:string,max=1024,itemMax=2048):string[]{if(!Array.isArray(value)||value.length>max)return bad(code);const result=value.map(item=>text(item,code,itemMax));if(new Set(result).size!==result.length)return bad(code);return result;}
function boolean(value:unknown,code:string):boolean{if(typeof value!=='boolean')return bad(code);return value;}
function date(value:unknown,code:string):string{
 const result=text(value,code,64);
 if(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(result))return bad(code);
 const day=result.slice(0,10),parsed=new Date(day+'T00:00:00Z');if(!Number.isFinite(parsed.valueOf())||parsed.toISOString().slice(0,10)!==day)return bad(code);
 if(result.length>10&&(Number(result.slice(11,13))>23||Number(result.slice(14,16))>59||Number(result.slice(17,19))>59||!Number.isFinite(Date.parse(result))))return bad(code);
 return result;
}
export function validateObservations(value:unknown):FieldObservations{
 const copy=jsonCopy(value),code='INVALID_SYNC_OBSERVATIONS';if(!copy||typeof copy!=='object'||Array.isArray(copy)||Object.keys(copy).length>128)return bad(code);
 const output:Record<string,Observation>={};for(const [field,entry] of Object.entries(copy)){
  text(field,code,128);if(!entry||typeof entry!=='object'||Array.isArray(entry))return bad(code);
  if(entry.kind==='known'){const o=record(entry,['kind','value'],code);output[field]={kind:'known',value:o.value as JsonValue};}
  else if(entry.kind==='unavailable'){const o=record(entry,['kind','reason'],code);output[field]={kind:'unavailable',reason:text(o.reason,code,512)};}
  else return bad(code);
 }return output;
}
export function validateNativeIdentity(value:unknown):NativeIdentity{
 const code='INVALID_SYNC_IDENTITY',o=record(jsonCopy(value),['storeEpoch','sourceId','containerId','itemId','externalId','aliases','seriesId','originalOccurrenceDate'],code);
 return {storeEpoch:text(o.storeEpoch,code),sourceId:text(o.sourceId,code),containerId:text(o.containerId,code),itemId:text(o.itemId,code),externalId:o.externalId===null?null:text(o.externalId,code),aliases:list(o.aliases,code,128),seriesId:o.seriesId===null?null:text(o.seriesId,code),originalOccurrenceDate:o.originalOccurrenceDate===null?null:date(o.originalOccurrenceDate,code)};
}
export function validateCapabilities(value:unknown):NativeCapabilities{
 const code='INVALID_SYNC_CAPABILITIES',o=record(jsonCopy(value),['protocolVersion','adapterId','adapterVersion','platform','fullSnapshot','writableFields','preserveUnchanged','scopes','nativeEventCancellationWrite','invitationWrite'],code);
 if(o.protocolVersion!==1||!['synthetic','macos'].includes(o.platform as string)||o.nativeEventCancellationWrite!==false||o.invitationWrite!==false)return bad(code);
 const full=record(o.fullSnapshot,['reminder','event'],code),fields=record(o.writableFields,['reminder','event'],code),scopes=list(o.scopes,code,4,32);
 if(scopes.some(scope=>!['single','occurrence','future','series'].includes(scope)))return bad(code);
 return {protocolVersion:1,adapterId:text(o.adapterId,code,128),adapterVersion:text(o.adapterVersion,code,128),platform:o.platform as NativeCapabilities['platform'],fullSnapshot:{reminder:boolean(full.reminder,code),event:boolean(full.event,code)},writableFields:{reminder:list(fields.reminder,code,128,128),event:list(fields.event,code,128,128)},preserveUnchanged:boolean(o.preserveUnchanged,code),scopes:scopes as NativeScope[],nativeEventCancellationWrite:false,invitationWrite:false};
}
export function validateCoverage(value:unknown):ScanCoverage{
 const code='INVALID_SYNC_COVERAGE',o=record(jsonCopy(value),['storeEpoch','accountSetHash','containerIds','complete','permissions','window','truncated','filtered'],code);
 if(!['full','limited','denied'].includes(o.permissions as string))return bad(code);
 let window:ScanCoverage['window']=null;if(o.window!==null){const w=record(o.window,['from','to'],code);window={from:date(w.from,code),to:date(w.to,code)};if(Date.parse(window.from)>=Date.parse(window.to))return bad(code);}
 return {storeEpoch:text(o.storeEpoch,code),accountSetHash:text(o.accountSetHash,code),containerIds:list(o.containerIds,code),complete:boolean(o.complete,code),permissions:o.permissions as ScanCoverage['permissions'],window,truncated:boolean(o.truncated,code),filtered:boolean(o.filtered,code)};
}
