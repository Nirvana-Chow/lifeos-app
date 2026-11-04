'use client';

import {useEffect,useRef} from 'react';
import {PasswordPage} from './password-page';
import styles from './password-page.module.css';

/** Disabled progressive fallback only. The existing modal owns interactive edits. */
export function LegacyPasswordEntry({enabled=false}:{enabled?:boolean}){
 const fallback=useRef<HTMLFieldSetElement>(null),started=useRef(false);
 useEffect(()=>{
  if(started.current)return;
  started.current=true;
  fallback.current?.querySelector('form')?.reset();
  window.location.replace('/personal?modal=settings&panel=security');
 },[]);
 // The outer fieldset stays disabled even after PasswordPage hydrates. No
 // credential can become editable or be native-serialized during navigation.
 return <main data-lifeos-surface="auth" className={styles.page}><div style={{maxWidth:640,margin:'0 auto'}}>
  <h1>修改密码</h1>
  <fieldset ref={fallback} disabled data-legacy-password-entry style={{border:0,margin:0,padding:0,minWidth:0}}>
   <PasswordPage enabled={enabled} changeOnly embedded/>
  </fieldset>
 </div></main>;
}
