'use client';
import {createContext,useContext,useLayoutEffect,type RefObject} from 'react';
import type {LifeOSWorkspaceProps} from '../ui-review/contract';

export const businessRecordWorkspaceTitles={
 '/personal/career':'职业','/personal/resume':'简历','/personal/media':'书影音','/personal/portfolio':'账户资产投资',
} as const;
type BusinessRecordWorkspacePath=keyof typeof businessRecordWorkspaceTitles;
export function isBusinessRecordWorkspaceRoute(path:string|undefined):path is BusinessRecordWorkspacePath{
 return path!==undefined&&Object.hasOwn(businessRecordWorkspaceTitles,path);
}
export type WorkspaceRoutePath='/personal'|'/personal/journal'|'/personal/storage-review'|'/personal/finance'|BusinessRecordWorkspacePath;
export function isWorkspaceRoute(path:string):path is WorkspaceRoutePath{
 return path==='/personal'||path==='/personal/journal'||path==='/personal/storage-review'||path==='/personal/finance'
  ||isBusinessRecordWorkspaceRoute(path);
}
export type WorkspaceRoute={path:WorkspaceRoutePath;push:(href:string)=>void};
export type TaskShellFrame=LifeOSWorkspaceProps&{showApiKeys?:boolean;passwordEnabled?:boolean};
export const WorkspaceRouteContext=createContext<{
 activeContentGuard:RefObject<(()=>boolean)|null>;
 publishTaskFrame:(frame:TaskShellFrame|null)=>void;
}|null>(null);


export function useActiveContentGuard(mayLeave:()=>boolean){
 const route=useContext(WorkspaceRouteContext);
 const slot=route?.activeContentGuard;
 useLayoutEffect(()=>{
  if(!slot)return;
  slot.current=mayLeave;
  return()=>{if(slot.current===mayLeave)slot.current=null;};
 },[slot,mayLeave]);
 return route!==null;
}
