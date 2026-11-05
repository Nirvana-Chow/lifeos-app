import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {readFileSync} from 'node:fs';
import {themeStorageKey,paletteStorageKey,readThemePreference,resolveTheme,saveThemePreference,themeInitializationScript} from '../src/workbench/theme.ts';

test('theme preference accepts only light, dark or system and follows system when unset',()=>{
 assert.equal(readThemePreference('dark'),'dark');assert.equal(readThemePreference('light'),'light');
 for(const value of [null,undefined,'',{},'<script>','sepia'])assert.equal(readThemePreference(value),'system');
 assert.equal(resolveTheme('system',true),'dark');assert.equal(resolveTheme('system',false),'light');
 assert.equal(resolveTheme('light',true),'light');assert.equal(resolveTheme('dark',false),'dark');
});
test('only a harmless UI preference is persisted and denied storage is reported',()=>{
 const calls:unknown[][]=[];
 assert.equal(saveThemePreference({setItem:(...args:string[])=>calls.push(args)},'dark'),true);
 assert.deepEqual(calls,[[themeStorageKey,'dark']]);
 assert.equal(saveThemePreference({setItem:()=>{throw Error('denied');}},'light'),false);
});
test('pre-paint script resolves stored, invalid and unavailable preferences without reading unrelated storage',()=>{
 for(const [saved,system,expected] of [['dark',false,'dark'],['light',true,'light'],['system',true,'dark'],['invalid',false,'light'],[null,true,'dark']] as const){
  const root={dataset:{} as Record<string,string>,style:{} as Record<string,string>};const keys:string[]=[];
  runInNewContext(themeInitializationScript,{document:{documentElement:root},localStorage:{getItem:(key:string)=>{keys.push(key);return saved;}},matchMedia:()=>({matches:system})});
  assert.equal(root.dataset.lifeosTheme,expected);assert.equal(root.style.colorScheme,expected);assert.deepEqual(keys,[themeStorageKey,paletteStorageKey]);
 }
 const root={dataset:{} as Record<string,string>,style:{} as Record<string,string>};
 runInNewContext(themeInitializationScript,{document:{documentElement:root},localStorage:{getItem:()=>{throw Error('denied');}},matchMedia:()=>({matches:true})});
 assert.equal(root.dataset.lifeosTheme,'dark');
});

test('all six curated palettes keep text, selected/hover and focus contrast readable',()=>{
 const css=readFileSync(new URL('../app/theme.css',import.meta.url),'utf8');
 const ratio=(a:string,b:string)=>{const lum=(hex:string)=>{const v=[0,2,4].map(at=>parseInt(hex.slice(1).slice(at,at+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722;};const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 const blocks=[...css.matchAll(/([^{}]+)\{([^{}]*--background:[^{}]+)\}/g)].filter(m=>!m[1].includes('not([data-lifeos-theme=light])'));
 assert.equal(blocks.length,6);
 for(const [_,selector,block] of blocks){const tokens=Object.fromEntries([...block.matchAll(/--([\w-]+):(#[0-9a-f]{6})\b/g)].map(m=>[m[1],m[2]]));
  for(const [ink,paper] of [['foreground','background'],['card-foreground','card'],['muted-foreground','muted'],['primary-foreground','primary'],['danger','danger-background'],['lo-link','background'],['lo-link','lo-chrome'],['muted-foreground','lo-chrome'],['popover-foreground','popover'],['lo-selected-foreground','lo-selected'],['accent-foreground','lo-hover']])assert.ok(ratio(tokens[ink],tokens[paper])>=4.5,`${selector} ${ink}/${paper}: ${ratio(tokens[ink],tokens[paper])}`);
  assert.ok(ratio(tokens.ring,tokens.background)>=3,selector+' keyboard focus');assert.ok(ratio(tokens.input,tokens.card)>=3,selector+' input outline');
 }
});
test('workspace wrappers do not shadow semantic palette tokens with legacy color definitions',()=>{
 for(const path of ['src/workbench/styles.module.css','src/admin-preview/styles.module.css']){
  const css=readFileSync(new URL('../'+path,import.meta.url),'utf8');
  assert.doesNotMatch(css,/--(?:ink|muted|line|soft)\s*:/,path);
 }
 assert.doesNotMatch(readFileSync(new URL('../src/chat-workbench/styles.module.css',import.meta.url),'utf8'),/prefers-color-scheme/);
});
