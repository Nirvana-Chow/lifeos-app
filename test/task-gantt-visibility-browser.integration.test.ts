import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';

test('OPT-IN todo Gantt keeps deadline and unscheduled detail actions usable in desktop/mobile themes',{
 skip:process.env.RUN_TODO_GANTT_VISIBILITY_BROWSER_TESTS!=='1'&&'Requires isolated synthetic Next fixture and native Chrome',timeout:180_000,
},async()=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-todo-gantt-'));
 let serverProcess:FixtureProcess|undefined,browserProcess:FixtureProcess|undefined,browserServer:Awaited<ReturnType<typeof chromium.launchServer>>|undefined,browser:Awaited<ReturnType<typeof chromium.connect>>|undefined;
 try{
  await mkdir(join(root,'app'),{recursive:true});
  await Promise.all([cp(join(source,'src'),join(root,'src'),{recursive:true}),...['layout.tsx','globals.css','theme.css'].map(file=>cp(join(source,'app',file),join(root,'app',file))),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components'))]);
  await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
  await writeFile(join(root,'app/page.tsx'),`'use client';
import {useState} from 'react';import {TaskProjectGantt} from '../src/ui-review/task-project-gantt';
const rows=[{id:'range',title:'合成完整计划',plannedStartOn:'2030-11-05',plannedEndOn:'2030-11-08'},{id:'deadline',title:'合成截止日期',dueOn:'2030-11-06'},{id:'none',title:'合成未排期待办：保留完整标题和明确的查看入口'},{id:'start',title:'合成只有开始日期',plannedStartOn:'2030-11-07'},{id:'end',title:'合成只有结束日期',plannedEndOn:'2030-11-09'}];
export default function Page(){const [selected,setSelected]=useState('');return <main data-lifeos-surface className="lo-shell" style={{height:'100dvh',padding:12,display:'flex',flexDirection:'column'}}><TaskProjectGantt label="待办" rows={rows} partial={true} onShowTable={()=>setSelected('表格')} renderTitle={row=><button type="button" aria-label={'查看待办 '+row.title} onClick={()=>setSelected(row.title)}>{row.title}</button>}/><output aria-label="已选择待办">{selected}</output></main>}`);
  const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],detached:true});serverProcess=trackAuthThemeProcess(server,true);server.stderr.resume();
  const origin=await new Promise<string>((accept,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Fixture startup timeout')),30_000);server.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture exited'));});server.once('error',error=>{clearTimeout(timer);reject(error);});server.stdout.on('data',chunk=>{output=(output+String(chunk)).slice(-65536);const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});});
  browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH,host:'127.0.0.1'});browserProcess=trackAuthThemeProcess(browserServer.process());browser=await chromium.connect(browserServer.wsEndpoint());
  const page=await browser.newPage();page.setDefaultTimeout(8000);let writes=0,external=0;const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{const request=route.request();if(new URL(request.url()).origin!==origin){external++;return route.abort();}if(!['GET','HEAD'].includes(request.method())){writes++;return route.abort();}return route.continue();});
  const cells=[];
  for(const width of [1365,390])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme as 'light'|'dark'});await page.goto(origin,{waitUntil:'networkidle',timeout:60000});
   await page.locator('html').evaluate((node,theme)=>node.setAttribute('data-lifeos-theme',theme),theme);
   const gantt=page.getByRole('region',{name:'待办甘特',exact:true});
   await expect(gantt.locator('[data-gantt-record]')).toHaveCount(5);await expect(gantt.locator('[data-gantt-bar]')).toHaveCount(1);await expect(gantt.locator('[data-gantt-milestone]')).toHaveCount(1);
   await expect(gantt.getByRole('img',{name:'计划 2030-11-05 至 2030-11-08',exact:true})).toBeVisible();await expect(gantt.getByRole('img',{name:'截止 2030-11-06',exact:true})).toBeVisible();await expect(gantt.getByRole('status')).toContainText('当前仅显示已读取范围');
   const button=gantt.getByRole('button',{name:'查看待办 合成未排期待办：保留完整标题和明确的查看入口',exact:true});await button.scrollIntoViewIfNeeded();await button.focus();await page.keyboard.press('Enter');await expect(page.getByLabel('已选择待办',{exact:true})).toHaveText('合成未排期待办：保留完整标题和明确的查看入口');
   await gantt.getByRole('button',{name:'查看待办 合成截止日期',exact:true}).click();await expect(page.getByLabel('已选择待办',{exact:true})).toHaveText('合成截止日期');
   const fits=await gantt.evaluate(node=>({page:document.documentElement.scrollWidth<=innerWidth,region:node.scrollWidth<=node.clientWidth,clippedTitles:[...node.querySelectorAll('article button')].some(button=>button.scrollWidth>button.clientWidth)}));assert.deepEqual(fits,{page:true,region:true,clippedTitles:false});
   if(process.env.LIFEOS_GANTT_ARTIFACT_DIR){await mkdir(process.env.LIFEOS_GANTT_ARTIFACT_DIR,{recursive:true});await gantt.screenshot({path:join(process.env.LIFEOS_GANTT_ARTIFACT_DIR,`todo-gantt-${width}-${theme}.png`)});}
   cells.push({width,theme,...fits});
  }
  assert.equal(writes,0);assert.equal(external,0);assert.deepEqual(errors,[]);console.log('TODO_GANTT_VISIBILITY_BROWSER_PASS '+JSON.stringify({cells,writes,external,errors}));
 }finally{await cleanupAuthThemeFixture({root,browser,browserServer,browserProcess,server:serverProcess});}
});
