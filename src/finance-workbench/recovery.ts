import {createFinanceCommand,type FinanceCommand} from './client.ts';
import type {FinanceFields} from './fields.ts';
export interface FinanceCommandStore{load():FinanceCommand|null;keep(command:FinanceCommand):void;clear(key:string):void;}
type StoragePort=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const name='lifeos.finance.pending.v1';
/** Synthetic review input only; identity binding prevents another account replaying a pending command. */
export function createFinanceCommandStore(storage:StoragePort,owner:string):FinanceCommandStore{
 const load=():FinanceCommand|null=>{
  const raw=storage.getItem(name);if(raw===null)return null;if(raw.length>150000)throw Error('待确认财务请求无法恢复，请核对原保存结果。');
  const value=JSON.parse(raw);
  if(!value||Object.keys(value).sort().join(',')!=='body,input,key,method,owner,path'||typeof value.body!=='string'||typeof value.input!=='string'||typeof value.path!=='string'||value.owner!==owner)throw Error('待确认财务请求与当前账号或保存格式不符，请恢复原账号后核对。');
  const match=/^\/api\/platform\/finance(?:\/([0-9a-f-]+))?$/.exec(value.path);
  if(!match||value.method!==(match[1]?'PATCH':'POST'))throw Error('待确认财务请求目标无效。');
  const body=JSON.parse(value.body),fields=JSON.parse(value.input)as FinanceFields;
  const checked=createFinanceCommand(fields,match[1]?{id:match[1],revision:body.expectedRevision}:null,value.key,owner);
  if(checked.body!==value.body||checked.input!==value.input)throw Error('待确认财务请求内容无法核对。');
  return checked;
 };
 return{load,keep(command){if(command.owner!==owner)throw Error('请求账号与当前账号不同。');const current=load();if(current&&JSON.stringify(current)!==JSON.stringify(command))throw Error('已有保存结果待确认，请先重试原请求。');storage.setItem(name,JSON.stringify(command));},clear(key){const current=load();if(current?.key===key)storage.removeItem(name);else if(current)throw Error('待确认请求已变化，不能清除。');}};
}
