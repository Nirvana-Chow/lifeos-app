import {readThemePreference,resolveTheme,saveThemePreference,themeStorageKey,type ThemePreference,readAppearancePalette,paletteStorageKey,type AppearancePalette} from './theme';

export type ThemeSnapshot=Readonly<{ready:boolean;preference:ThemePreference;palette:AppearancePalette;resolved:'light'|'dark';notice:string}>;
export const serverThemeSnapshot:ThemeSnapshot={ready:false,preference:'system',palette:'slate-indigo',resolved:'light',notice:''};
/** One document store. Controls only subscribe; the root runtime owns listeners. */
export function createThemeStore(){
 let snapshot=serverThemeSnapshot,initialized=false,owners=0,stop:(()=>void)|undefined;
 const subscribers=new Set<()=>void>();
 const system=()=>{try{return window.matchMedia('(prefers-color-scheme: dark)');}catch{return null;}};
 function apply(preference:ThemePreference,notice='',palette:AppearancePalette=snapshot.palette){
  const resolved=resolveTheme(preference,system()?.matches??false);
  document.documentElement.dataset.lifeosTheme=resolved;
  document.documentElement.dataset.lifeosPalette=palette;
  document.documentElement.style.colorScheme=resolved;
  if(snapshot.ready&&snapshot.preference===preference&&snapshot.resolved===resolved&&snapshot.notice===notice&&snapshot.palette===palette)return;
  snapshot={ready:true,preference,palette,resolved,notice};subscribers.forEach(fn=>fn());
 }
 return {
  getSnapshot:()=>snapshot,
  subscribe(listener:()=>void){subscribers.add(listener);return()=>{subscribers.delete(listener);};},
  setPreference(value:ThemePreference){
   const preference=readThemePreference(value);let saved=false;
   try{saved=saveThemePreference(window.localStorage,preference);}catch{}
   initialized=true;apply(preference,saved?'':'外观已切换，浏览器未允许保存偏好。');
  },
  setPalette(value:AppearancePalette){
   const palette=readAppearancePalette(value);let saved=false;
   try{window.localStorage.setItem(paletteStorageKey,palette);saved=true;}catch{}
   initialized=true;apply(snapshot.preference,saved?'':'外观已切换，浏览器未允许保存偏好。',palette);
  },
  start(){
   if(owners++===0){
    if(!initialized){let preference:ThemePreference='system',palette:AppearancePalette='slate-indigo';try{preference=readThemePreference(window.localStorage.getItem(themeStorageKey));palette=readAppearancePalette(window.localStorage.getItem(paletteStorageKey));}catch{}initialized=true;apply(preference,'',palette);}else apply(snapshot.preference,snapshot.notice);
    const media=system();
    const onSystem=()=>apply(snapshot.preference,snapshot.notice);
    const onStorage=(event:StorageEvent)=>{if(event.key!==themeStorageKey&&event.key!==paletteStorageKey&&event.key!==null)return;try{if(event.storageArea&&event.storageArea!==window.localStorage)return;}catch{}if(event.key===paletteStorageKey)apply(snapshot.preference,'',readAppearancePalette(event.newValue));else if(event.key===null)apply('system','','slate-indigo');else apply(readThemePreference(event.newValue));};
    media?.addEventListener('change',onSystem);window.addEventListener('storage',onStorage);
    stop=()=>{media?.removeEventListener('change',onSystem);window.removeEventListener('storage',onStorage);};
   }
   let active=true;return()=>{if(!active)return;active=false;if(--owners===0){stop?.();stop=undefined;}};
  },
 };
}
export const themeStore=createThemeStore();
