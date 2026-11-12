import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp, mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {once} from 'node:events';
import test from 'node:test';
import {chromium, expect,type Page} from '@playwright/test';
import {readyHeading} from './helpers/private-business-browser-fixture.ts';
import {confirmDiscard} from './helpers/personal-workspace-browser-fixture.ts';
import {requirements} from '../src/platform/requirements.ts';

const source=resolve(import.meta.dirname,'..');
const ids=Array.from({length:7},(_,index)=>`${String(index+1).repeat(8)}-1111-4111-8111-${String(index+1).repeat(12)}`);
function entry(index:number,type:string,title:string,personal:unknown={type}){
 const id=ids[index];
 return {id,kind:type==='todo'?'todo':'inbox',revision:2,
  draft:type==='todo'?{title,notes:'Synthetic fixture only',status:'open',dueOn:null,personal}:{title,text:'Synthetic fixture only',occurredOn:null,disposition:'reference',personal},
  source:{id,system:'website',externalId:id,version:1,asOf:'2030-11-02T00:00:00Z',original:{marker:'personal-manual-v1',spaceId:'synthetic-space',type,input:{}}},
  syncState:'draft',externalStatus:null,createdAt:'2030-11-02T00:00:00Z',updatedAt:'2030-11-02T00:00:00Z'};
}
const ref=(index:number)=>({id:ids[index],sourceId:ids[index],revision:2});
const items=[entry(0,'domain','合成领域甲'),entry(1,'domain','合成领域乙'),
 entry(2,'project','合成项目甲',{type:'project',stage:'active',purpose:'advance',nextStep:'核对合成样例',domain:ref(0),topics:[]}),
 entry(3,'project','合成项目乙',{type:'project',stage:'planned',purpose:'explore',nextStep:'检查后续阶段',domain:ref(1),topics:[]}),
 entry(4,'todo','合成待办甲',{project:ref(2),domain:null,topics:[]}),entry(5,'todo','合成待办乙',{project:ref(3),domain:null,topics:[]}),
 entry(6,'topic','合成主题')];

for(let i=0;i<75;i++){const id=`${(i+20).toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`,item=entry(4,'todo','合成长待办'+i,{project:null,domain:null,topics:[]});items.push({...item,id,source:{...item.source,id,externalId:id}});}
for(let i=0;i<75;i++)for(const [index,type,label] of [[0,'domain','领域'],[2,'project','项目']] as const){
 const id=`${(i+(type==='domain'?200:400)).toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`;
 const item=entry(index,type,'合成长'+label+i,type==='domain'?{type:'domain'}:{type:'project',stage:'active',purpose:'advance',nextStep:'合成下一步',domain:ref(0),topics:[]});
 items.push({...item,id,source:{...item.source,id,externalId:id}});
}
async function installSyntheticReads(page:Page,origin:string){
 let writes=0;
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin)return route.abort();
  if(!['GET','HEAD'].includes(request.method())){writes++;return route.fulfill({status:405});}
  if(url.pathname.endsWith('/personal/status'))return route.fulfill({json:{scope:'personal-manual-candidate',ownerId:'synthetic-owner',spaceId:'synthetic-space',storageVerified:true,writable:true,allowedTypes:['todo','journal','domain','project','topic']}});
  if(url.pathname.endsWith('/personal/availability'))return route.fulfill({json:{configured:true,loginAllowed:true,transport:'ssh-loopback',origin}});
  if(url.pathname.endsWith('/personal/overview'))return route.fulfill({json:{scope:'full-current-snapshot',total:items.length,truncated:false,items,today:url.searchParams.get('today'),observedAt:'2030-11-02T00:00:00Z'}});
  return route.continue();
 });
 return ()=>writes;
}
async function addSyntheticFooter(page:Page){
 await page.evaluate(()=>{const footer=document.createElement('footer');footer.className='lifeos-filing-footer';footer.innerHTML='<a href="#">合成备案占位</a>';document.body.appendChild(footer);window.dispatchEvent(new Event('resize'));});
 await expect.poll(()=>page.locator('.lifeos-filing-footer').evaluate(e=>e.getBoundingClientRect().height)).toBe(60);
}
async function expectAboveFooter(page:Page,control:import('@playwright/test').Locator){
 await expect(control).toBeInViewport({ratio:0.75});
 await expect.poll(async()=>{
  const box=await control.boundingBox(),footer=await page.locator('.lifeos-filing-footer').boundingBox();
  return !!box&&!!footer&&box.y>=0&&box.y+box.height<=footer.y+1;
 }).toBe(true);
}
async function fixture(root:string){
 await mkdir(join(root,'app/personal'),{recursive:true});
 await Promise.all([
  ...['layout.tsx','globals.css','theme.css'].map(file=>cp(join(source,'app',file),join(root,'app',file))),
  cp(join(source,'app/personal/page.tsx'),join(root,'app/personal/page.tsx')),
  cp(join(source,'app/personal/requirements'),join(root,'app/personal/requirements'),{recursive:true}),
  cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  cp(join(source,'src'),join(root,'src'),{recursive:true}),
  symlink(join(source,'node_modules'),join(root,'node_modules')),
  symlink(join(source,'components'),join(root,'components')),
 ]);
 await writeFile(join(root,'src/platform/runtime.ts'),'export const readPlatformPagePrincipal=async()=>({id:"synthetic-owner"}); export const readPlatformPasswordCapability=async()=>true;\n');
 await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
 const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],
  {cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 return server;
}

