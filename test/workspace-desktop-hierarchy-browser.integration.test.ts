import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,expect,type Browser,type BrowserServer} from '@playwright/test';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';
import {assertPrivateFixtureNavigation} from './helpers/private-business-browser-fixture.ts';
import {MemoryPort} from './helpers/platform.ts';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';

test('OPT-IN desktop hierarchy preserves authorized destinations, real domain relations, settings history and responsive keyboard access',{skip:process.env.RUN_WORKSPACE_HIERARCHY_BROWSER_TESTS!=='1'&&'Requires isolated synthetic Next/Chrome fixture',timeout:120000},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-hierarchy-'));
 let browser:Browser|undefined,browserServer:BrowserServer|undefined,browserProcess:FixtureProcess|undefined,server:FixtureProcess|undefined;
 t.after(()=>cleanupAuthThemeFixture({root,browser,browserServer,browserProcess,server}));
 await mkdir(join(root,'app','personal'),{recursive:true});
 await Promise.all([cp(join(source,'src'),join(root,'src'),{recursive:true}),...['layout.tsx','globals.css','theme.css'].map(name=>cp(join(source,'app',name),join(root,'app',name))),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components'))]);
 await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
 await writeFile(join(root,'app','personal','page.tsx'),`'use client';import {useEffect,useState} from 'react';import {LifeOSWorkspace} from '../../src/ui-review/workspace';export default function Page(){const[dirty,setDirty]=useState(false),[partial,setPartial]=useState(false);useEffect(()=>setPartial(new URLSearchParams(window.location.search).has('partial')),[]);return <LifeOSWorkspace syncUrl state={{status:'ready',data:{tasks:[],projects:[{id:'project-a',title:'合成项目甲',revision:1,area:{id:'area-a',title:'合成领域'},stage:'active',nextStep:'合成下一步'},{id:'project-b',title:'合成未关联项目',revision:1,area:null,stage:'active',nextStep:null}],areas:[{id:'area-a',title:'合成领域',revision:1}],topics:[],today:'2030-11-05',asOf:'2030-11-05T00:00:00Z',coverage:partial?'partial':'complete'}}} access={{authenticated:true,writable:true,loginAllowed:true,allowedTypes:['todo','journal','topic']}} viewPreferenceScope={JSON.stringify(['hierarchy-owner','hierarchy-space'])} availableSettingsPanels={['security','api-keys']} renderSettingsPanel={panel=><section><h2>{panel==='security'?'安全面板':'密钥面板'}</h2><button onClick={()=>setDirty(!dirty)}>合成草稿保护 {dirty?'开':'关'}</button></section>} settingsCloseGuard={{current:()=>!dirty}}/>;}`);
 const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3010'],{cwd:root,detached:true,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});server=trackAuthThemeProcess(child,true);
 let output='';const collect=(chunk:Buffer)=>{output=(output+String(chunk)).slice(-3000);};child.stdout.on('data',collect);child.stderr.on('data',collect);
 const origin=await new Promise<string>((accept,reject)=>{const timer=setTimeout(()=>reject(Error('fixture-start-timeout '+output)),30000);const check=()=>{if(output.includes('Ready in')){clearTimeout(timer);child.stdout.off('data',check);accept('http://127.0.0.1:3010');}};child.stdout.on('data',check);child.once('exit',()=>{clearTimeout(timer);reject(Error('fixture-start-exit '+output));});check();});
 browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});browserProcess=trackAuthThemeProcess(browserServer.process());browser=await chromium.connect(browserServer.wsEndpoint());
 const page=await browser.newPage({viewport:{width:1365,height:900}});page.setDefaultTimeout(10000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 let enabled=true;
 await page.route('**/api/platform/**',route=>route.fulfill({json:enabled?{scope:'personal-manual-candidate',ownerId:'hierarchy-owner',spaceId:'hierarchy-space',storageVerified:true,storageReviewEnabled:true,allowedTypes:['todo','journal'],calendarEnabled:true,financeEnabled:true,requirementsEnabled:true,requirementSupportEnabled:true}: {scope:'closed'}}));
 await page.goto(origin+'/personal',{waitUntil:'networkidle',timeout:70000});
 const nav=page.locator('aside').getByRole('navigation',{name:'主导航'});
 await expect(nav.getByRole('group',{name:'生活记录'}).getByRole('link',{name:'日记',exact:true})).toBeVisible();
 await expect(nav.getByRole('group',{name:'安排与推进'}).getByRole('link',{name:'日程',exact:true})).toBeVisible();
 await expect(nav.getByRole('group',{name:'长期积累'}).getByRole('link',{name:'财务',exact:true})).toBeVisible();
 const domains=page.getByRole('region',{name:'生活维度',exact:true});
 await expect(domains.getByRole('heading',{name:'合成领域',exact:true})).toBeVisible();
 await expect(domains.getByText('合成下一步',{exact:true})).toBeVisible();
 await expect(domains.getByRole('heading',{name:'未关联领域',exact:true})).toBeVisible();
 await domains.getByRole('button',{name:/合成项目甲/}).click();await expect(page).toHaveURL(/page=tasks/);
 await page.getByRole('navigation',{name:'浏览位置'}).getByRole('button',{name:'后退',exact:true}).click();await expect(domains).toBeVisible();
 await page.getByRole('button',{name:'收起侧栏',exact:true}).click();await expect(nav.getByRole('link',{name:'日记',exact:true})).toBeVisible();await page.getByRole('button',{name:'展开侧栏',exact:true}).click();
 await page.getByRole('button',{name:'设置',exact:true}).click();
 const settings=page.getByRole('navigation',{name:'设置分类'});
 await expect(settings.getByRole('group',{name:'偏好与账号'})).toBeVisible();await expect(settings.getByRole('group',{name:'产品与反馈'}).getByRole('button',{name:'需求池',exact:true})).toBeVisible();
 await settings.getByRole('button',{name:'安全与密码',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'安全面板'})).toBeVisible();
 await page.getByRole('button',{name:'合成草稿保护 关'}).click();await settings.getByRole('button',{name:'通用',exact:true}).click();await expect(page.getByRole('heading',{name:'安全面板'})).toBeVisible();await page.getByRole('button',{name:'合成草稿保护 开'}).click();
 await settings.getByRole('button',{name:'通用',exact:true}).click();await expect(page.getByRole('heading',{name:'外观',exact:true})).toBeVisible();
 await page.getByRole('navigation',{name:'浏览位置'}).getByRole('button',{name:'后退',exact:true}).click();await expect(page.getByRole('heading',{name:'安全面板'})).toBeVisible();await page.getByRole('navigation',{name:'浏览位置'}).getByRole('button',{name:'前进',exact:true}).click();await expect(page.getByRole('heading',{name:'外观',exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'明暗模式',exact:true}).selectOption('dark');await expect(page.locator('html')).toHaveAttribute('data-lifeos-theme','dark');
 for(const width of [1024,390]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await expect(settings.getByRole('button',{name:'通用',exact:true})).toBeVisible();}
 await page.goto(origin+'/personal?partial=1',{waitUntil:'networkidle'});await expect(page.getByRole('region',{name:'生活维度'}).getByText('仅显示已读取的领域与项目，完整范围待确认。',{exact:true})).toBeVisible();
 enabled=false;await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'打开导航',exact:true}).click();await expect(page.getByRole('dialog').getByRole('link',{name:'日记',exact:true})).toHaveCount(0);
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
 for(const change of ['extra','href','missing','order','storage-href','storage-missing','unadvertised','closed']){
  enabled=change!=='closed';advertised=change!=='unadvertised';await open();
  if(change!=='closed'&&change!=='unadvertised')await page.getByRole('navigation',{name:'主导航',exact:true}).evaluate((nav,change)=>{const search=nav.querySelector('a[href="/personal/search"]')!,storage=nav.querySelector('a[href="/personal/storage-review"]')!;if(change==='extra'){const link=document.createElement('a');link.href='/personal/extra';link.textContent='额外入口';nav.append(link);}else if(change==='href')search.setAttribute('href','/personal/search/extra');else if(change==='missing')search.remove();else if(change==='storage-href')storage.setAttribute('href','/personal/storage-review/extra');else if(change==='storage-missing')storage.remove();else nav.append(search);},change);
  await assert.rejects(assertPrivateFixtureNavigation(page),change.endsWith('href')?/toHaveAttribute/:/toHaveText/);t.diagnostic('strict navigation rejection: '+change);
 }
 assert.ok(statusReads>0);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
});
