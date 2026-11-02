import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {themeInitializationScript} from '../src/workbench/theme.ts';
import {applyAuthFixtureAppearance} from './helpers/owner-recovery-browser-fixture.ts';
test('a reused auth page reapplies its actual head initializer after changing emulated system appearance',async()=>{
 let dark=false;const document={documentElement:{dataset:{} as Record<string,string>,style:{} as Record<string,string>}};
 const sandbox=vm.createContext({document,localStorage:{getItem:()=>null},matchMedia:()=>({matches:dark})});vm.runInContext(themeInitializationScript,sandbox);
 const page={emulateMedia:async(options:{colorScheme:string})=>{dark=options.colorScheme==='dark';},addScriptTag:async(options:{content:string})=>{vm.runInContext(options.content,sandbox);}};
 await applyAuthFixtureAppearance(page as never,'dark');assert.equal(document.documentElement.dataset.lifeosTheme,'dark');assert.equal(document.documentElement.style.colorScheme,'dark');
 await applyAuthFixtureAppearance(page as never,'light');assert.equal(document.documentElement.dataset.lifeosTheme,'light');
});
