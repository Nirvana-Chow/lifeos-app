import {readThemePreference,resolveTheme,saveThemePreference,themeStorageKey,type ThemePreference} from './theme';

export type ThemeSnapshot=Readonly<{preference:ThemePreference;resolved:'light'|'dark';notice:string}>;
export const serverThemeSnapshot:ThemeSnapshot={preference:'system',resolved:'light',notice:''};
/** One document store. Controls only subscribe; the root runtime owns listeners. */
export function createThemeStore(){
 let snapshot=serverThemeSnapshot,initialized=false,owners=0,stop:(()=>void)|undefined;
 const subscribers=new Set<()=>void>();
 const system=()=>{try{return window.matchMedia('(prefers-color-scheme: dark)');}catch{return null;}};
 function apply(preference:ThemePreference,notice=''){
  const resolved=resolveTheme(preference,system()?.matches??false);
  document.documentElement.dataset.lifeosTheme=resolved;
  document.documentElement.style.colorScheme=resolved;
  if(snapshot.preference===preference&&snapshot.resolved===resolved&&snapshot.notice===notice)return;
  snapshot={preference,resolved,notice};subscribers.forEach(fn=>fn());
 }
 return {
  getSnapshot:()=>snapshot,
  subscribe(listener:()=>void){subscribers.add(listener);return()=>{subscribers.delete(listener);};},
  setPreference(value:ThemePreference){
   const preference=readThemePreference(value);let saved=false;
   try{saved=saveThemePreference(window.localStorage,preference);}catch{}
   initialized=true;apply(preference,saved?'':'外观已切换，浏览器未允许保存偏好。');
  },
  start(){
   if(owners++===0){
    if(!initialized){let preference:ThemePreference='system';try{preference=readThemePreference(window.localStorage.getItem(themeStorageKey));}catch{}initialized=true;apply(preference);}else apply(snapshot.preference,snapshot.notice);
    const media=system();
    const onSystem=()=>apply(snapshot.preference,snapshot.notice);
    const onStorage=(event:StorageEvent)=>{if(event.key!==themeStorageKey&&event.key!==null)return;try{if(event.storageArea&&event.storageArea!==window.localStorage)return;}catch{}apply(readThemePreference(event.key===null?null:event.newValue));};
    media?.addEventListener('change',onSystem);window.addEventListener('storage',onStorage);
    stop=()=>{media?.removeEventListener('change',onSystem);window.removeEventListener('storage',onStorage);};
   }
   let active=true;return()=>{if(!active)return;active=false;if(--owners===0){stop?.();stop=undefined;}};
  },
 };
}
export const themeStore=createThemeStore();
