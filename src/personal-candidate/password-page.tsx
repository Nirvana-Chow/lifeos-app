'use client';

import {useEffect,useState,useRef,type FormEvent} from 'react';
import Link from 'next/link';
import {OwnerEmailResetPanel} from './owner-email-reset-panel';
import {Button} from '../ui-review/ui/button';
import s from './password-page.module.css';

export function PasswordPage({enabled=false,changeOnly=false,embedded=false,closeGuard}: {
 enabled?:boolean;changeOnly?:boolean;embedded?:boolean;closeGuard?:{current:(()=>boolean)|null};
}) {
 const formRef=useRef<HTMLFormElement|null>(null);
 const busyRef=useRef(false);
 const [mode,setMode]=useState<'reset'|'change'>(changeOnly?'change':'reset');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 busyRef.current=busy;
 useEffect(()=>{if(!closeGuard)return;const guard=()=>{if(busyRef.current)return false;const dirty=Array.from(formRef.current?.querySelectorAll<HTMLInputElement>('input[type="password"]')??[]).some(input=>!!input.value);return !dirty||window.confirm('放弃尚未保存的密码修改？');};closeGuard.current=guard;return()=>{if(closeGuard.current===guard)closeGuard.current=null;};},[closeGuard]);
 const [hydrated,setHydrated]=useState(false);
 useEffect(()=>{setHydrated(true);},[]);

 async function submit(event:FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if(!enabled||!hydrated||busyRef.current)return;
  const form=event.currentTarget,data=new FormData(form);
  if(data.get('newPassword')!==data.get('confirmation')) {
   setMessage('两次密码不一致。');
   return;
  }
  busyRef.current=true;setBusy(true);
  try {
   const response=await fetch('/api/platform/personal/password',{
    method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},
    body:JSON.stringify({mode,newPassword:data.get('newPassword'),currentPassword:data.get('currentPassword')}),
   });
   form.reset();
   if(response.ok) {
    window.location.replace('/login');
    return;
   }
   setMessage('未能更新，请核对当前密码或稍后重试。');
  } catch {
   form.reset();
   setMessage('结果未确认，请重新核对。');
  } finally {
   busyRef.current=false;setBusy(false);
  }
 }

 if(mode==='reset'&&!changeOnly)return <OwnerEmailResetPanel enabled={enabled} onChangeMode={()=>setMode('change')}/>;
 const Surface=embedded?'section':'main';
 return <Surface
  data-lifeos-surface={embedded?undefined:'auth'}
  aria-label={embedded?'修改密码':undefined}
  className={`${s.page}${embedded?' '+s.embedded:''}`}
 >
  <section className={s.card}>
   {!embedded&&<h1>{changeOnly?'修改本人密码':'设置本人密码'}</h1>}
   {!changeOnly&&<p>保留原账号及其所有记录，不需要重新注册。</p>}
   {!enabled&&<p role="status">安全设置待启用。不会收集或发送密码。</p>}
   {!changeOnly&&<label>操作<select value={mode} onChange={event=>setMode(event.target.value as 'reset'|'change')}>
    <option value="reset">首次设置或忘记密码</option>
    <option value="change">已登录，修改密码</option>
   </select></label>}
   <form ref={formRef} method="post" action="/account/password" onSubmit={submit}>
    <fieldset disabled={!enabled||!hydrated||busy}>
     <label>本人账号<input name="username" type={changeOnly?'text':'email'} autoComplete="username" value={changeOnly?'owner':'owner@lifeos.local'} readOnly/></label>
     <label>原密码<input name="currentPassword" type="password" autoComplete="current-password" required/></label>
     <label>新密码<input name="newPassword" type="password" minLength={12} maxLength={128} autoComplete="new-password" required/></label>
     <label>确认新密码<input name="confirmation" type="password" autoComplete="new-password" required/></label>
     <Button type="submit">{busy?'正在更新…':'保存密码'}</Button>
    </fieldset>
   </form>
   {message&&<p role="status">{message}</p>}
   {!embedded&&<p><Link href={changeOnly?'/personal?modal=settings&panel=general':'/login'}>{changeOnly?'取消':'返回登录'}</Link></p>}
  </section>
 </Surface>;
}
