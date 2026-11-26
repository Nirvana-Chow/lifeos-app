import {validateCalendarDate} from '../calendar-candidate/domain.ts';
import type {StoredEntry} from '../platform/contracts.ts';
import {PlatformError} from '../platform/domain.ts';
import type {PersonalConfig} from './config.ts';
import {personalEntryType} from './service.ts';

export const taskWorkspaceSnapshotPath='/api/platform/personal/todo/workspace-snapshot';
const workspaceTypes=['todo','project','domain','topic'] as const;
export type TaskWorkspaceType=typeof workspaceTypes[number];
export interface TaskWorkspaceReader {
 readTaskWorkspaceSnapshot(owner:string,spaceId:string,types:readonly TaskWorkspaceType[]):Promise<StoredEntry[]>;
}

const unavailable=()=>new PlatformError(503,'TASK_WORKSPACE_SNAPSHOT_UNAVAILABLE','暂时无法核验待办工作区快照。');

export async function readTaskWorkspaceSnapshot(
 request:Request,config:PersonalConfig,storageVerified:boolean,reader:Partial<TaskWorkspaceReader>,
){
 const params=new URL(request.url).searchParams;
 if([...params.keys()].length!==1||!params.has('today'))throw new PlatformError(400,'INVALID_QUERY','查询参数无效。');
 const today=validateCalendarDate(params.get('today'));
 const types=workspaceTypes.filter(type=>config.allowedTypes.includes(type));
 if(!types.includes('todo'))throw new PlatformError(403,'PERSONAL_TYPE_DENIED','此本人记录类别未开放。');
 if(!storageVerified||!reader.readTaskWorkspaceSnapshot)throw unavailable();

 let rows:StoredEntry[];
 try{rows=await reader.readTaskWorkspaceSnapshot(config.ownerId,config.spaceId,types);}
 catch{throw unavailable();}
 if(!Array.isArray(rows)||rows.length>10000||rows.some(row=>!row||row.ownerId!==config.ownerId)||
    new Set(rows.map(row=>row.id)).size!==rows.length)throw unavailable();

 const items=rows.filter(row=>{
  const type=personalEntryType(row,config.spaceId);
  return types.some(allowed=>type===allowed);
 }).map(({ownerId:_,...entry})=>entry);
 return {scope:'task-workspace-current-snapshot' as const,items,total:items.length,truncated:false,today,observedAt:new Date().toISOString()};
}
