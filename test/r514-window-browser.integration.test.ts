import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {createPlatformHandler} from '../src/platform/http.ts';
import type {StoredEntry} from '../src/platform/contracts.ts';
import type {RecordWindowResponse} from '../src/platform/window-contracts.ts';
import {MemoryPort} from './helpers/platform.ts';

const checkout=resolve(import.meta.dirname,'..');
const owner={id:'synthetic-timeline-owner',email:'timeline@example.invalid'};
const createdAt='1991-09-13T08:00:00.000Z';
const early='1991-09-14T16:30:00.000Z',late='1991-09-14T17:30:00.000Z';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function entry(n:number,title:string,revision:number,updatedAt:string,dueOn:string|null):StoredEntry {
  const draft={title,notes:`Synthetic text for ${title}`,status:'open' as const,dueOn};
  return {id:id(n),ownerId:owner.id,kind:'todo',draft,revision,createdAt,updatedAt,syncState:'draft',externalStatus:null,
    source:{id:id(n+1000),system:'website',externalId:id(n),version:1,asOf:createdAt,
      original:{...draft,title:'Synthetic first input',notes:'Synthetic initial text'}}};
}

test('actual synthetic review route labels repeated correction times, keeps source and paging', {
  skip:process.env.RUN_RECORD_WINDOW_BROWSER_TESTS!=='1'&&'Requires isolated Next and Chromium',timeout:180000,
},async t=>{
  const root=await mkdtemp(join(tmpdir(),'lifeos-timeline-offset-'));
  await mkdir(join(root,'app/review/admin/[...section]'),{recursive:true});
  const appFiles=['layout.tsx','theme.css','globals.css','review/admin/layout.tsx','review/admin/[...section]/page.tsx'];
  await Promise.all([
    ...appFiles.map(path=>cp(join(checkout,'app',path),join(root,'app',path))),
    cp(join(checkout,'src'),join(root,'src'),{recursive:true}),
    cp(join(checkout,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
    symlink(join(checkout,'node_modules'),join(root,'node_modules')),
    symlink(join(checkout,'components'),join(root,'components')),
  ]);
  await writeFile(join(root,'src/platform/runtime.ts'),`export const readPlatformPagePrincipal=async(headers:Headers)=>headers.get('cookie')?.includes('timeline-fixture=owner')?{userId:'${owner.id}'}:null;`);
  const child=spawn(process.execPath,[join(checkout,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{
    cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],
  });
  const stopped=once(child,'exit');
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  t.after(async()=>{try{await browser?.close();}finally{child.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});}});
  let output='';child.stderr.on('data',chunk=>{output=(output+String(chunk)).slice(-9000);});
  const origin=await new Promise<string>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error(`Fixture startup timeout ${output}`)),30000);
    child.once('exit',()=>{clearTimeout(timer);reject(Error(output));});
    child.stdout.on('data',chunk=>{const url=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url){clearTimeout(timer);resolve(url);}});
  });
  const db=new MemoryPort();
  const current=entry(1,'Synthetic latest content',4,'1991-09-16T02:00:00.000Z','1991-09-15');
  db.rows.set(current.id,current);
  db.historyRows.push(entry(1,'Synthetic earlier correction',2,early,'1991-09-15'),entry(1,'Synthetic later correction',3,late,'1991-09-15'));
  for(let i=2;i<=50;i++){
    const pad=entry(i,`Synthetic filler ${i}`,2,'1991-09-14T17:00:00.000Z',null);
    db.rows.set(pad.id,pad);db.historyRows.push(pad);
  }
  const snapshot=structuredClone([...db.rows.values()]);
  const handler=createPlatformHandler({repository:db,owner,sessions:{read:async()=>({userId:owner.id,email:owner.email})},baseURL:origin,storageVerified:true});
  const appRoute=origin+'/review/admin/records?mode=synthetic-review';
  const anonymous=await fetch(appRoute,{redirect:'manual'});
  assert.equal(anonymous.status,307);assert.equal(anonymous.headers.get('location'),'/login');
  browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
  const context=await browser.newContext({viewport:{width:1365,height:900},timezoneId:'Asia/Shanghai'});
  await context.addCookies([{name:'timeline-fixture',value:'owner',url:origin}]);
  const page=await context.newPage();
  const reads:string[]=[],writes:string[]=[],outside:string[]=[],errors:string[]=[],pages:RecordWindowResponse[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==origin){outside.push(url.origin);return route.abort();}
    if(!url.pathname.startsWith('/api/platform/'))return route.continue();
    if(request.method()!=='GET'){writes.push(request.method());return route.abort();}
    reads.push(url.pathname);
    if(url.pathname==='/api/platform/auth/get-session')return route.fulfill({json:{user:{id:owner.id},session:{userId:owner.id}}});
    const headers=new Headers(request.headers());headers.set('host',url.host);
    const response=await handler(new Request(url,{headers}));
    const body=await response.text();
    if(url.pathname==='/api/platform/timeline/page'&&response.ok)pages.push(JSON.parse(body));
    return route.fulfill({status:response.status,body,headers:Object.fromEntries(response.headers)});
  });
  await page.goto(appRoute,{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('heading',{name:'记录时间线',exact:true})).toBeVisible();
  const fields=page.getByRole('region',{name:'窗口查询条件'}),results=page.getByRole('region',{name:'当前窗口结果'});
  await fields.getByLabel('窗口时间依据').selectOption('changed');
  await expect(fields.getByRole('button',{name:'开始查询'})).toBeDisabled();
  await fields.getByLabel('窗口开始日期').fill('1991-09-15');
  await fields.getByLabel('窗口结束日期').fill('1991-09-15');
  await fields.getByLabel('窗口合成评审确认').check();
  await fields.getByRole('button',{name:'开始查询'}).click();
  const later=results.getByRole('button',{name:/Synthetic later correction/});
  try {
    await expect(later).toContainText('1991-09-15 01:30:00（Asia/Shanghai · UTC+08:00）');
  } catch(error) {
    t.diagnostic(JSON.stringify({requests:reads,windowPages:pages.length,errors}));
    throw error;
  }
  await expect(later).toContainText('所选修订 3');
  assert.equal(pages[0].items[0].revision,3);assert.ok(pages[0].page.nextCursor);
  assert.equal('at' in pages[0].items[0]&&pages[0].items[0].at,late);
  await results.getByRole('button',{name:'读取下一页'}).click();
  const earlier=results.getByRole('button',{name:/Synthetic earlier correction/});
  await expect(earlier).toContainText('1991-09-15 01:30:00（Asia/Shanghai · UTC+09:00）');
  await expect(earlier).toContainText('所选修订 2');
  assert.equal(pages[1].items[0].revision,2);assert.equal(pages[1].page.cursorUsed,pages[0].page.nextCursor);
  assert.equal('at' in pages[1].items[0]&&pages[1].items[0].at,early);
  await earlier.click();
  const detail=page.getByRole('region',{name:'窗口来源详情'});
  await expect(detail.getByRole('heading',{name:'所选修订内容 · 修订 2'})).toBeVisible();
  await expect(detail.getByRole('heading',{name:'当前内容 · 修订 4'})).toBeVisible();
  assert.ok(reads.includes('/api/platform/search/source/todo/'+current.id));
  await detail.getByRole('button',{name:'返回同一查询和当前页'}).click();
  await expect(earlier).toBeVisible();assert.equal(pages.length,2);
  await fields.getByLabel('窗口时间依据').selectOption('occurred');
  await fields.getByLabel('窗口开始日期').fill('');await fields.getByLabel('窗口结束日期').fill('');
  await fields.getByRole('button',{name:'开始查询'}).click();
  await expect(results.getByRole('button',{name:/Synthetic latest content/})).toContainText('1991-09-15（仅日期）');
  await expect(results.getByRole('button',{name:/Synthetic filler 50/})).toContainText('日期未知');

  await page.goto(origin+'/review/admin/search?mode=synthetic-review',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('heading',{name:'统一搜索',exact:true})).toBeVisible();
  await fields.getByLabel('窗口关键词').fill('Synthetic latest content');
  await fields.getByRole('checkbox',{name:'窗口合成评审确认'}).check();
  await fields.getByRole('button',{name:'开始查询'}).click();
  await expect(results.getByText('本页扫描范围内没有匹配项，仍可读取下一页。')).toBeVisible();
  await results.getByRole('button',{name:'读取下一页'}).click();
  await expect(results.getByRole('button',{name:/Synthetic latest content/})).toBeVisible();
  assert.ok(reads.includes('/api/platform/search/page'));
  assert.deepEqual(writes,[]);assert.deepEqual(outside,[]);assert.deepEqual(errors,[]);assert.deepEqual([...db.rows.values()],snapshot);
  t.diagnostic('Actual review route showed rev. 3 UTC+08:00 on page 1 and rev. 2 UTC+09:00 on page 2, then opened rev. 2 and returned to page 2; date-only and unknown unchanged.');
});
