import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {journalFixture,journalStatus} from './helpers/journal-history.ts';

test('OPT-IN journal history route preserves original links, closed semantics, privacy and mobile keyboard access',{
 skip:process.env.RUN_JOURNAL_HISTORY_BROWSER!=='1'&&'Requires isolated synthetic Next fixture and Chromium',timeout:240_000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-journal-history-browser-'));
 await mkdir(join(root,'app/personal/journal'),{recursive:true});
 await Promise.all([
  ...['layout.tsx','globals.css','theme.css'].map(name=>cp(join(source,'app',name),join(root,'app',name))),
  cp(join(source,'src'),join(root,'src'),{recursive:true}),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components')),
 ]);
 // Isolated route harness uses the shipped client composition; owner API reads below contain synthetic records only.
 await writeFile(join(root,'app/personal/journal/page.tsx'),`import {JournalRecordPage} from '../../../src/personal-journal/page';export default function Page(){return <JournalRecordPage/>;}`);
 const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3007'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 const stopped=once(server,'exit');let log='';server.stderr.on('data',chunk=>{log+=String(chunk);});
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 await new Promise<void>((accept,reject)=>{const timer=setTimeout(()=>reject(Error(log||'Fixture failed to start')),30000);server.once('exit',()=>{clearTimeout(timer);reject(Error(log||'Fixture exited'));});server.stdout.on('data',chunk=>{log+=String(chunk);if(log.includes('http://127.0.0.1:3007')){clearTimeout(timer);accept();}});});
 const origin='http://127.0.0.1:3007',browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 for(const [width,theme] of [[1365,'light'],[390,'dark']] as const){
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme,timezoneId:'America/Los_Angeles'});
  const original=journalFixture(1,'2025-11-13'),current={...original,revision:2,draft:{...original.draft,text:'Synthetic corrected diary'}},other=journalFixture(2,'2026-11-13');
  let authorized=true,empty=false;const external:string[]=[],writes:string[]=[],errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(url.origin!==origin){external.push(url.origin);return route.abort();}
   if(!url.pathname.startsWith('/api/'))return route.continue();if(request.method()!=='GET')writes.push(request.method());
   if(!authorized)return route.fulfill({status:401,json:{error:{message:'Synthetic session ended'}}});
   const items=empty?[]:[current,other];
   const values:Record<string,unknown>={
    '/api/platform/personal/status':{...journalStatus,writable:false},
    '/api/platform/personal/journal/snapshot':{scope:'full-current-snapshot',items,total:items.length,truncated:false,observedAt:'2026-11-12T16:00:00.000Z'},
    '/api/platform/personal/overview':{items:[]},
    ['/api/platform/personal/journal/'+current.id]:{entry:current},
    ['/api/platform/personal/journal/'+current.id+'/history']:{items:[current,original],scope:'bounded-record-history',truncated:false},
   };
   return route.fulfill({status:200,json:values[url.pathname]??{}});
  });
  await page.goto(origin+'/personal/journal',{waitUntil:'domcontentloaded',timeout:90000});
  await expect(page.getByRole('heading',{name:'历史上的今天',exact:true})).toBeVisible();
  await expect(page.getByText('北京时间 2026-11-13',{exact:true})).toBeVisible();
  const link=page.getByRole('link',{name:'Synthetic diary 1',exact:true});await expect(link).toHaveAttribute('href','/personal/journal?record='+current.id);
  await expect(page.getByRole('region',{name:'历史上的今天'}).getByRole('link',{name:'Synthetic diary 2',exact:true})).toHaveCount(0);
  await link.focus();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'日记原文',exact:true})).toBeVisible();
  const article=page.getByRole('article',{name:'日记原文'});await expect(article.getByText('Synthetic original diary',{exact:true})).toBeVisible();await expect(article.getByText('Synthetic corrected diary',{exact:true})).toBeVisible();
  await page.goto(origin+'/personal/journal?record='+current.id);await expect(page.getByRole('heading',{name:'日记原文',exact:true})).toBeVisible();
  await page.getByText('相似日的实现状态',{exact:true}).click();await expect(page.getByText(/相似日尚未启用/)).toBeVisible();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.getByRole('heading',{name:'日记原文',exact:true})).toHaveCount(0);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.getByRole('heading',{name:'日记原文',exact:true})).toBeVisible();
  empty=true;await page.getByRole('button',{name:'重新读取历史',exact:true}).click();await expect(page.getByText('当前记录库没有过去年份同月同日的日记。',{exact:true})).toBeVisible();
  authorized=false;await page.getByRole('button',{name:'重新读取历史',exact:true}).click();await expect(page.getByRole('region',{name:'历史上的今天'}).getByText('Synthetic corrected diary',{exact:true})).toHaveCount(0);
  assert.deepEqual(external,[]);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);await page.close();
 }
 assert.ok(!/Failed to compile|Module not found/.test(log),log);
});
