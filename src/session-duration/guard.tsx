'use client';

import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {LoginPage} from '../personal-candidate/login';
import {OwnerPageVerification,OwnerSessionRecheck} from '../personal-candidate/privacy';
import type {LoginCapability} from '../platform/page-access';
import {checkDeviceSession,checkOwnerPageAccess,safeSessionReturn} from './client';
import s from './session.module.css';

type Phase='checking'|'active'|'locked'|'unavailable';

export function OwnerPageReadUnavailable(){
 return <main data-lifeos-surface="auth" className={s.lock}><section>
  <h1>私人页面暂时无法打开</h1>
  <button type="button" onClick={()=>location.reload()}>重新加载页面</button>
 </section></main>;
}

/** Keep the owner-bound page mounted and concealed until the server confirms access. */
export function DeviceSessionGuard({children,capability}:{children:ReactNode;capability:LoginCapability}){
 const [phase,setPhase]=useState<Phase>('checking');
 const [authenticating,setAuthenticating]=useState(false);
 const [returnTo,setReturnTo]=useState('/personal');
 const recheck=useRef<(afterLogin?:boolean)=>void>(()=>{});
 const requestVerification=useCallback(()=>recheck.current(),[]);
 const native=capability.sessionDuration===true;

 useEffect(()=>{
  let mounted=true,request:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  let recoveryPending=false;
  const conceal=()=>{
   request?.abort();
   request=undefined;
   clearTimeout(timer);
   document.documentElement.style.visibility='hidden';
   setPhase('checking');
  };
  async function check(afterLogin=false){
   if(!mounted||document.visibilityState==='hidden'||request&&!afterLogin)return;
   if(afterLogin){
    request?.abort();
    recoveryPending=true;
    setPhase('checking');
   }
   clearTimeout(timer);
   const controller=new AbortController();
   request=controller;
   const status=native
    ?await checkDeviceSession(fetch,controller.signal)
    :{kind:await checkOwnerPageAccess(fetch,controller.signal)};
   if(!mounted||request!==controller||controller.signal.aborted)return;
   request=undefined;
   document.documentElement.style.visibility=status.kind==='active'?'':'hidden';
   setPhase(status.kind);
   if(status.kind==='active'){
    setAuthenticating(false);
    if(recoveryPending){recoveryPending=false;window.dispatchEvent(new Event('lifeos-owner-session-restored'));}
   }
   const delay=status.kind==='active'&&'expiresAt' in status&&typeof status.expiresAt==='number'
    ?Math.max(0,Math.min(60000,status.expiresAt-Date.now())):60000;
   timer=setTimeout(()=>void check(),delay);
  }

  recheck.current=afterLogin=>void check(afterLogin);
  const foreground=()=>void check();
  const visibility=()=>{if(document.visibilityState==='hidden')conceal();else foreground();};
  foreground();
  for(const event of ['focus','pageshow','online'])window.addEventListener(event,foreground);
  window.addEventListener('pagehide',conceal);
  document.addEventListener('visibilitychange',visibility);
  return()=>{
   mounted=false;
   request?.abort();
   clearTimeout(timer);
   recheck.current=()=>{};
   for(const event of ['focus','pageshow','online'])window.removeEventListener(event,foreground);
   window.removeEventListener('pagehide',conceal);
   document.removeEventListener('visibilitychange',visibility);
   document.documentElement.style.visibility='';
  };
 },[native]);

 return <>
  <div hidden={phase!=='active'} inert={phase!=='active'}>
   <OwnerSessionRecheck.Provider value={requestVerification}>
    <OwnerPageVerification.Provider value={phase==='active'}>{children}</OwnerPageVerification.Provider>
   </OwnerSessionRecheck.Provider>
  </div>
  {phase==='locked'&&authenticating?<div style={{visibility:'visible'}}>
   <LoginPage capability={capability} returnTo={returnTo} onResume={()=>{setAuthenticating(false);recheck.current(true);}}/>
  </div>:phase!=='active'&&<main data-lifeos-surface="auth" className={s.lock} aria-live="polite" style={{visibility:'visible'}}><section>
   {phase==='checking'&&<h1>正在核对登录状态…</h1>}
   {phase==='unavailable'&&<><h1>暂时无法核对登录状态</h1><p>私人页面已隐藏，未发送的草稿仍保留在本页。</p><button type="button" onClick={()=>recheck.current()}>重新核对</button></>}
   {phase==='locked'&&<><h1>登录已到期或需要重新验证</h1><p>重新登录后可继续编辑，未发送的草稿仍保留在本页。</p>
    <button type="button" onClick={()=>{setReturnTo(safeSessionReturn(location.pathname+location.search));setAuthenticating(true);}}>重新登录</button>
    <button type="button" onClick={()=>recheck.current()}>已完成登录，继续编辑</button>
   </>}
  </section></main>}
 </>;
}
