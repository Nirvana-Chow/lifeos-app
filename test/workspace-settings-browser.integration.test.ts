import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp, mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {on, once} from 'node:events';
import test from 'node:test';
import {chromium, expect,type Page} from '@playwright/test';
import {readyHeading} from './helpers/private-business-browser-fixture.ts';
import {confirmDiscard} from './helpers/personal-workspace-browser-fixture.ts';
import {requirements} from '../src/platform/requirements.ts';
import {requirementBinding} from '../src/requirements-candidate/service.ts';
import {exerciseManagedCallback} from './helpers/managed-callback-browser.ts';

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
  if(request.method()==='POST'&&url.pathname==='/__nextjs_original-stack-frames')return route.continue();
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

test('OPT-IN injected filing footer follows workspace content and preserves its original link',{
 skip:process.env.RUN_SETTINGS_BROWSER_TESTS!=='1'&&'Requires Chromium and the disposable synthetic workspace',timeout:120_000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-filing-flow-')),server=await fixture(root),stopped=once(server,'exit');
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await prepareSettingsFixture(server,'/personal?page=tasks');
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
 t.after(()=>browser.close());
 for(const width of [1365,390]){
  const page=await browser.newPage({viewport:{width,height:900}});
  try{
   await installSyntheticReads(page,origin);
   let task=items[5];
   const statuses:string[]=[];
   await page.route('**/api/platform/personal/todo/'+task.id,async route=>{
    const request=route.request();
    if(request.method()==='GET')return route.fulfill({json:{entry:task}});
    if(request.method()!=='PATCH')return route.fulfill({status:405});
    const {expectedRevision,fields}=request.postDataJSON();
    assert.equal(expectedRevision,task.revision);
    statuses.push(fields.status);
    task={...task,revision:task.revision+1,draft:{...task.draft,...fields}};
    return route.fulfill({json:{entry:task,duplicate:false}});
   });
   await page.goto(origin+'/personal?page=tasks');
   await readyHeading(page,'待办');
   const original=await page.evaluateHandle(()=>{
    const footer=document.createElement('footer');
    footer.className='lifeos-filing-footer';
    footer.dataset.syntheticFilingProbe='';
    const link=document.createElement('a');
    link.href='#synthetic-filing';
    link.target='_blank';
    link.rel='noopener noreferrer';
    link.textContent='合成备案页脚';
    footer.append(link);
    document.body.append(footer);
    return {footer,link};
   });
   const main=page.locator('#personal-main');
   const shell=page.locator('.lo-shell');
   const menu=page.getByRole('button',{name:'打开导航',exact:true});
   const alignContent=async()=>{
    if(width===390&&!await menu.isVisible())await shell.evaluate(node=>node.scrollLeft=node.scrollWidth);
   };
   const footer=main.locator('.lifeos-filing-footer');
   const link=footer.getByRole('link',{name:'合成备案页脚'});
   await expect(footer).toBeAttached();
   await expect(page.locator('.lifeos-filing-footer')).toHaveCount(1);
   await expect(footer.getByRole('link')).toHaveCount(1);
   await expect(link).toHaveAttribute('href','#synthetic-filing');
   await expect(link).toHaveAttribute('target','_blank');
   await expect(link).toHaveAttribute('rel','noopener noreferrer');
   assert.ok(await original.evaluate(({footer,link})=>footer===document.querySelector('.lo-filing-slot > footer')&&link===footer.firstElementChild));
   await expect(footer).not.toBeInViewport();
   const grid=page.locator('[data-task-grid] [data-slot="data-grid-table-viewport"]');
   await grid.evaluate(node=>node.scrollTop=node.scrollHeight);
   const last=grid.getByRole('button',{name:'打开任务：合成长待办74',exact:true});
   await last.scrollIntoViewIfNeeded();
   await expect(last).toBeInViewport();
   await expect(footer).not.toBeInViewport();
   await page.getByRole('heading',{name:'待办',exact:true,level:1}).hover();
   await page.mouse.wheel(0,250);
   await alignContent();
   await expect(link).toBeInViewport({ratio:1});
   await main.evaluate(node=>node.scrollTop=0);
   await page.getByRole('button',{name:'列表',exact:true}).click();
   await page.getByRole('button',{name:'完成：合成待办乙',exact:true}).click();
   const undo=page.getByRole('button',{name:'撤销',exact:true});
   await expect(undo).toBeVisible();
   await main.evaluate(node=>node.scrollTop=node.scrollHeight);
   await alignContent();
   await expect(link).toBeInViewport({ratio:1});
   await expectAboveFooter(page,undo);
   await undo.press('Enter');
   await expect.poll(()=>statuses).toEqual(['done','open']);
   if(await menu.isVisible()){
    await menu.press('Enter');
    const drawer=page.locator('.lo-mobile-sidebar');
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(menu).toBeFocused();
    await menu.click();
   }
   await page.getByRole('button',{name:'设置',exact:true}).click();
   const logout=page.locator('header').getByRole('button',{name:'退出登录',exact:true});
   await expect(logout).toBeVisible();
   await alignContent();
   await expect(link).toBeInViewport({ratio:1});
   await main.getByRole('button',{name:'返回总览',exact:true}).focus();
   for(let step=0;step<16&&!await link.evaluate(node=>document.activeElement===node);step++){
    await page.keyboard.press('Tab');
   }
   await expect(link).toBeFocused();
   await page.getByRole('button',{name:'LifeOS 总览',exact:true}).click();
   await expect(page.getByRole('heading',{name:'总览',exact:true,level:1})).toBeVisible();
   await expect.poll(()=>main.evaluate(node=>{
    const slot=node.lastElementChild;
    return slot?.matches('.lo-filing-slot')&&getComputedStyle(slot).position!=='fixed';
   })).toBe(true);
   await main.evaluate(node=>node.scrollTop=node.scrollHeight);
   await alignContent();
   await expect(link).toBeInViewport({ratio:1});
  }finally{await page.close();}
 }
});
async function expectAboveFooter(page:Page,control:import('@playwright/test').Locator){
 await expect(control).toBeInViewport({ratio:0.75});
 await expect.poll(async()=>{
  const box=await control.boundingBox(),footer=await page.locator('.lifeos-filing-footer').boundingBox();
  return !!box&&!!footer&&box.y>=0&&box.y+box.height<=footer.y+1;
 }).toBe(true);
}
async function fixture(root:string,managedCallback=false,moduleNavigation=false){
 await mkdir(join(root,'app/personal'),{recursive:true});
 await mkdir(join(root,'app/login'),{recursive:true});
 await writeFile(join(root,'app/login/page.tsx'),'export default function FixtureLogin(){return <h1>合成登录页</h1>}');
 await Promise.all([
  ...['layout.tsx','globals.css','theme.css'].map(file=>cp(join(source,'app',file),join(root,'app',file))),
  cp(join(source,'app/personal/page.tsx'),join(root,'app/personal/page.tsx')),
  cp(join(source,'app/personal/requirements'),join(root,'app/personal/requirements'),{recursive:true}),
  cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  cp(join(source,'src'),join(root,'src'),{recursive:true}),
  symlink(join(source,'node_modules'),join(root,'node_modules')),
  symlink(join(source,'components'),join(root,'components')),
 ]);
 await writeFile(join(root,'src/platform/runtime.ts'),'export const readPlatformMfaState=async()=>({kind:"ready"}); export const readPlatformPagePrincipal=async()=>({id:"synthetic-owner"}); export const readPlatformPasswordCapability=async()=>true;\n');
 if(moduleNavigation)await Promise.all(['journal','schedule','media','cooking'].map(name=>
  cp(join(source,'app/personal',name),join(root,'app/personal',name),{recursive:true})));
 if(managedCallback){
  await cp(join(source,'app/account/mcp'),join(root,'app/account/mcp'),{recursive:true});
  await writeFile(join(root,'src/business-mcp-oauth/managed-client-runtime.ts'),'import {readFile} from "node:fs/promises"; export async function handleManagedClientRequest(){return new Response(await readFile("managed-setup.json","utf8"),{headers:{"content-type":"application/json"}});}');
 }
 await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
 const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],
  {cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',LIFEOS_BUSINESS_MCP_OAUTH:'business-mcp-oauth-v1',...(moduleNavigation?{LIFEOS_AGENT_KEY_MANAGEMENT:'1'}:{})},stdio:['ignore','pipe','pipe']});
 return server;
}

