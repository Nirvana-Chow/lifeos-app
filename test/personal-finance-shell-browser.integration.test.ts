import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {on} from 'node:events';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,expect,type Browser,type BrowserServer,type Page} from '@playwright/test';
import {PersonalFinanceService} from '../src/personal-finance/service.ts';
import {handlePersonalFinance} from '../src/personal-finance/http.ts';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';
import {journalFixture,journalStatus} from './helpers/journal-history.ts';
import {MemoryPort} from './helpers/platform.ts';

const fixtureOwner='synthetic-owner',fixtureSpace=journalStatus.spaceId;
const financePath='/personal/finance',taskPath='/personal?page=tasks',financeAPI='/api/platform/personal/finance';
const shellSelectors=['.lo-shell','header.lo-header','aside.lo-sidebar','header.lo-header nav[aria-label="切换模块"]','#personal-main'];
const fixedDate='2030-11-26T00:00:00.000Z';

test('OPT-IN owner task and finance routes share navigation without bypassing draft or read checks',{
 skip:process.env.RUN_PERSONAL_FINANCE_SHELL_BROWSER_TESTS!=='1'&&'Requires isolated Next and Chromium',timeout:180_000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-finance-shell-'));
 let server:FixtureProcess|undefined,browserProcess:FixtureProcess|undefined,browser:Browser|undefined,browserServer:BrowserServer|undefined;
 t.after(()=>cleanupAuthThemeFixture({root,server,browserProcess,browser,browserServer}));
 await mkdir(join(root,'app/personal/[...section]'),{recursive:true});
 await mkdir(join(root,'app/login'),{recursive:true});
 await Promise.all([
  ...['layout.tsx','globals.css','theme.css','personal/layout.tsx','personal/page.tsx','personal/[...section]/page.tsx'].map(file=>cp(join(source,'app',file),join(root,'app',file))),
  cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  cp(join(source,'src'),join(root,'src'),{recursive:true}),
  symlink(join(source,'components'),join(root,'components')),symlink(join(source,'node_modules'),join(root,'node_modules')),
 ]);
 await writeFile(join(root,'app/login/page.tsx'),'export default function Page(){return <h1>Synthetic login</h1>}');
 await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
 await writeFile(join(root,'src/platform/runtime.ts'),`
 export const readPlatformLoginCapability=async()=>({sessionDuration:false});
 export const readPlatformPasswordCapability=async()=>false;
 export const readPlatformPagePrincipal=async(headers)=>headers.get('cookie')?.includes('synthetic-owner=1')?{id:'synthetic-owner'}:null;
 `);
 const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{
  cwd:root,detached:true,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],
 });
 server=trackAuthThemeProcess(child,true);
 let origin='',output='',serverErrors='';
 child.stderr.on('data',chunk=>{serverErrors=(serverErrors+String(chunk)).slice(-2500);});
 for await(const [chunk] of on(child.stdout,'data',{signal:AbortSignal.timeout(30000)})){
  output=(output+String(chunk)).slice(-4000);
  const match=output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
  if(match&&/Ready in\b/.test(output)){origin=match;break;}
 }
 assert.ok(origin,serverErrors);
 browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
 browserProcess=trackAuthThemeProcess(browserServer.process());
 browser=await chromium.connect(browserServer.wsEndpoint());
 const before=process.env.LIFEOS_FINANCE_SHELL_EXPECT_RELOAD==='1';
 const repo=new MemoryPort();
 repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(row=>row.ownerId===owner));
 const service=new PersonalFinanceService(repo,{ownerId:fixtureOwner,spaceId:fixtureSpace,enabled:true,writable:true},()=>fixedDate);
 for(const kind of ['income','expense'] as const)await service.create(fixtureOwner,{
  spaceId:fixtureSpace,confirmed:true,fields:{kind,currency:'CNY',amountMinor:kind==='income'?10000:2901,occurredOn:'2030-11-26',notes:'Synthetic finance '+kind},
 },'synthetic-finance-'+kind);
 const tasks=Array.from({length:44},(_,index)=>{
  const entry=journalFixture(100+index,null);
  const fields={title:'合成导航待办 '+index,notes:'',dueOn:null,status:'open'};
  return {...entry,kind:'todo',draft:fields,source:{...entry.source,original:{marker:'personal-manual-v1',
   type:'todo',spaceId:fixtureSpace,input:{spaceId:fixtureSpace,confirmed:true,fields}}}};
 });
 for(const width of [1365,390,430]){
  const page:Page=await browser.newPage({viewport:{width,height:900},colorScheme:width===390?'dark':'light',timezoneId:'Asia/Shanghai'});
  await page.context().addCookies([{name:'synthetic-owner',value:'1',url:origin}]);
  const documents:string[]=[],writes:string[]=[],errors:string[]=[];
  const financeReads:{part:string;bytes:number}[]=[];
  let denySnapshot=false;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.resourceType()==='document')documents.push(new URL(request.url()).pathname);});
  await page.route('**/api/platform/**',async route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname;
   if(url.origin!==origin)return route.abort();
   if(!['GET','HEAD'].includes(request.method())){
    writes.push(request.method()+' '+path);
    return route.fulfill({status:405,json:{}});
   }
   if(path.startsWith(financeAPI+'/')){
    if(denySnapshot&&path===financeAPI+'/snapshot')return route.fulfill({status:403,json:{error:{code:'FORBIDDEN',message:'合成财务读取权限已撤回。'}}});
    const headers=new Headers(request.headers());
    headers.set('host',url.host);
    const response=await handlePersonalFinance(new Request(url,{headers}),{ownerId:fixtureOwner,baseURL:origin,service});
    assert.ok(response);
    const body=await response.text();
    financeReads.push({part:path.slice(financeAPI.length+1),bytes:Buffer.byteLength(body)});
    return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});
   }
   if(path.endsWith('/availability'))return route.fulfill({json:{configured:true,loginAllowed:true,transport:'ssh-loopback',origin}});
   if(path.endsWith('/status'))return route.fulfill({json:{...journalStatus,ownerId:fixtureOwner,scope:'personal-manual-candidate',writable:true,allowedTypes:['todo','journal'],financeEnabled:true}});
   if(path.endsWith('/overview')||path.endsWith('/workspace-snapshot'))return route.fulfill({json:{scope:path.endsWith('/overview')?'full-current-snapshot':'task-workspace-current-snapshot',truncated:false,total:tasks.length,items:tasks,today:url.searchParams.get('today'),observedAt:fixedDate}});
   return route.fulfill({status:404,json:{}});
  });
  const taskHeading=page.getByRole('heading',{name:'待办',exact:true,level:1});
  const financeHeading=page.getByRole('heading',{name:'财务',exact:true,level:1});
  const mobileMenu=page.getByRole('button',{name:'打开导航',exact:true});
  const taskRows=page.locator('.lo-list-rows');
  const firstRecord=page.getByRole('button',{name:'查看流水：2030-11-26 支出 29.01元',exact:true});
  const chart=page.getByRole('img',{name:'记录收支流向图'});
  await page.goto(origin+taskPath,{waitUntil:'domcontentloaded',timeout:60000});
  await expect(taskHeading).toBeVisible();
  await expect(page.locator('[data-workspace-state="ready"]')).toHaveCount(1);
  await page.getByRole('button',{name:'列表',exact:true}).click();
  await expect(taskRows.locator('.lo-task-row')).toHaveCount(tasks.length);
  await taskRows.evaluate(region=>{region.scrollTop=240;});
  await expect.poll(()=>taskRows.evaluate(region=>region.scrollTop)).toBe(240);
  await page.evaluate(selectors=>Object.assign(window,{financeShellProof:selectors.map(selector=>document.querySelector(selector))}),shellSelectors);
  const sameNodes=()=>page.evaluate(selectors=>{
   const proof=(window as Window&{financeShellProof?:Array<Element|null>}).financeShellProof;
   return selectors.map((selector,index)=>Boolean(proof?.[index])&&proof?.[index]===document.querySelector(selector));
  },shellSelectors);
  if(await mobileMenu.isVisible())await mobileMenu.click();
  const modules=width===1365?page.locator('header.lo-header'):page.getByRole('dialog',{name:'LifeOS',exact:true});
  const financeLink=modules.getByRole('link',{name:'财务',exact:true});
  await expect(financeLink).toHaveAttribute('href',financePath);
  await financeLink.focus();
  const started=performance.now();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(origin+financePath,{timeout:30_000});
  await expect(financeHeading).toBeVisible();
  await expect(firstRecord).toBeVisible();
  const firstRecordMs=Math.round(performance.now()-started);
  const parts=financeReads.map(read=>read.part);
  assert.deepEqual(parts.slice(-3),['status','snapshot','status']);
  assert.ok(parts.slice(0,-3).every(part=>part==='status'),'a superseded initial read must stop before the snapshot');
  const initialReads=[...financeReads];
  const enteredSameNodes=await sameNodes();
  assert.deepEqual(enteredSameNodes,Array(shellSelectors.length).fill(!before));
  await expect(page.locator('.lo-shell')).toHaveCount(1);
  const grid=page.locator('[data-personal-finance-grid="reui"]');
  await expect(grid).toBeVisible();
  const scroll=await grid.locator('[data-slot="data-grid-table-viewport"]').evaluate(region=>{
   region.scrollLeft=region.scrollWidth;
   return {inside:['auto','scroll'].includes(getComputedStyle(region).overflowX),overflow:region.scrollWidth>region.clientWidth,moved:region.scrollLeft>0};
  });
  assert.equal(scroll.inside,true);
  if(scroll.overflow)assert.equal(scroll.moved,true);
  await expect(chart).toHaveAccessibleDescription(/100\.00.*29\.01.*70\.99/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  if(!before)await expect(financeHeading).toBeFocused();
  await firstRecord.focus();
  await page.keyboard.press('Enter');
  const details=page.getByRole('dialog',{name:'流水详情',exact:true});
  await expect(details).toBeVisible();
  assert.equal(await details.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);
  const notes=details.getByLabel('摘要 / 备注',{exact:true});
  await notes.fill('合成未保存财务草稿');
  if(!before){
   for(const accept of [false,true]){
    const nextDialog=page.waitForEvent('dialog');
    await page.evaluate(()=>{setTimeout(()=>history.back(),0);});
    const prompt=await nextDialog;
    assert.equal(prompt.type(),'confirm');
    assert.match(prompt.message(),/尚未保存/);
    if(accept)await prompt.accept();
    else {
     await prompt.dismiss();
     await expect(page).toHaveURL(origin+financePath);
     await expect(notes).toHaveValue('合成未保存财务草稿');
    }
   }
   await expect(page).toHaveURL(origin+taskPath);
   await expect(taskHeading).toBeVisible();
   await expect.poll(()=>taskRows.evaluate(region=>region.scrollTop)).toBe(240);
   await expect(width===1365?financeLink:mobileMenu).toBeFocused();
   assert.deepEqual(await sameNodes(),enteredSameNodes);
   assert.deepEqual(documents,['/personal']);
   await page.goForward();
   await expect(page).toHaveURL(origin+financePath);
   await expect(firstRecord).toBeVisible();
   await expect(details).toHaveCount(0);
   assert.deepEqual(await sameNodes(),enteredSameNodes);
   assert.deepEqual(documents,['/personal']);
  }else {
   const nextDialog=page.waitForEvent('dialog');
   await Promise.all([page.keyboard.press('Escape'),nextDialog.then(dialog=>dialog.accept())]);
   await expect(details).toHaveCount(0);
   assert.deepEqual(documents,['/personal',financePath]);
  }
  denySnapshot=true;
  await page.getByRole('button',{name:'刷新',exact:true}).click();
  await expect(page.getByRole('region',{name:'财务记录'}).getByRole('alert')).toContainText('合成财务读取权限已撤回。');
  await expect(firstRecord).toHaveCount(0);
  await expect(chart).toHaveCount(0);
  assert.deepEqual(writes,[]);
  assert.deepEqual(errors,[]);
  console.log('FINANCE_SHELL_BROWSER '+JSON.stringify({before,width,firstRecordMs,initialReads,enteredSameNodes,documents,writes}));
  await page.close();
 }
 const anonymous=await browser.newPage();
 await anonymous.goto(origin+financePath);
 await expect(anonymous).toHaveURL(origin+'/login');
 await expect(anonymous.locator('.lo-shell')).toHaveCount(0);
 await anonymous.close();
});