test('OPT-IN short Settings keeps security and logout reachable above the filing footer',{
 skip:process.env.RUN_SETTINGS_BROWSER_TESTS!=='1'&&'Requires native Chrome and disposable synthetic Next fixture',timeout:120_000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-short-settings-')),server=await fixture(root),stopped=once(server,'exit');
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await new Promise<string>((accept,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Short Settings fixture startup timeout')),30000);server.stdout.on('data',chunk=>{output+=String(chunk);const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});server.once('exit',()=>{clearTimeout(timer);reject(Error('Short Settings fixture exited'));});});
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 for(const width of [1365,390])for(const height of [240,300]){
  const page=await browser.newPage({viewport:{width,height},colorScheme:width===1365?'light':'dark'});page.setDefaultTimeout(5000);
  try{
   const writes=await installSyntheticReads(page,origin);
   await page.goto(origin+'/personal?page=tasks',{waitUntil:'domcontentloaded',timeout:55_000});await readyHeading(page,'待办');await addSyntheticFooter(page);
   if(width===390)await page.getByRole('button',{name:'打开导航',exact:true}).click();
   await page.getByRole('button',{name:'设置',exact:true}).click();
   const settings=page.locator('[data-settings-page]');await expect(settings).toBeVisible();
   await expect(page).toHaveURL(origin+'/personal?page=settings&panel=general');
   const categories=page.getByRole('navigation',{name:'设置分类',exact:true});
   await categories.getByRole('button',{name:'安全与密码',exact:true}).click();
   for(const control of [settings.getByRole('textbox',{name:'本人账号',exact:true}),settings.getByRole('button',{name:'保存密码',exact:true})]){
    await control.scrollIntoViewIfNeeded();await expectAboveFooter(page,control);
    assert.equal(await control.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'short Settings security control receives pointer input');
   }
   await categories.getByRole('button',{name:'通用',exact:true}).click();
   const logout=page.getByRole('button',{name:'退出登录',exact:true});await logout.scrollIntoViewIfNeeded();await expectAboveFooter(page,logout);
   assert.equal(await logout.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'short Settings logout receives pointer input');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight===innerHeight&&document.documentElement.scrollWidth===document.documentElement.clientWidth),true,'short Settings scroll stays inside the document');
   for(let step=0;step<3;step++)await page.getByRole('button',{name:'后退',exact:true}).click();
   await readyHeading(page,'待办');await expect(page).toHaveURL(origin+'/personal?page=tasks');
   assert.equal(writes(),0,'short Settings browsing and history never mutate records');
  }finally{await page.close();}
 }
});

