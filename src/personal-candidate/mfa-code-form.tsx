'use client';
import {useEffect,useState,type FormEvent} from 'react';
import s from './workspace.module.css';

export function MfaCodeForm({allowBackup=false,disabled=false,onSuccess}:{allowBackup?:boolean;disabled?:boolean;onSuccess:()=>void}){
 const [backup,setBackup]=useState(false),[busy,setBusy]=useState(false),[hydrated,setHydrated]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>setHydrated(true),[]);
 async function verify(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!hydrated||busy||disabled)return;const form=event.currentTarget,code=new FormData(form).get('code');setBusy(true);setMessage('');
  try{const response=await fetch('/api/platform/auth/two-factor/'+(backup?'verify-backup-code':'verify-totp'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,trustDevice:false})});form.reset();
   if(response.ok)onSuccess();else setMessage(response.status===429?'尝试过于频繁，请稍后再试。':'验证未通过，请核对验证码；已失效的登录请重新开始。');
  }catch{form.reset();setMessage('验证结果未确认，请重新打开登录页确认后再操作。');}finally{setBusy(false);}
 }
 return <section aria-label="第二步验证">
  <p>{backup?'输入一组未使用的备用恢复码；每组只能使用一次。':'打开苹果「密码」或其他验证器，输入 LifeOS 当前的六位动态码。'}</p>
  {message&&<p role="status">{message}</p>}
  <form method="post" action="/account/mfa" onSubmit={verify}><fieldset disabled={!hydrated||busy||disabled}>
   <label>{backup?'备用恢复码':'验证器动态码'}<input key={backup?'backup':'totp'} name="code" required type="text" inputMode={backup?'text':'numeric'} pattern={backup?undefined:'[0-9]{6}'} minLength={backup?undefined:6} maxLength={backup?128:6} autoComplete={backup?'off':'one-time-code'} autoCapitalize="none" spellCheck={false}/></label>
   <button className={s.primary}>{busy?'正在验证…':'验证并继续'}</button>
  </fieldset></form>
  {allowBackup&&<button type="button" disabled={busy} onClick={()=>{setBackup(!backup);setMessage('');}}>{backup?'使用验证器动态码':'无法使用验证器？使用备用恢复码'}</button>}
  <p className={s.hint}>密码恢复不会关闭两步验证。验证器和备用恢复码均丢失时，目前需要另行核实身份后处理。</p>
 </section>;
}
