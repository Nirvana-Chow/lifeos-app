'use client';

import {Moon, Sun} from 'lucide-react';
import {useId, useSyncExternalStore} from 'react';
import {serverThemeSnapshot, themeStore} from './theme-store';
import {appearancePalettes,type AppearancePalette,type ThemePreference} from './theme';
import s from './theme-switch.module.css';

export function ThemeSwitch() {
 const noticeId=useId();
 const {ready, preference, resolved, notice}=useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot, () => serverThemeSnapshot);
 const next=resolved==='dark'?'light':'dark';
 const label=next==='light'?'切换到浅色模式':'切换到深色模式';
 const Icon=next==='light'?Sun:Moon;

 return <div className={s.control} data-lifeos-theme-control="">
  <button
   type="button"
   className={s.toggle}
   data-slot="theme-toggle"
   data-theme-preference={ready?preference:undefined}
   disabled={!ready}
   aria-hidden={!ready||undefined}
   aria-label={label}
   aria-describedby={notice?noticeId:undefined}
   title={label}
   onClick={()=>themeStore.setPreference(next)}
  >
   <Icon size={20} aria-hidden="true"/>
  </button>
  {notice&&<span id={noticeId} className={s.notice} role="status">{notice}</span>}
 </div>;
}

/** General settings uses the same document store and early-paint preference as the header. */
export function AppearanceSettings(){
 const {ready,preference,palette,notice}=useSyncExternalStore(themeStore.subscribe,themeStore.getSnapshot,()=>serverThemeSnapshot);
 return <section className={s.settings} aria-label="外观设置"><h2>外观</h2>
  <label>明暗模式<select aria-label="明暗模式" disabled={!ready} value={preference} onChange={event=>themeStore.setPreference(event.target.value as ThemePreference)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
  <label>配色<select aria-label="配色" disabled={!ready} value={palette} onChange={event=>themeStore.setPalette(event.target.value as AppearancePalette)}>{Object.entries(appearancePalettes).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
