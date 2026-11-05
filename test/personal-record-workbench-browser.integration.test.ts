import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {MemoryPort} from './helpers/platform.ts';
import {emptyCareerPersonal} from '../src/personal-career/domain.ts';
import {makePersonalCommand} from '../src/personal-candidate/client.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import {handlePersonalRequest} from '../src/personal-candidate/http.ts';
import type {PersonalConfig} from '../src/personal-candidate/config.ts';
const source=resolve(import.meta.dirname,'..');
test('OPT-IN record workbenches use native persistence and shell styles',{
 skip:process.env.RUN_PERSONAL_RECORD_BROWSER_TESTS!=='1'&&'Requires disposable fixture and native Chrome',timeout:300_000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-record-browser-'));await mkdir(join(root,'app'),{recursive:true});
 await Promise.all([...['layout.tsx','globals.css','theme.css'].map(name=>cp(join(source,'app',name),join(root,'app',name))),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),cp(join(source,'src'),join(root,'src'),{recursive:true}),symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components')),writeFile(join(root,'app/page.tsx'),`import {PersonalRecordWorkbench} from '../src/personal-candidate/record-workbench';import type {RecordModule} from '../src/personal-candidate/record-model';import '../src/ui-review/review.css';export default async function Page({searchParams}:{searchParams:Promise<{type?:string}>}){const q=await searchParams;return <main className="lo-shell" style={{padding:24,overflow:'auto'}}><PersonalRecordWorkbench type={(['journal','person','health','media','career','portfolio'].includes(q.type??'')?q.type:'journal') as RecordModule}/></main>;}`)]);
 const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 const stopped=once(server,'exit');let log='';server.stderr.on('data',chunk=>{log+=String(chunk);});t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await new Promise<string>((accept,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture failed to start')),30000);server.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture exited'));});server.stdout.on('data',chunk=>{log+=String(chunk);const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});});
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());const evidence=join(tmpdir(),'lifeos-record-browser-evidence-20261105');await mkdir(evidence,{recursive:true});
 for(const type of (process.env.RECORD_BROWSER_MODULE==='business'?['media','career','portfolio'] as const:process.env.RECORD_BROWSER_MODULE==='health'?['health'] as const:['journal','person','health','media','career','portfolio'] as const))for(const [width,theme] of [[1365,'light'],[390,'dark']] as const){
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme,timezoneId:'Asia/Shanghai'}),errors:string[]=[],reads:string[]=[],writes:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  const config:PersonalConfig={ownerId:'record-browser-owner',ownerEmail:'record@example.invalid',spaceId:'record-browser-space',databaseName:'lifeos_platform_test_local',allowedTypes:['todo','journal','project','domain','topic'],approval:'personal-manual-v1',baseURL:origin,healthEnabled:true,peopleEnabled:true,mediaEnabled:true,careerEnabled:true,portfolioEnabled:true};
  const repo=new MemoryPort();repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(row=>row.ownerId===owner));const service=new PersonalService(repo,config);
  const resumeIds:string[]=[];if(type==='career')for(const variant of ['A','B']){const result=await service.mutate(config.ownerId,'career',null,{spaceId:config.spaceId,confirmed:true,fields:{title:'Synthetic resume '+variant,text:'Internal saved resume '+variant,occurredOn:null,personal:emptyCareerPersonal('resume')}},'resume-fixture-'+variant);resumeIds.push(result.entry.id);}
  await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin)return route.abort();if(!url.pathname.startsWith('/api/platform/personal/'))return route.continue();const headers=new Headers(request.headers());headers.set('host',url.host);if(request.method()==='GET')reads.push(url.pathname);else writes.push(request.method());
   if(url.pathname.endsWith('/status'))return route.fulfill({status:200,json:{...config,scope:'personal-manual-candidate',storageVerified:true,writable:true}});
   try{const body=request.postData(),response=await handlePersonalRequest(new Request(url,{method:request.method(),headers,...(body?{body}:{})}),config.ownerId,origin,service,{assertOwner:async()=>{},assertWritable:async()=>{}});assert.ok(response);return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});}catch(error:any){return route.fulfill({status:error.status??503,json:{error:{code:error.code??'UNAVAILABLE',message:error.message}}});}
  });
  if(type==='health'){
   const pending=makePersonalCommand({ownerId:config.ownerId,spaceId:config.spaceId},'journal',null,{title:'Pending synthetic journal',text:'Previously confirmed internal fixture',occurredOn:null},'cross-module-pending-journal',true);
   await page.addInitScript(({key,command})=>{if(!localStorage.getItem('fixture.pending.seeded')){localStorage.setItem(key,JSON.stringify(command));localStorage.setItem('fixture.pending.seeded','1');}},{key:'lifeos.personal.pending.v1:'+config.ownerId+':'+config.spaceId,command:pending});
  }
  await page.goto(origin+'?type='+type,{waitUntil:'domcontentloaded',timeout:60000});
  if(type==='health'){await page.getByRole('button',{name:'继续上次保存（日记）',exact:true}).click();await expect(page.locator('[data-record-notice]')).toHaveText('上次的日记已保存');assert.equal(repo.rows.size,1);}
  const baselineRows=repo.rows.size;const label={journal:'日记',person:'人物',health:'健康',media:'书影音',career:'职业与简历',portfolio:'账户资产投资'}[type];await page.getByRole('button',{name:'新增'+label,exact:true}).click();const title=page.getByLabel(type==='person'?'姓名':'标题',{exact:true});await title.fill('Synthetic '+type);if(type==='career')await page.getByRole('combobox',{name:'记录类别',exact:true}).selectOption('opportunity');if(type==='journal')await page.getByLabel('正文',{exact:true}).fill('Internal synthetic journal fixture');await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('[data-record-notice]')).toHaveText('已保存');assert.equal(repo.rows.size,baselineRows+1);const saved=[...repo.rows.values()].find(entry=>(entry.source.original as {type?:string}).type===type&&'title'in entry.draft&&entry.draft.title==='Synthetic '+type)!;const id=saved.id;assert.ok(reads.includes('/api/platform/personal/'+type+'/'+id),'independent GET before save confirmation');
  if(type==='media'||type==='career'){
   await page.getByRole('button',{name:type==='career'?'求职看板':'看板',exact:true}).click();
   const state=page.getByRole('combobox',{name:type==='media'?'Synthetic media的状态':'更新状态',exact:true});await state.selectOption(type==='media'?'in_progress':'interview');await expect(page.locator('[data-record-notice]')).toHaveText('已更新状态');
   const updated=repo.rows.get(id)!.draft as any;assert.equal(type==='media'?updated.personal.state:updated.personal.applicationState,type==='media'?'in_progress':'interview');assert.equal(repo.rows.get(id)!.revision,2);
  }
  if(['media','career','portfolio'].includes(type))await page.getByRole('button',{name:'表格',exact:true}).click();
  await page.getByRole('button',{name:'Synthetic '+type,exact:true}).click();await expect(title).toHaveValue('Synthetic '+type);await title.fill('Unsent synthetic '+type);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});await expect(title).toHaveValue('Unsent synthetic '+type);await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('[data-record-notice]')).toHaveText('已保存');await page.reload();if(['media','career','portfolio'].includes(type))await page.getByRole('button',{name:'表格',exact:true}).click();await expect(page.getByRole('button',{name:'Unsent synthetic '+type,exact:true})).toBeVisible();
  if(type==='career'){
   await page.getByRole('button',{name:'简历',exact:true}).click();await page.getByRole('combobox',{name:'简历版本',exact:true}).selectOption(resumeIds[0]);await expect(page.getByRole('heading',{name:'Synthetic resume A',exact:true})).toBeVisible();
   await page.getByRole('combobox',{name:'简历版本',exact:true}).selectOption(resumeIds[1]);await expect(page.getByRole('heading',{name:'Synthetic resume B',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Synthetic resume A',exact:true})).toHaveCount(0);
   await page.getByRole('button',{name:'表格',exact:true}).click();
  }
  if(type==='health'){await page.getByRole('button',{name:'运动',exact:true}).click();await expect(page.getByText('暂无已完成的运动记录。飞盘、跑步、力量训练等都可记录；已有计划不会当作完成。',{exact:true})).toBeVisible();await page.getByRole('button',{name:'表格',exact:true}).click();}
  await page.getByRole('button',{name:'Unsent synthetic '+type,exact:true}).click();const dialog=page.getByRole('dialog');assert.ok(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1));await page.getByRole('button',{name:'关闭',exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);assert.deepEqual(writes,type==='health'?['POST','POST','PATCH']:type==='career'||type==='media'?['POST','PATCH','PATCH']:['POST','PATCH']);assert.equal(repo.rows.get(id)!.revision,type==='career'||type==='media'?3:2);if(type==='media'||type==='career'||type==='portfolio')await page.getByRole('button',{name:type==='portfolio'?'概览':type==='career'?'求职看板':'看板',exact:true}).click();await page.screenshot({path:join(evidence,type+'-'+width+'-'+theme+'.png'),fullPage:true});await page.close();
 }
 assert.ok(!/Failed to compile|Module not found/.test(log));
});