async function prepareSettingsFixture(server:Awaited<ReturnType<typeof fixture>>,firstPage:string) {
 const started=performance.now();
 const stopped=new AbortController();
 const onExit=(code:number|null,signal:NodeJS.Signals|null)=>
  stopped.abort(new Error('Next exited (code '+code+', signal '+signal+')'));
 const onError=(error:Error)=>stopped.abort(error);
 server.once('exit',onExit);
 server.once('error',onError);
 let startupOutput='',diagnostics='',origin:string|undefined,phase='listener startup';
 const capture=(chunk:Buffer)=>{diagnostics=(diagnostics+chunk.toString()).slice(-4000);};
 server.stdout.on('data',capture);
 server.stderr.on('data',capture);
 try{
  const startupSignal=AbortSignal.any([AbortSignal.timeout(30_000),stopped.signal]);
  for await(const [chunk] of on(server.stdout,'data',{signal:startupSignal})){
   startupOutput=(startupOutput+String(chunk)).slice(-4000);
   const address=startupOutput.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
   if(address&&/Ready in\b/.test(startupOutput)){origin=address;break;}
  }
  if(!origin)throw new Error('Missing the ready loopback listener');
  phase='first-page compilation and response';
  const requestStarted=performance.now();
  // Drain the actual route's HTML before opening a browser. Chrome still
  // makes its own timed navigation in a fresh context.
  const signal=AbortSignal.any([AbortSignal.timeout(55_000),stopped.signal]);
  const response=await fetch(new URL(firstPage,origin),{redirect:'manual',signal});
  if(response.status!==200||!response.headers.get('content-type')?.startsWith('text/html')){
   await response.body?.cancel();
   throw new Error('Expected HTTP 200 HTML, received HTTP '+response.status);
  }
  const html=await response.text();
  if(!html.includes('id="personal-main"')||!html.includes('</html>')){
   throw new Error('The complete personal workspace document was not rendered');
  }
  signal.throwIfAborted();
  console.log('SETTINGS_FIXTURE_READY '+JSON.stringify({
   firstPage,startupMs:Math.round(requestStarted-started),pageMs:Math.round(performance.now()-requestStarted),
  }));
  return origin;
 }catch(error){
  const elapsed=Math.round(performance.now()-started);
  throw new Error('Settings fixture readiness failed during '+phase+' for '+firstPage+
   ' after '+elapsed+'ms: '+String(error)+'\n'+diagnostics.trim(),{cause:error});
 }finally{
  server.off('exit',onExit);
  server.off('error',onError);
  server.stdout.off('data',capture);
  server.stderr.off('data',capture);
  server.stdout.resume();
  server.stderr.resume();
 }
}

