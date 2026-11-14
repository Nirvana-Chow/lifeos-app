import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {journalFixture,journalStatus} from './helpers/journal-history.ts';

test('OPT-IN canonical journal calendar filters verified periods, preserves drafts and clears stale private reads',{
 skip:process.env.RUN_JOURNAL_CALENDAR_BROWSER!=='1'&&'Requires the allocated isolated synthetic Next/Chromium slot',timeout:240_000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-journal-calendar-browser-'));
 await mkdir(join(root,'app/personal/journal'),{recursive:true});
 await Promise.all([
  ...['layout.tsx','globals.css','theme.css'].map(name=>cp(join(source,'app',name),join(root,'app',name))),
  cp(join(source,'src'),join(root,'src'),{recursive:true}),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components')),
 ]);
 await writeFile(join(root,'app/personal/journal/page.tsx'),`import {JournalRecordPage} from '../../../src/personal-journal/page';export default function Page(){return <JournalRecordPage/>;}`);
 const port=Number(process.env.LIFEOS_JOURNAL_BROWSER_PORT??3007),origin='http://127.0.0.1:'+port;
 const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 const stopped=once(server,'exit');let log='';server.stderr.on('data',chunk=>{log+=String(chunk);});
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 await new Promise<void>((accept,reject)=>{const timer=setTimeout(()=>reject(Error(log||'Fixture failed to start')),30000);server.once('exit',()=>{clearTimeout(timer);reject(Error(log||'Fixture exited'));});server.stdout.on('data',chunk=>{log+=String(chunk);if(log.includes(origin)){clearTimeout(timer);accept();}});});
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 for(const [width,theme] of [[1365,'light'],[390,'dark']] as const){
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme,timezoneId:'America/Los_Angeles'});
  const original=journalFixture(1,'2025-11-13'),current={...original,revision:2,draft:{...original.draft,text:'Synthetic current revision'}},today=journalFixture(2,'2026-11-13'),undated=journalFixture(3,null);
  let items=[current,today,undated,journalFixture(4,'2026-12-28'),journalFixture(5,'2027-01-01'),...Array.from({length:21},(_,i)=>journalFixture(10+i,'2026-11-13'))];
  let authorized=true,wrongScope=false,detail=current,delayed=false;
  let release:(()=>void)|undefined;const held:Promise<void>[]=[];
  const external:string[]=[],writes:string[]=[],errors:string[]=[],originalReads:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(url.origin!==origin){external.push(url.origin);return route.abort();}
   if(!url.pathname.startsWith('/api/'))return route.continue();if(request.method()!=='GET')writes.push(request.method());
   if(!authorized)return route.fulfill({status:401,json:{error:{message:'Synthetic session ended'}}});
   const snapshot={scope:'full-current-snapshot',items,total:items.length,truncated:false,observedAt:'2026-11-12T16:00:00.000Z'};
   if(url.pathname==='/api/platform/personal/journal/snapshot'&&delayed){
    const gate=new Promise<void>(accept=>{release=accept;});held.push(gate);await gate;
    return route.fulfill({status:200,json:snapshot});
   }
   if(url.pathname==='/api/platform/personal/journal/'+current.id)originalReads.push(url.pathname);
   const values:Record<string,unknown>={
    '/api/platform/personal/status':{...journalStatus,writable:true,...wrongScope?{spaceId:'another-synthetic-space'}:{}},
    '/api/platform/personal/journal/snapshot':snapshot,
    '/api/platform/personal/overview':{items:[]},
    ['/api/platform/personal/journal/'+current.id]:{entry:detail},
    ['/api/platform/personal/journal/'+current.id+'/history']:{items:[detail,original],scope:'bounded-record-history',truncated:false},
   };
   return route.fulfill({status:200,json:values[url.pathname]??{}});
  });
  await page.goto(origin+'/personal/journal',{waitUntil:'domcontentloaded',timeout:90000});
  const calendar=page.getByRole('region',{name:'日记日历与周期资料',exact:true,includeHidden:true});
  await expect(calendar.getByRole('heading',{name:'日记日历',exact:true})).toBeVisible();
  await expect(calendar.getByText('北京时间 2026-11-13',{exact:true})).toBeVisible();
  await expect(calendar.getByText('显示 20 / 22 条日记',{exact:true})).toBeVisible();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  const day=calendar.getByRole('button',{name:'2026-11-13，22 条日记',exact:true});
  await day.focus();await page.keyboard.press('Enter');await expect(calendar.getByLabel('资料周期')).toHaveValue('day');
  await expect(calendar.getByText(/已保存 22 条，分布在 1 个记录日期/)).toBeVisible();
  await calendar.getByRole('button',{name:'显示更多日记',exact:true}).click();
  await expect(calendar.getByText('显示 22 / 22 条日记',{exact:true})).toBeVisible();
  await calendar.getByRole('button',{name:'下个月',exact:true}).click();
  await expect(calendar.getByLabel('参考日期')).toHaveValue('2026-12-13');
  await calendar.getByLabel('参考日期').fill('2027-01-01');await calendar.getByLabel('资料周期').selectOption('week');
  await expect(calendar.getByText('2026-12-28 至 2027-01-03（含首尾日）',{exact:true})).toBeVisible();
  await expect(calendar.getByText(/已保存 2 条，分布在 2 个记录日期/)).toBeVisible();
  await calendar.getByLabel('资料周期').selectOption('quarter');
  await expect(calendar.getByText('2027-01-01 至 2027-03-31（含首尾日）',{exact:true})).toBeVisible();
  await calendar.getByLabel('资料周期').selectOption('year');
  await expect(calendar.getByText('2027-01-01 至 2027-12-31（含首尾日）',{exact:true})).toBeVisible();
  await expect(calendar.getByRole('region',{name:'日期未知的日记'}).getByRole('link',{name:'Synthetic diary 3',exact:true})).toBeVisible();
  await calendar.getByLabel('参考日期').fill('2025-11-13');await calendar.getByLabel('资料周期').selectOption('day');
  const coverageLink=calendar.getByRole('link',{name:'Synthetic diary 1',exact:true});
  await expect(coverageLink).toHaveAttribute('href','/personal/journal?record='+current.id);await coverageLink.click();
  await expect(page.getByRole('article',{name:'日记原文'}).getByText('Synthetic current revision',{exact:true})).toBeVisible();
  // A current editor draft stays mounted when local read filters change. The modal deliberately
  // blocks normal pointer access to the background, so dispatch only this filter's native event.
  await page.getByRole('button',{name:'新增日记',exact:true}).click();
  await page.getByRole('textbox',{name:'标题',exact:true}).fill('Synthetic unsaved title');
  await page.getByRole('textbox',{name:'正文',exact:true}).fill('Synthetic unsaved journal text');
  await calendar.getByRole('button',{name:'回到今天',exact:true,includeHidden:true}).evaluate(element=>(element as HTMLButtonElement).click());
  await expect(page.getByRole('textbox',{name:'正文',exact:true})).toHaveValue('Synthetic unsaved journal text');
  const history=page.getByRole('region',{name:'历史上的今天',exact:true,includeHidden:true});
  const originalLink=history.getByRole('link',{name:'Synthetic diary 1',exact:true,includeHidden:true});
  const before=originalReads.length;page.once('dialog',dialog=>dialog.dismiss());
  await originalLink.evaluate(element=>(element as HTMLAnchorElement).click());
  await expect(page.getByRole('textbox',{name:'正文',exact:true})).toHaveValue('Synthetic unsaved journal text');
  assert.equal(originalReads.length,before);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'取消',exact:true}).click();
  await originalLink.click();
  await expect(page.getByRole('article',{name:'日记原文'}).getByText('Synthetic current revision',{exact:true})).toBeVisible();
  await expect(page.getByRole('article',{name:'日记原文'}).getByText('Synthetic original diary',{exact:true})).toBeVisible();
  // An independently read newer source cannot validate the older snapshot reference.
  detail={...current,revision:3,draft:{...current.draft,text:'Synthetic superseding revision'}};
  await originalLink.click();await expect(history.getByRole('alert')).toHaveText(/版本已变化/);
  await expect(calendar).toHaveCount(0);await expect(page.getByRole('article',{name:'日记原文'})).toHaveCount(0);
  items=items.map(row=>row.id===detail.id?detail:row);
  await history.getByRole('button',{name:'重新读取历史',exact:true}).click();
  await expect(calendar.getByRole('heading',{name:'日记日历',exact:true})).toBeVisible();
  await history.getByRole('link',{name:'Synthetic diary 1',exact:true}).click();
  await expect(page.getByRole('article',{name:'日记原文'}).getByText('Synthetic superseding revision',{exact:true})).toBeVisible();
  await expect(history.getByText('Synthetic current revision',{exact:true})).toHaveCount(0);
  wrongScope=true;await history.getByRole('button',{name:'重新读取历史',exact:true}).click();
  await expect(calendar).toHaveCount(0);await expect(history.getByRole('alert')).toBeVisible();
  wrongScope=false;await history.getByRole('button',{name:'重新读取历史',exact:true}).click();await expect(calendar).toBeVisible();
  delayed=true;await history.getByRole('button',{name:'重新读取历史',exact:true}).click();
  await expect.poll(()=>held.length).toBe(1);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
  release?.();await Promise.all(held);await expect(calendar).toHaveCount(0);
  await expect(page.getByRole('article',{name:'日记原文'})).toHaveCount(0);
  delayed=false;await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(calendar).toBeVisible();
  authorized=false;await history.getByRole('button',{name:'重新读取历史',exact:true}).click();
  await expect(calendar).toHaveCount(0);await expect(history.getByRole('alert')).toHaveText(/请登录/);
  authorized=true;items=[];await history.getByRole('button',{name:'重新读取历史',exact:true}).click();
  await expect(calendar.getByText('当前库内没有这个周期的有日期日记。',{exact:true})).toBeVisible();
  await expect(calendar.getByText(/当前已接入 0 条日记/)).toBeVisible();
  await expect(calendar.getByRole('region',{name:'日期未知的日记'}).getByRole('link')).toHaveCount(0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  assert.deepEqual(external,[]);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);await page.close();
 }
 assert.ok(!/Failed to compile|Module not found/.test(log),log);
});
