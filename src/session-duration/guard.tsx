'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {checkDeviceSession,safeSessionReturn} from './client';
import s from './session.module.css';
/** Keep children mounted while locked: unsent drafts stay in their original owner-bound state. */
export function DeviceSessionGuard({children}:{children:ReactNode}){
 const [phase,setPhase]=useState<'checking'|'active'|'locked'>('checking'),[loginHref,setLoginHref]=useState('/login?reauthenticate=1');
 useEffect(()=>{
  const controller=new AbortController();
  let live=true,inFlight=false,timer:ReturnType<typeof setTimeout>|undefined,deadline:ReturnType<typeof setTimeout>|undefined;
  setLoginHref('/login?reauthenticate=1&return_to='+encodeURIComponent(safeSessionReturn(location.pathname+location.search)));
  async function check(){if(!live||inFlight||document.visibilityState==='hidden')return;inFlight=true;clearTimeout(timer);clearTimeout(deadline);
   try{const status=await checkDeviceSession(fetch,controller.signal);if(!live)return;setPhase(status.kind==='active'?'active':'locked');if(status.kind==='active')deadline=setTimeout(()=>{if(live){setPhase('locked');void check();}},Math.max(0,Math.min(status.expiresAt-Date.now(),2147483647)));}
   finally{inFlight=false;if(live)timer=setTimeout(()=>void check(),60000);}
  }
  const focus=()=>{if(document.visibilityState!=='hidden')void check();};void check();window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
  return()=>{live=false;controller.abort();clearTimeout(timer);clearTimeout(deadline);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
 },[]);
 return <><div hidden={phase!=='active'} inert={phase!=='active'}>{children}</div>{phase!=='active'&&<main data-lifeos-surface="auth" className={s.lock} aria-live="polite"><section><h1>{phase==='checking'?'正在核对登录状态…':'登录已到期或需要重新验证'}</h1>{phase==='locked'&&<><p>当前页面已锁定，未发送的草稿仍保留在本页。请在新标签页完成登录，再回到这里继续。</p><a href={loginHref} target="_blank" rel="noopener">重新登录</a><button type="button" onClick={()=>window.dispatchEvent(new Event('focus'))}>已完成登录，继续编辑</button></>}</section></main>}</>;
}
