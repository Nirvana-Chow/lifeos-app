import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAuthFixtureAppearance} from './helpers/owner-recovery-browser-fixture.ts';
test('auth appearance observes the actual runtime after OS changes without injecting a theme repair',async()=>{
 const events:string[]=[];
 const page={emulateMedia:async({colorScheme}:{colorScheme:string})=>{events.push('system-'+colorScheme);},waitForFunction:async(_observe:unknown,theme:string)=>{events.push('observe-'+theme);},addScriptTag:()=>{throw Error('THEME_REPAIR_FORBIDDEN');}};
 await applyAuthFixtureAppearance(page as never,'dark');await applyAuthFixtureAppearance(page as never,'light');assert.deepEqual(events,['system-dark','observe-dark','system-light','observe-light']);
});
