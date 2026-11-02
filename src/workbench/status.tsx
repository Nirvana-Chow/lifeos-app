'use client';
import{createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode}from'react';
import{createWorkspaceStatusReader,initialWorkspaceStatus,type WorkspaceStatus}from'./status-reader';
export type{WorkspaceStatus}from'./status-reader';
const Status=createContext<WorkspaceStatus&{refresh:()=>Promise<void>}>({...initialWorkspaceStatus,refresh:async()=>{}});
export function WorkspaceStatusProvider({children}:{children:ReactNode}){
 const[value,set]=useState(initialWorkspaceStatus),refreshRef=useRef<()=>Promise<void>>(async()=>{});
 const refresh=useCallback(()=>refreshRef.current(),[]);
 useEffect(()=>{const reader=createWorkspaceStatusReader(()=>fetch('/api/platform/status',{cache:'no-store',credentials:'same-origin'}),set);refreshRef.current=()=>reader.refresh();void reader.refresh();return()=>{reader.dispose();refreshRef.current=async()=>{};};},[]);
 return <Status.Provider value={{...value,refresh}}>{children}</Status.Provider>;
}
export const useWorkspaceStatus=()=>useContext(Status);
export const useRefreshWorkspaceStatus=()=>useContext(Status).refresh;
