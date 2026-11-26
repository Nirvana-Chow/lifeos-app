import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,readFile,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,expect,type Browser,type BrowserServer} from '@playwright/test';
import {MemoryPort} from './helpers/platform.ts';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';
import {assertWorkspaceModule} from './helpers/private-business-browser-fixture.ts';

test('OPT-IN owner module links and opt-in updates preserve recovery and server readback',{skip:process.env.RUN_OWNER_MODULE_BROWSER_TESTS!=='1'&&'Requires isolated synthetic Next/Chrome fixture',timeout:120000},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-owner-modules-'));
 let browser:Browser|undefined,browserServer:BrowserServer|undefined,browserProcess:FixtureProcess|undefined,server:FixtureProcess|undefined;
 t.after(()=>cleanupAuthThemeFixture({root,browser,browserServer,browserProcess,server}));
 await mkdir(join(root,'app','[[...section]]'),{recursive:true});
 await mkdir(join(root,'app','personal','storage-review'),{recursive:true});
 await Promise.all([cp(join(source,'src'),join(root,'src'),{recursive:true}),...['layout.tsx','globals.css','theme.css'].map(name=>cp(join(source,'app',name),join(root,'app',name))),...['response.ts','document.ts'].map(name=>cp(join(source,'app','personal','storage-review',name),join(root,'app','personal','storage-review',name))),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components'))]);
 // The fixture's catch-all has no personal layout. Restore stored choices at
 // document parse time with the same script as the actual personal layout.
 const rootLayout=join(root,'app','layout.tsx');
 const layout=await readFile(rootLayout,'utf8');
 assert.ok(layout.includes('</head>'));
 await writeFile(rootLayout,"import {workspaceLayoutInitializationScript} from '../src/workbench/workspace-layout';\n"+
  layout.replace('</head>','<script dangerouslySetInnerHTML={{__html:workspaceLayoutInitializationScript}}/></head>'));
 await writeFile(join(root,'app','personal','storage-review','route.ts'),`import {storageReviewResponse} from './response';export const dynamic='force-dynamic';export function GET(){return storageReviewResponse(async()=>({id:'module-owner'}));}`);
 await writeFile(join(root,'app','[[...section]]','page.tsx'),`'use client';import {useState} from 'react';import {usePathname,useSearchParams} from 'next/navigation';import {readWorkspaceLocation} from '../../src/workbench/private-navigation';import {LifeOSWorkspace} from '../../src/ui-review/workspace';import {RequirementUpdates} from '../../src/ui-review/requirement-updates';import {RequirementRoadmap} from '../../src/ui-review/requirement-roadmap';import {RequirementFeedback} from '../../src/ui-review/requirement-feedback';import {PersonalCalendarPage} from '../../src/calendar-candidate/personal-page';import {LivePersonalWorkspace} from '../../src/personal-candidate/live-workspace';export default function Page(){const path=usePathname(),query=useSearchParams(),location=readWorkspaceLocation(Object.fromEntries(query));const [connected]=useState(()=>query.has('connected'));if(path==='/personal/schedule')return <PersonalCalendarPage/>;if(path.endsWith('/roadmap'))return <LifeOSWorkspace state={{status:'unknown'}} access={{authenticated:true,writable:true,loginAllowed:true}} contentPage={{title:'阶段路线图',content:<RequirementRoadmap/>}}/>;if(path.endsWith('/feedback'))return <LifeOSWorkspace state={{status:'unknown'}} access={{authenticated:true,writable:true,loginAllowed:true}} contentPage={{title:'反馈 Inbox',content:<RequirementFeedback/>}}/>;if(connected)return <LivePersonalWorkspace initialPage={location.page} initialSettingsPanel={location.panel}/>;return <LifeOSWorkspace initialPage={location.page} initialSettingsPanel={location.panel} state={{status:'ready',data:{tasks:[],projects:[],areas:[],topics:[],today:'2030-11-05',asOf:'2030-11-05T00:00:00Z',coverage:'complete'}}} access={{authenticated:true,writable:true,loginAllowed:true,allowedTypes:['todo','journal']}} viewPreferenceScope={JSON.stringify(['module-owner','module-space'])} {...(path.endsWith('/updates')?{contentPage:{title:'更新记录',content:<RequirementUpdates/>}}:{})}/>;}`);
 const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,detached:true,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});server=trackAuthThemeProcess(child,true);
 let output='';const collect=(chunk:Buffer)=>{output=(output+String(chunk)).slice(-3000);};child.stdout.on('data',collect);child.stderr.on('data',collect);
 const origin=await new Promise<string>((accept,reject)=>{const timer=setTimeout(()=>reject(Error('fixture-start-timeout')),30000);const check=()=>{const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);child.stdout.off('data',check);accept(match[0]);}};child.stdout.on('data',check);child.once('exit',()=>{clearTimeout(timer);reject(Error('fixture-start-exit'));});check();});
 const repo=new MemoryPort(),native=repo.transaction.bind(repo);repo.transaction=(owner,key,fn)=>native(owner,key,tx=>fn({...tx,lockRecordIdentity:async()=>{}}));
 let enabled=false,lose=false,storageAvailable=true;const sha='2d0c8df0d83a39a01984f72bcb217de4de3caf7b',config={ownerId:'module-owner',ownerEmail:'fixture@example.invalid',spaceId:'module-space',databaseName:'fixture',baseURL:origin,approval:'personal-manual-v1',allowedTypes:['todo','journal'],requirementsEnabled:true} as const;
 browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});browserProcess=trackAuthThemeProcess(browserServer.process());browser=await chromium.connect(browserServer.wsEndpoint());const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(10000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const writes:string[]=[];
 await page.route('**/api/platform/**',async route=>{const request=route.request(),url=new URL(request.url());if(request.method()!=='GET')writes.push(request.method());const handler=createPersonalPlatformHandler({config:{...config,...(enabled?{calendarEnabled:true,requirementSupportEnabled:true}:{})},repository:Object.assign(repo,{readTaskWorkspaceSnapshot:async()=>[]}),storageVerified:storageAvailable,sessions:{read:async()=>({userId:config.ownerId,email:config.ownerEmail})},assertWritable:async()=>{},releaseArtifact:()=>({sourceSha:sha,sourceTreeDigest:'b'.repeat(64),buildId:'synthetic-build'})});const response=await handler(new Request(request.url(),{method:request.method(),headers:{...request.headers(),host:new URL(origin).host},...(request.postData()?{body:request.postData()!}:{})}));if(lose&&request.method()==='POST'){lose=false;await route.abort();return;}await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});});
 await page.goto(origin+'/personal',{waitUntil:'domcontentloaded',timeout:70000});
 await expect(page.getByRole('heading',{name:'总览',exact:true})).toBeVisible();
 await expect(page.getByRole('dialog',{name:'LifeOS 已更新'})).toHaveCount(0);assert.equal(repo.rows.size,0);
 enabled=true;await page.reload({waitUntil:'domcontentloaded'});
 await expect(page.getByRole('heading',{name:'总览',exact:true})).toBeVisible();
 await expect(page.getByRole('dialog',{name:'LifeOS 已更新'})).toHaveCount(0);
 await page.goto(origin+'/personal/requirements/updates',{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('region',{name:'当前版本说明',exact:true}).getByRole('heading',{name:'财务、日记复盘与时间线',exact:true})).toBeVisible();
 lose=true;await page.getByRole('button',{name:'知道了，此版本不再提示',exact:true}).click();
 const retryRead=page.getByRole('button',{name:'恢复原请求并回读',exact:true});
 await expect(retryRead).toBeVisible();assert.equal(repo.rows.size,1);
 await retryRead.click();
 await expect(page.getByText('本版本更新提醒已关闭。',{exact:true})).toBeVisible();
 assert.equal(repo.rows.size,1);assert.equal(repo.receipts.size,1);
 assert.deepEqual(writes,['POST','POST']);
 await page.goto(origin+'/personal',{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('heading',{name:'总览',exact:true})).toBeVisible();
 const drawer=page.getByRole('dialog',{name:'LifeOS',exact:true});
 const menu=drawer.or(page.locator('aside.lo-sidebar:visible'));
 const opener=page.getByRole('button',{name:'打开导航',exact:true});
 const openMenu=async()=>{
  await expect(page.locator('.lo-mobile-sidebar')).toHaveCount(0);
  if(await opener.isVisible()){
   await opener.click();
   await expect(drawer).toBeVisible();
  }else await expect(menu).toBeVisible();
 };
 const waitForModules=()=>expect(page.locator('header nav[aria-label="切换模块"] button').filter({hasText:/^兴趣学习$/})).toHaveCount(1);
 const readyMenu=async()=>{
  await waitForModules();
  await openMenu();
 };
 const readyDesktopMenu=async()=>{
  await waitForModules();
  await expect(drawer).toBeHidden();
  await expect(opener).toBeHidden();
  await expect(page.locator('aside').getByRole('navigation',{name:'主导航'})).toBeVisible();
 };
 const closeMenu=async()=>{
  if(await drawer.isVisible())await drawer.getByRole('button',{name:'关闭导航',exact:true}).click();
 };
 const switcher=drawer.getByRole('navigation',{name:'切换模块',exact:true}).or(page.locator('header nav[aria-label="切换模块"]:visible'));
 const nav=menu.getByRole('navigation',{name:'主导航',exact:true});
 const dailyBase=[['总览'],['待办'],['个人项目'],['领域']] as const;
 const dailyWithCalendar=[...dailyBase,['日程','/personal/schedule'],['记录','/personal/journal']] as const;
 const legacyPlanning=[...dailyWithCalendar,['搜索本人记录']] as const;
 const legacyWithoutCalendar=[...dailyBase,['记录','/personal/journal'],['搜索本人记录']] as const;
 const headerSearch=page.locator('header').getByRole('button',{name:'搜索本人记录',exact:true});
 const records=[['做饭','/personal/cooking']] as const;
 await readyMenu();
 await expect(switcher.getByRole('button')).toHaveText(['日常','兴趣学习']);
 await assertWorkspaceModule(nav,'日常',legacyPlanning);
 await nav.getByRole('link',{name:'日程',exact:true}).click();
 await expect(page).toHaveURL(origin+'/personal/schedule');
 await expect(page.getByRole('heading',{level:1,name:'日程',exact:true})).toBeVisible();
 await waitForModules();
 await page.getByRole('button',{name:'切换到桌面版',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-lifeos-workspace-layout','desktop');
 await readyDesktopMenu();
 assert.ok(await page.locator('.lo-shell').evaluate(el=>el.scrollWidth>el.clientWidth));
 await assertWorkspaceModule(nav,'日常',dailyWithCalendar);
 await expect(headerSearch).toBeVisible();
 await expect(headerSearch).toHaveAttribute('aria-haspopup','dialog');
 await expect(nav.getByRole('link',{name:'日程',exact:true})).toHaveAttribute('aria-current','page');
 await switcher.getByRole('button',{name:'兴趣学习',exact:true}).click();
 await assertWorkspaceModule(nav,'兴趣学习',records);
 await closeMenu();
 await page.goBack({waitUntil:'domcontentloaded'});
 await expect(page).toHaveURL(origin+'/personal');
 await readyMenu();
 await expect(drawer).toBeVisible();
 await assertWorkspaceModule(nav,'日常',legacyPlanning);
 await closeMenu();
 await page.goForward({waitUntil:'domcontentloaded'});
 await expect(page).toHaveURL(origin+'/personal/schedule');
 await readyDesktopMenu();
 await expect(switcher.getByRole('button',{pressed:true})).toHaveAccessibleName('兴趣学习');
 await assertWorkspaceModule(nav,'兴趣学习',records);
 await menu.getByRole('button',{name:'设置',exact:true}).click();
 await expect(page.getByRole('heading',{name:'设置',exact:true,level:1})).toBeVisible();
 await readyMenu();
 const productLinks=page.getByRole('navigation',{name:'设置分类'});
 const product=productLinks.getByRole('group',{name:'产品',exact:true});
 await expect(product.getByRole('button',{name:'需求池',exact:true})).toBeVisible();
 for(const label of ['阶段路线图','反馈 Inbox','更新记录'])await expect(productLinks.getByRole('link',{name:label,exact:true})).toHaveCount(0);
 await expect(productLinks.getByRole('group',{name:'资料与工具',exact:true}).getByRole('link',{name:'存储审核',exact:true})).toHaveAttribute('href','/personal/storage-review');
 for(const [route,title] of [['roadmap','阶段路线图'],['feedback','反馈 Inbox']]){
  await page.goto(origin+'/personal/requirements/'+route,{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('heading',{name:title,exact:true,level:1})).toBeVisible();
 }
 await page.goto(origin+'/personal/requirements/updates',{waitUntil:'domcontentloaded'});
 await expect(page).toHaveURL(origin+'/personal/requirements/updates');await expect(page.getByText('本版本更新提醒已关闭。',{exact:true})).toBeVisible();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 await page.goto(origin+'/personal?page=settings',{waitUntil:'domcontentloaded'});await expect(page.getByRole('heading',{name:'设置',exact:true,level:1})).toBeVisible();await readyMenu();const settings=page.getByRole('navigation',{name:'设置分类'});await expect(settings.getByRole('group',{name:'资料与工具'}).getByRole('link',{name:'存储审核',exact:true})).toHaveAttribute('href','/personal/storage-review');
 await settings.getByRole('link',{name:'存储审核',exact:true}).click();await expect(page).toHaveURL(origin+'/personal/storage-review');await expect(page.getByRole('heading',{name:'存储审核',exact:true,level:1})).toBeVisible();await expect(page.locator('#notice')).toContainText('LifeOS 暂无保存的清单');await expect(page.locator('#open-server')).toBeEnabled();await page.getByRole('link',{name:'← LifeOS 主站',exact:true}).click();await expect(page).toHaveURL(origin+'/personal');await expect(page.getByRole('heading',{name:'总览',exact:true,level:1})).toBeVisible();
 enabled=false;await page.goto(origin+'/personal',{waitUntil:'domcontentloaded'});await readyMenu();
 await assertWorkspaceModule(nav,'日常',legacyWithoutCalendar);
 await page.goto(origin+'/personal?page=settings',{waitUntil:'domcontentloaded'});await expect(page.getByRole('heading',{name:'设置',exact:true,level:1})).toBeVisible();await readyMenu();for(const label of ['阶段路线图','反馈 Inbox','更新记录'])await expect(settings.getByRole('link',{name:label,exact:true})).toHaveCount(0);
 storageAvailable=false;
 const unavailableStatus=page.waitForResponse(response=>response.url()===origin+'/api/platform/personal/status');
 await page.goto(origin+'/personal',{waitUntil:'domcontentloaded'});
 await unavailableStatus;await openMenu();
 await expect(switcher.getByRole('button')).toHaveText(['日常']);
 await assertWorkspaceModule(nav,'日常',dailyBase);
 storageAvailable=true;enabled=true;
 for(const width of [1365,390]){
  await page.setViewportSize({width,height:844});
  const verifiedOverview=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/platform/personal/todo/workspace-snapshot'&&response.ok());
  await page.goto(origin+'/personal?connected=1&page=tasks',{waitUntil:'domcontentloaded'});
  await verifiedOverview;
  await expect(page.getByRole('heading',{level:1,name:'待办'})).toBeVisible();
  await expect(page.getByRole('button',{name:'新建待办',exact:true})).toBeEnabled();
  await expect(opener).toBeHidden();
  await assertWorkspaceModule(nav,'日常',dailyWithCalendar);
  await expect(headerSearch).toBeVisible();
  await expect(headerSearch).toHaveAttribute('aria-haspopup','dialog');
  await expect(nav.getByRole('button',{name:'待办'})).toHaveAttribute('aria-current','page');
  if(width===390){
   await page.evaluate(()=>{
    const footer=document.createElement('footer');
    footer.className='lifeos-filing-footer';
    footer.textContent='合成页脚';
    document.body.append(footer);
    window.dispatchEvent(new Event('resize'));
   });
   const sidebarSettings=page.locator('aside').getByRole('button',{name:'设置',exact:true});
   const footer=page.locator('.lifeos-filing-footer');
   await expect.poll(async()=>{
    const [control,bar]=await Promise.all([sidebarSettings.boundingBox(),footer.boundingBox()]);
    return !!control&&!!bar&&control.y+control.height<=bar.y;
   }).toBe(true);
   await sidebarSettings.click();
   await expect(page.getByRole('heading',{level:1,name:'设置'})).toBeVisible();
  }
  await page.goto(origin+'/personal?connected=1&page=settings&panel=security',{waitUntil:'domcontentloaded',timeout:45_000});
  await expect(page.locator('aside').getByRole('button',{name:'安全与密码'})).toHaveAttribute('aria-current','page');
  await expect(page.getByRole('heading',{level:2,name:'安全与密码'})).toBeVisible();
 }
 assert.deepEqual(writes,['POST','POST']);assert.equal(repo.rows.size,1);assert.equal(repo.receipts.size,1);assert.deepEqual(errors,[]);
});
