'use client';
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {checkOwnerPageAccess} from '../session-duration/client';
import {flushSync} from 'react-dom';
type OwnerAccessPhase='active'|'checking'|'unavailable'|'recovered';
const OwnerPageVerification=createContext<OwnerAccessPhase|null>(null);
export function useOwnerPageVerification(){
 const phase=useContext(OwnerPageVerification);
 return phase===null?null:phase==='active'||phase==='recovered';
}
export function useOwnerPageRecovery(){return useContext(OwnerPageVerification)==='recovered';}

/** Conceal cached children before background/back navigation; reveal only after
 * a fresh server owner check. No client supplied identity is trusted. */
export function PrivacyBoundary({children}:{children:ReactNode}){
 const[phase,setPhase]=useState<OwnerAccessPhase>('active');
 const verified=phase==='active'||phase==='recovered';
 const retry=useRef<(()=>void)|null>(null);
 useEffect(()=>{
  let alive=true,generation=0;
  const hide=()=>{
   generation++;
   setPhase('checking');
   document.documentElement.style.visibility='hidden';
  };
  const check=async(recover=false)=>{
   if(document.visibilityState==='hidden')return;
   const token=++generation;
   setPhase('checking');
   const result=await checkOwnerPageAccess(fetch);
   if(!alive||token!==generation)return;
   if(result==='locked'){window.location.replace('/login');return;}
   if(result==='unavailable'){setPhase('unavailable');return;}
   document.documentElement.style.visibility='';
   setPhase(recover?'recovered':'active');
  };
  const pageShow=()=>void check();
  const visibility=()=>{if(document.visibilityState==='hidden')hide();else pageShow();};
  retry.current=()=>void check(true);
  window.addEventListener('pagehide',hide);
  window.addEventListener('pageshow',pageShow);
  document.addEventListener('visibilitychange',visibility);
  return()=>{
   alive=false;
   retry.current=null;
   window.removeEventListener('pagehide',hide);
   window.removeEventListener('pageshow',pageShow);
   document.removeEventListener('visibilitychange',visibility);
   document.documentElement.style.visibility='';
  };
 },[]);
 return <><div hidden={!verified} inert={!verified}>
   <OwnerPageVerification.Provider value={phase}>{children}</OwnerPageVerification.Provider>
  </div>
  {!verified&&<section style={{visibility:'visible'}}>
   <p role="status">{phase==='checking'?'正在重新核对私人空间…':'暂时无法核对登录状态。私人页面已隐藏。'}</p>
   {phase==='unavailable'&&<button type="button" onClick={()=>retry.current?.()}>重新核对</button>}
  </section>}
 </>;
}
export function LogoutButton({beforeLogout,onConfirmed,className,icon}:{beforeLogout?:()=>boolean;onConfirmed?:()=>void;className?:string;icon?:ReactNode}={}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function logout(){
  if(busy||beforeLogout?.()===false)return;
  setBusy(true);setError('');
  try{
   const response=await fetch('/api/platform/auth/sign-out',{
    method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}',
   });
   if(!response.ok)throw Error();
  }catch{
   setError('退出未获服务端确认，请重试。');setBusy(false);
   return;
  }
  // Remove private content and let its editor guards clean up before leaving.
  if(onConfirmed)flushSync(onConfirmed);
  window.location.replace('/login');
 }
 return <><button type="button" className={className} aria-label={icon?'退出登录':undefined}
  title={icon?'退出登录':undefined} data-workspace-nav={icon?'':undefined}
  aria-busy={busy||undefined} disabled={busy} onClick={logout}>
  {icon??(busy?'正在退出…':'退出')}
 </button>{error&&<span role="alert">{error}</span>}</>;
}