test('OPT-IN desktop modules and both Settings entry points follow the existing owner routes',{
 skip:process.env.RUN_SETTINGS_BROWSER_TESTS!=='1'&&'Requires Chromium and a synthetic Next fixture',timeout:150_000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-modules-')),server=await fixture(root,false,true),stopped=once(server,'exit');
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await prepareSettingsFixture(server,'/personal');
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1365,height:900}});t.after(()=>page.close());
 const writes=await installSyntheticReads(page,origin);
 await page.route(origin+'/api/platform/personal/status',route=>route.fulfill({json:{
  scope:'personal-manual-candidate',ownerId:'synthetic-owner',spaceId:'synthetic-space',storageVerified:true,writable:true,
  allowedTypes:['todo','journal','domain','project','topic'],calendarEnabled:true,healthEnabled:true,mediaEnabled:true,
  peopleEnabled:true,financeEnabled:true,portfolioEnabled:true,careerEnabled:true,storageReviewEnabled:true,
 }}));
 await page.route(origin+'/api/platform/status',route=>route.fulfill({json:{}}));
 await page.route(origin+'/api/platform/auth/device-sessions',route=>route.fulfill({json:{sessions:[],truncated:false}}));
 const header=page.locator('header.lo-header'),sidebar=page.locator('aside.lo-sidebar');
 const modules=header.getByRole('navigation',{name:'切换模块'}),nav=sidebar.getByRole('navigation',{name:'主导航'});
 const breadcrumb=page.getByRole('navigation',{name:'浏览位置'});
 const logout=header.getByRole('button',{name:'退出登录'});
 const expected=[
  ['日常',[['总览'],['待办'],['日程','/personal/schedule'],['记录','/personal/journal'],['搜索本人记录','/personal/search']]],
  ['身体基础',[['健康','/personal/health']]],
  ['兴趣学习',[['书影音','/personal/media'],['做饭','/personal/cooking']]],
  ['生活与关系',[['人物','/personal/people']]],
  ['财务',[['财务','/personal/finance'],['账户资产投资','/personal/portfolio']]],
  ['职业成长',[['职业与简历','/personal/career']]],
  ['项目',[['项目'],['领域']]],
 ] as const;
 await page.goto(origin+'/personal',{waitUntil:'load'});
 await expect(modules.getByRole('button')).toHaveText(expected.map(([name])=>name));
 const mainNav=nav.getByRole('button').or(nav.getByRole('link'));
 for(const [module,items] of expected){
  const tab=modules.getByRole('button',{name:module,exact:true});
  await tab.focus();await tab.press('Enter');
  await expect(tab).toHaveAttribute('aria-pressed','true');
  await expect(mainNav).toHaveText(items.map(([label])=>label));
  for(const [label,href] of items)if(href)await expect(nav.getByRole('link',{name:label,exact:true})).toHaveAttribute('href',href);
 }
 const learning=modules.getByRole('button',{name:'兴趣学习',exact:true});
 for(const [label,path] of [['书影音','/personal/media'],['做饭','/personal/cooking']] as const){
  await learning.click();
  const response=await fetch(origin+path,{redirect:'manual',signal:AbortSignal.timeout(45_000)});
  assert.equal(response.status,200);await response.text();
  await nav.getByRole('link',{name:label,exact:true}).click();
  await expect(page).toHaveURL(origin+path);
  await expect(page.getByRole('heading',{name:label,exact:true,level:1})).toBeVisible();
  await expect(learning).toHaveAttribute('aria-pressed','true');
  await expect(nav.getByRole('link',{name:label,exact:true})).toHaveAttribute('aria-current','page');
 }
 await header.getByRole('button',{name:'LifeOS 总览',exact:true}).click();
 await expect(page).toHaveURL(origin+'/personal');
 await modules.getByRole('button',{name:'项目',exact:true}).click();
 await nav.getByRole('button',{name:'项目',exact:true}).click();
 await expect(page).toHaveURL(origin+'/personal?page=projects');
 await expect(modules.getByRole('button',{name:'项目',exact:true})).toHaveAttribute('aria-pressed','true');
 await modules.getByRole('button',{name:'日常',exact:true}).click();
 await expect(logout).toBeInViewport({ratio:1});
 await expect(breadcrumb.getByText('标签',{exact:true})).toHaveCount(0);
 for(const [label,path] of [['记录','/personal/journal'],['日程','/personal/schedule']] as const){
  const route=await fetch(origin+path,{redirect:'manual',signal:AbortSignal.timeout(45_000)});assert.equal(route.status,200);await route.text();
  await nav.getByRole('link',{name:label,exact:true}).click();
  await expect(page).toHaveURL(origin+path);
  await expect(nav.getByRole('link',{name:label,exact:true})).toHaveAttribute('aria-current','page');
  await expect(logout).toBeInViewport({ratio:1});
  if(label==='记录')await expect(page.getByRole('link',{name:'查看每日活动'})).toHaveAttribute('href','/personal/activity');
 }
 const entry=page.getByRole('list',{name:'可用设置'});
 for(const trigger of [header.getByRole('button',{name:'打开设置'}),sidebar.getByRole('button',{name:'设置',exact:true})]){
  await trigger.click();
  await expect(page).toHaveURL(origin+'/personal?page=settings');
  await expect(entry.getByRole('button')).toHaveText(['API 密钥','安全与密码']);
  const settingsCategories=page.getByRole('navigation',{name:'设置分类',exact:true});
  await expect(settingsCategories.getByRole('button').last()).toHaveText('安全与密码');
  await expect(settingsCategories.getByRole('button',{name:'标签',exact:true})).toHaveCount(0);
  await expect(settingsCategories.getByRole('link',{name:'存储审核',exact:true})).toBeVisible();
  await expect(page.getByLabel('原密码',{exact:true})).toHaveCount(0);
  await expect(breadcrumb.getByText('标签',{exact:true})).toHaveCount(0);
  await entry.getByRole('button',{name:'安全与密码',exact:true}).click();
  await expect(page.getByLabel('原密码',{exact:true})).toBeVisible();
 }
 await page.goto(origin+'/personal?modal=settings&panel=general');
 await expect(page).toHaveURL(origin+'/personal?page=settings');await expect(entry).toBeVisible();
 await page.goto(origin+'/personal?page=projects&modal=settings&panel=api-keys');
 await expect(page).toHaveURL(origin+'/personal?page=settings&panel=api-keys');
 await expect(page.locator('[data-settings-panel="api-keys"]')).toBeVisible();
 for(const query of ['page=settings&panel=topics','modal=settings&panel=topics']){
  await page.goto(origin+'/personal?'+query);
  await expect(page).toHaveURL(origin+'/personal?page=settings&panel=topics');
  await expect(page.getByRole('region',{name:'标签',exact:true}).getByRole('textbox',{name:'搜索标签'})).toBeVisible();
 }
 await expect(breadcrumb.getByText('标签',{exact:true})).toHaveCount(0);
 if(process.env.LIFEOS_NAVIGATION_EVIDENCE_DIR){
  const folder=resolve(process.env.LIFEOS_NAVIGATION_EVIDENCE_DIR);await mkdir(folder,{recursive:true});
  await header.getByRole('button',{name:'打开设置'}).click();await expect(entry).toBeVisible();
  await page.screenshot({path:join(folder,'settings-desktop-synthetic.png'),animations:'disabled'});
  await page.goto(origin+'/personal');await expect(modules.getByRole('button')).toHaveText(expected.map(([name])=>name));
  await page.screenshot({path:join(folder,'navigation-desktop-synthetic.png'),animations:'disabled'});
 }
 assert.equal(writes(),0);
});

