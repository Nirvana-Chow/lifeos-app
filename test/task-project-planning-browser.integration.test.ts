import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {normalizePersonalFields} from '../src/personal-candidate/business.ts';
import {preserveOmittedPlanning} from '../src/personal-candidate/planning.ts';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';

test('OPT-IN saved task/project dates, individual readback and scheduled-only Gantt',{
 skip:process.env.RUN_TASK_PROJECT_PLANNING_BROWSER_TESTS!=='1'&&'Requires isolated synthetic Next fixture and native Chrome',timeout:180_000,
},async()=>{
 let releaseHeldReadback:(()=>void)|undefined;
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-task-project-planning-'));
 let serverProcess:FixtureProcess|undefined,browserProcess:FixtureProcess|undefined,browserServer:Awaited<ReturnType<typeof chromium.launchServer>>|undefined,browser:Awaited<ReturnType<typeof chromium.connect>>|undefined;
 try{
  await mkdir(join(root,'app/personal/edit'),{recursive:true});
  await Promise.all([cp(join(source,'src'),join(root,'src'),{recursive:true}),...['layout.tsx','globals.css','theme.css'].map(file=>cp(join(source,'app',file),join(root,'app',file))),cp(join(source,'app/personal/page.tsx'),join(root,'app/personal/page.tsx')),cp(join(source,'app/personal/edit/page.tsx'),join(root,'app/personal/edit/page.tsx')),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components'))]);
  await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
  await writeFile(join(root,'src/platform/runtime.ts'),'export const readPlatformPagePrincipal=async()=>({id:"synthetic-planning-owner"});export const readPlatformPasswordCapability=async()=>false;\n');
  const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],detached:true});serverProcess=trackAuthThemeProcess(server,true);server.stderr.resume();
  const origin=await new Promise<string>((accept,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Fixture startup timeout')),30_000);server.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture exited'));});server.once('error',error=>{clearTimeout(timer);reject(error);});server.stdout.on('data',chunk=>{output=(output+String(chunk)).slice(-65536);const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});});
  browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH,host:'127.0.0.1'});browserProcess=trackAuthThemeProcess(browserServer.process());browser=await chromium.connect(browserServer.wsEndpoint());
  const page=await browser.newPage({viewport:{width:1365,height:900},colorScheme:'light'});page.setDefaultTimeout(9000);
  const taskId='11111111-1111-4111-8111-111111111111',projectId='33333333-3333-4333-8333-333333333333',newId='55555555-5555-4555-8555-555555555555',spaceId='synthetic-planning-space',ownerId='synthetic-planning-owner';
  const makeEntry=(id:string,type:string,fields:any,input:any={spaceId,confirmed:true,fields})=>({id,kind:type==='todo'?'todo':'inbox',revision:1,draft:type==='todo'?fields:{...fields,disposition:'reference'},source:{id:id===taskId?'22222222-2222-4222-8222-222222222222':id===projectId?'44444444-4444-4444-8444-444444444444':'66666666-6666-4666-8666-666666666666',system:'website',externalId:id,version:1,asOf:'2030-11-01T00:00:00Z',original:{marker:'personal-manual-v1',spaceId,type,input}},createdAt:'2030-11-01T00:00:00Z',updatedAt:'2030-11-01T00:00:00Z',syncState:'draft',externalStatus:null});
  // Only this private test's Node memory is written. No remote service, real record or database.
  let entries:any[]=[makeEntry(taskId,'todo',{title:'合成排期待办',notes:'Synthetic only',dueOn:'2030-12-31',status:'open',personal:{project:{id:projectId,sourceId:'44444444-4444-4444-8444-444444444444',revision:1},domain:null,topics:[]}}),makeEntry(projectId,'project',{title:'合成排期项目',text:'Synthetic only',occurredOn:'2030-12-31',personal:{type:'project',stage:'active',purpose:null,nextStep:'',domain:null,topics:[]}})];
  let overviewUnavailable=false;
  let writable=true,writes=0,taskReads=0,projectReads=0,holdReadback=true,releaseReadback!:()=>void;const gate=new Promise<void>(r=>{releaseReadback=r;releaseHeldReadback=r;}),receipts=new Map<string,any>(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  let rejectNextCreate=false,createRequests=0,newTaskReads=0,taskPatchRequests=0;
  let newReadback:Promise<void>|undefined;
  const headers={'cache-control':'private, no-store',vary:'Cookie','x-content-type-options':'nosniff'};
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url()),method=request.method();if(url.origin!==origin)return route.abort();if(!url.pathname.startsWith('/api/'))return ['GET','HEAD'].includes(method)?route.continue():route.abort();
   let value:any;
   if(method==='GET'){
    if(url.pathname==='/api/platform/personal/availability')value={configured:true,loginAllowed:true,https:false,transport:'ssh-loopback',origin,writable:true};
    else if(url.pathname==='/api/platform/personal/status')value={scope:'personal-manual-candidate',ownerId,spaceId,storageVerified:true,allowedTypes:['todo','journal','project','domain','topic'],writable};
    else if(url.pathname==='/api/platform/personal/overview'&&overviewUnavailable)return route.fulfill({status:503,json:{error:{code:'PERSONAL_SNAPSHOT_UNAVAILABLE'}},headers});
    else if(url.pathname==='/api/platform/personal/overview')value={scope:'full-current-snapshot',truncated:false,total:entries.length,items:entries,today:url.searchParams.get('today'),observedAt:'2030-11-01T00:00:00Z'};
    else{const match=/^\/api\/platform\/personal\/(todo|project)\/([a-f0-9-]+)(\/history)?$/.exec(url.pathname),entry=match&&entries.find(entry=>entry.id===match[2]);if(!match||!entry)return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}},headers});if(match[3])value={items:[entry],truncated:false};else{if(match[1]==='todo'){taskReads++;if(holdReadback&&writes>0)await gate;if(entry.id===newId){newTaskReads++;await newReadback;}}else projectReads++;value={entry};}}
   }else if(method==='PATCH'||method==='POST'){
    const match=/^\/api\/platform\/personal\/(todo|project)(?:\/([a-f0-9-]+))?$/.exec(url.pathname);if(!match)return route.abort();const body=request.postDataJSON(),key=request.headers()['idempotency-key'];if(method==='PATCH'&&match[1]==='todo')taskPatchRequests++;if(receipts.has(key))return route.fulfill({json:{entry:receipts.get(key),duplicate:true},headers});
    if(method==='POST'&&match[1]==='todo'){
     createRequests++;
     if(rejectNextCreate){rejectNextCreate=false;return route.fulfill({status:422,json:{error:{code:'VALIDATION_FAILED'}},headers});}
    }
    const type=match[1],id=match[2]??newId,old=entries.find(entry=>entry.id===id);if(old&&old.revision!==body.expectedRevision)return route.fulfill({status:409,json:{error:{code:'REVISION_CONFLICT'}},headers});
    const normalized=normalizePersonalFields(type,body.fields),fields=old?preserveOmittedPlanning(type,body.fields,old.draft,normalized):normalized,entry=old?{...old,revision:old.revision+1,draft:type==='todo'?fields:{...fields,disposition:'reference'}}:makeEntry(id,type,fields,body);entries=entries.filter(row=>row.id!==id).concat(entry);receipts.set(key,structuredClone(entry));writes++;return route.fulfill({status:old?200:201,json:{entry,duplicate:false},headers});
   }else return route.abort();
   return route.fulfill({json:value,headers});
  });
  await page.goto(origin+'/personal',{waitUntil:'domcontentloaded',timeout:60000});
  const overview=page.getByRole('region',{name:'未完待办',exact:true});
  await overview.getByRole('button',{name:'查看待办：合成排期待办',exact:true}).click();
  const existingDetail=page.getByRole('dialog',{name:'待办详情',exact:true});
  await expect(existingDetail.getByLabel('标题',{exact:true})).toHaveValue('合成排期待办');
  await expect(page).toHaveURL(origin+'/personal');
  await page.keyboard.press('Escape');
  await expect(overview.getByRole('button',{name:'查看待办：合成排期待办',exact:true})).toBeFocused();
  await expect(page.getByRole('button',{name:'新建待办',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'查看全部未完待办',exact:true}).click();
  await page.getByRole('button',{name:'列表',exact:true}).click();
  await page.getByRole('button',{name:'查看待办：合成排期待办',exact:true}).click();
  await expect(existingDetail).toBeVisible();
  await expect(page).toHaveURL(origin+'/personal?page=tasks');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'分类预览',exact:true}).click();
  const classification=page.getByRole('dialog',{name:'待办分类预览',exact:true});
  await expect(classification.getByText('合成排期待办',{exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(classification).toHaveCount(0);
  await expect(page.getByRole('button',{name:'列表',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page).toHaveURL(origin+'/personal?page=tasks');
  assert.equal(writes,0);
  await page.goto(origin+'/personal/edit?type=todo&id='+taskId,{waitUntil:'domcontentloaded',timeout:60000});
  await expect(existingDetail).toBeVisible();
  await expect(page).toHaveURL(origin+'/personal/edit?type=todo&id='+taskId);
  await page.keyboard.press('Escape');
  await page.goto(origin+'/personal?page=tasks',{waitUntil:'domcontentloaded',timeout:60000});const grid=page.locator('[data-task-grid="reui"]');await expect(grid).toBeVisible();await expect(page.locator('[data-slot="theme-toggle"]')).toBeEnabled();
  const grouping=grid.getByRole('combobox',{name:'待办表格分组'});
  await expect(grouping).toHaveValue('none');
  await expect(grouping.getByRole('option',{name:'按领域'})).toHaveCount(0);
  await expect(grid.getByRole('columnheader',{name:/项目/})).toBeVisible();
  await expect(grid.getByRole('columnheader',{name:/领域/})).toHaveCount(0);
  await grouping.selectOption('project');
  await expect(grid.locator('[data-task-group="project"]').first()).toBeVisible();
  await grouping.selectOption('none');
  await page.getByRole('button',{name:'甘特',exact:true}).click();let gantt=page.getByRole('region',{name:'待办甘特',exact:true});await expect(gantt.getByRole('heading',{name:'尚无完整排期',exact:true})).toBeVisible();await expect(gantt.locator('[data-gantt-bar]')).toHaveCount(0);await expect(gantt.getByRole('button',{name:'查看待办 合成排期待办',exact:true})).toBeVisible();await expect(gantt.getByRole('img',{name:'截止 2030-12-31',exact:true})).toBeVisible();await gantt.getByRole('button',{name:'查看待办表格',exact:true}).click();
  await expect(grid.getByRole('link',{name:'查看项目：合成排期项目',exact:true})).toBeVisible();
  await grid.getByRole('button',{name:'查看待办详情：合成排期待办',exact:true}).click();let dialog=page.getByRole('dialog',{name:'待办详情',exact:true});await dialog.getByLabel('计划开始',{exact:true}).fill('2030-11-05');await dialog.getByLabel('计划结束',{exact:true}).fill('2030-11-10');await dialog.getByRole('button',{name:'保存待办',exact:true}).click();await expect.poll(()=>taskReads).toBe(1);await expect(dialog).toBeVisible();holdReadback=false;releaseReadback();await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'甘特',exact:true}).click();await expect(gantt.locator('[data-gantt-bar]')).toHaveCount(1);await expect(gantt.getByRole('img',{name:'计划 2030-11-05 至 2030-11-10',exact:true})).toBeVisible();
  await page.reload({waitUntil:'domcontentloaded'});await expect(grid).toBeVisible();await expect(page.locator('[data-slot="theme-toggle"]')).toBeEnabled();await page.getByRole('button',{name:'甘特',exact:true}).click();await expect(gantt.locator('[data-gantt-bar]')).toHaveCount(1);await gantt.getByRole('button',{name:'查看待办 合成排期待办',exact:true}).click();dialog=page.getByRole('dialog',{name:'待办详情',exact:true});await expect(dialog.getByLabel('计划开始',{exact:true})).toHaveValue('2030-11-05');await dialog.getByLabel('计划结束',{exact:true}).fill('');await dialog.getByRole('button',{name:'保存待办',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(gantt.locator('[data-gantt-bar]')).toHaveCount(0);await expect(gantt.getByRole('button',{name:'查看待办 合成排期待办',exact:true})).toBeVisible();await expect(gantt.getByRole('img',{name:'截止 2030-12-31',exact:true})).toBeVisible();
  const create=page.getByRole('button',{name:'新建待办',exact:true});
  await expect(create).toHaveCount(1);
  await expect(create).toHaveAttribute('data-variant','outline');
  await create.click();
  dialog=page.getByRole('dialog',{name:'新建待办',exact:true});
  await expect(dialog.getByRole('button',{name:'多行录入',exact:true})).toHaveCount(0);
  await dialog.getByLabel('标题',{exact:true}).fill('合成新建排期');
  await dialog.getByLabel('计划开始',{exact:true}).fill('2030-11-12');
  await dialog.getByLabel('计划结束',{exact:true}).fill('2030-11-14');
  const submit=dialog.getByRole('button',{name:'保存待办',exact:true});
  rejectNextCreate=true;
  await submit.click();
  await expect(dialog.getByRole('alert')).toContainText('请求未被接受');
  await expect(dialog.getByLabel('标题',{exact:true})).toHaveValue('合成新建排期');
  assert.equal(writes,2);
  assert.equal(newTaskReads,0);
  newReadback=new Promise<void>(resolve=>{releaseHeldReadback=resolve;});
  await submit.click();
  await expect.poll(()=>newTaskReads).toBe(1);
  await expect(dialog).toBeVisible();
  await expect(gantt.locator('[data-gantt-bar]')).toHaveCount(0);
  releaseHeldReadback!();
  await expect(dialog).toHaveCount(0);
  await expect(create).toBeFocused();
  await expect(gantt.locator('[data-gantt-bar]')).toHaveCount(1);
  const scheduledRow=gantt.locator('[data-gantt-record="'+newId+'"]');
  await expect(scheduledRow).toBeVisible();
  assert.ok((await scheduledRow.boundingBox())!.height<=49,'desktop task Gantt row is compact');
  await expect(gantt.locator('[data-gantt-scale] time[datetime="2030-12-31"]')).toHaveCount(1);
  assert.equal(createRequests,2);
  assert.equal(writes,3);
  await page.goto(origin+'/personal?page=tasks',{waitUntil:'domcontentloaded'});
  await expect(grid.getByRole('button',{name:'查看待办详情：合成排期待办',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'看板',exact:true}).click();
  const board=page.locator('[data-task-board="reui"]');
  const card=board.locator('[data-kanban-task="'+taskId+'"]');
  await expect(card.getByRole('link',{name:'合成排期项目',exact:true})).toBeVisible();
  await expect(card.getByText('领域',{exact:true})).toHaveCount(0);
  await card.getByRole('button',{name:'查看待办：合成排期待办',exact:true}).click();
  await expect(existingDetail).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(existingDetail).toHaveCount(0);
  await expect(card.getByRole('button',{name:'查看待办：合成排期待办',exact:true})).toBeFocused();
  const drag=card.getByRole('button',{name:'拖动：合成排期待办',exact:true});
  const destination=board.locator('[data-kanban-status="in_progress"] .lo-board-cards');
  await expect(drag).toBeEnabled();
  await drag.scrollIntoViewIfNeeded();
  const start=await drag.boundingBox(),end=await destination.boundingBox();
  assert.ok(start&&end);
  await page.mouse.move(start.x+start.width/2,start.y+start.height/2);
  await page.mouse.down();
  await page.mouse.move(start.x+start.width/2+14,start.y+start.height/2,{steps:3});
  await expect(board.locator('[data-slot="kanban"]')).toHaveAttribute('data-dragging','true');
  await page.mouse.move(end.x+end.width/2,end.y+Math.min(45,end.height/2),{steps:16});
  await expect(destination.locator('[data-kanban-task="'+taskId+'"]')).toBeVisible();
  assert.equal(writes,3,'drag preview must not write');
  await page.mouse.up();
  await expect.poll(()=>writes).toBe(4);
  await expect(board.locator('[data-kanban-status="in_progress"]').locator('[data-kanban-task="'+taskId+'"]')).toBeVisible();
  assert.equal(entries.find(entry=>entry.id===taskId).draft.status,'in_progress');
  await page.getByRole('textbox',{name:'搜索待办',exact:true}).fill('合成排期待办');
  const column=(status:'open'|'in_progress')=>board.locator('[data-kanban-status="'+status+'"] .lo-board-cards');
  const stagedCard=(status:'open'|'in_progress')=>column(status).locator('[data-kanban-task="'+taskId+'"]');
  const counts=()=>({writes,requests:taskPatchRequests});
  const beforeBoardInputs=counts();
  async function requireStatusReceipt(status:'open'|'in_progress',before:ReturnType<typeof counts>){
   await expect.poll(()=>writes).toBe(before.writes+1);
   await expect(stagedCard(status)).toBeVisible();
   await expect(drag).toBeEnabled();
   assert.equal(entries.find(entry=>entry.id===taskId).draft.status,status);
   assert.deepEqual(counts(),{writes:before.writes+1,requests:before.requests+1});
  }
  const kanban=board.locator('[data-slot="kanban"]');
  const moveMenu=card.getByRole('combobox',{name:'移动到',exact:true});
  for(let step=0;step<30;step++){
   if(await drag.evaluate(node=>node===node.ownerDocument.activeElement))break;
   await page.keyboard.press('Tab');
  }
  await expect(drag).toBeFocused();

  async function previewWithKeyboard(key:'ArrowLeft'|'ArrowRight',status:'open'|'in_progress'){
   const before=counts();
   await expect(column(status).locator('[data-kanban-task]')).toHaveCount(0);
   await expect(drag).toBeEnabled();
   await expect(drag).toBeFocused();
   await page.keyboard.press('Space');
   await expect(kanban).toHaveAttribute('data-dragging','true');
   // dnd-kit attaches the keyboard movement listener in a deferred task.
   await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0))));
   await page.keyboard.press(key);
   await expect(stagedCard(status)).toBeVisible();
   assert.deepEqual(counts(),before,'keyboard preview must not send a PATCH');
   return before;
  }
  async function dropWithKeyboard(key:'ArrowLeft'|'ArrowRight',status:'open'|'in_progress'){
   const before=await previewWithKeyboard(key,status);
   await page.keyboard.press('Space');
   await expect(kanban).toHaveAttribute('data-dragging','false');
   await requireStatusReceipt(status,before);
   await expect(drag).toBeFocused();
  }
  async function expectCanceled(status:'open'|'in_progress',before:ReturnType<typeof counts>){
   await expect(kanban).toHaveAttribute('data-dragging','false');
   await expect(stagedCard(status)).toBeVisible();
   await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0))));
   assert.deepEqual(counts(),before,'canceling keyboard preview must not send a PATCH');
  }
  const beforeTab=await previewWithKeyboard('ArrowLeft','open');
  await page.keyboard.press('Tab');
  await expectCanceled('in_progress',beforeTab);
  await expect(moveMenu).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(drag).toBeFocused();

  const beforeEscape=await previewWithKeyboard('ArrowLeft','open');
  await page.keyboard.press('Escape');
  await expectCanceled('in_progress',beforeEscape);
  await expect(drag).toBeFocused();
  await dropWithKeyboard('ArrowLeft','open');

  const beforeShiftTab=await previewWithKeyboard('ArrowRight','in_progress');
  await page.keyboard.press('Shift+Tab');
  await expectCanceled('open',beforeShiftTab);
  await expect(card).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(drag).toBeFocused();

  const beforeEnter=await previewWithKeyboard('ArrowRight','in_progress');
  await page.keyboard.press('Enter');
  await expect(kanban).toHaveAttribute('data-dragging','true');
  assert.deepEqual(counts(),beforeEnter,'Enter must not confirm a keyboard drag');
  await page.keyboard.press('Space');
  await requireStatusReceipt('in_progress',beforeEnter);
  await expect(drag).toBeFocused();

  await page.setViewportSize({width:390,height:844});
  await dropWithKeyboard('ArrowLeft','open');
  await dropWithKeyboard('ArrowRight','in_progress');
  const beforeMenu=counts();
  await page.keyboard.press('Tab');
  await expect(moveMenu).toBeFocused();
  await moveMenu.press('ArrowUp');
  await requireStatusReceipt('open',beforeMenu);

  const touch=await page.context().newCDPSession(page);
  try{
   await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
   await drag.scrollIntoViewIfNeeded();
   const handleBounds=await drag.boundingBox(),targetBounds=await column('in_progress').boundingBox();
   assert.ok(handleBounds&&targetBounds);
   const from={x:handleBounds.x+handleBounds.width/2,y:handleBounds.y+handleBounds.height/2};
   const to={x:Math.min(targetBounds.x+targetBounds.width/2,370),y:targetBounds.y+40};
   assert.ok(to.x>targetBounds.x&&to.x<targetBounds.x+targetBounds.width);
   const beforeTouch=counts();
   await expect(column('in_progress').locator('[data-kanban-task]')).toHaveCount(0);
   await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
   await expect(board.locator('[data-slot="kanban"]')).toHaveAttribute('data-dragging','true');
   for(let step=1;step<=12;step++){
    const x=from.x+(to.x-from.x)*step/12,y=from.y+(to.y-from.y)*step/12;
    await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y}]});
   }
   await expect(stagedCard('in_progress')).toBeVisible();
   assert.deepEqual(counts(),beforeTouch,'touch preview must not send a PATCH');
   await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await requireStatusReceipt('in_progress',beforeTouch);
  }finally{
   await touch.send('Emulation.setTouchEmulationEnabled',{enabled:false});
   await touch.detach();
   await page.setViewportSize({width:1365,height:900});
  }
  const boardInputs={writes:writes-beforeBoardInputs.writes,requests:taskPatchRequests-beforeBoardInputs.requests};
  assert.deepEqual(boardInputs,{writes:6,requests:6});
  console.log('TASK_BOARD_INPUTS_PASS '+JSON.stringify({keyboard:[1365,390],directions:['left','right'],cancelWithoutWrites:['Tab','Shift+Tab','Escape'],confirmation:'Space',menu:true,touch:390,boardInputs}));
  await page.getByRole('button',{name:'项目分类视图',exact:true}).click();await page.getByRole('group',{name:'项目视图',exact:true}).getByRole('button',{name:'甘特',exact:true}).click();gantt=page.getByRole('region',{name:'项目甘特',exact:true});await expect(gantt.locator('[data-gantt-bar]')).toHaveCount(0);await gantt.getByRole('button',{name:'查看项目表格',exact:true}).click();await page.getByRole('link',{name:'编辑项目：合成排期项目',exact:true}).click({noWaitAfter:true});
  await expect(page.getByLabel('计划开始',{exact:true})).toBeVisible();await page.getByLabel('计划开始',{exact:true}).fill('2030-11-01');await page.getByLabel('计划结束',{exact:true}).fill('2030-11-20');await page.getByRole('checkbox',{name:'我已核对这一条内容，确认保存到本人空间。',exact:true}).check();const projectReadsBeforeSave=projectReads;await page.getByRole('button',{name:'确认保存',exact:true}).click();await expect.poll(()=>projectReads).toBeGreaterThan(projectReadsBeforeSave);await expect(page.getByLabel('计划结束',{exact:true})).toHaveValue('2030-11-20');
  await page.goto(origin+'/personal?page=projects',{waitUntil:'domcontentloaded'});await expect(page.getByRole('columnheader',{name:/下一步/})).toBeVisible();await expect(page.getByRole('columnheader',{name:/领域/})).toHaveCount(0);await page.getByRole('group',{name:'项目视图',exact:true}).getByRole('button',{name:'甘特',exact:true}).click();gantt=page.getByRole('region',{name:'项目甘特',exact:true});await expect(gantt.locator('[data-gantt-bar]')).toHaveCount(1);await expect(gantt.getByRole('img',{name:'计划 2030-11-01 至 2030-11-20',exact:true})).toBeVisible();await page.setViewportSize({width:360,height:800});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  writable=false;
  await page.goto(origin+'/personal?page=tasks&create=todo',{waitUntil:'domcontentloaded'});
  await expect(grid).toBeVisible();
  await expect(page.getByRole('button',{name:'新建待办',exact:true})).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await grid.getByRole('button',{name:'查看待办详情：合成排期待办',exact:true}).click();
  const projectLink=page.getByRole('dialog',{name:'待办详情',exact:true}).getByRole('link',{name:'合成排期项目（版本已变化）',exact:true});
  await projectLink.click();
  await expect(page).toHaveURL(origin+'/personal/edit?type=project&id='+projectId);
  await expect(page.getByLabel('标题',{exact:true})).toHaveValue('合成排期项目');
  writable=true;
  entries=[];
  await page.goto(origin+'/personal?page=tasks',{waitUntil:'domcontentloaded'});
  await expect(grid.getByText('暂无待办',{exact:true})).toBeVisible();
  await expect(create).toBeEnabled();
  assert.ok((await create.boundingBox())!.height>=44,'mobile new task target is 44px tall');
  await page.getByRole('button',{name:'列表',exact:true}).click();
  await expect(page.getByRole('heading',{name:'暂无待办',exact:true})).toBeVisible();
  await expect(create).toHaveCount(1);
  entries=[makeEntry(taskId,'todo',{title:'合成单条读取',notes:'合成原文',dueOn:null,status:'open'})];
  overviewUnavailable=true;
  const readsBefore=taskReads;
  await page.goto(origin+'/personal?page=tasks',{waitUntil:'domcontentloaded'});
  await expect(page.getByText('暂时无法读取完整待办列表，请重试。',{exact:true})).toBeVisible();
  assert.equal(taskReads,readsBefore);
  await page.goto(origin+'/personal/edit?type=todo&id='+taskId,{waitUntil:'domcontentloaded'});
  const isolated=page.getByRole('dialog',{name:'待办详情',exact:true});
  await expect(isolated.getByRole('heading',{name:'合成单条读取',exact:true})).toBeVisible();
  await expect(isolated.getByText('合成原文',{exact:true})).toBeVisible();
  await expect(isolated.getByRole('button',{name:'保存待办',exact:true})).toHaveCount(0);
  await expect(isolated.getByText('未设置',{exact:true}).first()).toBeVisible();
  assert.equal(taskReads,readsBefore+1);
  await page.keyboard.press('Escape');
  await expect(isolated).toHaveCount(0);
  await page.goto(origin+'/personal/edit?type=todo&id='+newId,{waitUntil:'domcontentloaded'});
  await expect(page.getByText('这条待办不存在或当前无法访问。',{exact:true})).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  overviewUnavailable=false;
  await page.goto(origin+'/personal/edit?type=todo&id='+taskId,{waitUntil:'domcontentloaded',timeout:60000});
  const draftTitle=isolated.getByLabel('标题',{exact:true});
  await expect(draftTitle).toHaveValue('合成单条读取');
  await draftTitle.fill('仅保留在编辑器里的合成草稿');
  const visibility=(state:'hidden'|'visible')=>page.evaluate(value=>{
   Object.defineProperty(document,'visibilityState',{configurable:true,value});
   document.dispatchEvent(new Event('visibilitychange'));
  },state);
  overviewUnavailable=true;
  await visibility('hidden');
  await visibility('visible');
  await expect(isolated.getByRole('heading',{name:'合成单条读取',exact:true})).toBeVisible();
  await expect(isolated.getByText('合成原文',{exact:true})).toBeVisible();
  await expect(isolated.getByRole('button',{name:'保存待办',exact:true})).toHaveCount(0);
  overviewUnavailable=false;
  await visibility('hidden');
  await visibility('visible');
  await expect(draftTitle).toHaveValue('仅保留在编辑器里的合成草稿');
  assert.equal(writes,11);assert.ok(taskReads>=3);assert.ok(projectReads>=2);assert.deepEqual(errors,[]);console.log('TASK_PROJECT_PLANNING_BROWSER_PASS '+JSON.stringify({syntheticWrites:writes,taskReads,projectReads,scheduledOnly:true,partialExcluded:true,heldReadback:true,createRequests,newTaskReads,definiteFailureVisible:true,isolatedReadOnly:true,mobileOverflow:false}));
 }finally{releaseHeldReadback?.();await cleanupAuthThemeFixture({root,browser,browserServer,browserProcess,server:serverProcess});}
});
