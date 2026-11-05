export type ThemePreference='light'|'dark'|'system';
export const themeStorageKey='lifeos-ui-theme';
export const paletteStorageKey='lifeos-ui-palette';
export const appearancePalettes={'slate-indigo':'岩灰 · 靛蓝','sage-teal':'鼠尾草 · 青绿','mauve-violet':'雾紫 · 紫罗兰'} as const;
export type AppearancePalette=keyof typeof appearancePalettes;
export function readAppearancePalette(value:unknown):AppearancePalette{return typeof value==='string'&&Object.hasOwn(appearancePalettes,value)?value as AppearancePalette:'slate-indigo';}
export function readThemePreference(value:unknown):ThemePreference{return value==='light'||value==='dark'?value:'system';}
export function resolveTheme(value:ThemePreference,systemDark:boolean):'light'|'dark'{return value==='system'?(systemDark?'dark':'light'):value;}
export function saveThemePreference(storage:Pick<Storage,'setItem'>,value:ThemePreference):boolean{try{storage.setItem(themeStorageKey,value);return true;}catch{return false;}}
// Runs in the document head before paint. Only a validated, non-sensitive UI
// preference is read; storage denial falls back to the system appearance.
export const themeInitializationScript=`(()=>{let p='system',a='slate-indigo';try{const s=localStorage.getItem('lifeos-ui-theme');if(s==='light'||s==='dark')p=s;const c=localStorage.getItem('lifeos-ui-palette');if(c==='sage-teal'||c==='mauve-violet')a=c;}catch{}let d=false;try{d=matchMedia('(prefers-color-scheme: dark)').matches;}catch{}const t=p==='system'?(d?'dark':'light'):p;document.documentElement.dataset.lifeosPalette=a;document.documentElement.dataset.lifeosTheme=t;document.documentElement.style.colorScheme=t;})();`;
