import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp, mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {once} from 'node:events';
import test from 'node:test';
import {chromium, expect} from '@playwright/test';
import {readyHeading} from './helpers/private-business-browser-fixture.ts';

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
async function fixture(root:string){
 await mkdir(join(root,'app/personal'),{recursive:true});
 await Promise.all([
  ...['layout.tsx','globals.css','theme.css'].map(file=>cp(join(source,'app',file),join(root,'app',file))),
  cp(join(source,'app/personal/page.tsx'),join(root,'app/personal/page.tsx')),
  cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  cp(join(source,'src'),join(root,'src'),{recursive:true}),
  symlink(join(source,'node_modules'),join(root,'node_modules')),
  symlink(join(source,'components'),join(root,'components')),
 ]);
 await writeFile(join(root,'src/platform/runtime.ts'),'export const readPlatformPagePrincipal=async()=>({id:"synthetic-owner"}); export const readPlatformPasswordCapability=async()=>true;\n');
 const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],
  {cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 return server;
}

test('OPT-IN settings preserve drafts/history and bounded task viewport geometry',{
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
  const scrollTop=await viewport.evaluate(e=>e.scrollTop),reads=personalReads;
  await nav();const settings=page.getByRole('dialog',{name:'设置',exact:true});await expect(settings).toBeVisible();
  await settings.getByRole('button',{name:'安全与密码',exact:true}).click();await expect(settings.getByRole('textbox',{name:'本人账号'})).toBeVisible();
  await expect(page).toHaveURL(origin+'/personal?page=tasks&modal=settings&panel=security');
  await expect(settings.getByRole('button',{name:'安全与密码',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.screenshot({path:join(source,`.review-results/settings-security-${width}.png`),animations:'disabled'});
  await settings.getByLabel('原密码',{exact:true}).fill('synthetic-refused-draft');const refuse=(d:import('@playwright/test').Dialog)=>void d.dismiss();page.on('dialog',refuse);
  await page.goBack();await expect(page).toHaveURL(origin+'/personal?page=tasks&modal=settings&panel=security');await expect(settings.getByLabel('原密码',{exact:true})).toHaveValue('synthetic-refused-draft');page.off('dialog',refuse);await settings.getByLabel('原密码',{exact:true}).fill('');
  await page.goBack();await expect(settings).toHaveCount(0);assert.equal(await viewport.evaluate(e=>e.scrollTop),scrollTop);await expect(page.getByRole('textbox',{name:'搜索待办',exact:true})).toHaveValue('合成');
  await page.goForward();await expect(settings).toBeVisible();
  await settings.getByLabel('原密码',{exact:true}).fill('synthetic-unsaved-password');let confirmations=0;const accept=(d:import('@playwright/test').Dialog)=>{confirmations++;void d.accept();};page.on('dialog',accept);
  await settings.getByRole('button',{name:'关闭',exact:true}).click();await expect(settings).toHaveCount(0);page.off('dialog',accept);assert.equal(confirmations,1,'one explicit close must confirm unsaved password only once');
  assert.equal(personalReads,reads,'overlay transitions must not reload background business data');
  await viewport.evaluate(e=>e.scrollTop=0);await page.getByRole('gridcell',{name:'合成待办甲',exact:true}).dblclick();
  const input=page.getByRole('textbox',{name:'编辑待办',exact:true});await input.fill('未保存合成草稿');
  await nav();await expect(settings).toBeVisible();await page.keyboard.press('Escape');await expect(settings).toHaveCount(0);await expect(input).toHaveValue('未保存合成草稿');assert.equal(writes,0,'opening settings must not blur-submit or discard draft');
  await page.screenshot({path:join(source,`.review-results/settings-background-${width}.png`)});
  // Fresh navigation is safe here only after the retained draft is explicitly discarded.
  page.on('dialog',d=>d.accept());await page.getByRole('button',{name:'LifeOS 总览',exact:true}).click();
  await page.goto(origin+'/personal?page=settings');await expect(settings).toBeVisible();await settings.getByRole('button',{name:'关闭',exact:true}).click();await expect(page).toHaveURL(origin+'/personal');
  await page.goto(origin+'/personal?page=projects&modal=settings&panel=security');await expect(settings).toBeVisible();await page.reload();await settings.getByRole('button',{name:'关闭',exact:true}).click();await expect(page).toHaveURL(origin+'/personal?page=projects');
  for(const view of ['列表','看板']){await page.goto(origin+'/personal?page=tasks');await page.getByRole('button',{name:view,exact:true}).click();const target=page.locator(view==='列表'?'.lo-list-rows':'.lo-board-cards').first(),columnHeader=page.locator(view==='列表'?'.lo-list-columns':'.lo-board-column > h2').first(),top=await columnHeader.boundingBox();assert.ok(await target.evaluate(e=>e.scrollHeight>e.clientHeight));await target.evaluate(e=>e.scrollTop=900);assert.deepEqual(await columnHeader.boundingBox(),top);assert.equal(await page.locator('#personal-main').evaluate(e=>e.scrollTop),0);}
  await page.goto(origin+'/personal?page=requirements');await page.getByLabel('搜索需求',{exact:true}).fill('LO-TASK-001');await page.getByRole('button',{name:'看板视图',exact:true}).click();
  await nav();await expect(settings).toBeVisible();await page.keyboard.press('Escape');await expect(settings).toHaveCount(0);await expect(page.getByLabel('搜索需求',{exact:true})).toHaveValue('LO-TASK-001');await expect(page.getByRole('button',{name:'看板视图',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-requirement-id="LO-TASK-001"]')).toHaveCount(1);
  await page.close();
 }
});
