'use client';
import {useEffect,useState,type FormEvent} from 'react';
import s from './login.module.css';
import type {LoginCapability} from '../platform/page-access';
import {SessionDurationPicker} from '../session-duration/picker';
import type {SessionDuration} from '../session-duration/policy';
import {submitLogin} from './login-flow';
export function LoginPage({capability,oauthQuery,returnTo}:{capability:LoginCapability;oauthQuery?:string;returnTo?:string}){const enabled=capability.enabled,ownerAlias=capability.mode==='personal'?capability.ownerAlias:undefined,[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[hydrated,setHydrated]=useState(false),[challenge,setChallenge]=useState(false),[backup,setBackup]=useState(false),[unknown,setUnknown]=useState(false),[duration,setDuration]=useState<SessionDuration>({mode:'fixed',seconds:1800});
 useEffect(()=>{setHydrated(true);},[]);
 async function login(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!enabled||!hydrated||busy||unknown)return;
  const form=event.currentTarget,data=new FormData(form);setBusy(true);setMessage('');
  try{
   const result=await submitLogin({personal:capability.mode==='personal',challenge,backup,email:String(data.get('email')??''),password:String(data.get('password')??''),code:String(data.get('code')??''),oauthQuery,returnTo,...(capability.sessionDuration?{sessionDuration:duration}:{})},fetch);
   form.reset();
   if(result.kind==='redirect')window.location.replace(result.location);
   else{setChallenge(result.challenge);setUnknown(result.kind==='unknown');setMessage(result.message);}
  }finally{setBusy(false);}
 }
 return <main data-lifeos-surface="auth" className={s.page}>
  <section className={s.card} aria-labelledby="login-title">
   <h1>LifeOS</h1>
   <h2 id="login-title">{capability.mode==='synthetic'?'登录隔离测试空间':'登录私人空间'}</h2>
   {capability.mode==='synthetic'&&<p className={s.hint}>仅使用虚构测试身份，不输入本人密码或私人资料。</p>}
   {message&&<p className={s.message} role="status">{message}</p>}
   {enabled?<>
    <form method="post" action="/login" onSubmit={login}><fieldset disabled={!hydrated||busy||unknown}>
     <label>{ownerAlias?'账号':'邮箱'}<input name="email" type={ownerAlias?'text':'email'} defaultValue={ownerAlias??''} required={!challenge} readOnly={challenge} autoCapitalize="none" spellCheck={false} autoComplete="username"/></label>
     <label>密码<input name="password" type="password" required={!challenge} disabled={challenge} autoComplete="current-password"/></label>
     <label>{backup?'备用恢复码':'验证器动态码'}<input key={backup?'backup':'totp'} name="code" type="text" required={challenge} inputMode={backup?'text':'numeric'} pattern={backup?undefined:'[0-9]{6}'} minLength={backup?undefined:6} maxLength={backup?128:6} autoComplete={backup?'off':'one-time-code'} autoCapitalize="none" spellCheck={false}/></label>
     {capability.sessionDuration&&<SessionDurationPicker value={duration} onChange={setDuration}/>}
     <button className={s.primary}>{busy?'正在登录…':'登录'}</button>
    </fieldset></form>
    <button className={s.alternative} type="button" disabled={!hydrated||busy||unknown} onClick={()=>{setBackup(!backup);setMessage('');}}>{backup?'使用验证器动态码':'无法使用验证器？使用备用恢复码'}</button>
    {(challenge||unknown)&&<a className={s.link} href={oauthQuery?'/login?oauth_query='+encodeURIComponent(oauthQuery):'/login'}>重新开始登录</a>}
   </>:<p className={s.hint}>安全入口尚未就绪，当前不能登录或保存。</p>}
   {capability.mode==='personal'&&<a className={s.link} href="/account/recover">首次设置或忘记密码</a>}
  </section>
 </main>;
}
