import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {MemoryPort} from './helpers/platform.ts';
import {emptyMediaPersonal} from '../src/personal-media/domain.ts';
import {emptyCareerPersonal} from '../src/personal-career/domain.ts';
import {emptyPersonPersonal} from '../src/personal-people/model.ts';
import {makePersonalCommand} from '../src/personal-candidate/client.ts';
import type {RecordModule} from '../src/personal-candidate/record-model.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import {handlePersonalRequest} from '../src/personal-candidate/http.ts';
import type {PersonalConfig} from '../src/personal-candidate/config.ts';
const source=resolve(import.meta.dirname,'..');
test('OPT-IN record workbenches use native persistence and shell styles',{
 skip:process.env.RUN_PERSONAL_RECORD_BROWSER_TESTS!=='1'&&'Requires disposable fixture and native Chrome',timeout:300_000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-record-browser-'));await mkdir(join(root,'app'),{recursive:true});
 await Promise.all([...['layout.tsx','globals.css','theme.css'].map(name=>cp(join(source,'app',name),join(root,'app',name))),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),cp(join(source,'src'),join(root,'src'),{recursive:true}),symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components')),writeFile(join(root,'app/page.tsx'),`import {PersonalRecordWorkbench} from '../src/personal-candidate/record-workbench';import type {RecordModule} from '../src/personal-candidate/record-model';import '../src/ui-review/review.css';export default async function Page({searchParams}:{searchParams:Promise<{type?:string}>}){const q=await searchParams;return <main className="lo-shell" style={{padding:24,overflow:'auto'}}><PersonalRecordWorkbench type={(['journal','person','health','media','career','portfolio'].includes(q.type??'')?q.type:'journal') as RecordModule}/></main>;}`)]);
 const peopleRoute=join(root,'app/personal/[...section]');
 await mkdir(peopleRoute,{recursive:true});
 const routeSource=await readFile(join(source,'app/personal/[...section]/page.tsx'),'utf8');
 const principalImport="import {readPlatformPagePrincipal} from '../../../src/platform/runtime';";
 assert.ok(routeSource.includes(principalImport));
 await writeFile(join(peopleRoute,'page.tsx'),routeSource.replace(principalImport,
  "const readPlatformPagePrincipal=async (headers: Pick<Headers,'get'>)=>headers.get('x-fixture-owner')==='confirmed'?{}:null;"
 ));
 for(const name of ['journal','media']){
  const route=join(root,'app/personal',name);
  await mkdir(route,{recursive:true});
  const routeSource=await readFile(join(source,'app/personal',name,'page.tsx'),'utf8');
  assert.ok(routeSource.includes(principalImport));
  await writeFile(join(route,'page.tsx'),routeSource.replace(principalImport,
   "const readPlatformPagePrincipal=async (headers: Pick<Headers,'get'>)=>headers.get('x-fixture-owner')==='confirmed'?{}:null;"
  ));
 }
 const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 const stopped=once(server,'exit');let log='';server.stderr.on('data',chunk=>{log+=String(chunk);});t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await new Promise<string>((accept,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture failed to start')),30000);server.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture exited'));});server.stdout.on('data',chunk=>{log+=String(chunk);const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});});

 if(process.env.RECORD_BROWSER_MODULE==='person'){
  const anonymous=await fetch(origin+'/personal/people',{redirect:'manual'});
  assert.equal(anonymous.status,307);
  assert.equal(anonymous.headers.get('location'),'/login');
 }
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());const evidence=join(tmpdir(),'lifeos-record-browser-evidence-20261105');await mkdir(evidence,{recursive:true});
 const recordModules = new Map<string, readonly RecordModule[]>([
  ['business',['media','career','portfolio']],
  ['health',['health']],
  ['media',['media']],
  ['person',['person']],
 ]);
 const modules = recordModules.get(process.env.RECORD_BROWSER_MODULE ?? '') ?? ['journal','person','health','media','career','portfolio'] as const;
 for(const type of modules)for(const [width,theme] of [[1365,'light'],[390,'dark']] as const){
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme,timezoneId:'Asia/Shanghai',extraHTTPHeaders:type==='person'||type==='media'?{'x-fixture-owner':'confirmed'}:undefined}),errors:string[]=[],reads:string[]=[],writes:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  const config:PersonalConfig={ownerId:'record-browser-owner',ownerEmail:'record@example.invalid',spaceId:'record-browser-space',databaseName:'lifeos_platform_test_local',allowedTypes:['todo','journal','project','domain','topic'],approval:'personal-manual-v1',baseURL:origin,healthEnabled:true,peopleEnabled:true,mediaEnabled:true,careerEnabled:true,portfolioEnabled:true};
  let writable=true;
  const repo=new MemoryPort();repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(row=>row.ownerId===owner));const service=new PersonalService(repo,config);
  const resumeIds:string[]=[];if(type==='career')for(const variant of ['A','B']){const result=await service.mutate(config.ownerId,'career',null,{spaceId:config.spaceId,confirmed:true,fields:{title:'Synthetic resume '+variant,text:'Internal saved resume '+variant,occurredOn:null,personal:emptyCareerPersonal('resume')}},'resume-fixture-'+variant);resumeIds.push(result.entry.id);}
  if(type==='media'){
   const topic=(await service.mutate(config.ownerId,'topic',null,{spaceId:config.spaceId,confirmed:true,fields:{
    title:'网文',text:'Synthetic topic',occurredOn:null,personal:{type:'topic'},
   }},'catalog-novel-topic')).entry;
   const novel=emptyMediaPersonal('book');
   novel.links.topics=[{id:topic.id,sourceId:topic.source.id,revision:topic.revision}];
   await service.mutate(config.ownerId,'media',null,{spaceId:config.spaceId,confirmed:true,fields:{
    title:'Synthetic catalog novel',text:'',occurredOn:null,personal:novel,
   }},'catalog-fixture-novel');
   for(const kind of ['book','film','series'] as const){
    await service.mutate(config.ownerId,'media',null,{spaceId:config.spaceId,confirmed:true,fields:{
     title:'Synthetic catalog '+kind,text:'',occurredOn:null,personal:emptyMediaPersonal(kind),
    }},'catalog-fixture-'+kind);
   }
  }
  await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin)return route.abort();if(url.pathname==='/api/platform/status'&&(type==='person'||type==='media'))return route.fulfill({status:200,json:{}});if(!url.pathname.startsWith('/api/platform/personal/'))return route.continue();const headers=new Headers(request.headers());headers.set('host',url.host);if(request.method()==='GET')reads.push(url.pathname);else writes.push(request.method());
   if(url.pathname.endsWith('/status'))return route.fulfill({status:200,json:{...config,scope:'personal-manual-candidate',storageVerified:true,writable}});
   try{const body=request.postData(),response=await handlePersonalRequest(new Request(url,{method:request.method(),headers,...(body?{body}:{})}),config.ownerId,origin,service,{assertOwner:async()=>{},assertWritable:async()=>{}});assert.ok(response);return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});}catch(error:any){return route.fulfill({status:error.status??503,json:{error:{code:error.code??'UNAVAILABLE',message:error.message}}});}
  });
  if(type==='health'){
   const pending=makePersonalCommand({ownerId:config.ownerId,spaceId:config.spaceId},'journal',null,{title:'Pending synthetic journal',text:'Previously confirmed internal fixture',occurredOn:null},'cross-module-pending-journal',true);
   await page.addInitScript(({key,command})=>{if(!localStorage.getItem('fixture.pending.seeded')){localStorage.setItem(key,JSON.stringify(command));localStorage.setItem('fixture.pending.seeded','1');}},{key:'lifeos.personal.pending.v1:'+config.ownerId+':'+config.spaceId,command:pending});
  }
  await page.goto(origin+(type==='person'?'/personal/people':type==='media'?'/personal/media':'?type='+type),{waitUntil:'domcontentloaded',timeout:60000});
  if(type==='health'){await page.getByRole('button',{name:'继续上次保存（日记）',exact:true}).click();await expect(page.locator('[data-record-notice]')).toHaveText('上次的日记已保存');assert.equal(repo.rows.size,1);}
  if(type==='person'){
   await expect(page.getByRole('button',{name:'人物概览',exact:true})).toHaveAttribute('aria-pressed','true');
   await expect(page.getByRole('region',{name:'人物概览'}).getByText('暂无已确认人物。')).toBeVisible();
   await page.getByRole('button',{name:'人物列表',exact:true}).click();
   await expect(page.getByRole('cell',{name:'暂无已确认人物。'})).toBeVisible();
   await expect(page.getByRole('button',{name:'新增人物',exact:true})).toHaveCount(0);
   const more=page.locator('summary').filter({hasText:'更多操作'});
   await more.focus();
   await page.keyboard.press('Enter');
   await page.keyboard.press('Tab');
   await expect(page.getByRole('button',{name:'新增人物',exact:true})).toBeFocused();
  }
  if(type==='media'){
   if(width>1000){
    const navigation=page.getByRole('navigation',{name:'主导航',exact:true});
    await expect(navigation.getByRole('link',{name:'书影音',exact:true})).toHaveAttribute('aria-current','page');
    await expect(navigation.getByRole('group',{name:'兴趣学习',exact:true})).toBeVisible();
   }
   const filter=page.getByRole('combobox',{name:'筛选作品',exact:true});
   const board=page.getByRole('region',{name:'阅读与观影书架'});
   const card=(kind:string)=>board.getByRole('button',{name:'打开作品：Synthetic catalog '+kind,exact:true});
   await expect(card('book')).toBeVisible();
   await filter.selectOption('reading');
   await expect(card('book')).toBeVisible();
   await expect(card('novel')).toBeVisible();
   await filter.selectOption('novel');
   await expect(card('novel')).toBeVisible();
   await expect(card('book')).toHaveCount(0);
   await filter.selectOption('music');
   await expect(page.getByText('暂无音乐记录，音乐来源未接入。')).toBeVisible();
   await expect(page.getByRole('button',{name:'新增书影音',exact:true})).toBeDisabled();
   await filter.selectOption('photography');
   await expect(page.getByText('暂无摄影作品，日记照片关联尚未开放。')).toBeVisible();
   await expect(board).toHaveCount(0);
   await filter.selectOption('screen');
   await expect(card('book')).toHaveCount(0);
   await expect(card('film')).toBeVisible();
   await expect(card('series')).toBeVisible();
   const mediaSearch=page.getByRole('searchbox',{name:'搜索书影音',exact:true}).or(page.getByRole('textbox',{name:'搜索书影音',exact:true}));
   await mediaSearch.fill('catalog series');
   await expect(board.getByRole('status')).toContainText('当前显示 1 部作品');
   await expect(card('series')).toBeVisible();
   await expect(card('film')).toHaveCount(0);
   await mediaSearch.clear();
   await page.getByRole('button',{name:'新增书影音',exact:true}).click();
   const workType=page.getByRole('combobox',{name:'作品类型',exact:true});
   await expect(workType).toHaveValue('film');
   await workType.selectOption('series');
   await expect(workType).toHaveValue('series');
   await page.getByRole('button',{name:'关闭',exact:true}).click();
   await page.getByRole('button',{name:'表格',exact:true}).click();
   await expect(page.getByRole('button',{name:'Synthetic catalog series',exact:true})).toBeVisible();
   await expect(page.getByRole('button',{name:'Synthetic catalog book',exact:true})).toHaveCount(0);
   await filter.selectOption('film');
   await expect(page.getByRole('button',{name:'Synthetic catalog film',exact:true})).toBeVisible();
   await expect(page.getByRole('button',{name:'Synthetic catalog series',exact:true})).toHaveCount(0);
   await filter.selectOption('series');
   await expect(page.getByRole('button',{name:'Synthetic catalog series',exact:true})).toBeVisible();
   await expect(page.getByRole('button',{name:'Synthetic catalog film',exact:true})).toHaveCount(0);
   await filter.selectOption('book');
   await expect(page.getByRole('button',{name:'Synthetic catalog book',exact:true})).toBeVisible();
   await expect(page.getByRole('button',{name:'Synthetic catalog film',exact:true})).toHaveCount(0);
   assert.deepEqual(writes,[]);
   await filter.selectOption('all');
  }
  const baselineRows=repo.rows.size;const label={journal:'日记',person:'人物',health:'健康',media:'书影音',career:'职业',portfolio:'账户资产投资'}[type];await page.getByRole('button',{name:'新增'+label,exact:true}).click();const title=page.getByLabel(type==='person'?'姓名':'标题',{exact:true});await title.fill('Synthetic '+type);if(type==='career')await page.getByRole('combobox',{name:'记录类别',exact:true}).selectOption('opportunity');if(type==='journal')await page.getByLabel('正文',{exact:true}).fill('Internal synthetic journal fixture');await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('[data-record-notice]')).toHaveText('已保存');assert.equal(repo.rows.size,baselineRows+1);const saved=[...repo.rows.values()].find(entry=>(entry.source.original as {type?:string}).type===type&&'title'in entry.draft&&entry.draft.title==='Synthetic '+type)!;const id=saved.id;assert.ok(reads.includes('/api/platform/personal/'+type+'/'+id),'independent GET before save confirmation');
  if(type==='media'||type==='career'){
   await page.getByRole('button',{name:type==='career'?'求职看板':'看板',exact:true}).click();
   const state=page.getByRole('combobox',{name:type==='media'?'Synthetic media的状态':'更新状态',exact:true});await state.selectOption(type==='media'?'in_progress':'interview');await expect(page.locator('[data-record-notice]')).toHaveText('已更新状态');
   const updated=repo.rows.get(id)!.draft as any;assert.equal(type==='media'?updated.personal.state:updated.personal.applicationState,type==='media'?'in_progress':'interview');assert.equal(repo.rows.get(id)!.revision,2);
  }
  if(['media','career','portfolio'].includes(type))await page.getByRole('button',{name:'表格',exact:true}).click();
  await page.getByRole('button',{name:'Synthetic '+type,exact:true}).click();await expect(title).toHaveValue('Synthetic '+type);await title.fill('Unsent synthetic '+type);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});await expect(title).toHaveValue('Unsent synthetic '+type);await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('[data-record-notice]')).toHaveText('已保存');await page.reload();if(type==='person'){await expect(page.getByRole('region',{name:'人物概览'}).getByRole('heading',{name:'Unsent synthetic person',exact:true})).toBeVisible();await page.getByRole('button',{name:'人物列表',exact:true}).click();}if(['media','career','portfolio'].includes(type))await page.getByRole('button',{name:'表格',exact:true}).click();await expect(page.getByRole('button',{name:'Unsent synthetic '+type,exact:true})).toBeVisible();
  if(type==='career'){
   await page.getByRole('button',{name:'简历',exact:true}).click();await page.getByRole('combobox',{name:'简历版本',exact:true}).selectOption(resumeIds[0]);await expect(page.getByRole('heading',{name:'Synthetic resume A',exact:true})).toBeVisible();
   await page.getByRole('combobox',{name:'简历版本',exact:true}).selectOption(resumeIds[1]);await expect(page.getByRole('heading',{name:'Synthetic resume B',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Synthetic resume A',exact:true})).toHaveCount(0);
   await page.getByRole('button',{name:'表格',exact:true}).click();
  }
  if(type==='health'){await page.getByRole('button',{name:'运动',exact:true}).click();await expect(page.getByText('暂无已完成的运动记录。飞盘、跑步、力量训练等都可记录；已有计划不会当作完成。',{exact:true})).toBeVisible();await page.getByRole('button',{name:'表格',exact:true}).click();}
  await page.getByRole('button',{name:'Unsent synthetic '+type,exact:true}).click();const dialog=page.getByRole('dialog');assert.ok(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1));await page.getByRole('button',{name:'关闭',exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);assert.deepEqual(writes,type==='health'?['POST','POST','PATCH']:type==='career'||type==='media'?['POST','PATCH','PATCH']:['POST','PATCH']);assert.equal(repo.rows.get(id)!.revision,type==='career'||type==='media'?3:2);if(type==='media'||type==='career'||type==='portfolio')await page.getByRole('button',{name:type==='portfolio'?'概览':type==='career'?'求职看板':'看板',exact:true}).click();
  if(type==='person'){
   const namesake='Synthetic namesake', privateStart='Synthetic private note starts here ', privateEnd=' synthetic final marker';
   const longNote=privateStart+'x'.repeat(16384-privateStart.length-privateEnd.length)+privateEnd;
   const notes=[longNote,'Synthetic profile second'];
   const people=await Promise.all(notes.map((text,index)=>service.mutate(config.ownerId,'person',null,{spaceId:config.spaceId,confirmed:true,fields:{title:namesake,text,occurredOn:null,personal:{...emptyPersonPersonal(),relationship:index===0?'合成关系甲':'合成关系乙'}}},'person-overview-fixture-'+index)));
   await page.getByRole('button',{name:'刷新',exact:true}).click();
   await page.getByRole('button',{name:'人物概览',exact:true}).click();
   const overview=page.getByRole('region',{name:'人物概览'});
   await expect(overview.getByRole('heading',{name:namesake,exact:true})).toHaveCount(2);
   const cardHtml=await overview.innerHTML();
   assert.ok(!cardHtml.includes(privateStart)&&!cardHtml.includes(privateEnd)&&!cardHtml.includes(notes[1]));
   for(const record of people)assert.ok(!cardHtml.includes(record.entry.id),'UUID is absent from visible text and accessible labels');
   const search=page.getByRole('textbox',{name:'搜索人物'});
   for(const [idx,query] of [privateEnd.trim(),notes[1]].entries()){
    const summary=idx===0?'合成关系甲':'合成关系乙';
    const card=overview.getByRole('listitem').filter({hasText:summary});
    const detail=card.getByRole('button',{name:/^查看 Synthetic namesake（同名档案 [12]）$/});
    const label=await detail.getAttribute('aria-label');
    await search.fill(query);
    await expect(overview.getByRole('heading',{name:namesake,exact:true})).toHaveCount(1);
    await expect(detail).toHaveAttribute('aria-label',label!);
    await search.focus();
    for(const name of ['人物列表','人物概览','刷新']){
     await page.keyboard.press('Tab');
     await expect(page.getByRole('button',{name,exact:true})).toBeFocused();
    }
    await page.keyboard.press('Tab');
    await expect(page.locator('summary').filter({hasText:'更多操作'})).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(detail).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog').getByLabel('备注',{exact:true})).toHaveValue(notes[idx]);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await search.clear();
   }
   await page.getByRole('textbox',{name:'搜索人物'}).fill('unmatched synthetic search');
   await expect(overview.getByText('没有符合搜索条件的人物。')).toBeVisible();
   await page.getByRole('textbox',{name:'搜索人物'}).clear();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   assert.deepEqual(writes,['POST','PATCH']);
   await page.getByRole('button',{name:'人物列表',exact:true}).click();
   await expect(overview).toHaveCount(0);
   await expect(page.getByRole('button',{name:namesake,exact:true})).toHaveCount(2);
   const journalTitle='Synthetic confirmed shared journal';
   const journalBody='Synthetic linked journal body only at its original record';
   const journal=(await service.mutate(config.ownerId,'journal',null,{
    spaceId:config.spaceId,confirmed:true,fields:{title:journalTitle,text:journalBody,occurredOn:'2024-06-09',
     personal:{type:'journal',links:{project:null,domain:null,topics:[],
      people:people.map(({entry})=>({id:entry.id,sourceId:entry.source.id,revision:entry.revision}))}}}},
    'person-overview-linked-journal')).entry;
   await page.getByRole('button',{name:'刷新',exact:true}).click();
   await page.getByRole('button',{name:'人物概览',exact:true}).click();
   for(const summary of ['合成关系甲','合成关系乙']){
    const card=overview.getByRole('listitem').filter({hasText:summary});
    const toggle=card.getByText('关联日记（1）',{exact:true});
    await toggle.click();
    await expect(card.getByRole('link',{name:journalTitle})).toHaveAttribute('href',new RegExp('^/personal/journal\\?record='+journal.id+'&person='));
    await expect(card.getByText('2024-06-09',{exact:true})).toBeVisible();
   }
   await expect(overview).not.toContainText(journalBody);
   await overview.getByRole('listitem').filter({hasText:'合成关系乙'}).getByRole('link',{name:journalTitle}).click();
   const original=page.getByRole('article',{name:'日记原文'});
   await expect(original.getByText(journalTitle,{exact:true})).toBeVisible();
   const back=original.getByRole('link',{name:'返回关联人物'});
   await expect(back).toHaveAttribute('href','/personal/people?record='+people[1].entry.id);
   await back.click();
   await expect(page.getByRole('region',{name:'人物概览'}).getByRole('heading',{name:namesake,exact:true})).toHaveCount(1);
   await expect(page.getByRole('region',{name:'人物概览'}).getByText('合成关系乙',{exact:true})).toBeVisible();
   writable=false;
   await page.getByRole('button',{name:'刷新',exact:true}).click();
   await expect(page.locator('summary').filter({hasText:'更多操作'})).toHaveCount(0);
   await expect(page.getByRole('button',{name:'新增人物',exact:true})).toHaveCount(0);
   await expect(page.getByRole('region',{name:'人物概览'}).getByText('合成关系乙',{exact:true})).toBeVisible();
   assert.deepEqual(writes,['POST','PATCH']);

   await page.screenshot({path:join(evidence,type+'-'+width+'-'+theme+'.png'),fullPage:true});
   const account=page.getByRole('button',{name:'账号与更多操作',exact:true});
   await account.press('Enter');
   const logout=page.getByRole('dialog',{name:'账号操作'}).getByRole('button',{name:'退出登录',exact:true});
   await expect(logout).toBeInViewport({ratio:1});
   let signOutRequests=0;
   await page.route(origin+'/api/platform/auth/sign-out',async route=>{
    assert.equal(route.request().method(),'POST');
    assert.deepEqual(route.request().postDataJSON(),{});
    signOutRequests++;
    await route.fulfill({json:{success:true}});
   });
   await logout.focus();await page.keyboard.press('Enter');
   await expect(page).toHaveURL(origin+'/login');
   assert.equal(signOutRequests,1);
  }else await page.screenshot({path:join(evidence,type+'-'+width+'-'+theme+'.png'),fullPage:true});
  await page.close();
 }
 if(modules.includes('media')){
  for(const topicTitles of [[],['网文'],['网文','小说']]){
   await t.test('novel shelf save with '+topicTitles.length+' matching topics',async()=>{
    const page=await browser.newPage({extraHTTPHeaders:{'x-fixture-owner':'confirmed'}});
    try{
     const config:PersonalConfig={ownerId:'novel-fixture-owner',ownerEmail:'novel@example.invalid',spaceId:'novel-fixture-space',databaseName:'lifeos_platform_test_local',allowedTypes:['topic'],approval:'personal-manual-v1',baseURL:origin,mediaEnabled:true};
     const repo=new MemoryPort();
     repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(row=>row.ownerId===owner));
     const service=new PersonalService(repo,config);
     const topics=await Promise.all(topicTitles.map(async(title,index)=>
      (await service.mutate(config.ownerId,'topic',null,{spaceId:config.spaceId,confirmed:true,fields:{title,text:'Synthetic topic',occurredOn:null,personal:{type:'topic'}}},'novel-topic-'+index)).entry,
     ));
     const posts:{key:string|null;body:string}[]=[];
     let loseResponse=topics.length===2;
     await page.route('**/api/platform/**',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.pathname==='/api/platform/status')return route.fulfill({json:{}});
      if(url.pathname==='/api/platform/personal/status')return route.fulfill({json:{...config,scope:'personal-manual-candidate',storageVerified:true,writable:true}});
      const headers=new Headers(request.headers());headers.set('host',url.host);
      const body=request.postData();
      const mediaWrite=request.method()==='POST'&&url.pathname==='/api/platform/personal/media';
      if(mediaWrite)posts.push({key:headers.get('idempotency-key'),body:body??''});
      const response=await handlePersonalRequest(new Request(url,{method:request.method(),headers,...(body?{body}:{})}),config.ownerId,origin,service,{assertOwner:async()=>{},assertWritable:async()=>{}});
      assert.ok(response);
      if(mediaWrite&&loseResponse){
       loseResponse=false;
       assert.equal(response.status,201);
       return route.abort('failed');
      }
      return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
     });
     const title='Synthetic novel create '+topics.length;
     const savedRows=async()=>(await service.currentSnapshot(config.ownerId)).filter(entry=>'title' in entry.draft&&entry.draft.title===title);
     await page.goto(origin+'/personal/media',{waitUntil:'domcontentloaded',timeout:60000});
     const filter=page.getByRole('combobox',{name:'筛选作品',exact:true});
     await filter.selectOption('novel');
     await page.getByRole('button',{name:'新增书影音',exact:true}).click();
     const dialog=page.getByRole('dialog',{name:'新增书影音',exact:true});
     await dialog.getByLabel('标题',{exact:true}).fill(title);
     const save=dialog.getByRole('button',{name:'保存',exact:true});
     if(topics.length===0){
      await expect(dialog.getByRole('status')).toContainText('当前没有可用的网文／小说主题');
      await expect(save).toBeDisabled();
      const pendingKey='lifeos.personal.pending.v1:'+config.ownerId+':'+config.spaceId;
      const pending=await dialog.locator('form').evaluate((form,key)=>{
       (form as HTMLFormElement).requestSubmit();
       return localStorage.getItem(key);
      },pendingKey);
      assert.equal(pending,null);
      expect(posts).toHaveLength(0);
      assert.deepEqual(await savedRows(),[]);
      return;
     }
     await dialog.getByText('作品来源与关联',{exact:true}).click();
     const relation=dialog.getByRole('combobox',{name:'关联主题',exact:true});
     const selected=topics.at(-1)!;
     const pin={id:selected.id,sourceId:selected.source.id,revision:selected.revision};
     if(topics.length===1){
      await expect(relation).toHaveValue(JSON.stringify(pin));
      await expect(save).toBeEnabled();
      await relation.selectOption('');
     }else await expect(relation).toHaveValue('');
     await expect(dialog.getByRole('status')).toContainText('选择一个网文／小说主题后保存');
     await expect(save).toBeDisabled();
     expect(posts).toHaveLength(0);
     await relation.selectOption(JSON.stringify(pin));
     await expect(save).toBeEnabled();
     await save.click();
     if(topics.length===2){
      await expect.poll(async()=>(await savedRows()).length).toBe(1);
      const [first]=await savedRows();
      await page.reload({waitUntil:'domcontentloaded'});
      await page.getByRole('button',{name:'继续上次保存（书影音）',exact:true}).click();
      await expect(page.locator('[data-record-notice]')).toHaveText('上次的书影音已保存');
      assert.equal(posts.length,2);
      assert.ok(posts[0].key);
      assert.deepEqual(posts[1],posts[0]);
      assert.deepEqual(await savedRows(),[first]);
      await filter.selectOption('novel');
     }else{
      await expect(page.locator('[data-record-notice]')).toHaveText('已保存');
      assert.equal(posts.length,1);
     }
     await page.getByRole('button',{name:'刷新',exact:true}).click();
     await expect(page.getByRole('button',{name:'打开作品：'+title,exact:true})).toHaveCount(1);
     const [saved]=await savedRows();
     const personal=saved&&'personal' in saved.draft?saved.draft.personal:null;
     assert.ok(personal&&'type' in personal&&personal.type==='media');
     assert.deepEqual(personal.links.topics,[pin]);
    }finally{await page.close();}
   });
  }
 }
 assert.ok(!/Failed to compile|Module not found/.test(log));
});