test('OPT-IN short Settings keeps security and logout reachable above the filing footer',{
 skip:process.env.RUN_SETTINGS_BROWSER_TESTS!=='1'&&'Requires native Chrome and disposable synthetic Next fixture',timeout:120_000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-short-settings-')),server=await fixture(root),stopped=once(server,'exit');
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await prepareSettingsFixture(server,'/personal?page=tasks');
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 for(const width of [1365,390])for(const height of [240,300]){
  const page=await browser.newPage({viewport:{width,height},hasTouch:width===390,colorScheme:width===1365?'light':'dark'});page.setDefaultTimeout(5000);
  try{
   const writes=await installSyntheticReads(page,origin);
   await page.route(origin+'/api/platform/auth/device-sessions',route=>route.request().method()==='GET'
    ?route.fulfill({json:{sessions:[],truncated:false}}):route.fallback());
   const debugRequests:string[]=[];page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))debugRequests.push(r.method()+' '+new URL(r.url()).pathname);});
   await page.goto(origin+'/personal?page=tasks',{waitUntil:'load',timeout:55_000});await readyHeading(page,'待办');await addSyntheticFooter(page);
   if(width===390)await expect(page.getByRole('button',{name:'打开导航',exact:true})).toBeHidden();
   await page.getByRole('button',{name:'设置',exact:true}).click();
   const settings=page.locator('[data-settings-page]');await expect(settings).toBeVisible();
   await expect(page).toHaveURL(origin+'/personal?page=settings');
   const location=page.getByRole('navigation',{name:'浏览位置',exact:true});
   await expect(location.locator('[aria-current="page"]')).toHaveText('设置');
   await expect(location.getByText('标签',{exact:true})).toHaveCount(0);
   const mcpLink=settings.getByRole('link',{name:'ChatGPT 连接设置',exact:true});
   await expect(mcpLink).toHaveCount(0);
   await expect(settings.getByRole('group',{name:'配色预设',exact:true})).toHaveCount(0);
   await expect(settings.getByRole('region',{name:'外观设置',exact:true})).toHaveCount(0);
   await expect(page.locator('header [data-slot="theme-toggle"]')).toBeEnabled();
   const categories=page.getByRole('navigation',{name:'设置分类',exact:true});
   await expect(categories.getByRole('group',{name:'偏好与账号',exact:true})).toBeVisible();
   await categories.getByRole('button',{name:'安全与密码',exact:true}).click();
   await expect(page).toHaveURL(origin+'/personal?page=settings&panel=security');
   const scroll=page.locator('#personal-main');
   const header=page.locator('header.lo-header');
   const logout=header.getByRole('button',{name:'退出登录',exact:true});
   const headerTop=(await header.boundingBox())!.y;
   await expect(logout).toBeInViewport({ratio:1});
   await expect(settings.locator('[data-settings-panel]')).toHaveCSS('overflow-y','visible');
   await expect(settings.locator('xpath=..')).toHaveCSS('overflow-y','visible');
   await scroll.focus();await page.keyboard.press('PageDown');
   await expect.poll(()=>scroll.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
   assert.equal((await header.boundingBox())!.y,headerTop,'the header stays fixed while Settings scrolls');
   await expect(logout).toBeInViewport({ratio:1});
   await scroll.evaluate(e=>e.scrollTop=0);
   if(width===1365){
    const box=(await scroll.boundingBox())!;
    await page.mouse.move(box.x+50,box.y+45);await page.mouse.wheel(0,161);
    await expect.poll(()=>scroll.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
   }else if(height===300){
    const client=await page.context().newCDPSession(page);
    const box=(await scroll.boundingBox())!,x=Math.min(width-35,box.x+70),y=box.y+92;
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(const offset of [17,31,45,63])await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-offset}]});
    await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect.poll(()=>scroll.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
    const shell=page.locator('.lo-shell');
    await shell.evaluate(e=>e.scrollLeft=0);
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(const offset of [19,35,51,66])await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-offset,y}]});
    await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect.poll(()=>shell.evaluate(e=>e.scrollLeft)).toBeGreaterThan(0);
    await expect(logout).toBeInViewport({ratio:1});
    await client.detach();
   }
   for(const control of [settings.getByRole('textbox',{name:'本人账号',exact:true}),settings.getByRole('button',{name:'保存密码',exact:true})]){
    await control.scrollIntoViewIfNeeded();await expectAboveFooter(page,control);
    assert.equal(await control.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'short Settings security control receives pointer input');
   }
   const password=settings.getByLabel('原密码',{exact:true});
   await password.fill('synthetic-short-draft');
   await expect(page).toHaveURL(origin+'/personal?page=settings&panel=security');
   const [logoutPrompt]=await Promise.all([page.waitForEvent('dialog').then(async dialog=>{
    const message=dialog.message();await dialog.dismiss();return message;
   }),logout.click()]);
   assert.equal(logoutPrompt,'放弃尚未保存的密码修改？');
   await expect(password).toHaveValue('synthetic-short-draft');
   await expect(page).toHaveURL(origin+'/personal?page=settings&panel=security');
   assert.equal(writes(),0,'rejected logout never calls the API');
   const footerLink=page.getByRole('link',{name:'合成备案占位',exact:true});
   await footerLink.scrollIntoViewIfNeeded();
   await expect(footerLink).toBeInViewport({ratio:0.75});
   await footerLink.click({trial:true});
   await footerLink.focus();await expect(footerLink).toBeFocused();
   await password.fill('');
   await logout.scrollIntoViewIfNeeded();await expectAboveFooter(page,logout);
   assert.equal(await logout.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'short Settings logout receives pointer input');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight===innerHeight&&document.documentElement.scrollWidth===document.documentElement.clientWidth),true,'short Settings scroll stays inside the document');
   for(let step=0;step<2;step++)await page.getByRole('button',{name:'后退',exact:true}).click();
   await readyHeading(page,'待办');await expect(page).toHaveURL(origin+'/personal?page=tasks');
   assert.equal(writes(),0,'short Settings browsing and history never mutate records: '+debugRequests.join(', '));
  }finally{await page.close();}
 }
});

