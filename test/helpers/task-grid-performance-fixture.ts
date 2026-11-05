import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {themeStorageKey} from '../../src/workbench/theme.ts';
import {privateRead, type PrivateFixture} from './private-business-browser-fixture.ts';
import {requireTaskGrid, taskGridRoot} from './task-grid-browser-driver.ts';

const origin = 'https://review.example.test';
const prefix = '合成性能待办';
const path = '/api/platform/personal/todo';
const overview = '/api/platform/personal/overview?today=2030-11-02';

export async function measureTaskGrid({browser,context,page,entries}:PrivateFixture, rows:100|1000, previousRows:0|100=0) {
  assert.equal(new URL(page.url()).origin, origin);
  assert.ok(previousRows < rows);
  assert.equal((await privateRead(page,overview)).total, previousRows+3);
  const seeded = await page.evaluate(async ({rows,previousRows,prefix,path}) => {
    for (let index=previousRows; index<rows; index++) {
      const title=prefix+' '+String(index).padStart(4,'0');
      const response=await fetch(path,{
        method:'POST',credentials:'same-origin',
        headers:{'content-type':'application/json','idempotency-key':'synthetic-grid-benchmark-'+index},
        body:JSON.stringify({spaceId:'personal-review-space',confirmed:true,fields:{title,notes:'隔离性能验证',dueOn:'2030-11-03',status:'open'}}),
      });
      if (response.status!==201) return false;
      const {entry,duplicate}=await response.json();
      if (duplicate!==false || entry.revision!==1 || entry.draft.title!==title) return false;
    }
    return true;
  },{rows,previousRows,prefix,path});
  assert.equal(seeded,true);
  const snapshot=await privateRead(page,overview);
  assert.equal(snapshot.total,rows+3);
  assert.equal(snapshot.truncated,false);
  for (const entry of entries) assert.deepEqual(snapshot.items.find((item:{id:string})=>item.id===entry.id),entry);

  const results=[];
  const cookies=await context.cookies(origin);
  for (const layout of [{width:1365,height:900,theme:'light'},{width:390,height:844,theme:'dark'}] as const) {
    const raw={cold:[] as number[],warm:[] as number[]};
    for (let i=0;i<3;i++) {
      const sample=await browser.newContext({viewport:{width:layout.width,height:layout.height},colorScheme:layout.theme});
      try {
        await sample.addCookies(cookies);
        await sample.addInitScript(({key,theme})=>localStorage.setItem(key,theme),{key:themeStorageKey,theme:layout.theme});
        const tab=await sample.newPage();
        for (const mode of ['cold','warm'] as const) {
          await tab.goto(origin+'/personal?page=tasks',{waitUntil:'domcontentloaded'});
          await expect(tab.locator('html')).toHaveAttribute('data-lifeos-theme',layout.theme);
          const count=tab.locator('.lo-result-count');
          await expect(count).toHaveText((rows+1)+' 项');
          const search=tab.getByRole('textbox',{name:'搜索待办',exact:true});
          await search.fill('合成性能验证空结果');
          await expect(count).toHaveText('0 项');
          await search.evaluate((node,target)=>{
            const input=node as HTMLInputElement;
            type TimingWindow=Window & {syntheticGridElapsed?:Promise<number>};
            (window as TimingWindow).syntheticGridElapsed=new Promise((resolve,reject)=>{
              const timeout=setTimeout(()=>reject(Error('SYNTHETIC_GRID_TIMEOUT')),8000);
              input.addEventListener('input',()=>{
                const start=performance.now();
                const observe=()=>{
                  if(document.querySelector('.lo-result-count')?.textContent?.trim()!==target){
                    requestAnimationFrame(observe);
                    return;
                  }
                  requestAnimationFrame(()=>{
                    clearTimeout(timeout);
                    resolve(performance.now()-start);
                  });
                };
                requestAnimationFrame(observe);
              },{capture:true,once:true});
            });
          },rows+' 项');
          await search.fill(prefix);
          const elapsed=await tab.evaluate(async()=>await (window as Window & {syntheticGridElapsed?:Promise<number>}).syntheticGridElapsed);
          assert.ok(typeof elapsed==="number"&&Number.isFinite(elapsed)&&elapsed>=0);
          const firstTitle=taskGridRoot(tab).locator('tbody td[data-col-id="title"]').first();
          await expect(firstTitle).toHaveText(/^合成性能待办 \d{4}$/);
          await requireTaskGrid(tab,(await firstTitle.innerText()).trim(),rows);
          raw[mode].push(Math.round(elapsed*100)/100);
        }
      } finally {
        await sample.close();
      }
    }
    const summary=(values:number[])=>{const [min,median,max]=values.toSorted((a,b)=>a-b);return {raw:values,min,median,max};};
    results.push({...layout,rows,cold:summary(raw.cold),warm:summary(raw.warm)});
  }
  for (const entry of entries) {
    const type=entry.id===entries[0].id?'domain':entry.id===entries[1].id?'project':'todo';
    assert.deepEqual((await privateRead(page,'/api/platform/personal/'+type+'/'+entry.id)).entry,entry);
  }
  return results;
}
