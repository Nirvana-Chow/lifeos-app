import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,expect,type Browser,type BrowserServer} from '@playwright/test';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';

// Actual TaskGrid/ReUI rendering with explicit synthetic data; no business API.
test('OPT-IN todo grouping keeps ID-based groups, filtered counts and native leaf edit boundaries',{
 skip:process.env.RUN_TODO_GROUPING_BROWSER_TESTS!=='1'&&'Requires isolated synthetic Next fixture and native Chrome',timeout:180_000,
},async()=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-task-grouping-'));
 const output=process.env.LIFEOS_GROUPING_ARTIFACT_DIR??join(source,'.review-results');
 let server:FixtureProcess|undefined,browserProcess:FixtureProcess|undefined,browserServer:BrowserServer|undefined,browser:Browser|undefined,serverOutput='';
 try{
  await mkdir(join(root,'app'),{recursive:true});await mkdir(output,{recursive:true});
  await Promise.all([cp(join(source,'src'),join(root,'src'),{recursive:true}),...['layout.tsx','globals.css','theme.css'].map(file=>cp(join(source,'app',file),join(root,'app',file))),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components'))]);
  await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
  await writeFile(join(root,'app/page.tsx'),`'use client';
import {useState} from 'react';
import {TaskGrid} from '../src/ui-review/task-grid';
import '../src/ui-review/review.css';
const project=(id:string,title='同名合成项目')=>({id,title}),area=(id:string)=>({id,title:'合成领域 '+id});
const rows=[['a',project('p-one'),area('d-one')],['b',project('p-one'),area('d-two')],['c',project('p-two'),area('d-one')],['d',null,area('d-two')],['e',null,null],['f',project('p-three','其他合成项目'),null]].map(([id,project,area])=>({id:id as string,revision:7,title:'合成待办 '+id,status:'open' as const,dueOn:null,project:project as ReturnType<typeof project>|null,area:area as ReturnType<typeof area>|null}));
export default function Page(){const [filtered,setFiltered]=useState(false),[blocked,setBlocked]=useState(false),[writes,setWrites]=useState(0),[opens,setOpens]=useState(0);
return <main className="lo-shell" data-lifeos-surface="personal" style={{height:'100dvh',padding:12,display:'flex',flexDirection:'column',gap:8}}><aside aria-label="合成测试控制"><button onClick={()=>setFiltered(value=>!value)}>切换合成筛选</button><button onClick={()=>setBlocked(value=>!value)}>切换合成阻塞</button><output aria-label="合成写入次数">{writes}</output><output aria-label="合成打开次数">{opens}</output></aside><TaskGrid tasks={filtered?rows.filter(row=>['a','c','e'].includes(row.id)):rows} viewPreferenceScope="synthetic-grouping-only" writable blocked={blocked} onOpen={()=>setOpens(value=>value+1)} onSetTaskStatus={()=>setWrites(value=>value+1)} getTaskFields={task=>({title:rows.find(row=>row.id===task.id)!.title,text:'',date:'',status:'open'})} onSave={async()=>{setWrites(value=>value+1);return null;}}/></main>;}`);
  const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,detached:true,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
  server=trackAuthThemeProcess(child,true);child.stdout.on('data',chunk=>serverOutput+=String(chunk));child.stderr.on('data',chunk=>serverOutput+=String(chunk));
  const origin=await new Promise<string>((accept,reject)=>{const timer=setTimeout(()=>reject(Error('Synthetic grouping startup timeout')),15_000);child.once('exit',()=>{clearTimeout(timer);reject(Error('Synthetic grouping server exited'));});child.stdout.on('data',()=>{const match=serverOutput.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});});
  browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});browserProcess=trackAuthThemeProcess(browserServer.process());browser=await chromium.connect(browserServer.wsEndpoint());
  const results:unknown[]=[];
  for(const width of [1365,390])for(const theme of ['light','dark'] as const){
   const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme});page.setDefaultTimeout(8000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto(origin,{waitUntil:'networkidle',timeout:30_000});await page.evaluate(theme=>document.documentElement.setAttribute('data-lifeos-theme',theme),theme);
   const grid=page.locator('[data-task-grid="reui"]'),select=grid.getByRole('combobox',{name:'待办表格分组',exact:true});
   await expect(select).toHaveValue('none');await expect(grid.locator('[data-task-group]')).toHaveCount(0);await expect(grid.locator('tbody tr[data-row-id]')).toHaveCount(6);
   const headers=await grid.locator('thead th[data-col-id]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-col-id')));assert.equal(headers.length,7);
   const surface=await grid.evaluate(node=>({width:node.getBoundingClientRect().width,headerBackground:getComputedStyle(node.querySelector('thead [data-variant="ghost"]')!).backgroundColor}));
   assert.ok(surface.width>=width-26,'the marked personal surface uses the full available width');assert.equal(surface.headerBackground,'rgba(0, 0, 0, 0)','native ghost buttons do not inherit old reader styling');
   await select.selectOption('project');await expect(grid.locator('[data-task-group="project"]')).toHaveCount(4);
   for(const [id,label,count] of [['p-one','同名合成项目','2 项'],['p-two','同名合成项目','1 项'],['p-three','其他合成项目','1 项'],['unassigned','未关联项目','2 项']]){
    const group=grid.locator('[data-task-group-id="'+id+'"]');await expect(group).toHaveText(label+count);
   }
   const leafIds=await grid.locator('tbody tr[data-row-id]').evaluateAll(nodes=>nodes.filter(node=>!node.querySelector('[data-task-group]')).map(node=>node.getAttribute('data-row-id')).sort());assert.deepEqual(leafIds,['a','b','c','d','e','f']);
   const groupRow=grid.locator('tr[data-row-id]').filter({has:page.locator('[data-task-group-id="p-one"]')});
   await expect(groupRow.getByRole('button')).toHaveCount(0);const groupTitle=groupRow.locator('td[data-col-id="title"]');await groupTitle.click();await page.keyboard.press('F2');await groupTitle.dblclick();await expect(grid.getByLabel('编辑待办',{exact:true})).toHaveCount(0);
   await expect(page.getByLabel('合成写入次数')).toHaveText('0');await expect(page.getByLabel('合成打开次数')).toHaveText('0');
   await page.getByRole('button',{name:'切换合成筛选',exact:true}).click();await expect(grid.locator('[data-task-group="project"]')).toHaveCount(3);for(const id of ['p-one','p-two','unassigned'])await expect(grid.locator('[data-task-group-id="'+id+'"]')).toContainText('1 项');
   await select.selectOption('area');await expect(grid.locator('[data-task-group="area"]')).toHaveCount(2);await expect(grid.locator('[data-task-group-id="d-one"]')).toHaveText('合成领域 d-one2 项');await expect(grid.locator('[data-task-group-id="unassigned"]')).toHaveText('未关联领域1 项');
   await page.getByRole('button',{name:'切换合成筛选',exact:true}).click();await expect(grid.locator('[data-task-group="area"]')).toHaveCount(3);
   await grid.getByRole('button',{name:'按待办排序',exact:true}).click();
   const aria=await grid.locator('tbody tr[data-row-id]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-rowindex')));assert.equal(new Set(aria).size,aria.length);assert.ok(aria.every(value=>Number(value)>=2));
   const title=grid.locator('tr[data-row-id="a"] td[data-col-id="title"]');await title.click();await page.keyboard.press('F2');const editor=grid.getByLabel('编辑待办',{exact:true});await expect(editor).toBeFocused();await editor.fill('合成未提交草稿');await expect(select).toBeDisabled();
   await page.getByRole('button',{name:'切换合成阻塞',exact:true}).evaluate(node=>(node as HTMLButtonElement).click());await expect(editor).toBeDisabled();await expect(editor).toHaveValue('合成未提交草稿');await expect(page.getByLabel('合成写入次数')).toHaveText('0');
   await page.getByRole('button',{name:'切换合成阻塞',exact:true}).evaluate(node=>(node as HTMLButtonElement).click());await expect(editor).toBeEnabled();await editor.focus();await page.keyboard.press('Escape');await expect(editor).toHaveCount(0);
   const columns=grid.getByRole('button',{name:'列设置',exact:true});await columns.click();await grid.getByRole('checkbox',{name:'显示项目列',exact:true}).uncheck();await grid.getByRole('button',{name:'向前移动状态列',exact:true}).click();await columns.click();
   await select.selectOption('project');assert.deepEqual(await grid.locator('thead th[data-col-id]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-col-id'))),['complete','status','title','due','area','detail']);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   const control=await select.boundingBox();assert.ok(control&&control.height>=(width===1365?32:44));
   if(width===390)await grid.locator('[data-task-group-id="p-one"]').scrollIntoViewIfNeeded();
   await page.screenshot({path:join(output,'todo-grouping-'+width+'-'+theme+'.png'),animations:'disabled'});assert.deepEqual(errors,[]);await expect(page.getByLabel('合成写入次数')).toHaveText('0');
   results.push({width,theme,surface,groups:4,leaves:6,uniqueAriaRows:true,groupWrites:0,leafKeyboardEdit:true,blockedDraftRetained:true,documentOverflow:false,errors});await page.close();
  }
  await writeFile(join(output,'todo-grouping-results.json'),JSON.stringify(results,null,2));console.log('TODO_GROUPING_RENDER '+JSON.stringify(results));
 }finally{await writeFile(join(output,'todo-grouping-next.log'),serverOutput);await cleanupAuthThemeFixture({root,browser,browserServer,browserProcess,server});}
});