test('OPT-IN Settings header theme keyboard, aligned content and guarded desktop/mobile deep links',{
 skip:process.env.RUN_SETTINGS_BROWSER_TESTS!=='1'&&'Requires native Chrome and disposable synthetic Next fixture',timeout:150_000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-settings-header-')),server=await fixture(root),stopped=once(server,'exit');
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await prepareSettingsFixture(server,'/personal?page=settings&panel=security');
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 const screenshots=join(source,'.review-results');await mkdir(screenshots,{recursive:true});
 const security=origin+'/personal?page=settings&panel=security';
 for(const width of [1440,360]){
  const mobile=width===360;
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:'light',isMobile:mobile,hasTouch:mobile,
   storageState:{cookies:[],origins:[{origin,localStorage:[{name:'lifeos-ui-palette',value:'sage-teal'}]}]}});
  try{
   const writes=await installSyntheticReads(page,origin);
   await page.route(origin+'/api/platform/auth/device-sessions',route=>route.request().method()==='GET'
    ?route.fulfill({json:{sessions:[],truncated:false}}):route.fallback());
   const attemptedWrites:string[]=[];
   page.on('request',request=>{if(!['GET','HEAD'].includes(request.method()))attemptedWrites.push(request.method()+' '+new URL(request.url()).pathname);});
   await page.goto(security,{waitUntil:'domcontentloaded',timeout:55_000});
   const main=page.locator('#personal-main'),panel=main.locator('[data-settings-panel]');
   const password=panel.getByLabel('原密码',{exact:true}),theme=page.locator('header [data-slot="theme-toggle"]');
   const system=page.locator('header').getByRole('button',{name:'跟随系统',exact:true});
   const logout=page.locator('header').getByRole('button',{name:'退出登录',exact:true});
   const categories=page.locator('aside').getByRole('navigation',{name:'设置分类',exact:true});
   await expect(password).toBeEnabled({timeout:15_000});
   await expect(page).toHaveURL(security);
   await expect(theme).toBeEnabled();
   await theme.focus();await page.keyboard.press('Space');
   await expect(theme).toBeFocused();
   await expect(page.locator('html')).toHaveAttribute('data-lifeos-theme','dark');
   await page.reload({waitUntil:'domcontentloaded'});
   await expect(theme).toHaveAttribute('data-theme-preference','dark');
   await expect(page.locator('html')).toHaveAttribute('data-lifeos-theme','dark');
   await expect(page.locator('html')).toHaveAttribute('data-lifeos-palette','sage-teal');
   await expect(panel.getByRole('button',{name:'重新读取设备列表',exact:true})).toBeEnabled();
   if(mobile)for(const control of [theme,system,logout]){
    const box=await control.boundingBox();assert.ok(box&&box.width>=44&&box.height>=44);
   }
   const geometry=await panel.evaluate(node=>{
    const bounds=node.getBoundingClientRect(),content=node.closest('.lo-content')!.getBoundingClientRect();
    const form=node.querySelector('[aria-label="修改密码"]')!.getBoundingClientRect();
    return {documentFits:document.documentElement.scrollWidth<=document.documentElement.clientWidth,
     panelFits:node.scrollWidth<=node.clientWidth,panelStart:bounds.left,contentStart:content.left,
     panelWidth:bounds.width,contentWidth:content.width,formStart:form.left,formWidth:form.width,
     panelOverflow:getComputedStyle(node).overflowY,contentOverflow:getComputedStyle(node.closest('.lo-content')!).overflowY};
   });
   assert.ok(geometry.documentFits&&geometry.panelFits,JSON.stringify(geometry));
   assert.equal(geometry.panelStart,geometry.contentStart);
   assert.equal(geometry.panelWidth,geometry.contentWidth);
   assert.ok(geometry.formWidth<=640&&geometry.formWidth<=geometry.panelWidth,JSON.stringify(geometry));
   assert.ok(Math.abs(geometry.formStart-geometry.panelStart-(geometry.panelWidth-geometry.formWidth)/2)<=1,JSON.stringify(geometry));
   assert.equal(geometry.panelOverflow,'visible');
   assert.equal(geometry.contentOverflow,'visible');
   console.log('SETTINGS_HEADER_LAYOUT '+JSON.stringify({width,...geometry}));
   await page.screenshot({path:join(screenshots,`settings-header-security-${width}.png`),animations:'disabled'});
   if(mobile){
    await expect(page.getByRole('button',{name:'打开导航',exact:true})).toBeHidden();
    const securityCategory=categories.getByRole('button',{name:'安全与密码',exact:true});
    await securityCategory.scrollIntoViewIfNeeded();
    await expect(securityCategory).toHaveAttribute('aria-current','page');
    await page.screenshot({path:join(screenshots,'settings-header-narrow-sidebar.png'),animations:'disabled'});
   }
   await password.fill('synthetic-password-draft');
   const [logoutPrompt]=await Promise.all([page.waitForEvent('dialog').then(async dialog=>{
    const message=dialog.message();await dialog.dismiss();return message;
   }),logout.click()]);
   assert.equal(logoutPrompt,'放弃尚未保存的密码修改？');
   await expect(password).toHaveValue('synthetic-password-draft');
   await expect(page).toHaveURL(security);
   assert.equal(writes(),0);
   await expect(main.getByRole('navigation',{name:'设置分类',exact:true})).toHaveCount(0);
   await expect(categories.getByRole('button',{name:'外观',exact:true})).toHaveCount(0);
   await expect(categories.getByRole('button',{name:'通用',exact:true})).toHaveCount(0);
   await expect(categories.getByRole('button',{name:'标签',exact:true})).toHaveCount(0);
   const settingsButton=page.locator('header').getByRole('button',{name:'打开设置',exact:true});
   for(const accept of [false,true]){
    const [message]=await Promise.all([page.waitForEvent('dialog').then(async dialog=>{
     const message=dialog.message();
     if(accept)await dialog.accept();else await dialog.dismiss();
     return message;
    }),settingsButton.click()]);
    assert.equal(message,'放弃尚未保存的密码修改？');
    if(!accept){
     await expect(page).toHaveURL(security);
     await expect(password).toHaveValue('synthetic-password-draft');
     await expect(categories).toBeVisible();
    }
   }
   await expect(page).toHaveURL(origin+'/personal?page=settings');
   await expect(password).toHaveCount(0);
   await expect(categories).toBeVisible();
   await expect(logout).toBeVisible();
   await expect(panel.getByRole('region',{name:'外观设置',exact:true})).toHaveCount(0);
   await expect(panel.getByRole('radio')).toHaveCount(0);
   await expect(panel.locator('a[href="/account/mcp"]')).toHaveCount(0);
   await theme.focus();await page.keyboard.press('Enter');
   await expect(theme).toHaveAttribute('data-theme-preference','light');
   await system.focus();await page.keyboard.press('Enter');
   await expect(system).toHaveAttribute('aria-pressed','true');
   assert.equal(await page.evaluate(()=>localStorage.getItem('lifeos-ui-theme')),'system');
   await page.goto('about:blank');
   await page.goto(origin+'/personal?page=settings&panel=general',{waitUntil:'domcontentloaded'});
   await expect(page).toHaveURL(origin+'/personal?page=settings');
   const settingsIndex=main.getByRole('list',{name:'可用设置',exact:true});
   await expect(settingsIndex).toBeVisible();
   await expect(password).toHaveCount(0);
   await settingsIndex.getByRole('button',{name:'安全与密码',exact:true}).click();
   await expect(page).toHaveURL(security);
   await expect(password).toBeVisible();
   await expect(theme).toHaveAttribute('data-theme-preference','system');
   await expect(page.locator('html')).toHaveAttribute('data-lifeos-palette','sage-teal');
   await expect(logout).toBeVisible();
   await page.screenshot({path:join(screenshots,`settings-header-legacy-${width}.png`),animations:'disabled'});
   assert.equal(writes(),0,attemptedWrites.join(', '));
  }finally{await page.close();}
 }
});

