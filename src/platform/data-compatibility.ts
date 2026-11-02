import {PlatformError} from './domain.ts';
import {recordTypes} from '../records-candidate/contracts.ts';
import {validateRecordMetadata} from '../records-candidate/domain.ts';
export const readerVersions=['r5.10','r5.11','r5.12'] as const;
export type ReaderVersion=typeof readerVersions[number];
const failure=()=>new PlatformError(409,'DATA_READER_INCOMPATIBLE','存在当前读者不支持的记录，已停止此读取；请使用兼容版本或完整原样导出，不要回退或转换数据。');
const obj=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
/** Examine only metadata, never include originals, IDs, owner or text in diagnostics. */
export function recordCompatibility(entry:unknown,target:ReaderVersion='r5.12'):'supported'|'unsupported'|'malformed'{
 if(!readerVersions.includes(target))throw failure();const e=obj(entry);if(!e)return'malformed';if(e.kind!=='inbox')return ['todo','finance'].includes(String(e.kind))?'supported':'unsupported';
 for(const raw of [e.draft,obj(e.source)?.original]){const payload=obj(raw);if(!payload)return'malformed';if(!Object.hasOwn(payload,'record'))continue;const record=obj(payload.record);if(!record||typeof record.type!=='string')return'malformed';if(!recordTypes.includes(record.type as any)||target==='r5.10'&&record.type==='training')return'unsupported';try{validateRecordMetadata(record);}catch{return'malformed';}}
 return'supported';
}
export function assertReadableEntries(entries:readonly unknown[],target:ReaderVersion='r5.12'):void{if(entries.some(e=>recordCompatibility(e,target)!=='supported'))throw failure();}
export function inspectSnapshotCompatibility(snapshot:unknown,target:ReaderVersion='r5.12'){
 if(!readerVersions.includes(target))throw failure();const s=obj(snapshot);if(!s||!Array.isArray(s.entries)||!Array.isArray(s.history))throw failure();const values=[...s.entries,...s.history],states=values.map(e=>recordCompatibility(e,target)),unsupported=states.filter(v=>v==='unsupported').length,malformed=states.filter(v=>v==='malformed').length;
 return{targetReader:target,compatible:unsupported===0&&malformed===0,entries:s.entries.length,history:s.history.length,unsupported,malformed,rawExportRequired:unsupported>0||malformed>0,automaticRollbackAllowed:false,liveWriteFenceVerified:false,scope:'provided-core-snapshot-only' as const};
}