test('OPT-IN standalone settings preserves drafts/history and bounded task viewport geometry',{
 skip:process.env.RUN_SETTINGS_BROWSER_TESTS!=='1'&&'Requires native Chrome and disposable synthetic Next.js fixture',timeout:240_000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-settings-browser-')),server=await fixture(root),stopped=once(server,'exit');
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await new Promise<string>((accept,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('fixture start timeout')),30000);server.stdout.on('data',chunk=>{text+=String(chunk);const match=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});server.once('exit',()=>reject(Error('fixture exited')));});
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 await mkdir(join(source,'.review-results'),{recursive:true});
 for(const width of [1365,390]){
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:width===390?'dark':'light'});let writes=0,personalReads=0;
  if(width===1365)await page.addInitScript(()=>Object.defineProperty(window,'navigation',{configurable:true,value:undefined}));
  await page.route('**/*',async route=>{
   const r=route.request(),u=new URL(r.url());if(u.origin!==origin)return route.abort();
   if(!['GET','HEAD'].includes(r.method())){writes++;return route.fulfill({status:405});}
   if(u.pathname.startsWith('/api/platform/personal/'))personalReads++;
   if(u.pathname.endsWith('/personal/status'))return route.fulfill({json:{scope:'personal-manual-candidate',ownerId:'synthetic-owner',spaceId:'synthetic-space',storageVerified:true,writable:true,allowedTypes:['todo','journal','domain','project','topic']}});
   if(u.pathname.endsWith('/personal/availability'))return route.fulfill({json:{configured:true,loginAllowed:true,transport:'ssh-loopback',origin}});
   if(u.pathname.endsWith('/personal/overview'))return route.fulfill({json:{scope:'full-current-snapshot',total:items.length,truncated:false,items,today:u.searchParams.get('today'),observedAt:'2030-11-02T00:00:00Z'}});
   return route.continue();
  });
  await page.goto(origin+'/personal?page=tasks');await expect(page.locator('[data-task-grid="reui"]')).toBeVisible();
  await expect(page.getByRole('heading',{name:'待办',exact:true,level:1})).toBeVisible();
  const nav=async()=>{if(width<850)await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();};
  await page.getByRole('textbox',{name:'搜索待办',exact:true}).fill('合成');
  const viewport=page.locator('[data-task-grid="reui"] [data-slot="data-grid-table-viewport"]');
  const gridBox=await viewport.boundingBox();assert.ok(gridBox&&gridBox.height>150&&gridBox.y+gridBox.height<=900,'remaining-height grid viewport');
  const toolbar=page.locator('.lo-task-toolbar'),before=await toolbar.boundingBox();
  await viewport.evaluate(e=>e.scrollTop=600);await page.waitForTimeout(100);
  assert.deepEqual(await toolbar.boundingBox(),before,'toolbar must remain fixed');
  const header=viewport.locator('thead');const headerY=(await header.boundingBox())!.y;
  await viewport.evaluate(e=>e.scrollTop=900);await page.waitForTimeout(100);assert.equal((await header.boundingBox())!.y,headerY,'native header must stay fixed');
  const reads=personalReads;
  await nav();const settings=page.locator('#personal-main'),settingsPage=page.locator('[data-settings-page]');await expect(settingsPage).toBeVisible();
  await expect(page.getByRole('dialog',{name:'设置',exact:true})).toHaveCount(0);await expect(page.locator('[data-task-grid]')).toHaveCount(0);
  await settings.getByRole('button',{name:'安全与密码',exact:true}).click();await expect(settings.getByRole('textbox',{name:'本人账号'})).toBeVisible();
  await expect(page).toHaveURL(origin+'/personal?page=settings&panel=security');
  await expect(settings.getByRole('button',{name:'安全与密码',exact:true})).toHaveAttribute('aria-current','page');
  await page.screenshot({path:join(source,`.review-results/settings-security-${width}.png`),animations:'disabled'});
  await settings.getByLabel('原密码',{exact:true}).fill('synthetic-refused-draft');const refuse=(d:import('@playwright/test').Dialog)=>void d.dismiss();page.on('dialog',refuse);
  await page.getByRole('button',{name:'后退',exact:true}).click();await expect(page).toHaveURL(origin+'/personal?page=settings&panel=security');await expect(settings.getByLabel('原密码',{exact:true})).toHaveValue('synthetic-refused-draft');page.off('dialog',refuse);await settings.getByLabel('原密码',{exact:true}).fill('');
  await page.getByRole('button',{name:'后退',exact:true}).click();await expect(page).toHaveURL(origin+'/personal?page=settings&panel=general');
  await page.getByRole('button',{name:'后退',exact:true}).click();await expect(settingsPage).toHaveCount(0);await expect(page.getByRole('textbox',{name:'搜索待办',exact:true})).toHaveValue('');
  await page.getByRole('button',{name:'前进',exact:true}).click();await expect(settingsPage).toBeVisible();await page.getByRole('button',{name:'前进',exact:true}).click();await expect(settings.getByLabel('原密码',{exact:true})).toBeVisible();
  await settings.getByLabel('原密码',{exact:true}).fill('synthetic-unsaved-password');let confirmations=0;const accept=(d:import('@playwright/test').Dialog)=>{confirmations++;void d.accept();};page.on('dialog',accept);
  if(width<850)await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.getByRole('button',{name:'事项',exact:true}).click();await expect(settingsPage).toHaveCount(0);page.off('dialog',accept);assert.equal(confirmations,1,'one page departure confirms unsaved password once');
  assert.equal(personalReads,reads,'client page transitions retain the verified data controller');
  await viewport.evaluate(e=>e.scrollTop=0);await page.getByRole('gridcell',{name:'合成待办甲',exact:true}).dblclick();
  const input=page.getByRole('textbox',{name:'编辑待办',exact:true});await input.fill('未保存合成草稿');
  await confirmDiscard(page,false,nav);await expect(settingsPage).toHaveCount(0);
  if(width<850)await page.keyboard.press('Escape');
  await expect(input).toHaveValue('未保存合成草稿');assert.equal(writes,0,'refused settings departure never blur-submits or discards the draft');
  await page.screenshot({path:join(source,`.review-results/settings-background-${width}.png`)});
  await confirmDiscard(page,true,async()=>{await page.getByRole('button',{name:'LifeOS 总览',exact:true}).click();});
  await page.goto(origin+'/personal?page=settings');await expect(settingsPage).toBeVisible();await expect(page).toHaveURL(origin+'/personal?page=settings&panel=general');
  await page.goto(origin+'/personal?page=projects&modal=settings&panel=security');await expect(settingsPage).toBeVisible();await expect(page).toHaveURL(origin+'/personal?page=settings&panel=security');await page.reload();
  if(width===390){
   await page.setViewportSize({width,height:400});
   const panel=settings.locator('.lo-settings-panel'),save=settings.getByRole('button',{name:'保存密码',exact:true});
   await expect(save).toBeEnabled();await expect.poll(()=>panel.evaluate(e=>e.clientHeight>60&&e.scrollHeight>e.clientHeight)).toBe(true);
   for(const control of [settings.getByRole('textbox',{name:'本人账号',exact:true}),save]){await control.scrollIntoViewIfNeeded();await expect(control).toBeInViewport({ratio:0.75});}
   await page.setViewportSize({width,height:900});
  }
  for(const view of ['列表','看板']){await page.goto(origin+'/personal?page=tasks');await page.getByRole('button',{name:view,exact:true}).click();const target=page.locator(view==='列表'?'.lo-list-rows':'.lo-board-cards').first(),columnHeader=page.locator(view==='列表'?'.lo-list-columns':'.lo-board-column > h2').first(),top=await columnHeader.boundingBox();assert.ok(await target.evaluate(e=>e.scrollHeight>e.clientHeight));await target.evaluate(e=>e.scrollTop=900);assert.deepEqual(await columnHeader.boundingBox(),top);assert.equal(await page.locator('#personal-main').evaluate(e=>e.scrollTop),0);}
  await page.goto(origin+'/personal?page=requirements');await page.getByLabel('搜索需求',{exact:true}).fill('LO-TASK-001');await page.getByRole('button',{name:'看板视图',exact:true}).click();
  await nav();await expect(settingsPage).toBeVisible();await page.getByRole('button',{name:'后退',exact:true}).click();await expect(settingsPage).toHaveCount(0);await expect(page.getByLabel('搜索需求',{exact:true})).toHaveValue('');await expect(page.getByRole('button',{name:'表格视图',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-requirement-id="LO-TASK-001"]')).toHaveCount(1);
  await page.close();
 }
 for(const [height,expanded] of [[400,false],[568,true],[900,true]] as const){
  for(const view of ['表格','列表','看板'])await t.test(`390x${height} ${view} ${expanded?'expanded filters':'collapsed filters'} exposes first and last task above footer`,async()=>{
   const page=await browser.newPage({viewport:{width:390,height},colorScheme:'dark'});page.setDefaultTimeout(8000);
   try{
    const writes=await installSyntheticReads(page,origin);
    await page.goto(origin+'/personal?page=tasks');await expect(page.locator('[data-task-grid="reui"]')).toBeVisible();await addSyntheticFooter(page);
    await page.getByRole('button',{name:view,exact:true}).click();
    if(expanded){
     await page.getByRole('button',{name:'筛选',exact:true}).click();
     for(const control of await page.locator('#lo-filters select,#lo-filters button').all()){
      await control.scrollIntoViewIfNeeded();await expectAboveFooter(page,control);await control.focus();await expect(control).toBeFocused();
     }
    }
    const viewport=page.locator(view==='表格'?'[data-task-grid="reui"] [data-slot="data-grid-table-viewport"]':view==='列表'?'.lo-list-rows':'.lo-board-cards').first();
    await expect.poll(async()=>{const box=await viewport.boundingBox(),head=view==='表格'?await viewport.locator('thead').boundingBox():null;return !!box&&box.height-(head?.height??0)>=96;},{message:'at least 96px usable record viewport'}).toBe(true);
    await page.locator('.lo-workspace-view').scrollIntoViewIfNeeded();
    for(const [title,end] of [['合成待办甲',false],['合成长待办74',true]] as const){
     await viewport.evaluate((e,end)=>e.scrollTop=end?e.scrollHeight:0,end);
     const trigger=page.getByRole('button',{name:(view==='表格'?'打开任务：':'展开详情：')+title,exact:true});
     await expect(trigger).toBeAttached();await trigger.scrollIntoViewIfNeeded();await expectAboveFooter(page,trigger);
     await trigger.click();const detail=page.getByRole('dialog',{name:'待办详情',exact:true});await expect(detail.getByLabel('标题',{exact:true})).toHaveValue(title);await page.keyboard.press('Escape');await expect(detail).toHaveCount(0);
    }
    await page.screenshot({path:join(source,`.review-results/matters-short-${height}-${view}.png`)});
    assert.equal(writes(),0,'short-view browsing never writes records');
   }finally{await page.close();}
  });
  if(height>600)continue;
  for(const [kind,label] of [['projects','项目'],['areas','领域']] as const)await t.test(`390x${height} ${label} exposes first and last category above footer`,async()=>{
   const page=await browser.newPage({viewport:{width:390,height},colorScheme:'dark'});page.setDefaultTimeout(8000);
   try{
    const writes=await installSyntheticReads(page,origin);
    for(const [title,end] of [['合成'+label+'甲',false],['合成长'+label+'74',true]] as const){
     await page.goto(origin+'/personal?page='+kind);const grid=page.locator('[data-category-grid="reui"]');await expect(grid).toBeVisible();await addSyntheticFooter(page);
     const viewport=grid.locator('[data-slot="data-grid-table-viewport"]');
     await expect.poll(async()=>{const box=await viewport.boundingBox(),head=await viewport.locator('thead').boundingBox();return !!box&&!!head&&box.height-head.height>=96;},{message:'category records need usable viewport'}).toBe(true);
     await grid.scrollIntoViewIfNeeded();await viewport.evaluate((e,end)=>e.scrollTop=end?e.scrollHeight:0,end);
     const trigger=grid.getByRole('button',{name:'查看待办：'+title,exact:true});await expect(trigger).toBeAttached();await trigger.scrollIntoViewIfNeeded();await expectAboveFooter(page,trigger);await trigger.click();
     await expect(page.getByRole('heading',{name:'待办',exact:true,level:1})).toBeVisible();await expect(page.locator('.lo-active-filter')).toContainText(title);
    }
    assert.equal(writes(),0);
   }finally{await page.close();}
  });
 }

});