test('OPT-IN standalone settings preserves drafts/history and bounded task viewport geometry',{
 skip:process.env.RUN_SETTINGS_BROWSER_TESTS!=='1'&&'Requires native Chrome and disposable synthetic Next.js fixture',timeout:240_000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-settings-browser-')),server=await fixture(root),stopped=once(server,'exit');
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await prepareSettingsFixture(server,'/personal?page=tasks');
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 await mkdir(join(source,'.review-results'),{recursive:true});
 for(const width of [1365,390]){
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:width===390?'dark':'light'});let writes=0,personalReads=0;
  if(width===1365)await page.addInitScript(()=>Object.defineProperty(window,'navigation',{configurable:true,value:undefined}));
  await page.route('**/*',async route=>{
   const r=route.request(),u=new URL(r.url());if(u.origin!==origin)return route.abort();
   if(r.method()==='POST'&&u.pathname==='/__nextjs_original-stack-frames')return route.continue();
   if(!['GET','HEAD'].includes(r.method())){writes++;return route.fulfill({status:405});}
   // Overview widgets verify the owner independently. Count the workspace controller's availability and data reads.
   if(u.pathname.endsWith('/personal/availability')||u.pathname.endsWith('/personal/overview'))personalReads++;
   if(u.pathname.endsWith('/personal/status'))return route.fulfill({json:{scope:'personal-manual-candidate',ownerId:'synthetic-owner',spaceId:'synthetic-space',storageVerified:true,writable:true,allowedTypes:['todo','journal','domain','project','topic']}});
   if(u.pathname.endsWith('/personal/availability'))return route.fulfill({json:{configured:true,loginAllowed:true,transport:'ssh-loopback',origin}});
   if(u.pathname.endsWith('/personal/overview'))return route.fulfill({json:{scope:'full-current-snapshot',total:items.length,truncated:false,items,today:u.searchParams.get('today'),observedAt:'2030-11-02T00:00:00Z'}});
   return route.continue();
  });
  await page.goto(origin+'/personal?page=tasks');await expect(page.locator('[data-task-grid="reui"]')).toBeVisible();
  await expect(page.getByRole('heading',{name:'待办',exact:true,level:1})).toBeVisible();
  const nav=()=>page.locator('aside').getByRole('button',{name:'设置',exact:true}).click();
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
  const categories=page.getByRole('navigation',{name:'设置分类',exact:true});
  await categories.getByRole('button',{name:'安全与密码',exact:true}).click();await expect(settings.getByRole('textbox',{name:'本人账号'})).toBeVisible();
  await expect(page).toHaveURL(origin+'/personal?page=settings&panel=security');
  await expect(categories.getByRole('button',{name:'安全与密码',exact:true})).toHaveAttribute('aria-current','page');
  if(width===1365)await page.screenshot({path:join(source,`.review-results/settings-security-${width}.png`),animations:'disabled'});
  await settings.getByLabel('原密码',{exact:true}).fill('synthetic-refused-draft');const refuse=(d:import('@playwright/test').Dialog)=>void d.dismiss();page.on('dialog',refuse);
  await page.getByRole('button',{name:'后退',exact:true}).click();await expect(page).toHaveURL(origin+'/personal?page=settings&panel=security');await expect(settings.getByLabel('原密码',{exact:true})).toHaveValue('synthetic-refused-draft');
  await page.locator('header').getByRole('button',{name:'打开设置',exact:true}).click();
  await expect(categories).toBeVisible();await expect(page).toHaveURL(origin+'/personal?page=settings&panel=security');
  await expect(settings.getByLabel('原密码',{exact:true})).toHaveValue('synthetic-refused-draft');page.off('dialog',refuse);await settings.getByLabel('原密码',{exact:true}).fill('');
  for(let step=0;step<2;step++)await page.getByRole('button',{name:'后退',exact:true}).click();await expect(settingsPage).toHaveCount(0);await expect(page.getByRole('textbox',{name:'搜索待办',exact:true})).toHaveValue('');
  for(let step=0;step<2;step++)await page.getByRole('button',{name:'前进',exact:true}).click();await expect(settingsPage).toBeVisible();await expect(settings.getByLabel('原密码',{exact:true})).toBeVisible();
  await settings.getByLabel('原密码',{exact:true}).fill('synthetic-unsaved-password');let confirmations=0;const accept=(d:import('@playwright/test').Dialog)=>{confirmations++;void d.accept();};page.on('dialog',accept);
  await page.getByRole('button',{name:'返回总览',exact:true}).click();await expect(settingsPage).toHaveCount(0);page.off('dialog',accept);assert.equal(confirmations,1,'one page departure confirms unsaved password once');
  if(width<850)await expect(page.getByRole('button',{name:'打开导航',exact:true})).toBeHidden();
  await page.locator('aside').getByRole('button',{name:'待办',exact:true}).click();
  assert.equal(personalReads,reads,'client page transitions retain the verified data controller');
  await viewport.evaluate(e=>e.scrollTop=0);await page.getByRole('button',{name:'编辑标题：合成待办甲',exact:true}).dblclick();
  const input=page.getByRole('textbox',{name:'编辑待办',exact:true});await input.fill('未保存合成草稿');
  await confirmDiscard(page,false,nav);await expect(settingsPage).toHaveCount(0);
  await expect(input).toHaveValue('未保存合成草稿');assert.equal(writes,0,'refused settings departure never blur-submits or discards the draft');
  if(width===1365)await page.screenshot({path:join(source,`.review-results/settings-background-${width}.png`)});
  await confirmDiscard(page,true,async()=>{await page.getByRole('button',{name:'LifeOS 总览',exact:true}).click();});
  await expect(page).toHaveURL(origin+'/personal');
  await page.getByRole('button',{name:'查看全部未完待办',exact:true}).click();
  await expect(page.getByRole('button',{name:'编辑标题：合成待办甲',exact:true})).toBeVisible();
  await page.goto(origin+'/personal?page=settings');await expect(settingsPage).toBeVisible();await expect(page).toHaveURL(origin+'/personal?page=settings');
  await page.goto(origin+'/personal?page=projects&modal=settings&panel=security');await expect(settingsPage).toBeVisible();await expect(page).toHaveURL(origin+'/personal?page=settings&panel=security');await page.reload();
  if(width===390){
   await page.setViewportSize({width,height:400});
   const panel=settings.locator('.lo-settings-panel'),save=settings.getByRole('button',{name:'保存密码',exact:true});
   await expect(save).toBeEnabled();await expect(panel).toHaveCSS('overflow-y','visible');await expect.poll(()=>page.locator('#personal-main').evaluate(e=>e.clientHeight>60&&e.scrollHeight>e.clientHeight)).toBe(true);
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

test('OPT-IN overview draft survives rejected logout, Settings and matters page departures',{
 skip:process.env.RUN_SETTINGS_BROWSER_TESTS!=='1'&&'Requires native Chrome and disposable synthetic Next fixture',timeout:120_000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-overview-settings-')),server=await fixture(root),stopped=once(server,'exit');
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await prepareSettingsFixture(server,'/personal');
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1365,height:900},colorScheme:'light'});t.after(()=>page.close());
 const writes=await installSyntheticReads(page,origin);
 await page.goto(origin+'/personal',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'编辑标题：合成待办甲',exact:true}).dblclick();
 const input=page.getByRole('textbox',{name:'编辑待办',exact:true});await expect(input).toBeFocused();
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('form')).toHaveCount(0);
 await input.fill('合成未保存总览草稿');const originalInput=await input.elementHandle();
 await confirmDiscard(page,false,async()=>{await page.locator('header').getByRole('button',{name:'退出登录',exact:true}).click();});
 await expect(page).toHaveURL(origin+'/personal');await expect(input).toHaveValue('合成未保存总览草稿');assert.equal(writes(),0);
 await confirmDiscard(page,false,async()=>{await page.getByRole('button',{name:'设置',exact:true}).click();});
 await expect(page.locator('[data-settings-page]')).toHaveCount(0);await expect(page).toHaveURL(origin+'/personal');
 await expect(input).toHaveValue('合成未保存总览草稿');assert.equal(await originalInput!.evaluate(node=>node.isConnected),true,'refused settings departure preserves the same overview input');
 assert.equal(writes(),0);
 await confirmDiscard(page,false,async()=>{await page.locator('aside').getByRole('button',{name:'待办',exact:true}).click();});
 await expect(page).toHaveURL(origin+'/personal');await expect(input).toHaveValue('合成未保存总览草稿');assert.equal(writes(),0,'refused page departure does not submit or discard');
 const logout=page.locator('header').getByRole('button',{name:'退出登录',exact:true});
 let signOutRequests=0;
 await page.route(origin+'/api/platform/auth/sign-out',async route=>{
  assert.equal(route.request().method(),'POST');
  assert.deepEqual(route.request().postDataJSON(),{});
  signOutRequests++;
  await route.fulfill({json:{success:true}});
 });
 await confirmDiscard(page,true,async()=>{await logout.click();});
 await expect(page).toHaveURL(origin+'/login',{timeout:30_000});
 await expect(logout).toHaveCount(0);
 await expect(input).toHaveCount(0);
 assert.equal(signOutRequests,1,'confirmed logout uses the existing sign-out endpoint once');
 assert.equal(writes(),0,'confirmed logout does not submit the draft');
});

