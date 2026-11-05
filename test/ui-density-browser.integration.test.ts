import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {renderedContrast} from './helpers/personal-contrast.ts';

// Internal synthetic fixture. It is never owner-data delivery or a production writer.
test('OPT-IN dense appearances and stable owner-scoped native column editing',{
 skip:process.env.RUN_UI_DENSITY_BROWSER_TESTS!=='1'&&'Requires isolated synthetic Next fixture and native Chrome',timeout:240_000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-density-board-'));
 await mkdir(join(root,'app'),{recursive:true});
 await Promise.all([cp(join(source,'src'),join(root,'src'),{recursive:true}),...['layout.tsx','globals.css','theme.css'].map(file=>cp(join(source,'app',file),join(root,'app',file))),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components'))]);
 await writeFile(join(root,'app/page.tsx'),`'use client';
import {useState} from 'react';import {LifeOSWorkspace} from '../src/ui-review/workspace';
const initial=Array.from({length:18},(_,i)=>({id:'synthetic-'+i,revision:2,title:'合成待办 '+i,notes:null,status:'open' as const,dueOn:null,area:null,project:null,inInbox:false,sourceLabel:'合成数据'}));
export default function Page(){const [tasks,setTasks]=useState<any[]>(initial),[writes,setWrites]=useState(0),[pending,setPending]=useState<any>(null),[reject,setReject]=useState(false),[scope,setScope]=useState('synthetic-owner:one');
return <><aside style={{position:'fixed',bottom:0,right:0,zIndex:100,background:'var(--card)'}} aria-label="合成测试控制"><output aria-label="合成写入次数">{writes}</output><button onClick={()=>setReject(v=>!v)} aria-pressed={reject}>拒绝移动</button><button onClick={()=>{if(pending){setTasks(rows=>rows.map(t=>t.id===pending.id?{...t,status:pending.status,revision:t.revision+1}:t));setPending(null);}}}>确认回执</button><button onClick={()=>setScope(v=>v.endsWith('one')?'synthetic-owner:two':'synthetic-owner:one')}>切换合成账号</button></aside><LifeOSWorkspace viewPreferenceScope={scope} initialPage="tasks" initialView="table" state={{status:'ready',data:{tasks,areas:[],projects:[],today:'2030-11-05',asOf:'2030-11-05T00:00:00Z',coverage:'complete'}}} access={{authenticated:true,writable:true,loginAllowed:true}} saving={!!pending} onSetTaskStatus={(task,status)=>{if(reject)return;setWrites(v=>v+1);setPending({...task,status});}} getTaskFields={task=>{const t=tasks.find(v=>v.id===task.id);return t?{title:t.title,text:'',date:t.dueOn??'',status:t.status}:null;}} onSaveTask={async(task,fields)=>{setWrites(v=>v+1);setTasks(rows=>rows.map(t=>t.id===task?.id?{...t,title:fields.title,status:fields.status,dueOn:fields.date||null,revision:t.revision+1}:t));return {id:task?.id} as any;}}/></>}`);
 const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});const stopped=once(server,'exit');t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await new Promise<string>((accept,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Fixture startup timeout')),30_000);server.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture exited'));});server.stdout.on('data',chunk=>{output+=String(chunk);const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});});
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1366,height:768}});page.setDefaultTimeout(10000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.text().includes('DND_TRACE'))console.log(message.text());});await page.goto(origin,{waitUntil:'networkidle',timeout:60000});
 const grid=page.locator('[data-task-grid="reui"]');await expect(grid).toBeVisible();
 assert.equal(await grid.locator('thead th').first().innerText(),'完成','completion leads the native table');
 const columns=grid.getByRole('button',{name:'列设置',exact:true});await columns.click();await grid.getByRole('button',{name:'向前移动状态列',exact:true}).click();await grid.getByRole('checkbox',{name:'显示项目列',exact:true}).uncheck();await columns.click();
 const status=grid.locator('tr[data-row-id="synthetic-0"] td[data-col-id="status"]');await status.dblclick();await grid.getByLabel('编辑状态',{exact:true}).selectOption({label:'进行中'});await page.keyboard.press('Enter');await expect(status).toHaveText('进行中');
 const title=grid.locator('tr[data-row-id="synthetic-0"] td[data-col-id="title"]');await title.dblclick();await grid.getByLabel('编辑待办',{exact:true}).fill('合成标题已编辑');await page.keyboard.press('Enter');await expect(title).toHaveText('合成标题已编辑');assert.equal(await page.getByLabel('合成写入次数').innerText(),'2');
 await page.reload({waitUntil:'networkidle'});await expect(grid.locator('thead th').nth(1)).toContainText('状态');assert.equal(await grid.locator('thead th[data-col-id="project"]').count(),0);
 await page.getByRole('button',{name:'切换合成账号',exact:true}).click();await expect(grid.locator('thead th').nth(1)).toContainText('待办');await expect(grid.getByRole('columnheader',{name:/项目/})).toHaveCount(1);
 // Layout measurements use computed styles, actual geometry and composited colors.
 await page.getByRole('button',{name:'设置',exact:true}).click();const settings=page.getByRole('dialog',{name:'设置',exact:true});
 for(const palette of ['slate-indigo','sage-teal','mauve-violet'])for(const mode of ['light','dark']){
  await settings.getByLabel('配色',{exact:true}).selectOption(palette);await settings.getByLabel('明暗模式',{exact:true}).selectOption(mode);
  const sample=await page.locator('.lo-shell').evaluate(node=>{const style=getComputedStyle(node),header=node.querySelector('.lo-header')!,side=node.querySelector('.lo-sidebar')!;return {font:parseFloat(style.fontSize),header:header.getBoundingClientRect().height,sidebar:side.getBoundingClientRect().width,foreground:style.color,layers:[{backgroundColor:style.backgroundColor}]};});
  assert.equal(sample.font,14);assert.equal(sample.header,52);assert.equal(sample.sidebar,208);assert.ok(renderedContrast(sample.foreground,sample.layers).contrast>=4.5);
 }
await page.keyboard.press('Escape');await mkdir(join(source,'.review-results'),{recursive:true});await page.screenshot({path:join(source,'.review-results/density-table-1366-dark.png')});await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();const mobile=await settings.getByLabel('配色',{exact:true}).evaluate(node=>({font:parseFloat(getComputedStyle(node).fontSize),height:node.getBoundingClientRect().height}));assert.ok(mobile.font>=16);assert.ok(mobile.height>=44);assert.deepEqual(errors,[]);
});