test('OPT-IN overview draft survives rejected Settings and matters page departures',{
 skip:process.env.RUN_SETTINGS_BROWSER_TESTS!=='1'&&'Requires native Chrome and disposable synthetic Next fixture',timeout:120_000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-overview-settings-')),server=await fixture(root),stopped=once(server,'exit');
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await new Promise<string>((accept,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Overview fixture startup timeout')),30_000);server.stdout.on('data',chunk=>{output+=String(chunk);const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});server.once('exit',()=>{clearTimeout(timer);reject(Error('Overview fixture exited'));});});
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1365,height:900},colorScheme:'light'});t.after(()=>page.close());
 const writes=await installSyntheticReads(page,origin);
 await page.goto(origin+'/personal',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'编辑标题：合成待办甲',exact:true}).dblclick();
 const input=page.getByRole('textbox',{name:'编辑待办',exact:true});await expect(input).toBeFocused();
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('form')).toHaveCount(0);
 await input.fill('合成未保存总览草稿');const originalInput=await input.elementHandle();
 await confirmDiscard(page,false,async()=>{await page.getByRole('button',{name:'设置',exact:true}).click();});
 await expect(page.locator('[data-settings-page]')).toHaveCount(0);await expect(page).toHaveURL(origin+'/personal');
 await expect(input).toHaveValue('合成未保存总览草稿');assert.equal(await originalInput!.evaluate(node=>node.isConnected),true,'refused settings departure preserves the same overview input');
 assert.equal(writes(),0);
 await confirmDiscard(page,false,async()=>{await page.getByRole('button',{name:'事项',exact:true}).click();});
 await expect(page).toHaveURL(origin+'/personal');await expect(input).toHaveValue('合成未保存总览草稿');assert.equal(writes(),0,'refused page departure does not submit or discard');
});

