import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';

// Isolated synthetic UI verification only; no owner records or network writer.
test('OPT-IN task content fills the desktop grid and existing board classifications stay readable on mobile',{
 skip:process.env.RUN_TASK_GRID_LAYOUT_BROWSER_TESTS!=='1'&&'Requires isolated synthetic Next fixture and Chrome',
 timeout:180_000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-task-layout-'));
 await mkdir(join(root,'app'),{recursive:true});
 await Promise.all([
  cp(join(source,'src'),join(root,'src'),{recursive:true}),
  ...['layout.tsx','globals.css','theme.css'].map(file=>cp(join(source,'app',file),join(root,'app',file))),
  cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  symlink(join(source,'node_modules'),join(root,'node_modules')),
  symlink(join(source,'components'),join(root,'components')),
 ]);
 await writeFile(join(root,'app/page.tsx'),`'use client';
import {useState} from 'react';
import {LifeOSWorkspace} from '../src/ui-review/workspace';
const tasks=Array.from({length:18},(_,i)=>({id:'synthetic-'+i,revision:2,title:'合成待办 '+i,notes:null,status:'open' as const,dueOn:null,area:i===0?{id:'a',title:'合成领域：持续学习与个人成长'}:null,project:i===0?{id:'p',title:'合成项目：建立可持续复用的学习方法和知识整理流程'}:null,inInbox:false,sourceLabel:'合成数据'}));
export default function Page(){const [writable,setWritable]=useState(true),[writes,setWrites]=useState(0);
return <><aside style={{position:'fixed',bottom:0,right:0,zIndex:100,background:'var(--card)'}} aria-label="合成测试控制"><output aria-label="合成写入次数">{writes}</output><button onClick={()=>setWritable(value=>!value)}>切换写入权限</button></aside><LifeOSWorkspace initialPage="tasks" initialView="table" viewPreferenceScope="synthetic-task-layout" state={{status:'ready',data:{tasks,areas:[],projects:[],today:'2030-11-05',asOf:'2030-11-05T00:00:00Z',coverage:'complete'}}} access={{authenticated:true,writable,loginAllowed:true}} onSetTaskStatus={()=>setWrites(value=>value+1)} getTaskFields={task=>({title:tasks.find(row=>row.id===task.id)?.title??'',text:'',date:'',status:'open'})} onSaveTask={async()=>{setWrites(value=>value+1);return null;}}/></>}`);
 const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{
  cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],
 });
 const stopped=once(server,'exit');
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 let serverOutput='';server.stderr.on('data',chunk=>{serverOutput+=String(chunk);});
 const origin=await new Promise<string>((accept,reject)=>{
  const timer=setTimeout(()=>reject(Error('Fixture startup timeout: '+serverOutput)),30_000);
  server.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture exited: '+serverOutput));});
  server.stdout.on('data',chunk=>{serverOutput+=String(chunk);const match=serverOutput.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});
 });
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
 t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1365,height:900},colorScheme:'light'});page.setDefaultTimeout(10_000);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin,{waitUntil:'networkidle',timeout:60_000});
 const grid=page.locator('[data-task-grid="reui"]');await expect(grid).toBeVisible();
 const title=grid.locator('tr[data-row-id="synthetic-0"] td[data-col-id="title"]');
 const initialTitleWidth=await title.evaluate(node=>node.getBoundingClientRect().width);
 const columns=grid.getByRole('button',{name:'列设置',exact:true});await columns.click();
 for(const label of ['到期日','项目','领域','详情'])await grid.getByRole('checkbox',{name:`显示${label}列`,exact:true}).uncheck();
 await grid.getByRole('button',{name:'向前移动状态列',exact:true}).click();await columns.click();
 await expect(grid.locator('thead th[data-col-id="status"]')).toHaveCount(1);
 const measure=()=>grid.evaluate(node=>{
  const viewport=node.querySelector('[data-slot="data-grid-table-viewport"]')!,table=node.querySelector('table')!,header=node.querySelector('thead')!;
  const columns=Array.from(header.querySelectorAll('th[data-col-id]'));
  return {viewport:viewport.clientWidth,table:table.getBoundingClientRect().width,title:node.querySelector('td[data-col-id="title"]')!.getBoundingClientRect().width,
   filler:node.querySelector('[data-slot="data-grid-table-fill-head-cell"]')!.getBoundingClientRect().width,
   lastColumnEnd:columns.at(-1)!.getBoundingClientRect().right-viewport.getBoundingClientRect().left,
   headers:columns.map(column=>column.getAttribute('data-col-id'))};
 });
 await expect.poll(async()=>(await measure()).filler).toBeLessThanOrEqual(1);
 const desktop=await measure();
 assert.ok(desktop.title>initialTitleWidth+200,JSON.stringify({desktop,initialTitleWidth}));
 assert.ok(Math.abs(desktop.table-desktop.viewport)<=1,JSON.stringify(desktop));
 assert.ok(Math.abs(desktop.lastColumnEnd-desktop.viewport)<=1,JSON.stringify(desktop));
 assert.deepEqual(desktop.headers,['complete','status','title']);
 await grid.getByRole('button',{name:'按待办排序',exact:true}).click();
 const firstTitle=grid.locator('tbody tr[data-row-id]').first().locator('td[data-col-id="title"]');
 await firstTitle.click();await expect(firstTitle).toHaveAttribute('data-cell-focused',/.*/);await page.keyboard.press('F2');
 const editor=grid.getByLabel('编辑待办',{exact:true});await expect(editor).toBeFocused();
 await editor.fill('尚未保存的合成草稿');
 await page.getByRole('button',{name:'切换写入权限',exact:true}).evaluate(node=>(node as HTMLButtonElement).click());
 await expect(editor).toBeDisabled();await expect(editor).toHaveValue('尚未保存的合成草稿');
 assert.equal(await page.getByLabel('合成写入次数').innerText(),'0');
 await page.getByRole('button',{name:'切换写入权限',exact:true}).evaluate(node=>(node as HTMLButtonElement).click());
 await expect(editor).toBeEnabled();await editor.focus();await page.keyboard.press('Escape');await expect(editor).toHaveCount(0);
 assert.equal(await page.getByLabel('合成写入次数').innerText(),'0');
 const output=join(source,'.review-results');await mkdir(output,{recursive:true});
 await page.screenshot({path:join(output,'desktop-todos-1365-light.png'),animations:'disabled'});
 await page.getByRole('button',{name:'看板',exact:true}).click();
 const card=page.locator('[data-kanban-task="synthetic-0"]'),classification=card.locator('dl[aria-label="待办分类"]');
 await expect(classification).toContainText('项目合成项目：');await expect(classification).toContainText('领域合成领域：');
 await expect(page.locator('[data-kanban-task="synthetic-1"] dl')).toContainText('未关联项目');
 await expect(page.locator('[data-kanban-task="synthetic-1"] dl')).toContainText('未关联领域');
 const handle=card.getByRole('button',{name:'拖动：合成待办 0',exact:true});await handle.focus();await page.keyboard.press('Space');
 await expect(page.locator('[data-slot="kanban"]')).toHaveAttribute('data-dragging','true');
 // dnd-kit 6.3.1 defers the keyboard listener to a timer after activation.
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0))));
 await page.keyboard.press('Escape');await expect(page.locator('[data-slot="kanban"]')).toHaveAttribute('data-dragging','false');
 assert.equal(await page.getByLabel('合成写入次数').innerText(),'0');
 await page.screenshot({path:join(output,'desktop-todos-board-1365-light.png'),animations:'disabled'});
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'切换到深色模式',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-lifeos-theme','dark');
 await expect(classification).toBeVisible();
 const mobile=await classification.evaluate(node=>({width:node.getBoundingClientRect().width,scroll:node.scrollWidth,font:parseFloat(getComputedStyle(node).fontSize),values:Array.from(node.querySelectorAll('dd')).map(value=>({width:value.clientWidth,scroll:value.scrollWidth}))}));
 assert.ok(mobile.font>=14,JSON.stringify(mobile));
 assert.ok(mobile.values.every(value=>value.scroll<=value.width),JSON.stringify(mobile));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:join(output,'desktop-todos-board-390-dark.png'),animations:'disabled'});
 await page.getByRole('button',{name:'表格',exact:true}).click();
 await columns.click();await grid.getByRole('button',{name:'恢复默认列',exact:true}).click();await columns.click();
 const mobileViewport=grid.locator('[data-slot="data-grid-table-viewport"]');
 const mobileTable=await mobileViewport.evaluate(node=>({client:node.clientWidth,scroll:node.scrollWidth}));
 assert.ok(mobileTable.scroll>mobileTable.client,JSON.stringify(mobileTable));
 await mobileViewport.evaluate(node=>node.scrollLeft=0);
 await title.dblclick();await expect(editor).toBeVisible();
 const mobileEditor=await editor.evaluate(node=>({height:node.getBoundingClientRect().height,font:parseFloat(getComputedStyle(node).fontSize)}));
 assert.ok(mobileEditor.height>=44&&mobileEditor.font>=16,JSON.stringify(mobileEditor));
 await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal(await page.getByLabel('合成写入次数').innerText(),'0');
 await page.screenshot({path:join(output,'desktop-todos-table-390-dark.png'),animations:'disabled'});
 assert.deepEqual(errors,[]);
 await writeFile(join(output,'desktop-todos-layout.json'),JSON.stringify({syntheticOnly:true,viewports:[1365,390],desktop,mobile,mobileTable,mobileEditor,pageErrors:errors},null,2));
});
