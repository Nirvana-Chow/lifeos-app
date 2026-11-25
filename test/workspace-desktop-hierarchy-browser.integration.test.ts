import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,expect,type Browser,type BrowserServer} from '@playwright/test';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';
import {assertPrivateFixtureNavigation,assertWorkspaceModule} from './helpers/private-business-browser-fixture.ts';
import {MemoryPort} from './helpers/platform.ts';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';

test('OPT-IN desktop hierarchy preserves authorized destinations, real domain relations, settings history and responsive keyboard access',{skip:process.env.RUN_WORKSPACE_HIERARCHY_BROWSER_TESTS!=='1'&&'Requires isolated synthetic Next/Chrome fixture',timeout:120000},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-hierarchy-'));
 let browser:Browser|undefined,browserServer:BrowserServer|undefined,browserProcess:FixtureProcess|undefined,server:FixtureProcess|undefined;
 t.after(()=>cleanupAuthThemeFixture({root,browser,browserServer,browserProcess,server}));
 await mkdir(join(root,'app','personal'),{recursive:true});
 await Promise.all([cp(join(source,'src'),join(root,'src'),{recursive:true}),...['layout.tsx','globals.css','theme.css'].map(name=>cp(join(source,'app',name),join(root,'app',name))),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components'))]);
 await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
 await writeFile(join(root,'app','personal','page.tsx'),`'use client';import {useEffect,useState} from 'react';import {LifeOSWorkspace} from '../../src/ui-review/workspace';import {readWorkspaceLocation} from '../../src/workbench/private-navigation';export default function Page(){const[dirty,setDirty]=useState(false),[query,setQuery]=useState<URLSearchParams|null>(null);useEffect(()=>setQuery(new URLSearchParams(window.location.search)),[]);if(!query)return null;const initial=readWorkspaceLocation(Object.fromEntries(query));return <LifeOSWorkspace desktopNavigation syncUrl initialPage={initial.page} initialSettingsPanel={initial.panel} state={{status:'ready',data:{tasks:[],projects:[{id:'project-a',title:'合成项目甲',revision:1,area:{id:'area-a',title:'合成领域'},stage:'active',nextStep:'合成下一步'},{id:'project-b',title:'合成未关联项目',revision:1,area:null,stage:'active',nextStep:null}],areas:[{id:'area-a',title:'合成领域',revision:1}],topics:[],today:'2030-11-05',asOf:'2030-11-05T00:00:00Z',coverage:query.has('partial')?'partial':'complete'}}} access={{authenticated:true,writable:true,loginAllowed:true,allowedTypes:['todo','journal','topic']}} viewPreferenceScope={JSON.stringify(['hierarchy-owner','hierarchy-space'])} availableSettingsPanels={['security','api-keys']} renderSettingsPanel={panel=><section><h2>{panel==='security'?'安全面板':'密钥面板'}</h2><button onClick={()=>setDirty(!dirty)}>合成草稿保护 {dirty?'开':'关'}</button></section>} settingsCloseGuard={{current:()=>!dirty}}/>;}`);
 const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3010'],{cwd:root,detached:true,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});server=trackAuthThemeProcess(child,true);
 let output='';const collect=(chunk:Buffer)=>{output=(output+String(chunk)).slice(-3000);};child.stdout.on('data',collect);child.stderr.on('data',collect);
 const origin=await new Promise<string>((accept,reject)=>{const timer=setTimeout(()=>reject(Error('fixture-start-timeout '+output)),30000);const check=()=>{if(output.includes('Ready in')){clearTimeout(timer);child.stdout.off('data',check);accept('http://127.0.0.1:3010');}};child.stdout.on('data',check);child.once('exit',()=>{clearTimeout(timer);reject(Error('fixture-start-exit '+output));});check();});
 browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});browserProcess=trackAuthThemeProcess(browserServer.process());browser=await chromium.connect(browserServer.wsEndpoint());
 const page=await browser.newPage({viewport:{width:1365,height:900}});page.setDefaultTimeout(10000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 let enabled=true,fileHandoffEnabled=false;
 const writes:string[]=[];let releaseReads=0;
 await page.route('**/api/platform/**',route=>{
  if(route.request().method()!=='GET')writes.push(route.request().method());
  if(new URL(route.request().url()).pathname.endsWith('/requirement-support/releases')){
   releaseReads++;return route.fulfill({json:{
    scope:'public-source-records',ownerAccepted:false,visualQualification:'not-attested',preferencesEnabled:true,
    current:{sourceSha:'a'.repeat(40),sourceTreeDigest:'b'.repeat(64),buildId:'synthetic-build'},
    readState:{sourceSha:'a'.repeat(40),seen:false},records:[],
   }});
  }
  return route.fulfill({json:enabled?{scope:'personal-manual-candidate',ownerId:'hierarchy-owner',spaceId:'hierarchy-space',storageVerified:true,writable:true,storageReviewEnabled:true,fileHandoffEnabled,allowedTypes:['todo','journal'],calendarEnabled:true,financeEnabled:true,requirementsEnabled:true,requirementSupportEnabled:true}: {scope:'closed'}});
 });
 await page.goto(origin+'/personal',{waitUntil:'networkidle',timeout:70000});
 const nav=page.locator('aside').getByRole('navigation',{name:'主导航'});
 const moduleSwitch=page.locator('header').getByRole('navigation',{name:'切换模块'});
 const planning=[['总览'],['事项'],['搜索本人记录','/personal/search'],['日程','/personal/schedule']] as const;
 const records=[['日记','/personal/journal'],['做饭','/personal/cooking']] as const;
 await expect(moduleSwitch.getByRole('button')).toHaveText(['安排与推进','生活记录','长期积累','资料与工具']);
 await expect(moduleSwitch.getByRole('button',{pressed:true})).toHaveAccessibleName('安排与推进');
 await assertWorkspaceModule(nav,'安排与推进',planning);
 await expect(page.getByRole('dialog')).toHaveCount(0);
 assert.equal(releaseReads,0,'opening the workspace does not consult automatic announcements');
 await expect(page.locator('header')).toHaveCSS('background-image','none');
 await expect(page.getByRole('button',{name:'LifeOS 总览',exact:true}).locator('svg path')).toHaveCount(1);
 const overviewCards=page.locator('.lo-overview-grid > .lo-panel');
 await expect(overviewCards).toHaveCount(2);
 for(const card of await overviewCards.all()){
  await expect(card).not.toHaveCSS('box-shadow','none');
  await expect(card.locator('.lo-panel-heading')).toHaveCSS('box-shadow','none');
 }
 const metrics=page.getByRole('region',{name:'任务指标',exact:true});
 const domains=page.getByRole('region',{name:'生活维度',exact:true});
 const breadcrumb=page.getByRole('navigation',{name:'浏览位置'});
 const overviewLink=breadcrumb.getByRole('button',{name:'返回总览'});
 const back=breadcrumb.getByRole('button',{name:'后退'});
 const forward=breadcrumb.getByRole('button',{name:'前进'});
 const location=breadcrumb.locator('[aria-current="page"]');
 await expect(location).toHaveText('总览');
 await expect(back).toBeDisabled();
 await expect(forward).toBeDisabled();
 await expect(overviewLink).toHaveCount(0);
 const [trailEnd,backPosition,forwardPosition,content]=await Promise.all(
  [location,back,forward,page.locator('.lo-content')].map(control=>control.boundingBox())
 );
 assert.ok(trailEnd&&backPosition&&forwardPosition&&content);
 assert.ok(Math.abs(content.x-trailEnd.x)<1,'overview breadcrumb starts on the content edge');
 assert.ok(trailEnd.x+trailEnd.width+backPosition.width<backPosition.x&&backPosition.x<forwardPosition.x);
 const metricButtons=metrics.getByRole('button');
 await expect(metricButtons).toHaveText(['待办0','今日到期0','已逾期0','推进中项目2']);
 for(const width of [1365,390]){
  await page.setViewportSize({width,height:900});
  const [leftCard,rightCard]=await Promise.all([overviewCards.nth(0).boundingBox(),overviewCards.nth(1).boundingBox()]);
  assert.ok(leftCard&&rightCard&&rightCard.x>=leftCard.x+leftCard.width&&Math.abs(rightCard.y-leftCard.y)<1);
  const bounds=await Promise.all((await metricButtons.all()).map(button=>button.boundingBox()));
  const rows=Map.groupBy(bounds,bound=>bound?.y);
  assert.deepEqual([...rows.values()].map(row=>row.length),[4]);
  for(const bound of [...bounds,await domains.getByRole('button',{name:'查看全部项目'}).boundingBox(),await domains.getByRole('button',{name:/合成项目甲/}).boundingBox()]){
   assert.ok(bound&&bound.width>=44&&bound.height>=44&&bound.x>=0&&bound.x+bound.width<=Math.max(width,900));
  }
  const region=await metrics.boundingBox(),domainCard=await domains.boundingBox(),lowerCard=await overviewCards.first().boundingBox();
  assert.ok(region&&domainCard&&lowerCard&&region.y+region.height<domainCard.y&&domainCard.y+domainCard.height<lowerCard.y);
  assert.ok(region&&domainCard&&Math.abs(region.width-domainCard.width)<=8);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const shell=page.locator('.lo-shell');
  if(width===390){
   assert.ok(await shell.evaluate(el=>el.scrollWidth>el.clientWidth&&getComputedStyle(el).overflowX==='auto'));
   await expect(page.getByRole('button',{name:'打开导航'})).toBeHidden();
   await expect(nav).toBeVisible();
   await metricButtons.last().scrollIntoViewIfNeeded();
   assert.ok(await shell.evaluate(el=>el.scrollLeft>0));
   await shell.evaluate(el=>{el.scrollLeft=0});
  }
  t.diagnostic(`Overview ${width}px: ${bounds.map(bound=>`${bound?.width}×${bound?.height}`).join(', ')}; no document overflow`);
 }
 await page.setViewportSize({width:1365,height:900});
 if(process.env.LIFEOS_OVERVIEW_SCREENSHOT){
  const candidate=await page.locator('main').evaluateHandle(main=>{
   const label=document.createElement('p');
   label.textContent='未上线 · 合成数据';
   label.style.cssText='display:block;margin:0 0 12px;padding:8px 12px;background:#fff3cf;color:#493600;border-radius:6px;font-size:15px';
   main.prepend(label);
   return label;
  });
  await page.screenshot({path:process.env.LIFEOS_OVERVIEW_SCREENSHOT});
  await candidate.evaluate(label=>label.remove());
  await candidate.dispose();
 }
 for(const [name,due] of [['待办：0','all'],['今日到期：0','today'],['已逾期：0','overdue']] as const){
  const button=metricButtons.filter({hasText:name.split('：')[0]});
  await expect(button).toHaveAccessibleName(name);
  if(due==='today'){
   await button.focus();
   await expect(button).toBeFocused();
   await page.keyboard.press('Enter');
  }else await button.click();
  await expect(page).toHaveURL(/page=tasks/);
  await page.getByRole('button',{name:'筛选',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'状态',exact:true})).toHaveValue('pending');
  await expect(page.getByLabel('到期筛选')).toHaveValue(due);
  await page.goto(origin+'/personal',{waitUntil:'networkidle'});
 }
 await metricButtons.getByText('推进中项目',{exact:true}).click();
 await expect(page).toHaveURL(/page=projects/);
 await page.goto(origin+'/personal',{waitUntil:'networkidle'});
 const historyLength=await page.evaluate(()=>history.length);
 for(const [module,items] of [
  ['生活记录',records],
  ['长期积累',[['财务','/personal/finance']]],
  ['资料与工具',[['存储审核','/personal/storage-review']]],
 ] as const){
  await moduleSwitch.getByRole('button',{name:module,exact:true}).click();
  await expect(moduleSwitch.getByRole('button',{pressed:true})).toHaveAccessibleName(module);
  await assertWorkspaceModule(nav,module,items);
 }
 await expect(page).toHaveURL(origin+'/personal');
 assert.equal(await page.evaluate(()=>history.length),historyLength);
 await moduleSwitch.getByRole('button',{name:'生活记录',exact:true}).click();
 await expect(domains.getByRole('heading',{name:'合成领域',exact:true})).toBeVisible();
 await expect(domains.getByText('合成下一步',{exact:true})).toBeVisible();
 await expect(domains.getByRole('heading',{name:'未关联领域',exact:true})).toBeVisible();
 await domains.getByRole('button',{name:/合成项目甲/}).click();await expect(page).toHaveURL(/page=tasks/);
 await expect(breadcrumb).toHaveCount(1);
 await assertWorkspaceModule(nav,'安排与推进',planning);
 await expect(location).toHaveText('待办');
 await expect(overviewLink).toHaveText('总览');
 await back.focus();await page.keyboard.press('Enter');await expect(domains).toBeVisible();
 await expect(location).toHaveText('总览');
 await expect(forward).toBeEnabled();
 await assertWorkspaceModule(nav,'生活记录',records);
 await breadcrumb.getByRole('button',{name:'前进',exact:true}).click();await expect(page).toHaveURL(/page=tasks/);
 await assertWorkspaceModule(nav,'安排与推进',planning);
 await breadcrumb.getByRole('button',{name:'后退',exact:true}).click();await expect(domains).toBeVisible();
 await page.getByRole('button',{name:'收起侧栏',exact:true}).click();await expect(nav.getByRole('link',{name:'日记',exact:true})).toBeVisible();await page.getByRole('button',{name:'展开侧栏',exact:true}).click();
 await page.getByRole('button',{name:'设置',exact:true}).click();
 const settings=page.getByRole('navigation',{name:'设置分类'});
 await expect(page.locator('aside').getByRole('navigation',{name:'设置分类'})).toBeVisible();
 await expect(page.locator('main').getByRole('navigation',{name:'设置分类'})).toHaveCount(0);
 await expect(nav).toHaveCount(0);
 await expect(settings.getByRole('group',{name:'偏好与账号'})).toBeVisible();await expect(settings.getByRole('group',{name:'产品与反馈'}).getByRole('button',{name:'需求池',exact:true})).toBeVisible();
 await settings.getByRole('button',{name:'安全与密码',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'安全面板'})).toBeVisible();
 await page.getByRole('button',{name:'合成草稿保护 关'}).click();await settings.getByRole('button',{name:'通用',exact:true}).click();await expect(page.getByRole('heading',{name:'安全面板'})).toBeVisible();await page.getByRole('button',{name:'合成草稿保护 开'}).click();
 const general=page.locator('[data-settings-panel="general"]');
 await settings.getByRole('button',{name:'通用',exact:true}).click();await expect(general).toBeVisible();
 await page.getByRole('navigation',{name:'浏览位置'}).getByRole('button',{name:'后退',exact:true}).click();await expect(page.getByRole('heading',{name:'安全面板'})).toBeVisible();await page.getByRole('navigation',{name:'浏览位置'}).getByRole('button',{name:'前进',exact:true}).click();await expect(general).toBeVisible();
 const appearance=page.locator('header [data-slot="theme-toggle"]');
 await appearance.focus();await page.keyboard.press('Space');await expect(page.locator('html')).toHaveAttribute('data-lifeos-theme','dark');
 await expect(appearance).toBeFocused();
 const accumulationModule=moduleSwitch.getByRole('button',{name:'长期积累',exact:true});
 await accumulationModule.click();
 await expect(accumulationModule).toBeFocused();
 await expect(general).toBeVisible();
 await page.setViewportSize({width:1024,height:844});await expect(settings.getByRole('button',{name:'通用',exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 await expect(settings.getByRole('button',{name:'通用'})).toHaveAttribute('aria-current','page');
 await expect(moduleSwitch).toBeVisible();
 await expect(page.getByRole('button',{name:'打开导航'})).toBeHidden();
 await page.goto(origin+'/personal?page=settings&panel=security',{waitUntil:'networkidle'});
 await expect(settings.getByRole('button',{name:'安全与密码'})).toHaveAttribute('aria-current','page');
 await expect(page.getByRole('heading',{name:'安全面板'})).toBeVisible();
 await page.getByRole('button',{name:'合成草稿保护 关'}).click();
 await settings.getByRole('button',{name:'通用'}).focus();
 await page.keyboard.press('Enter');
 await expect(page.getByRole('heading',{name:'安全面板'})).toBeVisible();
 await page.getByRole('button',{name:'合成草稿保护 开'}).click();
 await settings.getByRole('button',{name:'通用'}).click();
 await expect(general).toBeVisible();
 for(const width of [1365,390]){
  await page.setViewportSize({width,height:844});
  await page.goto(origin+'/personal?page=tasks',{waitUntil:'networkidle'});
  await expect(location).toHaveText('待办');
  await expect(nav.getByRole('button',{name:'事项'})).toHaveAttribute('aria-current','page');
  await overviewLink.click();
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:2});
  await expect.poll(()=>page.evaluate(()=>visualViewport?.scale)).toBe(2);
  const recordsModule=moduleSwitch.getByRole('button',{name:'生活记录'});
  await recordsModule.focus();
  await page.keyboard.press('Enter');
  await assertWorkspaceModule(nav,'生活记录',records);
  const lastMetric=metricButtons.last();
  await lastMetric.evaluate(button=>button.scrollIntoView({inline:'end',block:'nearest'}));
  const points=await lastMetric.evaluate(button=>{
   const r=button.getBoundingClientRect(),v=visualViewport!;
   const x=r.x+r.width/2,y=r.y+r.height/2;
   return [[x-v.offsetLeft,y-v.offsetTop],[(x-v.offsetLeft)*v.scale,(y-v.offsetTop)*v.scale],[x,y]];
  });
  for(const [x,y] of points){
   await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
   await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
   if(page.url().includes('page=projects'))break;
   if(page.url().includes('page=tasks'))await page.evaluate(()=>history.back());
  }
  await expect(page).toHaveURL(/page=projects/);
  await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});
  await cdp.detach();
  t.diagnostic(`${width}px at 200%: keyboard module selection and pointer opened Projects`);
 }
 await page.goto(origin+'/personal?partial=1',{waitUntil:'networkidle'});await expect(page.getByRole('region',{name:'生活维度'}).getByText('仅显示已读取的领域与项目，完整范围待确认。',{exact:true})).toBeVisible();
 await expect(metricButtons).toHaveText(['待办—','今日到期—','已逾期—','推进中项目—']);
 for(const [index,label] of ['待办','今日到期','已逾期','推进中项目'].entries()){
  await expect(metricButtons.nth(index)).toHaveAccessibleName(label+'：未知');
  await expect(metricButtons.nth(index)).toBeDisabled();
 }
 fileHandoffEnabled=true;
 await page.reload({waitUntil:'networkidle'});
 await moduleSwitch.getByRole('button',{name:'资料与工具'}).click();
 await expect(nav.getByRole('link',{name:'文件交接'})).toHaveAttribute('href','/personal/file-handoffs');
 enabled=false;await page.reload({waitUntil:'networkidle'});
 await expect(moduleSwitch.getByRole('button')).toHaveText(['安排与推进']);
 await assertWorkspaceModule(nav,'安排与推进',[['总览'],['事项']]);
 assert.deepEqual(writes,[]);
 assert.deepEqual(errors,[]);
});

