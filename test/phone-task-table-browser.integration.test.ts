import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,devices,expect,type Browser,type BrowserServer} from '@playwright/test';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {MemoryPort} from './helpers/platform.ts';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';

test('OPT-IN phone task table reads long titles, status and due date and edits without native clone',{
 skip:process.env.RUN_PHONE_TASK_TABLE_BROWSER_TESTS!=='1'&&'Requires an isolated Next fixture and native Chromium',timeout:180_000,
},async()=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-phone-task-table-'));
 const owner={id:'synthetic-expand-owner',email:'phone-task@example.invalid'};
 const sessionCookie='lifeos-phone-task-fixture';
 const hasSession=(headers:Headers)=>headers.get('cookie')?.split(';').some(part=>part.trim()===sessionCookie+'=owner')===true;
 let server:FixtureProcess|undefined,browserProcess:FixtureProcess|undefined,browserServer:BrowserServer|undefined,browser:Browser|undefined;
 try{
  await mkdir(join(root,'app/personal'),{recursive:true});
  await mkdir(join(root,'app/login'),{recursive:true});
  await writeFile(join(root,'app/login/page.tsx'),'export default function Page(){return <h1>合成登录</h1>}');
  await Promise.all([
   cp(join(source,'src'),join(root,'src'),{recursive:true}),
   ...['layout.tsx','globals.css','theme.css','personal/page.tsx','personal/layout.tsx','personal/error.tsx'].map(file=>cp(join(source,'app',file),join(root,'app',file))),
   cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
   symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components')),
  ]);
  await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
  await writeFile(join(root,'src/platform/runtime.ts'),`
export const readPlatformPagePrincipal=async(headers:Headers)=>
 headers.get('cookie')?.split(';').some(part=>part.trim()==='${sessionCookie}=owner')?{userId:'${owner.id}'}:null;
export const readPlatformPasswordCapability=async()=>false;
export const readPlatformLoginCapability=async()=>({sessionDuration:false});
`);
  const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{
   cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],detached:true,
  });
  server=trackAuthThemeProcess(child,true);
  child.stderr.resume();
  const origin=await new Promise<string>((accept,reject)=>{
   const timer=setTimeout(()=>reject(Error('Synthetic Next fixture startup timeout')),30_000);
   child.once('exit',()=>{clearTimeout(timer);reject(Error('Synthetic Next fixture exited'));});
   child.once('error',error=>{clearTimeout(timer);reject(error);});
   child.stdout.on('data',chunk=>{
    const url=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if(url){clearTimeout(timer);accept(url);}
   });
  });
  browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH,host:'127.0.0.1'});
  browserProcess=trackAuthThemeProcess(browserServer.process());
  browser=await chromium.connect(browserServer.wsEndpoint());
  const platformStatus='/api/platform/status';
  const title='合成长中文待办：整理周末项目资料、核对全部待处理内容并写下下一步安排';
  const id='11111111-1111-4111-8111-111111111111',spaceId='synthetic-expand-space',ownerId=owner.id;
  const handlePlatform=createPersonalPlatformHandler({
   config:{ownerId,ownerEmail:owner.email,spaceId,baseURL:origin,databaseName:'lifeos_platform_test_local',
    allowedTypes:['todo'],approval:'personal-manual-v1',transport:'ssh-loopback'},
   repository:new MemoryPort(),storageVerified:true,assertWritable:async()=>{},
   sessions:{read:async headers=>hasSession(headers)?{userId:ownerId,email:owner.email}:null},
  });
  const at='2030-11-01T00:00:00Z';
  const initial={title,notes:'合成原备注',dueOn:'2030-11-03',status:'in_progress',plannedStartOn:'2030-11-01',plannedEndOn:'2030-11-02'};
  const geometry:unknown[]=[];
  const failures:unknown[]=[];
  for(const width of [390,430,1365]){
   const page=await browser.newPage(width===1365?{viewport:{width,height:900}}:{...devices['iPhone 13'],viewport:{width,height:844}});
   await page.context().addCookies([{name:sessionCookie,value:'owner',url:origin,httpOnly:true,sameSite:'Lax',expires:Date.now()/1000+600}]);
   const errors:string[]=[],writes:unknown[]=[],readbacks:number[]=[];
   let snapshotReads=0,legacyStatusMissing=false;
   page.on('pageerror',error=>{errors.push(error.stack??error.message);console.log('PHONE_TASK_PAGE_ERROR '+(error.stack??error.message));});
   if(process.env.PHONE_TASK_TABLE_NO_CLONE==='1'){
    await page.addInitScript(()=>Object.defineProperty(window,'structuredClone',{configurable:true,value:undefined}));
   }
   let task={id,kind:'todo',revision:1,draft:{...initial},createdAt:at,updatedAt:at,syncState:'draft',externalStatus:null,
    source:{id,system:'website',externalId:id,version:1,asOf:at,original:{marker:'personal-manual-v1',spaceId,type:'todo',input:{spaceId,confirmed:true,fields:initial}}}};
   await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(url.origin!==origin)return route.abort();
    if(!path.startsWith('/api/'))return route.continue();
    const headers=new Headers(await request.allHeaders());
    if(path===platformStatus||path==='/api/platform/personal/status'){
     if(path===platformStatus&&legacyStatusMissing)return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
     headers.set('host',url.host);
     const response=await handlePlatform(new Request(url,{method:request.method(),headers}));
     return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
    }
    if(path.startsWith('/api/platform/personal/')&&!hasSession(headers)){
     return route.fulfill({status:401,json:{error:{code:'LOGIN_REQUIRED'}}});
    }
    if(path.endsWith('/personal/todo/'+id)){
     if(request.method()==='PATCH'){
      const body=request.postDataJSON();
      writes.push(body);
      if(body.expectedRevision!==task.revision||body.confirmed!==true||body.spaceId!==spaceId)return route.fulfill({status:409,json:{}});
      task={...task,revision:task.revision+1,draft:body.fields};
      return route.fulfill({json:{entry:task,duplicate:false}});
     }
     readbacks.push(task.revision);
     return route.fulfill({json:{entry:task}});
    }
    assert.equal(request.method(),'GET');
    if(path.endsWith('/personal/availability'))return route.fulfill({json:{configured:true,loginAllowed:true,transport:'ssh-loopback',origin}});
    if(path==='/api/platform/personal/todo/workspace-snapshot'){
     const today=url.searchParams.get('today')??'';
     assert.match(today,/^\d{4}-\d{2}-\d{2}$/);
     assert.equal(url.searchParams.get('include'),'access');
     snapshotReads++;
     return route.fulfill({json:{scope:'task-workspace-current-snapshot',truncated:false,total:1,items:[task],today,observedAt:at,access:{scope:'personal-manual-candidate',ownerId,spaceId,storageVerified:true,allowedTypes:['todo'],writable:true}}});
    }
    return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
   });
   await page.goto(origin+'/personal?page=tasks',{waitUntil:'domcontentloaded',timeout:60000});
   if(process.env.PHONE_TASK_TABLE_NO_CLONE==='1'){
    assert.equal(await page.evaluate(()=>typeof window.structuredClone),'undefined');
   }
   const grid=page.locator('[data-task-grid="reui"]');
   const view=page.getByRole('button',{name:'表格',exact:true});
   if(!await grid.isVisible())await view.click();
   const row=grid.locator('tbody tr[data-row-id]').first(),heading=row.locator('td[data-col-id="title"]').getByText(title,{exact:true});
   await expect(heading).toBeVisible({timeout:25000});
   assert.ok(snapshotReads>0,'actual tasks must use the narrow workspace read');
   const measured=await row.evaluate(node=>{
    const measure=(selector:string)=>{
     const cell=node.querySelector<HTMLElement>(selector)!;
     const range=document.createRange();range.selectNodeContents(cell);
     const boxes=Array.from(range.getClientRects());
     const enclosing=cell.getBoundingClientRect();
     return {top:Math.round(enclosing.top),bottom:Math.round(enclosing.bottom),right:Math.round(enclosing.right),left:Math.round(enclosing.left),
      lines:boxes.length,textFits:boxes.every(box=>box.right<=enclosing.right+1&&box.left>=enclosing.left-1)};
    };
    const tools=document.querySelector('.lo-task-toolbar')?.getBoundingClientRect();
    return {firstRowY:Math.round(node.getBoundingClientRect().top),toolsHeight:tools&&Math.round(tools.height),
     title:measure('td[data-col-id="title"] [class*="cellText"]'),
     status:measure('td[data-col-id="status"] [class*="cellText"]'),due:measure('td[data-col-id="due"] [class*="cellText"]'),
     viewportWidth:innerWidth,viewportHeight:innerHeight};
   });
   geometry.push({width,...measured});
   console.log('PHONE_TASK_TABLE_MEASUREMENT '+JSON.stringify({width,...measured}));
   if(width!==1365){
    if(!measured.toolsHeight||measured.toolsHeight>115)failures.push({width,toolsHeight:measured.toolsHeight});
    for(const key of ['title','status','due'] as const){
     const cell=measured[key];
     if(!(cell.textFits&&cell.left>=0&&cell.right<=width&&cell.bottom<=844))failures.push({width,key,cell});
    }
   }else await expect(grid.locator('th[data-col-id="status"]')).toBeVisible();

   const cell=row.locator('td[data-col-id="title"]'),editor=grid.getByRole('textbox',{name:'编辑待办',exact:true});
   await row.getByRole('button',{name:'查看待办详情：'+title,exact:true}).press('F2');
   try{
    await expect(editor).toBeFocused({timeout:2500});
    await editor.fill('合成取消');await editor.press('Escape');
    await expect(heading).toBeVisible();
    await expect(grid.getByRole('grid')).toBeFocused();
    assert.equal(writes.length,0);
    await row.getByRole('button',{name:'查看待办详情：'+title,exact:true}).press('F2');
    await expect(editor).toBeFocused();await editor.fill(title+' 已核对');await editor.press('Enter');
    await expect(cell.getByText(title+' 已核对',{exact:true})).toBeVisible();
    assert.deepEqual(task.draft,{...initial,title:title+' 已核对'});
    assert.equal(writes.length,1);assert.ok(readbacks.includes(2));
   }catch(error){failures.push({width,entry:'grid',message:String(error),errors:[...errors]});}
   await page.getByRole('button',{name:'列表',exact:true}).click();
   const currentTitle=task.draft.title;
   const listTitle=page.getByRole('button',{name:'查看待办：'+currentTitle,exact:true});
   await expect(listTitle).toBeVisible();
   await listTitle.press('F2');
   try{
    const listEditor=page.getByRole('textbox',{name:'编辑待办',exact:true});
    await expect(listEditor).toBeFocused({timeout:2500});await listEditor.fill('另一合成取消');await listEditor.press('Escape');
    await expect(listTitle).toBeFocused();assert.equal(task.draft.title,currentTitle);
    assert.equal(writes.length,1);
    await listTitle.press('F2');
    await expect(listEditor).toBeFocused();
    const savedTitle=currentTitle+' 列表已核对';
    await listEditor.fill(savedTitle);await listEditor.press('Enter');
    await expect(page.getByRole('button',{name:'查看待办：'+savedTitle,exact:true})).toBeFocused();
    assert.deepEqual(task.draft,{...initial,title:savedTitle});
    assert.equal(writes.length,2);assert.ok(readbacks.includes(3));
   }catch(error){failures.push({width,entry:'list',message:String(error),errors:[...errors]});}
   if(failures.length===0){
    await view.click();
    const savedTitle=task.draft.title;
    const details=(value:string)=>grid.getByRole('button',{name:'查看待办详情：'+value,exact:true});
    const detail=page.getByRole('dialog',{name:'待办详情',exact:true});
    await details(savedTitle).click();
    const detailTitle=detail.getByLabel('标题',{exact:true});
    await expect(detail.getByRole('button',{name:'关闭待办详情',exact:true})).toBeFocused();
    await expect(detail.getByRole('textbox',{name:'正文',exact:true})).toHaveValue(initial.notes);
    const detailDate=detail.locator('label').filter({hasText:/^到期日$/}).locator('input[type=date]');
    await expect(detailDate).toHaveValue(initial.dueOn);
    await detailTitle.fill('合成侧栏取消');
    page.once('dialog',dialog=>void dialog.accept());
    await detail.getByRole('button',{name:'取消',exact:true}).click();
    await expect(detail).toHaveCount(0);
    await expect(details(savedTitle)).toBeFocused();
    assert.equal(writes.length,2);

    await details(savedTitle).click();
    const revisedTitle=savedTitle+' 侧栏已核对';
    await detailTitle.fill(revisedTitle);
    await detailDate.fill('');
    await detail.getByRole('button',{name:'保存待办',exact:true}).click();
    await expect(detail).toHaveCount(0);
    await expect(details(revisedTitle)).toBeVisible();
    assert.deepEqual(task.draft,{...initial,title:revisedTitle,dueOn:null});
    assert.equal(writes.length,3);assert.ok(readbacks.includes(4));
    const focusAfterSave=await page.evaluate(()=>document.activeElement?.tagName);
    await details(revisedTitle).click();
    await expect(detail.getByRole('button',{name:'关闭待办详情',exact:true})).toBeFocused();
    await expect(detailTitle).toHaveValue(revisedTitle);
    await expect(detailDate).toHaveValue('');
    await detail.getByRole('button',{name:'关闭待办详情',exact:true}).click();
    await expect(details(revisedTitle)).toBeFocused();
    console.log('PHONE_TASK_EDITOR_RECEIPTS '+JSON.stringify({width,cloneDisabled:process.env.PHONE_TASK_TABLE_NO_CLONE==='1',readbacks,focusAfterSave}));
   }
   if(width===390&&failures.length===0){
    await view.click();
    await expect(grid.getByLabel('待办表格分组')).toHaveCount(0);
    await expect(grid.locator('tbody tr[data-row-id]')).toHaveCount(1);
    await expect(grid.locator('[data-task-group],th[data-col-id="project"],th[data-col-id="area"]')).toHaveCount(0);
    const filter=page.getByRole('textbox',{name:'搜索待办'});
    await filter.fill('合成不存在');await expect(grid.getByText('没有符合条件的待办')).toBeVisible();
    await filter.fill('合成长中文');await expect(row).toBeVisible();
    const toDesktop=page.getByRole('button',{name:'切换到桌面版'});
    await toDesktop.click();
    await expect(page.locator('html')).toHaveAttribute('data-lifeos-workspace-layout','desktop');
    await expect(filter).toHaveValue('合成长中文');
    await expect.poll(()=>row.evaluate(element=>getComputedStyle(element).display)).toBe('table-row');
    await page.reload({waitUntil:'domcontentloaded'});
    await expect(page.locator('html')).toHaveAttribute('data-lifeos-workspace-layout','desktop');
    await expect(grid).toBeVisible();
    await page.getByRole('button',{name:'切换到手机版'}).click();
    await expect.poll(()=>row.evaluate(element=>getComputedStyle(element).display)).toBe('grid');

    // The native pageshow can precede hydration. Drive the same registered
    // listener explicitly so the recheck is exercised on every test run.
    const statuses:number[]=[];
    const recheck=async(status:number,trigger:()=>Promise<unknown>)=>{
     const [response]=await Promise.all([
      page.waitForResponse(value=>value.url()===origin+platformStatus&&value.request().method()==='GET'),
      trigger(),
     ]);
     assert.equal(response.status(),status);
     statuses.push(response.status());
    };
    const pageshow=()=>page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow')));
    await recheck(200,pageshow);
    await expect(grid).toBeVisible();
    await expect(grid.getByText(task.draft.title,{exact:true})).toBeVisible();

    legacyStatusMissing=true;
    await recheck(404,pageshow);
    await expect(page.getByText('暂时无法核对登录状态。私人页面已隐藏。',{exact:true})).toBeVisible();
    await expect(grid).toBeHidden();
    await expect(page.getByText(task.draft.title,{exact:true})).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('data-lifeos-workspace-layout','mobile');

    legacyStatusMissing=false;
    await recheck(200,()=>page.getByRole('button',{name:'重新核对',exact:true}).click());
    await expect(grid.getByText(task.draft.title,{exact:true})).toBeVisible();

    await page.context().clearCookies({name:sessionCookie});
    await recheck(401,pageshow);
    await expect(page).toHaveURL(origin+'/login');
    await expect(page.getByRole('heading',{name:'合成登录',exact:true})).toBeVisible();
    await expect(grid).toHaveCount(0);
    await expect(page.getByText(task.draft.title,{exact:true})).toHaveCount(0);
    assert.equal(task.revision,4);
    assert.equal(writes.length,3,'Rechecks must not write or replay a task');
    console.log('PHONE_TASK_SESSION_RECHECK '+JSON.stringify({width,statuses,revision:task.revision,writes:writes.length}));
   }
   await page.close();
  }
  console.log('PHONE_TASK_TABLE_METRICS '+JSON.stringify(geometry));
  assert.deepEqual(failures,[]);
 }finally{await cleanupAuthThemeFixture({root,browser,browserServer,browserProcess,server});}
});
