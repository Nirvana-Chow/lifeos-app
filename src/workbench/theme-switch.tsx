'use client';
import {useId,useSyncExternalStore} from 'react';
import {serverThemeSnapshot,themeStore} from './theme-store';
import s from './theme-switch.module.css';
const modes=[['light','浅色'],['dark','深色'],['system','系统']] as const;
export function ThemeSwitch(){
 const id=useId(),{ready,preference,notice}=useSyncExternalStore(themeStore.subscribe,themeStore.getSnapshot,()=>serverThemeSnapshot);
 return <div className={s.control} data-lifeos-theme-control="">
  <fieldset className={`${s.modes}${ready?'':' '+s.pending}`} disabled={!ready} aria-hidden={!ready||undefined} aria-label="外观模式" aria-describedby={notice?id+'-notice':undefined}>
   {modes.map(([value,label])=><label key={value} className={s.mode}><input type="radio" name={id+'-appearance'} value={value} checked={ready&&preference===value} onChange={()=>themeStore.setPreference(value)}/><span>{label}</span></label>)}
  </fieldset>
  {notice&&<span id={id+'-notice'} className={s.notice} role="status">{notice}</span>}
 </div>;
}
