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
  await t.test(`readable table typography ${width}/${theme}`,async()=>{
   const sizes=await page.locator('[data-requirement-id]').first().evaluate(node=>({body:parseFloat(getComputedStyle(node.querySelector('button')!).fontSize),metadata:parseFloat(getComputedStyle(node.querySelector('button span')!).fontSize)}));
   assert.ok(sizes.body>=(width>=1024?14:16),`Requirement body must be at least 16px, got ${sizes.body}`);
   assert.ok(sizes.metadata>=(width>=1024?12:14),`Requirement metadata must be at least 14px, got ${sizes.metadata}`);
  });
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
  assert.equal(await page.locator('[data-requirement-id] button').first().evaluate(node=>parseFloat(getComputedStyle(node).fontSize)>=(innerWidth>=1024?14:16)),true);
  assert.equal(await page.locator('article [data-slot="badge"]').evaluateAll(nodes=>nodes.length>0&&nodes.every(node=>parseFloat(getComputedStyle(node).fontSize)>=(innerWidth>=1024?12:14))),true,'Board metadata stays at least 14px');
  await page.screenshot({path:join(screenshots,`requirements-board-${width}-${theme}.png`)});
  await page.getByRole('button',{name:'甘特视图',exact:true}).click();assert.deepEqual(await visibleIds(),[]);
  await page.getByRole('button',{name:'看板视图',exact:true}).click();
  await page.locator('[data-requirements-filters] summary').click();await page.getByLabel('阶段',{exact:true}).selectOption('workspace');
  await page.getByLabel('优先级',{exact:true}).selectOption('P0');
  await page.getByLabel('实现状态',{exact:true}).selectOption('partial');
  await page.getByLabel('验收状态',{exact:true}).selectOption('in_progress');
  const expected=selectRequirements(baseline,{phase:'workspace',priority:'P0',implementation:'partial',acceptance:'in_progress'}).map(r=>r.id).sort();
  assert.ok(expected.length>0);assert.deepEqual(await visibleIds(),expected);
  await page.getByRole('button',{name:'甘特视图',exact:true}).click();
  assert.deepEqual(await visibleIds(),[]);
  assert.equal(await page.locator('[data-requirements-filters]').evaluate(node=>(node as HTMLDetailsElement).open),false);
  await expect(page.getByRole('heading',{name:`未排期（${expected.length}）`,exact:true})).toBeVisible();
  await expect(page.getByText('尚无完整排期；设置计划开始和结束日期后显示甘特条',{exact:true})).toBeVisible();
  await expect(page.locator('[data-gantt-bar],time')).toHaveCount(0);
  await page.screenshot({path:join(screenshots,`requirements-gantt-${width}-${theme}.png`)});
  await page.getByRole('button',{name:'查看需求表格',exact:true}).click();assert.deepEqual(await visibleIds(),expected);
  const trigger=page.locator(`[data-requirement-id="${expected[0]}"] button`);await trigger.click();
  const dialog=page.getByRole('dialog'),title=dialog.getByRole('heading',{level:2});
  await expect(dialog).toBeVisible();await expect(title).toBeFocused();
  const item=baseline.requirements.find(r=>r.id===expected[0])!;
  await expect(dialog.getByText(baseline.roadmap!.phases.find(phase=>phase.id==='workspace')!.title,{exact:true})).toBeVisible();
  for(const criterion of item.acceptanceCriteria)await expect(dialog.getByText(criterion,{exact:true})).toBeVisible();
  const handle=await dialog.elementHandle();
  await dialog.evaluate(node=>(node as HTMLElement).dataset.continuity='same');
  await dialog.getByRole('button',{name:'展开到内容区',exact:true}).click();
  assert.equal(await handle!.evaluate(node=>node.isConnected&&node.dataset.continuity==='same'),true);
  await expect(dialog.getByRole('button',{name:'收起详情',exact:true})).toBeVisible();
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
 for(const view of ['table','board','gantt'] as const)await t.test(`390x400 ${view} keeps first and last records reachable`,async()=>{
  const page=await browser.newPage({viewport:{width:390,height:400},colorScheme:'dark'});page.setDefaultTimeout(8000);t.after(()=>page.close());
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin&&['GET','HEAD'].includes(route.request().method())?route.continue():route.abort());
  await page.goto(origin,{waitUntil:'networkidle',timeout:60000});
  await page.getByRole('button',{name:({table:'表格',board:'看板',gantt:'甘特'}[view])+'视图',exact:true}).click();
  if(view==='gantt'){
   // The public baseline has no planning dates. Preserve reachability through the table;
   // undated records must never be stacked into the chart to satisfy this oracle.
   const gantt=page.getByRole('region',{name:'需求甘特'});
   assert.ok((await gantt.boundingBox())!.height>=96);
   await expect(gantt.locator('[data-requirement-id]')).toHaveCount(0);
   await page.screenshot({path:join(screenshots,`requirements-short-${view}-390x400-dark.png`)});
   const table=gantt.getByRole('button',{name:'查看需求表格',exact:true});await table.scrollIntoViewIfNeeded();await expect(table).toBeInViewport({ratio:0.5});await table.click();
  }
  const populatedColumn=page.locator('[aria-label="按阶段查看需求"]').locator(':scope > section').filter({has:page.locator('[data-requirement-id]')});
  const viewport=view==='board'?populatedColumn.first().locator(':scope > div'):page.locator('[data-slot="data-grid-table-viewport"]');
  const headerHeight=view!=='board'?(await viewport.locator('thead').boundingBox())!.height:0;
  const height=(await viewport.boundingBox())!.height;
  assert.ok(height-headerHeight>=96,`${view} requires visible row area, got ${height-headerHeight}px`);
  const entries=page.locator('[data-requirement-id] button');
  for(const trigger of [entries.first(),entries.last()]){
   await trigger.scrollIntoViewIfNeeded();await expect(trigger).toBeInViewport({ratio:0.5});
   const id=await trigger.locator('span').first().textContent();
   await trigger.click();await expect(page.getByRole('dialog').getByText(id!,{exact:true})).toBeVisible();await page.keyboard.press('Escape');
  }
  if(view!=='gantt')await page.screenshot({path:join(screenshots,`requirements-short-${view}-390x400-dark.png`)});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 });
});
