import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';

test('OPT-IN visible palettes and truthful task/project/requirement Gantt',{
 skip:process.env.RUN_APPEARANCE_GANTT_BROWSER_TESTS!=='1'&&'Requires isolated synthetic Next fixture and native Chrome',timeout:180_000,
},async()=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-appearance-gantt-'));
 let serverProcess:FixtureProcess|undefined,browserProcess:FixtureProcess|undefined,browserServer:Awaited<ReturnType<typeof chromium.launchServer>>|undefined,browser:Awaited<ReturnType<typeof chromium.connect>>|undefined;
 try{
  await mkdir(join(root,'app/schedule'),{recursive:true});
  await Promise.all([cp(join(source,'src'),join(root,'src'),{recursive:true}),...['layout.tsx','globals.css','theme.css'].map(file=>cp(join(source,'app',file),join(root,'app',file))),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components'))]);
  await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
  // Internal memory-only records: a deadline and a project stage never imply an interval.
  await writeFile(join(root,'app/page.tsx'),`'use client';
import {LifeOSWorkspace} from '../src/ui-review/workspace';
export default function Page(){return <LifeOSWorkspace initialPage="tasks" state={{status:'ready',data:{tasks:[{id:'synthetic-task',revision:1,title:'合成到期待办',notes:null,status:'open',dueOn:'2030-11-05',area:null,project:null,inInbox:false,sourceLabel:'合成测试'}],projects:[{id:'synthetic-project',revision:1,title:'合成项目',area:null,stage:'active',nextStep:null}],areas:[],today:'2030-11-05',asOf:'2030-11-05T00:00:00Z',coverage:'complete'}}} access={{authenticated:true,writable:false,loginAllowed:true}}/>}`);
  await writeFile(join(root,'app/schedule/page.tsx'),`'use client';
import {RequirementsGantt} from '../../src/ui-review/requirements-views';import {requirements} from '../../src/platform/requirements';
const rows=requirements().requirements.slice(0,4),planning=new Map([[rows[0].id,{plannedStartOn:'2030-11-05',plannedEndOn:'2030-11-08'}],[rows[1].id,{plannedStartOn:'2030-11-06',plannedEndOn:null}],[rows[2].id,{plannedStartOn:null,plannedEndOn:'2030-11-09'}]]);
export default function Page(){return <main data-lifeos-surface className="lo-shell" style={{height:'100dvh',padding:16}}><RequirementsGantt rows={rows} planning={planning} onOpen={()=>{}}/></main>}`);
  const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],detached:true});serverProcess=trackAuthThemeProcess(server,true);server.stderr.resume();
  const origin=await new Promise<string>((accept,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Fixture startup timeout')),30_000);server.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture exited'));});server.once('error',error=>{clearTimeout(timer);reject(error);});server.stdout.on('data',chunk=>{output=(output+String(chunk)).slice(-65536);const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});});
  browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH,host:'127.0.0.1'});browserProcess=trackAuthThemeProcess(browserServer.process());browser=await chromium.connect(browserServer.wsEndpoint());
  const page=await browser.newPage({viewport:{width:1365,height:900},colorScheme:'light'});page.setDefaultTimeout(8000);let writes=0;const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{const request=route.request();if(!['GET','HEAD'].includes(request.method())){writes++;return route.abort();}return new URL(request.url()).origin===origin?route.continue():route.abort();});
  await page.goto(origin,{waitUntil:'networkidle',timeout:60000});await expect(page.locator('[data-task-grid="reui"]')).toBeVisible();
  const baselineFont=await page.locator('.lo-shell').evaluate(node=>getComputedStyle(node).fontSize);
  await page.getByRole('button',{name:'设置',exact:true}).click();const settings=page.locator('[data-settings-page]');
  await expect(settings.getByRole('group',{name:'配色预设',exact:true})).toBeVisible();await expect(settings.getByRole('radio')).toHaveCount(3);
  await settings.getByRole('radio',{name:'鼠尾草 · 青绿',exact:true}).check();await settings.getByLabel('明暗模式',{exact:true}).selectOption('dark');
  assert.equal(await page.locator('html').getAttribute('data-lifeos-palette'),'sage-teal');assert.equal(await page.locator('html').getAttribute('data-lifeos-theme'),'dark');
  assert.equal(await page.locator('.lo-shell').evaluate(node=>getComputedStyle(node).fontSize),baselineFont);
  await page.getByRole('button',{name:'事项',exact:true}).click();await page.reload({waitUntil:'networkidle'});await expect(page.locator('[data-task-grid="reui"]')).toBeVisible();
  assert.equal(await page.locator('html').getAttribute('data-lifeos-palette'),'sage-teal');assert.equal(await page.locator('html').getAttribute('data-lifeos-theme'),'dark');
  await page.getByRole('button',{name:'甘特',exact:true}).click();const taskGantt=page.getByRole('region',{name:'待办甘特',exact:true});await expect(taskGantt.getByRole('heading',{name:'尚无完整排期',exact:true})).toBeVisible();await expect(taskGantt.locator('[data-gantt-bar],time')).toHaveCount(0);await expect(taskGantt).toContainText('1 项待办未完整排期');await taskGantt.getByRole('button',{name:'查看待办表格',exact:true}).click();await expect(page.locator('[data-task-grid="reui"]')).toBeVisible();
  await page.getByRole('button',{name:'项目分类视图',exact:true}).click();await page.getByRole('group',{name:'项目视图',exact:true}).getByRole('button',{name:'甘特',exact:true}).click();const projectGantt=page.getByRole('region',{name:'项目甘特',exact:true});await expect(projectGantt.getByRole('heading',{name:'尚无完整排期',exact:true})).toBeVisible();await expect(projectGantt).toContainText('1 项项目未完整排期');await projectGantt.getByRole('button',{name:'查看项目表格',exact:true}).click();await expect(page.getByRole('columnheader',{name:/下一步/})).toBeVisible();
  const viewport=page.locator('[data-slot="data-grid-table-viewport"]');assert.equal(await viewport.evaluate(node=>getComputedStyle(node).scrollbarWidth),'thin');
  await page.setViewportSize({width:360,height:800});await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();
  await settings.getByRole('radio',{name:'雾紫 · 紫罗兰',exact:true}).check();const mobile=await settings.getByRole('radio').first().locator('..').evaluate(node=>({font:parseFloat(getComputedStyle(node).fontSize),height:node.getBoundingClientRect().height}));assert.ok(mobile.font>=16);assert.ok(mobile.height>=44);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.keyboard.press('Escape');await page.goto(origin+'/schedule',{waitUntil:'networkidle',timeout:60000});const gantt=page.getByRole('region',{name:'需求甘特',exact:true});await expect(gantt.locator('[data-gantt-bar]')).toHaveCount(1);await expect(gantt.locator('[data-requirement-id]')).toHaveCount(1);await expect(gantt.getByRole('img',{name:'计划 2030-11-05 至 2030-11-08',exact:true})).toBeVisible();await expect(gantt.getByRole('heading',{name:'未排期（3）',exact:true})).toBeVisible();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(writes,0);assert.deepEqual(errors,[]);console.log('APPEARANCE_GANTT_BROWSER_PASS '+JSON.stringify({desktopFont:baselineFont,mobile,paletteRefresh:true,completeBars:1,partialBars:0,writes}));
 }finally{await cleanupAuthThemeFixture({root,browser,browserServer,browserProcess,server:serverProcess});}
});
