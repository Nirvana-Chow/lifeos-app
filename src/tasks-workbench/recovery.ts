import {createTaskCommand,type TaskCommand} from './client.ts';
export interface TasksCommandStore{load():TaskCommand|null;keep(command:TaskCommand):void;clear(key:string):void;}
type StoragePort=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const name='lifeos.tasks.pending.v1';
/** Only the explicit synthetic review task command is stored, never session credentials or model settings. */
export function createTasksCommandStore(storage:StoragePort):TasksCommandStore{
 const load=():TaskCommand|null=>{
  const raw=storage.getItem(name);if(raw===null)return null;if(raw.length>100000)throw Error('待确认请求无法恢复，请先核对原保存结果。');
  const value=JSON.parse(raw);
  if(!value||Object.keys(value).sort().join(',')!=='body,key,method,path'||typeof value.body!=='string'||typeof value.path!=='string')throw Error('待确认请求格式无效，请先核对原保存结果。');
  const match=/^\/api\/platform\/todos(?:\/([0-9a-f-]+))?$/.exec(value.path);
  if(!match||value.method!==(match[1]?'PATCH':'POST'))throw Error('待确认请求目标无效。');
  const body=JSON.parse(value.body);const {expectedRevision,...fields}=body;
  const checked=createTaskCommand(fields,match[1]?{id:match[1],revision:expectedRevision}:null,value.key);
  if(checked.body!==value.body)throw Error('待确认请求内容无法核对。');
  return checked;
 };
 return{load,keep(command){const current=load();if(current&&(current.key!==command.key||current.body!==command.body||current.path!==command.path))throw Error('已有保存结果待确认，请先重试原请求。');storage.setItem(name,JSON.stringify(command));},clear(key){const current=load();if(current?.key===key)storage.removeItem(name);else if(current)throw Error('待确认请求已变化，不能清除。');}};
}
