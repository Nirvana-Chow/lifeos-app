import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {MemoryPort} from './helpers/platform.ts';
import {personalEntryType,PersonalService} from '../src/personal-candidate/service.ts';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {calendarFields} from './helpers/personal-calendar-port.ts';
import type {PersonalConfig} from '../src/personal-candidate/config.ts';
const source=resolve(import.meta.dirname,'..');
test('OPT-IN owner search uses stable original reads and retains query/back/keyboard context without writes or egress',{skip:process.env.RUN_PERSONAL_SEARCH_BROWSER_TESTS!=='1'&&'Requires disposable synthetic Next fixture and native Chrome',timeout:180_000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-search-browser-'));await mkdir(join(root,'app/personal/[...section]'),{recursive:true});await mkdir(join(root,'app/login'),{recursive:true});
 const workspaceSource=await readFile(join(source,'app/personal/page.tsx'),'utf8');
 const workspaceRoute=workspaceSource.replace("from'../../src/platform/runtime'","from'../../src/search-fixture-principal'");
 assert.notEqual(workspaceRoute,workspaceSource,'Fixture must use the real task route with a synthetic principal');
 const routeSource=await readFile(join(source,'app/personal/[...section]/page.tsx'),'utf8');
 const route=routeSource.replace("from '../../../src/platform/runtime'","from '../../../src/search-fixture-principal'");
 assert.notEqual(route,routeSource,'Fixture must replace only the canonical route principal reader');
 const layoutSource=await readFile(join(source,'app/personal/layout.tsx'),'utf8');
 const layout=layoutSource.replace("from '../../src/platform/runtime'","from '../../src/search-fixture-principal'");
 assert.notEqual(layout,layoutSource,'Fixture must retain the actual personal layout');
 await Promise.all([...['layout.tsx','globals.css','theme.css'].map(name=>cp(join(source,'app',name),join(root,'app',name))),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),cp(join(source,'src'),join(root,'src'),{recursive:true}),symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components')),writeFile(join(root,'app/personal/[...section]/page.tsx'),route),writeFile(join(root,'app/personal/page.tsx'),workspaceRoute),writeFile(join(root,'app/personal/layout.tsx'),layout),writeFile(join(root,'app/login/page.tsx'),`export default function Page(){return <main><h1>请重新登录</h1></main>;}`)]);
 await writeFile(join(root,'src/search-fixture-principal.ts'),`
export async function readPlatformPagePrincipal(){return {userId:'search-browser-owner'};}
export async function readPlatformPasswordCapability(){return false;}
export async function readPlatformLoginCapability(){return {sessionDuration:false};}
`);
 const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 const stopped=once(server,'exit');let log='';server.stderr.on('data',chunk=>{log+=String(chunk);});t.after(async()=>{if(t.signal.aborted)t.diagnostic(log);server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await new Promise<string>((accept,reject)=>{const timer=setTimeout(()=>reject(Error('Synthetic Next fixture failed to start')),30000);server.once('exit',()=>{clearTimeout(timer);reject(Error(log));});server.stdout.on('data',chunk=>{log+=String(chunk);const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});});
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 for(const[width,theme]of[[1365,'light'],[390,'dark'],[430,'light']]as const){
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme,timezoneId:'Asia/Shanghai'}),errors:string[]=[],writes:string[]=[],outside:string[]=[],reads:string[]=[];page.on('pageerror',error=>errors.push(error.message));let expired=false,broken=false,denyCancelledDetail=false;
  const discardPrompts:string[]=[];
  page.on('dialog',async dialog=>{
   if(dialog.type()==='beforeunload'){await dialog.accept();return;}
   discardPrompts.push(dialog.message());await dialog.dismiss();
  });
  const config:PersonalConfig={ownerId:'search-browser-owner',ownerEmail:'search@example.invalid',spaceId:'search-browser-space',databaseName:'lifeos_platform_test_local',allowedTypes:['todo','domain','journal','calendar'],calendarEnabled:true,approval:'personal-manual-v1',baseURL:origin};const repo=Object.assign(new MemoryPort(),{
   async readTaskWorkspaceSnapshot(owner:string,spaceId:string,types:readonly string[]){
    return structuredClone([...repo.rows.values()].filter(row=>{
     const type=personalEntryType(row,spaceId);
     return row.ownerId===owner&&type!==null&&types.includes(type);
    }));
   },
  });
  repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(row=>row.ownerId===owner));
  const service=new PersonalService(repo,config);
  const entry=(await service.mutate(config.ownerId,'journal',null,{spaceId:config.spaceId,confirmed:true,fields:{title:'Synthetic search diary',text:'Original needle diary body',occurredOn:null}},'browser-search-journal')).entry;const calendar=(await service.mutate(config.ownerId,'calendar',null,{spaceId:config.spaceId,confirmed:true,fields:{...calendarFields,title:'Synthetic calendar',text:'Calendar needle body'}},'browser-search-calendar')).entry;const dated=(await service.mutate(config.ownerId,'journal',null,{spaceId:config.spaceId,confirmed:true,fields:{title:'Synthetic December diary',text:'Boundary needle prose',occurredOn:'2025-12-31'}},'browser-search-december')).entry;
  await service.mutate(config.ownerId,'calendar',null,{spaceId:config.spaceId,confirmed:true,fields:{...calendarFields,title:'Synthetic Shanghai calendar',text:'Boundary needle',personal:{...calendarFields.personal,schedule:{kind:'timed',startAt:'2025-12-31T16:00:00Z',endAt:'2025-12-31T17:00:00Z',timeZone:'UTC'}}}},'browser-search-shanghai');
  const todo=(await service.mutate(config.ownerId,'todo',null,{spaceId:config.spaceId,confirmed:true,fields:{title:'Synthetic workspace task',notes:'Keep as-is',dueOn:null,status:'open'}},'browser-search-workspace-task')).entry;
  const seedTask=async(key:string,title:string,fields:Record<string,unknown>,owner=config)=>{
   return (await new PersonalService(repo,owner).mutate(owner.ownerId,'todo',null,{spaceId:owner.spaceId,confirmed:true,fields:{title,notes:'Synthetic needle',...fields}},key)).entry;
  };
  const openTask=await seedTask('browser-search-cancelled','Synthetic cancelled task',{status:'open',dueOn:'2026-01-01',plannedStartOn:'2025-12-29',plannedEndOn:'2025-12-30'});
  const {entry:cancelled}=await service.mutate(config.ownerId,'todo',openTask.id,{spaceId:config.spaceId,confirmed:true,
   expectedRevision:openTask.revision,fields:{...openTask.draft,status:'cancelled'}},'browser-search-cancel-transition');
  assert.equal(cancelled.source.id,openTask.source.id);
  assert.equal(cancelled.revision,openTask.revision+1);
  await seedTask('browser-search-outside','Synthetic outside deadline',{status:'cancelled',dueOn:'2026-01-02',plannedStartOn:'2025-12-31',plannedEndOn:'2026-01-01'});
  const legacy=await seedTask('browser-search-legacy','Synthetic legacy task',{dueOn:'2025-12-31'});
  delete (repo.rows.get(legacy.id)!.draft as {status?:string}).status;
  const foreign=await seedTask('browser-search-foreign','Synthetic other owner task',{status:'cancelled',dueOn:'2026-01-01'},{...config,ownerId:'other-owner',spaceId:'other-space'});
  const areas=[];
  const linked=[];
  for(const key of ['first','second']){
   const {entry:area}=await service.mutate(config.ownerId,'domain',null,{spaceId:config.spaceId,confirmed:true,
    fields:{title:'同名合成领域',text:'',occurredOn:null,personal:{type:'domain'}}},'browser-search-area-'+key);
   areas.push(area);
   linked.push(await seedTask('browser-search-area-task-'+key,'合成领域待办 '+key,{notes:'',dueOn:null,status:'open',
    personal:{project:null,domain:{id:area.id,sourceId:area.source.id,revision:area.revision},topics:[]}}));
  }
  const snapshot=JSON.stringify([...repo.rows.values()]);
  const handler=createPersonalPlatformHandler({repository:repo,config,storageVerified:true,sessions:{read:async()=>({userId:config.ownerId,email:config.ownerEmail})},assertWritable:async()=>{}});
  await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin){outside.push(url.origin);return route.abort();}if(!url.pathname.startsWith('/api/'))return route.continue();if(request.method()!=='GET'){
    writes.push(request.method()+' '+url.pathname);
    return route.fulfill({status:405,json:{error:{code:'NO_SYNTHETIC_WRITES'}}});
   }
   if(url.pathname==='/api/platform/personal/todo/workspace-snapshot')assert.equal(url.searchParams.get('include'),'access');
   reads.push(url.pathname);
   if(expired)return route.fulfill({status:401,json:{error:{code:'AUTH_REQUIRED'}}});
   if(denyCancelledDetail&&url.pathname==='/api/platform/personal/todo/'+cancelled.id)return route.fulfill({status:403,json:{error:{code:'FORBIDDEN'}}});
   if(url.pathname==='/api/platform/personal/status'||url.pathname==='/api/platform/status')return route.fulfill({status:200,json:{...config,scope:'personal-manual-candidate',storageVerified:true,writable:true}});
   if(url.pathname.endsWith('/search')&&broken)return route.fulfill({status:503,json:{error:{code:'UNAVAILABLE'}}});
   const headers=new Headers(request.headers());headers.set('host',url.host);try{const response=await handler(new Request(url,{headers}));if(!response)return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});assert.equal(response.headers.get('cache-control'),'private, no-store');return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});}catch(error:any){return route.fulfill({status:error.status??503,json:{error:{code:error.code??'UNAVAILABLE'}}});}
  });
  const taskUrl=origin+'/personal?page=tasks', searchUrl=origin+'/personal/search';
  const searchReads=()=>reads.filter(path=>path==='/api/platform/personal/search').length;
  for(const url of [taskUrl,searchUrl]){
   await page.goto(url,{waitUntil:'domcontentloaded'});
   if(url===searchUrl)await expect(page.getByRole('heading',{name:'搜索结果',exact:true})).toBeVisible();
   const before=searchReads();
   const trigger=page.locator('header').getByRole('button',{name:'搜索本人记录',exact:true});
   await expect(trigger).toBeVisible({timeout:30_000});
   const draftInput=page.getByRole('textbox',{name:'编辑待办',exact:true});
   if(url===taskUrl){
    const grid=page.locator('[data-task-grid="reui"]');
    const grouping=grid.getByRole('combobox',{name:'待办表格分组'});
    const leaves=grid.locator('tbody tr[data-row-id]:not(:has([data-task-group]))');
    const expected=[todo.id,legacy.id,...linked.map(row=>row.id)].sort();
    const assertVisibleOnce=async()=>{
     await expect(leaves).toHaveCount(expected.length);
     assert.deepEqual(await leaves.evaluateAll(rows=>rows.map(row=>row.getAttribute('data-row-id')).sort()),expected);
    };
    await expect(grouping).toHaveValue('none',{timeout:30_000});
    await assertVisibleOnce();
    await grouping.selectOption('project');
    await expect(grid.locator('[data-task-group="project"]')).toHaveText('未关联项目4 项');
    await assertVisibleOnce();
    await grouping.selectOption('area');
    await expect(grid.locator('[data-task-group="area"]')).toHaveCount(3);
    for(const area of areas)await expect(grid.locator('[data-task-group-id="'+area.id+'"]')).toHaveText('同名合成领域1 项');
    await expect(grid.locator('[data-task-group-id="unassigned"]')).toHaveText('未关联领域2 项');
    await assertVisibleOnce();
    assert.deepEqual(writes,[],'Switching grouping is presentation only');
    const title=grid.locator('tr[data-row-id="'+todo.id+'"] td[data-col-id="title"]');
    await title.dblclick();
    await draftInput.fill('Unsent synthetic task title');
   }
   await trigger.click();
   const popup=page.getByRole('dialog',{name:'搜索本人记录',exact:true});
   await expect(popup).toBeVisible();
   const field=popup.getByRole('searchbox',{name:'搜索标题与正文',exact:true});
   await expect(field).toBeFocused();
   assert.deepEqual(writes,[],'Opening while an inline task draft is active must not save it');
   assert.deepEqual(discardPrompts,[],'Opening search must not ask to discard the workspace draft');
   assert.equal(searchReads(),before,'Opening a blank search must not read the search snapshot');
   assert.equal(page.url(),url);
   await field.fill('needle');
   assert.equal(searchReads(),before,'Typing must not read the search snapshot');
   await field.press('Enter');
   const journal=popup.getByRole('button',{name:'Synthetic search diary 查看原记录',exact:true});
   await expect(journal).toBeVisible();
   const submitted=searchReads();
   if(url===taskUrl&&process.env.LIFEOS_SEARCH_SCREENSHOT_DIR){
    await page.screenshot({path:join(process.env.LIFEOS_SEARCH_SCREENSHOT_DIR,'synthetic-search-dialog-'+width+'.png')});
   }
   await journal.click();
   await expect(popup.getByText('Original needle diary body',{exact:true})).toBeVisible();
   assert.equal(searchReads(),submitted,'The original detail must not reload the search snapshot');
   assert.ok(reads.includes('/api/platform/personal/journal/'+entry.id));
   await popup.getByRole('button',{name:'返回搜索结果',exact:true}).click();
   await expect(journal).toBeFocused();
   assert.equal(searchReads(),submitted,'Returning from detail rechecks the owner without rescanning');
   await popup.getByLabel('开始日期',{exact:true}).fill('2025-12-31');
   await popup.getByLabel('结束日期',{exact:true}).fill('2025-12-31');
   await field.press('Enter');
   await expect(popup.getByRole('button',{name:'Synthetic December diary 查看原记录',exact:true})).toBeVisible();
   await expect(journal).toHaveCount(0);
   await field.fill('unmatched');
   await field.press('Enter');
   await expect(popup.getByRole('status')).toContainText('没有匹配“unmatched”的记录');
   broken=true;
   await field.fill('needle');
   await field.press('Enter');
   await expect(popup.getByRole('alert')).toContainText('无法核对完整搜索结果');
   broken=false;
   await popup.getByRole('button',{name:'重新读取',exact:true}).click();
   await expect(popup.getByRole('button',{name:'Synthetic December diary 查看原记录',exact:true})).toBeVisible();
   const standalone=popup.getByRole('link',{name:'在独立页面打开',exact:true});
   await expect(standalone).toHaveAttribute('href','/personal/search?q=needle&from=2025-12-31&to=2025-12-31');
   assert.equal(await popup.evaluate(element=>{const box=element.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth; }),true);
   await popup.getByLabel('结束日期',{exact:true}).fill('2026-01-01');
   await field.press('Enter');
   const cancelledButton=popup.getByRole('button',{name:'Synthetic cancelled task 查看原记录',exact:true});
   const cancelledRow=popup.getByRole('listitem').filter({has:page.getByRole('button',{name:'Synthetic cancelled task 查看原记录',exact:true})});
   await expect(cancelledRow.getByText('已取消',{exact:true})).toBeVisible();
   await expect(cancelledRow.getByText('待办 · 截止日期：2026-01-01',{exact:true})).toBeVisible();
   await cancelledButton.click();
   const popupDetail=popup.getByRole('region',{name:'原业务记录只读详情'});
   await expect(popupDetail.getByText('已取消',{exact:true})).toBeVisible();
   await expect(popupDetail.getByText('待办 · 截止日期：2026-01-01',{exact:true})).toBeVisible();
   assert.ok(reads.includes('/api/platform/personal/todo/'+cancelled.id));
   await popupDetail.getByRole('button',{name:'返回搜索结果'}).click();
   await expect(cancelledButton).toBeFocused();
   denyCancelledDetail=true;
   await cancelledButton.click();
   await expect(popup.getByRole('alert')).toContainText('搜索结果已隐藏');
   await expect(popup.getByText(/Synthetic cancelled task|Synthetic needle|已取消/)).toHaveCount(0);
   denyCancelledDetail=false;
   await field.press('Enter');
   await expect(cancelledButton).toBeVisible();
   expired=true;
   await field.press('Enter');
   await expect(popup.getByRole('alert')).toContainText('本人会话已失效');
   await expect(journal).toHaveCount(0);
   await expect(cancelledButton).toHaveCount(0);
   expired=false;
   await page.keyboard.press('Escape');
   await expect(popup).toHaveCount(0);
   await expect(trigger).toBeFocused();
   const after=searchReads();
   await trigger.press('Enter');
   await expect(field).toHaveValue('needle');
   assert.equal(searchReads(),after,'Reopening a cancelled search keeps its draft without reading private results');
   await popup.getByRole('button',{name:'关闭',exact:true}).click();
   await expect(popup).toHaveCount(0);
   await expect(trigger).toBeFocused();
   if(url===taskUrl){
    await expect(draftInput).toHaveValue('Unsent synthetic task title');
    await draftInput.focus();
    await trigger.press('Enter');
    await expect(field).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(draftInput).toHaveValue('Unsent synthetic task title');
    await expect(page.getByRole('combobox',{name:'待办表格分组'})).toHaveValue('area');
    assert.deepEqual(writes,[],'Keyboard focus moving into search must also preserve the task draft');
   }
  }
  await page.goto(origin+'/personal/search?q=needle',{waitUntil:'domcontentloaded'});const original=page.getByRole('link',{name:'Synthetic search diary 查看原记录',exact:true});try{await expect(original).toBeVisible();}catch(error){t.diagnostic(log);t.diagnostic(JSON.stringify(errors));throw error;}await expect(page.getByText('日记 · 记录日期：日期未知',{exact:true})).toBeVisible();await original.focus();await page.keyboard.press('Enter');await expect(page.getByRole('region',{name:'原业务记录只读详情'})).toBeVisible();await expect(page.getByText('Original needle diary body',{exact:true})).toBeVisible();assert.ok(reads.includes('/api/platform/personal/journal/'+entry.id));assert.ok(page.url().includes('q=needle'));
  const back=page.getByRole('link',{name:'返回搜索结果',exact:true});await back.focus();await page.keyboard.press('Enter');await expect(original).toBeVisible();await original.click();await expect(page.getByRole('region',{name:'原业务记录只读详情'})).toBeVisible();await page.goBack();await expect(original).toBeVisible();await expect(page.getByLabel('搜索标题与正文',{exact:true})).toHaveValue('needle');
  await page.getByLabel('搜索标题与正文',{exact:true}).fill('unmatched');await page.getByLabel('搜索标题与正文',{exact:true}).press('Enter');await expect(page.getByText('没有匹配“unmatched”的记录。试试其他关键词。',{exact:true})).toBeVisible();assert.ok(page.url().includes('q=unmatched'));
  await page.goto(origin+'/personal/search?q=needle');const calendarLink=page.getByRole('link',{name:'Synthetic calendar 查看原记录',exact:true});await expect(calendarLink).toBeVisible();await calendarLink.focus();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'Synthetic calendar',exact:true})).toBeVisible();await expect(page.getByText('Calendar needle body',{exact:true})).toBeVisible();assert.ok(reads.includes('/api/platform/personal/calendar/'+calendar.id));await expect(page.getByText('来源 ID：'+calendar.source.id,{exact:true})).toBeVisible();await page.getByRole('link',{name:'返回搜索结果',exact:true}).click();await expect(calendarLink).toBeVisible();
  const keyword=page.getByLabel('搜索标题与正文',{exact:true}),start=page.getByLabel('开始日期',{exact:true}),end=page.getByLabel('结束日期',{exact:true});
  await start.fill('2025-12-31');await end.fill('2026-01-01');
  await page.getByRole('search').getByRole('button',{name:'搜索',exact:true}).click();
  const december=page.getByRole('link',{name:'Synthetic December diary 查看原记录',exact:true});
  await expect(december).toBeVisible();
  await expect(page.getByRole('link',{name:'Synthetic Shanghai calendar 查看原记录',exact:true})).toBeVisible();
  await expect(page.getByText('日程 · 开始日期（北京时间）：2026-01-01',{exact:true})).toBeVisible();
  await expect(original).toHaveCount(0);
  assert.equal(new URL(page.url()).searchParams.get('from'),'2025-12-31');
  assert.equal(new URL(page.url()).searchParams.get('to'),'2026-01-01');
  const cancelledLink=page.getByRole('link',{name:'Synthetic cancelled task 查看原记录',exact:true});
  const cancelledRow=page.getByRole('listitem').filter({has:cancelledLink});
  await expect(cancelledRow.getByText('已取消',{exact:true})).toBeVisible();
  await expect(cancelledRow.getByText('待办 · 截止日期：2026-01-01',{exact:true})).toBeVisible();
  const legacyLink=page.getByRole('link',{name:'Synthetic legacy task 查看原记录',exact:true});
  await expect(legacyLink).toBeVisible();
  await expect(page.getByRole('listitem').filter({has:legacyLink}).getByText('已取消',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('link',{name:/Synthetic outside deadline|Synthetic other owner task/})).toHaveCount(0);
  await cancelledLink.click();
  const detail=page.getByRole('region',{name:'原业务记录只读详情'});
  await expect(detail.getByRole('heading',{name:'Synthetic cancelled task',exact:true})).toBeVisible();
  await expect(detail.getByText('已取消',{exact:true})).toBeVisible();
  await expect(detail.getByText('待办 · 截止日期：2026-01-01',{exact:true})).toBeVisible();
  assert.ok(reads.includes('/api/platform/personal/todo/'+cancelled.id));
  await page.goBack();
  await expect(cancelledLink).toBeVisible();
  await page.goForward();
  await expect(detail.getByRole('heading',{name:'Synthetic cancelled task',exact:true})).toBeVisible();
  await detail.getByRole('link',{name:'返回搜索结果',exact:true}).click();
  await expect(cancelledLink).toBeVisible();
  await expect(keyword).toHaveValue('needle');
  await expect(start).toHaveValue('2025-12-31');
  await expect(end).toHaveValue('2026-01-01');

  await december.click();
  await expect(page.getByRole('heading',{name:'Synthetic December diary',exact:true})).toBeVisible();
  assert.ok(reads.includes('/api/platform/personal/journal/'+dated.id));
  await page.getByRole('link',{name:'返回搜索结果',exact:true}).click();
  await expect(december).toBeVisible();
  await expect(keyword).toHaveValue('needle');await expect(start).toHaveValue('2025-12-31');await expect(end).toHaveValue('2026-01-01');
  await december.click();await expect(page.getByRole('region',{name:'原业务记录只读详情'})).toBeVisible();await page.goBack();
  await expect(december).toBeVisible();await expect(start).toHaveValue('2025-12-31');await expect(end).toHaveValue('2026-01-01');
  const foreignURL=new URL(page.url());
  foreignURL.searchParams.set('type','todo');
  foreignURL.searchParams.set('id',foreign.id);
  await page.goto(foreignURL.toString());
  await expect(detail.getByText(/原记录已不可访问/)).toBeVisible();
  await expect(detail.getByText(/Synthetic other owner task|已取消|来源 ID/)).toHaveCount(0);
  assert.ok(reads.includes('/api/platform/personal/todo/'+foreign.id));
  await detail.getByRole('link',{name:'返回搜索结果',exact:true}).click();
  await expect(cancelledLink).toBeVisible();

  broken=true;await page.goto(origin+'/personal/search?q=needle');await expect(page.getByRole('region',{name:'本人记录搜索'}).getByRole('alert')).toContainText('无法核对完整搜索结果');await expect(original).toHaveCount(0);broken=false;await page.getByRole('button',{name:'重新读取',exact:true}).click();await expect(original).toBeVisible();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(writes,[]);assert.deepEqual(outside,[]);assert.equal(JSON.stringify([...repo.rows.values()]),snapshot);
  expired=true;await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});await expect(original).toHaveCount(0);await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});await expect(page.getByRole('heading',{name:'请重新登录',exact:true})).toBeVisible();assert.deepEqual(errors,[]);
  console.log('GROUPING_SEARCH_BROWSER '+JSON.stringify({width,theme,sameNameAreas:areas.length,ungrouped:2,visibleRows:4,groupingModes:3,writes:writes.length,draftRetained:true,hiddenOn:[401,403],cancelledDetail:cancelled.id,backForward:true}));
  await page.close();
 }
 assert.ok(!/Failed to compile|Module not found/.test(log),log);
});
