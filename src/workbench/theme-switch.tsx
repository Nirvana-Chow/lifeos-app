'use client';
import{useEffect,useRef,useState}from'react';
import{themeStorageKey,readThemePreference,resolveTheme,saveThemePreference,type ThemePreference}from'./theme';
import s from'./styles.module.css';
export function ThemeSwitch(){
 const currentPreference=useRef<ThemePreference>('system');
 const[preference,setPreference]=useState<ThemePreference>('system'),[notice,setNotice]=useState('');
 const apply=(next:ThemePreference)=>{const theme=resolveTheme(next,window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.lifeosTheme=theme;document.documentElement.style.colorScheme=theme;};
 useEffect(()=>{let value:ThemePreference='system';try{value=readThemePreference(localStorage.getItem(themeStorageKey));}catch{}currentPreference.current=value;setPreference(value);apply(value);
  const system=window.matchMedia('(prefers-color-scheme: dark)');
  const sync=()=>apply(currentPreference.current);
  const storage=(event:StorageEvent)=>{if(event.key===themeStorageKey||event.key===null){const next=readThemePreference(event.key===null?null:event.newValue);currentPreference.current=next;setPreference(next);apply(next);}};
  system.addEventListener('change',sync);window.addEventListener('storage',storage);return()=>{system.removeEventListener('change',sync);window.removeEventListener('storage',storage);};
 },[]);
 return <div className={s.themeControl}><select aria-label="外观模式" title="外观模式" value={preference} onChange={event=>{const next=readThemePreference(event.target.value);currentPreference.current=next;setPreference(next);apply(next);let saved=false;try{saved=saveThemePreference(localStorage,next);}catch{}setNotice(saved?'':'外观已切换，浏览器未允许保存偏好。');}}><option value="system">系统</option><option value="light">浅色</option><option value="dark">深色</option></select>{notice&&<span className={s.themeNotice} role="status">{notice}</span>}</div>;
}
