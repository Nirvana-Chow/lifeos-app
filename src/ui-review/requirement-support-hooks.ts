'use client';
import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {SupportMutationSession,type SupportMutationState} from '../requirement-support-candidate/client';
import type {RequirementBinding} from '../requirements-candidate/client';
export type SupportOwner=RequirementBinding&{writable:boolean;requirementsEnabled:boolean;requirementSupportEnabled:boolean};
const idle:SupportMutationState={phase:'idle',pending:null,observed:null,error:''};
const noSubscribe=()=>()=>{};
export async function supportJSON(path:string){const response=await fetch('/api/platform/personal/'+path,{credentials:'same-origin',cache:'no-store'}),value=await response.json();if(!response.ok)throw Error(response.status===401||response.status===403?'请恢复本人登录后重试。':typeof value?.error?.message==='string'?value.error.message:'读取暂不可用，请稍后刷新。');return value;}
export function useSupportOwner(){
 const [owner,setOwner]=useState<SupportOwner|null>(null),[error,setError]=useState(''),[session,setSession]=useState<SupportMutationSession|null>(null);
 const binding=useRef<string|null>(null),writer=useRef<SupportMutationSession|null>(null),writerKey=useRef<string|null>(null),epoch=useRef(0);
 const refresh=useCallback(async()=>{const token=++epoch.current;binding.current=null;setOwner(null);setError('');try{const v=await supportJSON('status');if(token!==epoch.current)return;if(typeof v.ownerId!=='string'||typeof v.spaceId!=='string')throw Error('本人空间状态无效。');const key=JSON.stringify([v.ownerId,v.spaceId]);if(writerKey.current!==key){writer.current?.invalidateBinding();const next={ownerId:v.ownerId,spaceId:v.spaceId};writer.current=new SupportMutationSession({binding:next,storage:{getItem:k=>window.localStorage.getItem(k),setItem:(k,value)=>window.localStorage.setItem(k,value),removeItem:k=>window.localStorage.removeItem(k)},assertBinding:()=>binding.current===key});writerKey.current=key;setSession(writer.current);}binding.current=key;setOwner({ownerId:v.ownerId,spaceId:v.spaceId,writable:v.writable===true,requirementsEnabled:v.requirementsEnabled===true,requirementSupportEnabled:v.requirementSupportEnabled===true});}catch(e){if(token===epoch.current)setError(e instanceof Error?e.message:'本人状态读取失败。');}},[]);
 useEffect(()=>{void refresh();const focus=()=>{void refresh();},hide=()=>{epoch.current++;binding.current=null;setOwner(null);};window.addEventListener('focus',focus);window.addEventListener('pagehide',hide);return()=>{epoch.current++;binding.current=null;writer.current?.invalidateBinding();window.removeEventListener('focus',focus);window.removeEventListener('pagehide',hide);};},[refresh]);
 const mutation=useSyncExternalStore(session?.subscribe??noSubscribe,session?.getSnapshot??(()=>idle),()=>idle);
 useEffect(()=>{const unload=(event:BeforeUnloadEvent)=>{if(writer.current&&['saving','uncertain'].includes(writer.current.getSnapshot().phase)){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload);},[]);
 return{owner,error,session,mutation,refresh};
}