test('OPT-IN confirmed header logout clears already loaded private requirements',{
 skip:process.env.RUN_SETTINGS_BROWSER_TESTS!=='1'&&'Requires native Chrome and disposable synthetic Next fixture',timeout:120_000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-requirements-logout-')),server=await fixture(root),stopped=once(server,'exit');
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await prepareSettingsFixture(server,'/personal?page=requirements');
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 const page=await browser.newPage();t.after(()=>page.close());
 await installSyntheticReads(page,origin);
 await page.route(origin+'/api/platform/personal/status',route=>route.fulfill({json:{scope:'personal-manual-candidate',ownerId:'synthetic-owner',spaceId:'synthetic-space',storageVerified:true,writable:true,allowedTypes:['todo','journal'],requirementsEnabled:true}}));
 const baseline=requirements(),example=baseline.requirements.find(item=>item.roadmap)!;
 const title='合成退出后应清除的私有需求';
 await page.route(origin+'/api/platform/personal/requirements/snapshot',route=>route.fulfill({json:{scope:'full-current-requirements-snapshot',total:1,truncated:false,observedAt:'2030-11-02T00:00:00Z',baseline,items:[{
  id:example.id,revision:1,sourceId:'11111111-1111-4111-8111-111111111111',baselineBinding:requirementBinding(baseline,example.id),baselineConflict:false,
  requirement:{...example,title},fields:{title,body:'合成需求正文',phaseId:example.roadmap!.phaseId,priority:example.roadmap!.priority,plannedStartOn:null,plannedEndOn:null},
 }]}}));
 await page.route(origin+'/api/platform/auth/sign-out',route=>route.fulfill({json:{success:true}}));
 await page.goto(origin+'/personal?page=requirements');
 await expect(page.getByText(title,{exact:true})).toBeVisible();
 const logout=page.locator('header').getByRole('button',{name:'退出登录',exact:true});
 const response=page.waitForResponse(result=>result.url()===origin+'/api/platform/auth/sign-out');
 await logout.click();
 assert.equal((await response).status(),200);
 await expect(page).toHaveURL(origin+'/login',{timeout:30_000});
 await expect(logout).toHaveCount(0);
 await expect(page.getByText(title,{exact:true})).toHaveCount(0,{timeout:3000});
 await expect(page.locator('[data-requirements-page]')).toHaveCount(0);
});

test('OPT-IN requirements draft survives only same-owner tab revalidation',{
 skip:process.env.RUN_SETTINGS_BROWSER_TESTS!=='1'&&'Requires native Chrome and disposable synthetic Next fixture',timeout:120_000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-requirements-suspend-')),server=await fixture(root),stopped=once(server,'exit');
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await prepareSettingsFixture(server,'/personal?page=requirements');
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 const page=await browser.newPage();t.after(()=>page.close());
 const writes=await installSyntheticReads(page,origin);
 const baseline=requirements();
 let ownerId='synthetic-owner';
 await page.route(origin+'/api/platform/personal/status',route=>route.fulfill({json:{scope:'personal-manual-candidate',ownerId,spaceId:'synthetic-space',storageVerified:true,writable:true,allowedTypes:['todo','journal'],requirementsEnabled:true}}));
 await page.route(origin+'/api/platform/personal/requirements/snapshot',route=>route.fulfill({json:{scope:'full-current-requirements-snapshot',total:0,truncated:false,observedAt:'2030-11-02T00:00:00Z',baseline,items:[]}}));
 await page.goto(origin+'/personal?page=requirements');
 const add=page.getByRole('button',{name:'新增需求',exact:true});
 const draft=page.getByLabel('需求标题',{exact:true});
 await add.click();
 await draft.fill('合成未保存需求草稿');
 const visibility=(state:'hidden'|'visible')=>page.evaluate(state=>{
  Object.defineProperty(document,'visibilityState',{configurable:true,value:state});
  document.dispatchEvent(new Event('visibilitychange'));
 },state);
 await visibility('hidden');
 await expect(draft).toHaveCount(0);
 await expect(page.locator('[data-requirements-page]')).toHaveCount(0);
 await visibility('visible');
 await expect(draft).toHaveValue('合成未保存需求草稿',{timeout:8000});
 await visibility('hidden');
 ownerId='synthetic-new-owner';
 await visibility('visible');
 await expect(add).toBeEnabled();
 await expect(draft).toHaveCount(0);
 assert.equal(writes(),0);
});

