export type ThemePreference='light'|'dark'|'system';
export const themeStorageKey='lifeos-ui-theme';
export function readThemePreference(value:unknown):ThemePreference{return value==='light'||value==='dark'?value:'system';}
export function resolveTheme(value:ThemePreference,systemDark:boolean):'light'|'dark'{return value==='system'?(systemDark?'dark':'light'):value;}
export function saveThemePreference(storage:Pick<Storage,'setItem'>,value:ThemePreference):boolean{try{storage.setItem(themeStorageKey,value);return true;}catch{return false;}}
// Runs in the document head before paint. Only a validated, non-sensitive UI
// preference is read; storage denial falls back to the system appearance.
export const themeInitializationScript=`(()=>{let p='system';try{const s=localStorage.getItem('lifeos-ui-theme');if(s==='light'||s==='dark')p=s;}catch{}let d=false;try{d=matchMedia('(prefers-color-scheme: dark)').matches;}catch{}const t=p==='system'?(d?'dark':'light'):p;document.documentElement.dataset.lifeosTheme=t;document.documentElement.style.colorScheme=t;})();`;
