import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';

test('mobile shell keeps readable content, existing navigation and saved layout across reopened pages',{
 skip:process.env.RUN_WORKSPACE_MOBILE_SHELL_BROWSER_TESTS!=='1'&&'Requires isolated Next and Chromium',timeout:180000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-mobile-shell-'));
 await mkdir(join(root,'app','personal'),{recursive:true});
 await Promise.all([cp(join(source,'src'),join(root,'src'),{recursive:true}),
  ...['layout.tsx','globals.css','theme.css'].map(name=>cp(join(source,'app',name),join(root,'app',name))),
  cp(join(source,'app','personal','layout.tsx'),join(root,'app','personal','layout.tsx')),
  cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components'))]);
 await writeFile(join(root,'app','personal','page.tsx'),`import {LifeOSWorkspace} from '../../src/ui-review/workspace';
 import {readWorkspaceLocation} from '../../src/workbench/private-navigation';
 export default async function Page({searchParams}:{searchParams:Promise<{guest?:string;page?:string;panel?:string}>}){
  const params=await searchParams,owner=!params.guest,location=readWorkspaceLocation(params);
  return <LifeOSWorkspace desktopNavigation syncUrl initialPage={location.page} initialSettingsPanel={location.panel} state={{status:'ready',data:{tasks:[],projects:[],areas:[],today:'2026-11-25',asOf:'2026-11-25T00:00:00Z',coverage:'complete'}}}
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
 const page=await browser.newPage({viewport:{width:1365,height:900}});
 const pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));
 const header=page.locator('header.lo-header');
 const more=header.getByRole('button',{name:'账号与更多操作'});
 const account=page.getByRole('dialog',{name:'账号操作'});
 await page.route('**/api/platform/**', route=>route.fulfill({json:{
  scope:'personal-manual-candidate',ownerId:'overview-owner',spaceId:'overview-space',requirementsEnabled:true,
  writable:false,storageVerified:true,allowedTypes:['todo','journal'],calendarEnabled:true,
 }}));
 const card=page.getByRole('region',{name:'需求进度',exact:true});
 await page.goto(origin+'/personal',{waitUntil:'load',timeout:70000});
 await expect(header.getByRole('link',{name:'搜索本人记录'})).toHaveAttribute('href','/personal/search',{timeout:25000});
 await expect(page.locator('.lo-sidebar')).toBeVisible();
 await expect(card.getByRole('button',{name:'查看全部需求'})).toBeInViewport();
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
  await expect(card.getByRole('button',{name:'查看全部需求'})).toBeInViewport();
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
  await page.reload({waitUntil:'networkidle'});
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
