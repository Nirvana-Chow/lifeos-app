'use client';

import {Monitor, Moon, Sun} from 'lucide-react';
import {useId, useSyncExternalStore} from 'react';
import {serverThemeSnapshot, themeStore} from './theme-store';
import {appearancePalettes,type AppearancePalette,type ThemePreference} from './theme';
import s from './theme-switch.module.css';

export function ThemeSwitch({allowSystem=false}:{allowSystem?:boolean}={}) {
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
  {allowSystem&&<button
   type="button"
   className={s.toggle}
   data-slot="theme-system"
   disabled={!ready}
   aria-hidden={!ready||undefined}
   aria-label="跟随系统"
   aria-pressed={preference==='system'}
   aria-describedby={notice?noticeId:undefined}
   title="跟随系统"
   onClick={()=>themeStore.setPreference('system')}
  ><Monitor size={20} aria-hidden="true"/></button>}
  {notice&&<span id={noticeId} className={s.notice} role="status">{notice}</span>}
 </div>;
}

export function ThemeSystemAction({className}: {className: string}) {
 const {ready, preference}=useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot, () => serverThemeSnapshot);
 return <button type="button" className={className} disabled={!ready} aria-pressed={preference==='system'}
  onClick={()=>themeStore.setPreference('system')}>
  <Monitor size={17} aria-hidden="true"/>跟随系统
 </button>;
}

/** General settings uses the same document store and early-paint preference as the header. */
export function AppearanceSettings({showPalettePresets=true}:{showPalettePresets?:boolean}={}){
 const paletteGroup=useId();
 const {ready,preference,palette,notice}=useSyncExternalStore(themeStore.subscribe,themeStore.getSnapshot,()=>serverThemeSnapshot);
 return <section className={s.settings} aria-label="外观设置"><h2>外观</h2>
  <label>明暗模式<select aria-label="明暗模式" disabled={!ready} value={preference} onChange={event=>themeStore.setPreference(event.target.value as ThemePreference)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
  {showPalettePresets&&<fieldset className={s.palettes} disabled={!ready}><legend>配色预设</legend><div className={s.paletteOptions}>{Object.entries(appearancePalettes).map(([value,label])=><label key={value} className={s.paletteOption} data-palette={value} data-selected={palette===value}>
   <input type="radio" name={paletteGroup} value={value} checked={palette===value} onChange={()=>themeStore.setPalette(value as AppearancePalette)}/>
   <span className={s.swatch} aria-hidden="true"><span/><span/><span/></span><span>{label}</span>
  </label>)}</div></fieldset>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
