'use client';
import {createContext,useContext,useEffect,useRef,type ReactNode} from 'react';
import {PersonalPage} from '../personal-candidate/personal-page';
const GuardContext=createContext<{current:()=>boolean}|null>(null);
export function RequirementSupportFrame({title,children}:{title:string;children:ReactNode}){const guard=useRef(()=>true);return <PersonalPage title={title} initialPage="requirements" wide canNavigate={()=>guard.current()}><GuardContext.Provider value={guard}><div style={{height:'100%',minHeight:0}}>{children}</div></GuardContext.Provider></PersonalPage>;}
export function useSupportDeparture(dirty:boolean,pending:boolean){
 const guard=useContext(GuardContext),approved=useRef(false);
 // Any subsequent form render revokes an earlier discard approval.
 approved.current=false;
 useEffect(()=>{
  const check=()=>{
   if(pending){window.alert('保存结果尚未确认，请先恢复原请求并回读。');return false;}
   if(!dirty||approved.current)return true;
   approved.current=window.confirm('反馈内容尚未保存，确定放弃并离开？');return approved.current;
  };
  if(guard)guard.current=check;
  const unload=(event:BeforeUnloadEvent)=>{
   // One accepted explicit departure owns the matching document unload too.
   if(approved.current&&!pending){approved.current=false;return;}
   if(dirty||pending){event.preventDefault();event.returnValue='';}
  };
  window.addEventListener('beforeunload',unload);
  return()=>{if(guard&&guard.current===check)guard.current=()=>true;window.removeEventListener('beforeunload',unload);};
 },[guard,dirty,pending]);
}
