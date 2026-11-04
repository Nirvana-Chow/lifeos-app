import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {requirements,selectRequirements} from '../src/platform/requirements.ts';

// Readonly public metadata fixture: no account service, credentials or real records.
test('OPT-IN requirements share filters across table, board and undated Gantt with stable fullscreen details',{
 skip:process.env.RUN_REQUIREMENTS_BROWSER_TESTS!=='1'&&'Requires native Chrome and isolated Next fixture',timeout:180_000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-requirements-views-'));
 await mkdir(join(root,'app'),{recursive:true});
 await Promise.all([
  cp(join(source,'src'),join(root,'src'),{recursive:true}),
  ...['layout.tsx','globals.css','theme.css'].map(file=>cp(join(source,'app',file),join(root,'app',file))),
  cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  symlink(join(source,'node_modules'),join(root,'node_modules')),
  symlink(join(source,'components'),join(root,'components')),
 ]);
 await writeFile(join(root,'app/page.tsx'),`import {RequirementsPage} from '../src/ui-review/requirements-page';export default function Page(){return <main data-lifeos-surface style={{height:'100dvh',minHeight:0,padding:16,display:'flex',flexDirection:'column',overflow:'hidden'}}><RequirementsPage/></main>}`);
 const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 const stopped=once(server,'exit');
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await new Promise<string>((accept,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Fixture startup timeout')),30_000);server.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture exited'));});server.stdout.on('data',chunk=>{output+=String(chunk);const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});});
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 const baseline=requirements(), allIds=baseline.requirements.map(r=>r.id).sort();
 const screenshots=join(source,'.review-results');await mkdir(screenshots,{recursive:true});
 for(const [width,theme] of [[1365,'light'],[390,'dark']] as const){
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme});page.setDefaultTimeout(8000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin&&['GET','HEAD'].includes(route.request().method())?route.continue():route.abort());
  await page.goto(origin,{waitUntil:'networkidle',timeout:60000});
  await expect(page.locator('[data-requirements-grid="reui"]')).toBeVisible();
  await expect(page.getByText('验收条件',{exact:true})).toHaveCount(0);
  const visibleIds=async()=>page.locator('[data-requirement-id]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-requirement-id')!).sort());
  assert.deepEqual(await visibleIds(),allIds);
  await page.getByRole('button',{name:'按需求排序',exact:true}).click();
  const viewport=page.locator('[data-slot="data-grid-table-viewport"]');
  if(width<600)assert.equal(await viewport.evaluate(node=>node.scrollWidth>node.clientWidth),true,'Mobile table needs its own horizontal viewport');
  await page.screenshot({path:join(screenshots,`requirements-table-${width}-${theme}.png`)});
  const tools=page.getByRole('search',{name:'筛选需求'});
  const toolsY=(await tools.boundingBox())!.y;
  const header=viewport.locator('thead'),headerY=(await header.boundingBox())!.y;
  await viewport.evaluate(node=>{node.scrollTop=500;});
  assert.equal((await tools.boundingBox())!.y,toolsY);
  assert.ok(Math.abs((await header.boundingBox())!.y-headerY)<2);
  await page.getByRole('button',{name:'看板视图',exact:true}).click();
  assert.deepEqual(await visibleIds(),allIds);
  await page.screenshot({path:join(screenshots,`requirements-board-${width}-${theme}.png`)});
  await page.getByRole('button',{name:'甘特视图',exact:true}).click();assert.deepEqual(await visibleIds(),allIds);
  await page.getByRole('button',{name:'看板视图',exact:true}).click();
  await page.getByLabel('阶段',{exact:true}).selectOption('workspace');
  await page.getByLabel('优先级',{exact:true}).selectOption('P0');
  await page.getByLabel('实现状态',{exact:true}).selectOption('partial');
  await page.getByLabel('验收状态',{exact:true}).selectOption('in_progress');
  const expected=selectRequirements(baseline,{phase:'workspace',priority:'P0',implementation:'partial',acceptance:'in_progress'}).map(r=>r.id).sort();
  assert.ok(expected.length>0);assert.deepEqual(await visibleIds(),expected);
  await page.getByRole('button',{name:'甘特视图',exact:true}).click();
  assert.deepEqual(await visibleIds(),expected);
  await expect(page.getByRole('heading',{name:`未排期（${expected.length}）`,exact:true})).toBeVisible();
  await expect(page.getByText('尚未设置计划日期',{exact:true})).toBeVisible();
  await expect(page.locator('[data-gantt-bar],time')).toHaveCount(0);
  await page.screenshot({path:join(screenshots,`requirements-gantt-${width}-${theme}.png`)});
  const trigger=page.locator(`[data-requirement-id="${expected[0]}"] button`);await trigger.click();
  const dialog=page.getByRole('dialog'),title=dialog.getByRole('heading',{level:2});
  await expect(dialog).toBeVisible();await expect(title).toBeFocused();
  const item=baseline.requirements.find(r=>r.id===expected[0])!;
  await expect(dialog.getByText('待办与项目工作台',{exact:true})).toBeVisible();
  for(const criterion of item.acceptanceCriteria)await expect(dialog.getByText(criterion,{exact:true})).toBeVisible();
  const handle=await dialog.elementHandle();
  await dialog.evaluate(node=>(node as HTMLElement).dataset.continuity='same');
  await dialog.getByRole('button',{name:'展开全屏',exact:true}).click();
  assert.equal(await handle!.evaluate(node=>node.isConnected&&node.dataset.continuity==='same'),true);
  await expect(dialog.getByRole('button',{name:'退出全屏',exact:true})).toBeVisible();
  await expect.poll(async()=>Math.round((await dialog.boundingBox())!.width)).toBe(width);
  await expect.poll(async()=>Math.round((await dialog.boundingBox())!.height)).toBe(900);
  await page.screenshot({path:join(screenshots,`requirements-detail-${width}-${theme}.png`)});
  for(let index=0;index<12;index++){await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(node=>node.contains(document.activeElement)),true);}
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
  await page.getByRole('button',{name:'表格视图',exact:true}).click();assert.deepEqual(await visibleIds(),expected);
  await page.getByLabel('搜索需求',{exact:true}).fill('no-such-requirement');
  await expect(page.getByText('没有匹配的需求',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'甘特视图',exact:true}).click();await expect(page.getByRole('heading',{name:'未排期（0）',exact:true})).toBeVisible();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);await page.close();
 }
});
