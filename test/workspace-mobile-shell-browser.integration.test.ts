import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';

test('mobile shell keeps readable content, existing navigation and saved layout across reopened pages',{
 skip:process.env.RUN_WORKSPACE_MOBILE_SHELL_BROWSER_TESTS!=='1'&&'Requires isolated Next and Chromium',timeout:240000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-mobile-shell-'));
 await mkdir(join(root,'app','personal'),{recursive:true});
 await Promise.all([cp(join(source,'src'),join(root,'src'),{recursive:true}),
  ...['layout.tsx','globals.css','theme.css'].map(name=>cp(join(source,'app',name),join(root,'app',name))),
  cp(join(source,'app','personal','layout.tsx'),join(root,'app','personal','layout.tsx')),
  cp(join(source,'app','personal','page.tsx'),join(root,'app','personal','owner-page.tsx')),
  cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components'))]);
 await writeFile(join(root,'src','platform','runtime.ts'),`
  export const readPlatformPagePrincipal=async()=>({userId:'overview-owner'});
  export const readPlatformPasswordCapability=async()=>false;
  export const readPlatformLoginCapability=async()=>({sessionDuration:false});
 `);
 await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
 await writeFile(join(root,'app','personal','page.tsx'),`import {LifeOSWorkspace} from '../../src/ui-review/workspace';
 import {readWorkspaceLocation} from '../../src/workbench/private-navigation';
 import {cookies} from 'next/headers';
 import OwnerPage from './owner-page';
 export default async function Page({searchParams}:{searchParams:Promise<{guest?:string;page?:string;panel?:string;idle?:string}>}){
  const params=await searchParams,owner=!params.guest,location=readWorkspaceLocation(params);
  if((await cookies()).get('quiet-shell')?.value==='canonical')return OwnerPage({searchParams});
  return <LifeOSWorkspace desktopNavigation syncUrl initialPage={location.page} initialSettingsPanel={location.panel} state={params.idle?{status:'unknown',message:'此页面未配置数据来源。'}:{status:'ready',data:{tasks:[],projects:[],areas:[],today:'2026-11-25',asOf:'2026-11-25T00:00:00Z',coverage:'complete'}}}
  access={{authenticated:owner,writable:false,loginAllowed:true}} availableSettingsPanels={['security']} viewPreferenceScope={owner?JSON.stringify(['overview-owner','overview-space']):null}/>;
 }`);
 const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{
  cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],
 });
 const stopped=once(child,'exit');
 t.after(async()=>{child.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 let output='';const collect=(chunk:Buffer)=>{output=(output+String(chunk)).slice(-4000);};
 child.stdout.on('data',collect);child.stderr.on('data',collect);
 const origin=await new Promise<string>((accept,reject)=>{
  const timer=setTimeout(()=>reject(Error('Fixture startup timeout '+output)),30000);
  child.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture exited '+output));});
  child.stdout.on('data',()=>{
   const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);
   if(match){clearTimeout(timer);accept(match[0]);}
  });
 });
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
 t.after(()=>browser.close());
 const actual=await browser.newPage({viewport:{width:1365,height:900}});
 await actual.context().addCookies([{name:'quiet-shell',value:'canonical',url:origin}]);
 const title='合成私人待办';
 const id='11111111-1111-4111-8111-111111111111',sourceId='22222222-2222-4222-8222-222222222222';
 const at='2026-11-25T00:00:00.000Z',spaceId='overview-space';
 const fields={title,notes:'',status:'open',dueOn:null};
 const entry={id,kind:'todo',revision:1,draft:fields,source:{id:sourceId,system:'website',externalId:id,version:1,asOf:at,
  original:{marker:'personal-manual-v1',spaceId,type:'todo',input:{spaceId,confirmed:true,fields}}},createdAt:at,updatedAt:at,syncState:'draft',externalStatus:null};
 let finishOverview: (()=>void)|undefined, statusCode=200;
 let overviewGate: Promise<void>|undefined;
 const holdOverview=()=>{overviewGate=new Promise<void>(done=>{finishOverview=done;});};
 const releaseOverview=()=>{finishOverview?.();overviewGate=undefined;};
 const writes:string[]=[],external:string[]=[];
 await actual.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){external.push(url.origin);return route.abort();}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  if(request.method()!=='GET')writes.push(request.method());
  if(url.pathname==='/api/platform/personal/overview'){
   if(overviewGate)await overviewGate;
   if(statusCode!==200)return route.fulfill({status:statusCode,json:{error:{code:'PERSONAL_SNAPSHOT_UNAVAILABLE'}}});
   return route.fulfill({json:{scope:'full-current-snapshot',items:[entry],truncated:false,total:1,today:url.searchParams.get('today'),observedAt:at}});
  }
  if(url.pathname==='/api/platform/personal/availability')return route.fulfill({json:{configured:true,loginAllowed:true,https:false,transport:'ssh-loopback',origin}});
  return route.fulfill({json:{scope:'personal-manual-candidate',ownerId:'overview-owner',spaceId,storageVerified:true,writable:false,allowedTypes:['todo','journal']}});
 });
 const shellHeader=actual.locator('header.lo-header'),main=actual.locator('#personal-main'),view=main.locator('.lo-workspace-view');
 const task=main.getByRole('button',{name:'查看待办详情：'+title,exact:true});
 try {
  for(const width of [1365,390]){
   await actual.setViewportSize({width,height:900});
   holdOverview();
   await actual.goto(origin+'/personal?page=tasks',{waitUntil:'domcontentloaded'});
   await expect(shellHeader).toBeVisible();
   await expect(view.getByText(/正在读取数据|等待数据连接/)).toHaveCount(0,{timeout:1500});
   await expect(view.locator('[aria-busy="true"]')).toBeVisible();
   await expect(task).toHaveCount(0);
   const headerHeight=(await shellHeader.boundingBox())!.height,mainTop=(await main.boundingBox())!.y;
   const mountedView=await view.elementHandle();
   releaseOverview();
   await expect(task).toBeVisible();
   await expect(view.locator('[aria-busy="true"]')).toHaveCount(0);
   assert.equal((await shellHeader.boundingBox())!.height,headerHeight);
   assert.equal((await main.boundingBox())!.y,mainTop);
   assert.equal(await mountedView!.evaluate(node=>node.isConnected),true);

   holdOverview();
   await actual.evaluate(()=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
    document.dispatchEvent(new Event('visibilitychange'));
   });
   await expect(task).toHaveCount(0);
   await expect(view.locator('[aria-busy="true"]')).toBeVisible();
   await expect(view.getByText(/正在读取数据|等待数据连接/)).toHaveCount(0);
   assert.equal((await actual.evaluate(()=>document.querySelector('#personal-main')!.scrollTop)),0);
   statusCode=503;
   releaseOverview();
   const alert=view.getByRole('alert');
   await expect(alert).toContainText('暂时无法读取完整待办列表');
   await expect(view.locator('[aria-busy="true"]')).toHaveCount(0);
   statusCode=200;
   await view.getByRole('button',{name:'重新读取',exact:true}).click();
   await expect(task).toBeVisible();
  }
 } finally {
  releaseOverview();
  await actual.close();
 }
 assert.deepEqual(writes,[]);
 assert.deepEqual(external,[]);

 const page=await browser.newPage({viewport:{width:1365,height:900}});
 await page.goto(origin+'/personal?page=tasks&idle=1',{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('status').filter({hasText:'此页面未配置数据来源。'})).toBeVisible();
 await expect(page.getByText('等待数据连接',{exact:true})).toHaveCount(0);
 const pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));
 const header=page.locator('header.lo-header');
 const more=header.getByRole('button',{name:'账号与更多操作'});
 const account=page.getByRole('dialog',{name:'账号操作'});
 await page.route('**/api/platform/**', route=>route.fulfill({json:{
  scope:'personal-manual-candidate',ownerId:'overview-owner',spaceId:'overview-space',requirementsEnabled:true,
  writable:false,storageVerified:true,allowedTypes:['todo','journal'],calendarEnabled:true,
 }}));
 const card=page.getByRole('region',{name:'未完待办',exact:true});
 await page.goto(origin+'/personal',{waitUntil:'load',timeout:70000});
 await expect(header.getByRole('link',{name:'搜索本人记录'})).toHaveAttribute('href','/personal/search',{timeout:25000});
 await expect(page.locator('.lo-sidebar')).toBeVisible();
 await expect(card.getByRole('button',{name:'查看全部未完待办'})).toBeInViewport();
 const desktopHeight=(await header.boundingBox())!.height;
 await page.getByRole('button',{name:'打开设置'}).click();
 await expect(page).toHaveURL(/page=settings$/);
 assert.equal((await header.boundingBox())!.height,desktopHeight);
 const screenshotDir=process.env.LIFEOS_LAYOUT_SCREENSHOT_DIR;
 if(screenshotDir){
  await mkdir(screenshotDir,{recursive:true});
  await page.screenshot({path:join(screenshotDir,'settings-1365-desktop.png')});
 }
 for (const width of [390,430]) {
  await page.setViewportSize({width,height:844});
  await page.evaluate(()=>localStorage.removeItem('lifeos-ui-workspace-layout'));
  await page.goto(origin+'/personal',{waitUntil:'networkidle'});
  const shell=page.locator('.lo-shell');
  const toDesktop=page.getByRole('button',{name:'切换到桌面版'});
  const toMobile=page.getByRole('button',{name:'切换到手机版'});
  const menu=page.getByRole('button',{name:'打开导航',exact:true});
  const homeHeaderHeight=(await header.boundingBox())!.height;
  await expect(toDesktop).toBeVisible();
  await expect(menu).toBeVisible();
  await expect(card.getByRole('button',{name:'查看全部未完待办'})).toBeInViewport();
  assert.equal(await shell.evaluate(node=>node.scrollWidth),width);
  if(screenshotDir)await page.screenshot({path:join(screenshotDir,`overview-${width}-mobile.png`)});
  await menu.click();
  const drawer=page.getByRole('dialog',{name:'LifeOS'});
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('link',{name:'日程',exact:true})).toHaveAttribute('href','/personal/schedule');
  await expect(drawer.getByRole('link',{name:'记录',exact:true})).toHaveAttribute('href','/personal/journal');
  await drawer.getByRole('button',{name:'关闭导航'}).click();
  await expect(menu).toBeFocused();

  await toDesktop.click();
  await expect(toMobile).toBeInViewport();
  await expect(menu).toBeHidden();
  assert.ok(await shell.evaluate(node=>node.scrollWidth>=900));
  await page.reload({waitUntil:'networkidle'});
  await expect(toMobile).toBeInViewport();
  await page.getByRole('button',{name:'打开设置',exact:true}).click();
  await expect(page).toHaveURL(/\/personal\?page=settings$/);
  assert.equal((await header.boundingBox())!.height,homeHeaderHeight);
  await expect(header.getByRole('button',{name:'跟随系统'})).toHaveCount(0);
  await more.click();
  const layout=account.getByRole('combobox',{name:'显示布局'});
  await expect(layout).toHaveValue('desktop');
  const followSystem=account.getByRole('button',{name:'跟随系统',exact:true});
  await expect(followSystem).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Escape');
  await header.locator('[data-slot="theme-toggle"]').click();
  await more.click();
  await expect(followSystem).toHaveAttribute('aria-pressed','false');
  await followSystem.click();
  await expect(followSystem).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Escape');
  await expect(account).toBeHidden();
  await toMobile.click();
  await expect(page.locator('html')).toHaveAttribute('data-lifeos-workspace-layout','mobile');
  await page.reload({waitUntil:'networkidle'});
  await expect(toDesktop).toBeInViewport();
  await more.click();
  await expect(layout).toHaveValue('mobile');
  await layout.selectOption('auto');
  await page.keyboard.press('Escape');
  await expect(menu).toBeVisible();
  await page.getByRole('button',{name:'返回总览',exact:true}).click();
  await menu.click();
  await drawer.getByRole('button',{name:'待办',exact:true}).click();
  await expect(page).toHaveURL(/\/personal\?page=tasks$/);
 }
 assert.deepEqual(pageErrors,[]);
});