test('OPT-IN settings category returns to the requested panel after requirement browsing',{
 skip:process.env.RUN_SETTINGS_BROWSER_TESTS!=='1'&&'Requires native Chrome and disposable synthetic Next fixture',timeout:90_000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-settings-return-')),server=await fixture(root),stopped=once(server,'exit');
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await prepareSettingsFixture(server,'/personal?page=settings&panel=security');
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1365,height:900}});t.after(()=>page.close());
 const writes=await installSyntheticReads(page,origin);
 await page.goto(origin+'/personal?page=settings&panel=security');await expect(page.getByLabel('原密码',{exact:true})).toBeVisible();
 const categories=page.getByRole('navigation',{name:'设置分类',exact:true});
 await categories.getByRole('button',{name:'需求池',exact:true}).click();await expect(page.getByLabel('搜索需求',{exact:true})).toBeVisible();
 await categories.getByRole('button',{name:'安全与密码',exact:true}).click();
 await expect(page).toHaveURL(origin+'/personal?page=settings&panel=security');await expect(page.getByLabel('原密码',{exact:true})).toBeVisible();
 const living=page.getByRole('navigation',{name:'切换模块',exact:true}).getByRole('button',{name:'兴趣学习',exact:true});
 await living.click();
 await expect(living).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'做饭'})).toBeVisible();
 await expect(categories).toHaveCount(0);
 await expect(page.getByLabel('原密码',{exact:true})).toBeVisible();
 await page.locator('header').getByRole('button',{name:'打开设置'}).click();
 await expect(page).toHaveURL(origin+'/personal?page=settings');
 await expect(categories.getByRole('button',{name:'标签',exact:true})).toHaveCount(0);
 await categories.getByRole('button',{name:'安全与密码',exact:true}).click();
 await expect(page).toHaveURL(origin+'/personal?page=settings&panel=security');
 await page.getByRole('button',{name:'后退',exact:true}).click();
 await expect(page).toHaveURL(origin+'/personal?page=settings');
 await page.getByRole('button',{name:'前进',exact:true}).click();
 await expect(page).toHaveURL(origin+'/personal?page=settings&panel=security');
 assert.equal(writes(),0);
});


test('OPT-IN feedback dirty and uncertain state guards settings links and document back/forward',{
 skip:process.env.RUN_SETTINGS_BROWSER_TESTS!=='1'&&'Requires native Chrome and disposable synthetic Next fixture',timeout:120_000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-settings-feedback-')),server=await fixture(root),stopped=once(server,'exit');
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await prepareSettingsFixture(server,'/personal?page=settings&panel=security');
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
 await page.goto(origin+'/personal?page=settings&panel=security',{waitUntil:'domcontentloaded'});
 const categories=page.getByRole('navigation',{name:'设置分类',exact:true});
 await expect(categories.getByRole('link',{name:'反馈 Inbox',exact:true})).toHaveCount(0);
 await page.goto(origin+'/personal/requirements/feedback',{waitUntil:'domcontentloaded'});
 const original=page.getByRole('textbox',{name:'原文',exact:true});await expect(original).toBeEnabled();
 await page.goto(origin+'/personal/requirements/updates',{waitUntil:'domcontentloaded'});
 await page.goBack({waitUntil:'domcontentloaded'});await expect(original).toBeEnabled();
 // Exercise the privacy recheck required when a document returns from bfcache.
 const privacyRead=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/platform/status');
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
 assert.equal((await privacyRead).status(),200,'restored synthetic owner passes the fresh platform privacy check');
 await expect(page).toHaveURL(origin+'/personal/requirements/feedback');await expect(original).toBeEnabled();await original.fill('Synthetic unsaved feedback');
 // Exercise delegated same-origin navigation without restoring a hidden navigation link.
 await categories.evaluate(nav=>{
  const link=document.createElement('a');
  link.href='/personal/requirements/updates';
  link.textContent='合成直达检查';
  nav.append(link);
 });
 feedbackPhase='link-refused';await confirmFeedback(false,()=>categories.getByRole('link',{name:'合成直达检查',exact:true}).click());await expect(original).toHaveValue('Synthetic unsaved feedback');
 for(const direction of ['后退','前进']){feedbackPhase='button-'+direction;await confirmFeedback(false,()=>page.getByRole('button',{name:direction,exact:true}).click());}
 for(const direction of ['back','forward'] as const)await confirmDiscard(page,false,async signal=>{await(direction==='back'?page.goBack({waitUntil:'domcontentloaded',signal}):page.goForward({waitUntil:'domcontentloaded',signal}));},5000,'beforeunload');
 await expect(page).toHaveURL(origin+'/personal/requirements/feedback');await expect(original).toHaveValue('Synthetic unsaved feedback');assert.equal(writes,0);
 feedbackPhase='link-accepted';await confirmFeedback(true,()=>categories.getByRole('link',{name:'合成直达检查',exact:true}).click(),origin+'/personal/requirements/updates');
 await page.goBack({waitUntil:'domcontentloaded'});await expect(original).toBeEnabled();await original.fill('Synthetic pending feedback');
 await page.getByRole('button',{name:'保存反馈',exact:true}).click();await expect(page.getByRole('button',{name:'恢复原请求并回读',exact:true})).toBeVisible();assert.equal(writes,1);
 const checkPending=async(name:string)=>{const dialog=page.waitForEvent('dialog'),action=page.getByRole('button',{name,exact:true}).click({noWaitAfter:true});const alert=await dialog;assert.equal(alert.type(),'alert');assert.match(alert.message(),/保存结果尚未确认/);await alert.accept();await action;};
 await checkPending('设置');
 await expect(page).toHaveURL(origin+'/personal/requirements/feedback');
 for(const direction of ['后退','前进'])await checkPending(direction);
 for(const direction of ['back','forward'] as const)await confirmDiscard(page,false,async signal=>{await(direction==='back'?page.goBack({waitUntil:'domcontentloaded',signal}):page.goForward({waitUntil:'domcontentloaded',signal}));},5000,'beforeunload');
 authorized=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(original).toHaveCount(0);await expect(categories.getByRole('link',{name:'反馈 Inbox',exact:true})).toHaveCount(0);assert.equal(writes,1);
});

test('OPT-IN managed callback settings navigates, replaces, and recovers on desktop and mobile',{
 skip:process.env.RUN_SETTINGS_BROWSER_TESTS!=='1'&&'Requires native Chrome and disposable synthetic Next fixture',timeout:145_000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-managed-callback-browser-'));
 let closeBrowser:(()=>Promise<void>)|undefined;
 let stopServer:(()=>Promise<void>)|undefined;
 t.after(async()=>{
  try{await closeBrowser?.();}
  finally{try{await stopServer?.();}finally{await rm(root,{recursive:true,force:true});}}
 });
 const server=await fixture(root,true),stopped=once(server,'exit');
 stopServer=async()=>{server.kill('SIGTERM');await stopped;};
 const origin=await prepareSettingsFixture(server,'/personal?page=settings&panel=general');
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
 closeBrowser=()=>browser.close();
 const desktop=await browser.newPage({viewport:{width:1365,height:900}});
 const mobile=await browser.newPage({viewport:{width:390,height:844}});
 for(const page of [desktop,mobile]){page.setDefaultTimeout(7000);page.setDefaultNavigationTimeout(30_000);await installSyntheticReads(page,origin);}
 await exerciseManagedCallback(root,origin,desktop,mobile);
});