test('OPT-IN settings category returns to the requested panel after requirement browsing',{
 skip:process.env.RUN_SETTINGS_BROWSER_TESTS!=='1'&&'Requires native Chrome and disposable synthetic Next fixture',timeout:90_000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-settings-return-')),server=await fixture(root),stopped=once(server,'exit');
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await new Promise<string>((accept,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('settings return fixture timeout')),30_000);server.stdout.on('data',chunk=>{output+=String(chunk);const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});server.once('exit',()=>{clearTimeout(timer);reject(Error('settings return fixture exited'));});});
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1365,height:900}});t.after(()=>page.close());
 const writes=await installSyntheticReads(page,origin);
 await page.goto(origin+'/personal?page=settings&panel=security');await expect(page.getByLabel('原密码',{exact:true})).toBeVisible();
 const categories=page.getByRole('navigation',{name:'设置分类',exact:true});
 await categories.getByRole('button',{name:'需求池',exact:true}).click();await expect(page.getByLabel('搜索需求',{exact:true})).toBeVisible();
 await categories.getByRole('button',{name:'安全与密码',exact:true}).click();
 await expect(page).toHaveURL(origin+'/personal?page=settings&panel=security');await expect(page.getByLabel('原密码',{exact:true})).toBeVisible();
 assert.equal(writes(),0);
});


