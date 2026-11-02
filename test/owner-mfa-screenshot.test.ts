import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {safeScreenshot} from './helpers/owner-recovery-browser-fixture.ts';
test('screenshot gate refuses rendered MFA seed, QR or backup codes even when inputs are empty',async()=>{
 const prior=process.env.RUNNER_TEMP,dir=mkdtempSync(join(tmpdir(),'lifeos-synthetic-screenshot-'));process.env.RUNNER_TEMP=dir;
 try{for(const secret of ['mfa-setup-key','canvas','备用恢复码']){
  let screenshots=0;
  const page={locator:(selector:string)=>({evaluateAll:async(check:(nodes:unknown[])=>boolean)=>check([{tagName:'INPUT',name:'code',value:''},...(selector.includes(secret)?[{tagName:'CANVAS'}]:[])])}),screenshot:async()=>{screenshots++;}};
  await assert.rejects(safeScreenshot(page as never,'login-desktop.png'),/SCREENSHOT_DENIED/);assert.equal(screenshots,0);
 }}finally{if(prior===undefined)delete process.env.RUNNER_TEMP;else process.env.RUNNER_TEMP=prior;rmSync(dir,{recursive:true,force:true});}
});
