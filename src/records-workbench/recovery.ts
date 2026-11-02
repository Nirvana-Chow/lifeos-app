import {inspectRecordCommand,type RecordCommand} from './client.ts';
export interface RecordsCommandStore{load():RecordCommand|null;keep(command:RecordCommand):void;clear(key:string):void;}
type StoragePort=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const name='lifeos.records.pending.v1',maxPendingLength=1500000;
/** Explicit synthetic draft command plus authenticated account ID; no credentials. */
export function createRecordsCommandStore(storage:StoragePort):RecordsCommandStore{
 const load=():RecordCommand|null=>{const raw=storage.getItem(name);if(raw===null)return null;if(raw.length>maxPendingLength)throw Error('待确认请求无法恢复。');return inspectRecordCommand(JSON.parse(raw)).command;};
 return {load,keep(command){const checked=inspectRecordCommand(command).command,current=load(),serialized=JSON.stringify(checked);if(serialized.length>maxPendingLength)throw Error('本次请求过大，无法完整保留，尚未发送。');if(current&&JSON.stringify(current)!==serialized)throw Error('已有保存结果待确认，请先重试原请求。');storage.setItem(name,serialized);if(storage.getItem(name)!==serialized)throw Error('本次保存请求未能保留，尚未发送。');},clear(key){const current=load();if(current&&current.key!==key)throw Error('待确认请求已变化。');storage.removeItem(name);if(storage.getItem(name)!==null)throw Error('保存回执尚未完成本地确认。');}};
}