test('OPT-IN feedback dirty and uncertain state guards settings links and document back/forward',{
 skip:process.env.RUN_SETTINGS_BROWSER_TESTS!=='1'&&'Requires native Chrome and disposable synthetic Next fixture',timeout:120_000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-settings-feedback-')),server=await fixture(root),stopped=once(server,'exit');
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await new Promise<string>((accept,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('feedback fixture timeout')),30_000);server.stdout.on('data',chunk=>{output+=String(chunk);const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});server.once('exit',()=>{clearTimeout(timer);reject(Error('feedback fixture exited'));});});
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1365,height:900}});t.after(()=>page.close());let writes=0,authorized=true;
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==origin)return route.abort();
  if(!['GET','HEAD'].includes(request.method())){writes++;return route.abort();}
  if(url.pathname==='/api/platform/status')return route.fulfill(authorized?{json:{scope:'isolated-synthetic-review',personalAccountReady:false,personalDataAuthorized:false,storage:{type:'postgresql',schemaVersion:2,restrictedRoleVerified:true},features:{training:{readable:true,writesEnabled:false,activationRequiresAcceptance:true}},extensions:{calendar:{configured:false,restrictedRoleVerified:false},chat:{configured:false,restrictedRoleVerified:false}},ai:{configured:false,settingsPersistable:false,secretStoreReady:false,externalCallsEnabled:false}}}:{status:403,json:{error:{message:'Synthetic revoked'}}});
  if(url.pathname.endsWith('/personal/status'))return route.fulfill(authorized?{json:{scope:'personal-manual-candidate',ownerId:'synthetic-owner',spaceId:'synthetic-space',storageVerified:true,writable:true,allowedTypes:['todo','journal','domain','project','topic'],requirementsEnabled:true,requirementSupportEnabled:true}}:{status:403,json:{error:{message:'Synthetic revoked'}}});
  if(url.pathname.endsWith('/personal/availability'))return route.fulfill({json:{configured:true,loginAllowed:true,transport:'ssh-loopback',origin}});
  if(url.pathname.endsWith('/personal/overview'))return route.fulfill({json:{scope:'full-current-snapshot',total:items.length,truncated:false,items,today:url.searchParams.get('today'),observedAt:'2030-11-02T00:00:00Z'}});
  if(url.pathname.endsWith('/requirements/snapshot'))return route.fulfill({json:{scope:'full-current-requirements-snapshot',total:0,truncated:false,items:[],baseline:requirements()}});
  if(url.pathname.endsWith('/requirement-support/feedback/snapshot'))return route.fulfill({json:{scope:'full-current-feedback-snapshot',total:0,truncated:false,items:[]}});
  if(url.pathname.endsWith('/requirement-support/updates'))return route.fulfill({json:{}});
  return route.continue();
 });
 let feedbackPhase='start';
 const confirmFeedback=async(accept:boolean,action:()=>Promise<unknown>,destination?:string)=>{
  let count=0;let received!:()=>void;const seen=new Promise<void>(resolve=>{received=resolve;});
  const handler=async(dialog:import('@playwright/test').Dialog)=>{count++;if(dialog.type()!=='confirm'){await dialog.dismiss();throw Error('Feedback guard '+feedbackPhase+' expected confirm but got '+dialog.type());}assert.equal(dialog.type(),'confirm');assert.equal(dialog.message(),'反馈内容尚未保存，确定放弃并离开？');if(accept&&count===1)await dialog.accept();else await dialog.dismiss();received();};
  page.on('dialog',handler);
  try{await Promise.all([action(),seen]);if(destination)await expect(page).toHaveURL(destination);assert.equal(count,1,'one explicit feedback departure has one confirmation');}finally{page.off('dialog',handler);}
 };
 await page.goto(origin+'/personal?page=settings&panel=general',{waitUntil:'networkidle'});
 const categories=page.getByRole('navigation',{name:'设置分类',exact:true});
 await categories.getByRole('link',{name:'反馈 Inbox',exact:true}).click();
 const original=page.getByRole('textbox',{name:'原文',exact:true});await expect(original).toBeEnabled();
 await categories.getByRole('link',{name:'更新记录',exact:true}).click();await expect(page).toHaveURL(origin+'/personal/requirements/updates');
 await page.goBack({waitUntil:'networkidle'});await expect(original).toBeEnabled();
 // Exercise the privacy recheck required when a document returns from bfcache.
 const privacyRead=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/platform/status');
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
 assert.equal((await privacyRead).status(),200,'restored synthetic owner passes the fresh platform privacy check');
 await expect(page).toHaveURL(origin+'/personal/requirements/feedback');await expect(original).toBeEnabled();await original.fill('Synthetic unsaved feedback');
 feedbackPhase='link-refused';await confirmFeedback(false,()=>categories.getByRole('link',{name:'更新记录',exact:true}).click());await expect(original).toHaveValue('Synthetic unsaved feedback');
 for(const direction of ['后退','前进']){feedbackPhase='button-'+direction;await confirmFeedback(false,()=>page.getByRole('button',{name:direction,exact:true}).click());}
 for(const direction of ['back','forward'] as const)await confirmDiscard(page,false,async signal=>{await(direction==='back'?page.goBack({waitUntil:'domcontentloaded',signal}):page.goForward({waitUntil:'domcontentloaded',signal}));},5000,'beforeunload');
 await expect(page).toHaveURL(origin+'/personal/requirements/feedback');await expect(original).toHaveValue('Synthetic unsaved feedback');assert.equal(writes,0);
 feedbackPhase='link-accepted';await confirmFeedback(true,()=>categories.getByRole('link',{name:'更新记录',exact:true}).click(),origin+'/personal/requirements/updates');
 await page.goBack({waitUntil:'networkidle'});await expect(original).toBeEnabled();await original.fill('Synthetic pending feedback');
 await page.getByRole('button',{name:'保存反馈',exact:true}).click();await expect(page.getByRole('button',{name:'恢复原请求并回读',exact:true})).toBeVisible();assert.equal(writes,1);
 const checkPending=async(name:string)=>{const dialog=page.waitForEvent('dialog'),action=page.getByRole('button',{name,exact:true}).click({noWaitAfter:true});const alert=await dialog;assert.equal(alert.type(),'alert');assert.match(alert.message(),/保存结果尚未确认/);await alert.accept();await action;};
 await checkPending('设置');
 await expect(page).toHaveURL(origin+'/personal/requirements/feedback');
 for(const direction of ['后退','前进'])await checkPending(direction);
 for(const direction of ['back','forward'] as const)await confirmDiscard(page,false,async signal=>{await(direction==='back'?page.goBack({waitUntil:'domcontentloaded',signal}):page.goForward({waitUntil:'domcontentloaded',signal}));},5000,'beforeunload');
 authorized=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(original).toHaveCount(0);await expect(categories.getByRole('link',{name:'反馈 Inbox',exact:true})).toHaveCount(0);assert.equal(writes,1);
});