test('OPT-IN exact private navigation oracle accepts only the enabled four-link owner surface',{skip:process.env.RUN_WORKSPACE_HIERARCHY_BROWSER_TESTS!=='1'&&'Requires isolated synthetic Next/Chrome fixture',timeout:120000},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-navigation-oracle-'));
 let browser:Browser|undefined,browserServer:BrowserServer|undefined,browserProcess:FixtureProcess|undefined,server:FixtureProcess|undefined;
 t.after(()=>cleanupAuthThemeFixture({root,browser,browserServer,browserProcess,server}));
 await mkdir(join(root,'app','personal'),{recursive:true});
 await Promise.all([cp(join(source,'src'),join(root,'src'),{recursive:true}),...['layout.tsx','globals.css','theme.css'].map(name=>cp(join(source,'app',name),join(root,'app',name))),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components'))]);
 await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
 await writeFile(join(root,'app','personal','page.tsx'),`'use client';import {LifeOSWorkspace} from '../../src/ui-review/workspace';export default function Page(){return <LifeOSWorkspace syncUrl state={{status:'ready',data:{tasks:[],projects:[],areas:[],topics:[],today:'2030-11-05',asOf:'2030-11-05T00:00:00Z',coverage:'complete'}}} access={{authenticated:true,writable:true,loginAllowed:true,allowedTypes:['todo','journal','project','domain','topic']}} onCreateTask={()=>true} viewPreferenceScope={JSON.stringify(['navigation-owner','navigation-space'])}/>;}`);
 const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,detached:true,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});server=trackAuthThemeProcess(child,true);
 let output='';const collect=(chunk:Buffer)=>{output=(output+String(chunk)).slice(-3000);};child.stdout.on('data',collect);child.stderr.on('data',collect);
 const origin=await new Promise<string>((accept,reject)=>{const timer=setTimeout(()=>reject(Error('fixture-start-timeout')),30000);const check=()=>{const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);child.stdout.off('data',check);accept(match[0]);}};child.stdout.on('data',check);child.once('exit',()=>{clearTimeout(timer);reject(Error('fixture-start-exit'));});check();});
 browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});browserProcess=trackAuthThemeProcess(browserServer.process());browser=await chromium.connect(browserServer.wsEndpoint());
 const page=await browser.newPage({viewport:{width:1365,height:900}}),errors:string[]=[],writes:string[]=[];page.on('pageerror',error=>errors.push(error.message));let enabled=true,advertised=true,statusReads=0;
 const config={ownerId:'navigation-owner',ownerEmail:'navigation@example.invalid',spaceId:'navigation-space',databaseName:'fixture',baseURL:origin,approval:'personal-manual-v1',allowedTypes:['todo','journal','project','domain','topic']} as const;
 const handler=createPersonalPlatformHandler({config,repository:new MemoryPort(),storageVerified:true,sessions:{read:async()=>({userId:config.ownerId,email:config.ownerEmail})},assertWritable:async()=>{}});
 await page.route('**/api/platform/**',async route=>{
  const request=route.request();if(request.method()!=='GET')writes.push(request.method());
  if(!enabled)return route.fulfill({headers:{'cache-control':'private, no-store'},json:{scope:'closed'}});
  const response=await handler(new Request(request.url(),{method:request.method(),headers:{...request.headers(),host:new URL(origin).host}}));assert.ok(response);
  let body=await response.text();if(['/api/platform/personal/status','/api/platform/status'].includes(new URL(request.url()).pathname)){const value=JSON.parse(body);assert.equal(value.storageReviewEnabled,true);statusReads++;if(!advertised){delete value.storageReviewEnabled;body=JSON.stringify(value);}}
  return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});
 });
 const open=async(width=1365)=>{await page.setViewportSize({width,height:844});await page.goto(origin+'/personal',{waitUntil:'networkidle',timeout:70000});if(width===390)await page.getByRole('button',{name:'打开导航',exact:true}).click();};
 for(const width of [1365,390]){await open(width);await assertPrivateFixtureNavigation(page);t.diagnostic('original navigation oracle passed '+width);}
 for(const change of ['extra','href','missing','order','role','storage-href','storage-missing','unadvertised','closed']){
  enabled=change!=='closed';advertised=change!=='unadvertised';await open();
  if(change==='closed'||change==='unadvertised'){
   await assert.rejects(assertPrivateFixtureNavigation(page),/toHaveText/);
  }else{
   const storage=change.startsWith('storage-');
   const module=storage?'资料与工具':change==='order'?'生活记录':'安排与推进';
   await page.getByRole('navigation',{name:'切换模块'}).getByRole('button',{name:module,exact:true}).click();
   const nav=page.getByRole('navigation',{name:'主导航',exact:true});
   const items=storage?[['存储审核','/personal/storage-review']] as const:change==='order'?[['日记','/personal/journal'],['做饭','/personal/cooking']] as const:[['总览'],['事项'],['搜索本人记录','/personal/search']] as const;
   await nav.evaluate((nav,{change,href})=>{
    const link=nav.querySelector<HTMLAnchorElement>('a[href="'+href+'"]')!;
    if(change==='extra'){const extra=document.createElement('a');extra.href='/personal/extra';extra.textContent='额外入口';nav.append(extra);}
    else if(change.endsWith('href'))link.setAttribute('href',href+'/extra');
    else if(change.endsWith('missing'))link.remove();
    else if(change==='role'){const button=document.createElement('button');button.textContent=link.textContent;link.replaceWith(button);}
    else link.parentElement!.append(link);
   },{change,href:items.find(([,href])=>href)![1]});
   // These mutations are already applied when checking the oracle.
   await assert.rejects(assertWorkspaceModule(nav,module,items,500),change.endsWith('href')?/toHaveAttribute/:change==='role'?/toHaveRole/:/toHaveText/);
  }
  t.diagnostic('strict navigation rejection: '+change);
 }
 assert.ok(statusReads>0);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
});
