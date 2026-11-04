'use client';

import {Moon, Sun} from 'lucide-react';
import {useId, useSyncExternalStore} from 'react';
import {serverThemeSnapshot, themeStore} from './theme-store';
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
