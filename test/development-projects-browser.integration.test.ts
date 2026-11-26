import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {requirements} from '../src/platform/requirements.ts';
import {readLifeOSDevelopmentProgress} from '../src/ui-review/development-project-progress.ts';
import {emptyCareerPersonal} from '../src/personal-career/domain.ts';
import {readyHeading} from './helpers/private-business-browser-fixture.ts';

test('OPT-IN development projects respects owner binding and preserves the career and legacy project entries',{
 skip:process.env.RUN_DEVELOPMENT_PROJECTS_BROWSER!=='1'&&'Requires isolated Next and Chromium',timeout:180000,
},async t=>{
 const baselineSource=process.env.LIFEOS_PERFORMANCE_BASELINE_SOURCE;
 const source=baselineSource??resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-development-projects-'));
 const pages=['personal','personal/career','personal/resume','personal/development-projects','login'];
 for(const path of pages)await mkdir(join(root,'app',path),{recursive:true});
 await Promise.all([
  cp(join(source,'src'),join(root,'src'),{recursive:true}),
  ...['layout.tsx','globals.css','theme.css','personal/layout.tsx','personal/page.tsx','personal/career/page.tsx','personal/resume/page.tsx','personal/development-projects/page.tsx'].filter(name=>!baselineSource||name!=='personal/resume/page.tsx').map(name=>cp(join(source,'app',name),join(root,'app',name))),
  cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components')),
 ]);
 await writeFile(join(root,'app/login/page.tsx'),'export default function Page(){return <h1>Synthetic login</h1>}');
 await writeFile(join(root,'src/platform/runtime.ts'),`
  export const readPlatformPagePrincipal=async(headers:Headers)=>headers.get('cookie')?.includes('dev-fixture=owner')?{userId:'synthetic-owner'}:null;
  export const readPlatformPasswordCapability=async()=>false;
  export const readPlatformLoginCapability=async()=>({sessionDuration:false});
 `);
 const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 const stopped=once(child,'exit');
 let log='';
 child.stderr.on('data',chunk=>{log=(log+String(chunk)).slice(-4000);});
 let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
 t.after(async()=>{try{await browser?.close();}finally{if(child.exitCode===null)child.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});}});
 const origin=await new Promise<string>((done,fail)=>{
  const timer=setTimeout(()=>fail(Error(log||'Fixture startup timed out')),30000);
  child.once('exit',()=>{clearTimeout(timer);fail(Error(log||'Fixture exited'));});
  child.stdout.on('data',chunk=>{const address=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(address){clearTimeout(timer);done(address[0]);}});
 });
 browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
 const context=await browser.newContext({viewport:{width:1365,height:900}});
 const page=await context.newPage();
 const development=origin+'/personal/development-projects';
 const career=origin+'/personal/career';
 const resume=origin+'/personal/resume';
 for(const url of baselineSource?[development,career]:[development,career,resume]){
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  await expect(page.getByRole('heading',{name:'Synthetic login'})).toBeVisible();
 }
 await context.addCookies([{name:'dev-fixture',value:'owner',url:origin}]);
 const baseline=requirements(),time='2026-11-25T00:00:00.000Z';
 const items=baseline.requirements.map(requirement=>({id:requirement.id,revision:0,sourceId:null,
  fields:{title:'Synthetic requirement',body:'Private fixture body',phaseId:'foundation',priority:'P2',plannedStartOn:null,plannedEndOn:null},
  baselineBinding:{baselineVersion:baseline.baselineVersion,itemVersion:requirement.version,digest:'a'.repeat(64)},baselineConflict:false,requirement}));
 const expectedRequirement=items.find(item=>item.id==='LO-REQ-001');
 assert.ok(expectedRequirement);
 const ownerId='synthetic-owner',spaceId='synthetic-space';
 const id='11111111-1111-4111-8111-111111111111',sourceId='22222222-2222-4222-8222-222222222222';
 const fields={title:'Synthetic career record',text:'Synthetic career original',occurredOn:'2026-11-20',personal:emptyCareerPersonal('achievement')};
 const entry={id,kind:'inbox',revision:1,draft:{...fields,disposition:'reference'},source:{id:sourceId,system:'website',externalId:id,version:1,asOf:time,
  original:{marker:'personal-manual-v1',spaceId,type:'career',input:{spaceId,confirmed:true,fields}}},
  createdAt:time,updatedAt:time,syncState:'draft',externalStatus:null};
 const resumeId='33333333-3333-4333-8333-333333333333',resumeSourceId='44444444-4444-4444-8444-444444444444';
 const resumeFields={...fields,title:'Synthetic resume version',personal:{...emptyCareerPersonal('resume'),facts:[{id,sourceId,revision:1}]}};
 const resumeEntry={...entry,id:resumeId,draft:{...resumeFields,disposition:'reference'},source:{...entry.source,id:resumeSourceId,externalId:resumeId,
  original:{...entry.source.original,input:{spaceId,confirmed:true,fields:resumeFields}}}};
 let summaryError: {status:number; code:string}|null=null;
 let ownerCheckFailure:403|503|null=null;
 let summaryGate:Promise<void>|null=null;
 let writable=false,poolStorageVerified=true;
 let summaries=0,snapshots=0,careerReads=0,revisionReads=0;
 const requests:string[]=[];
 const snapshot={scope:'full-current-requirements-snapshot',truncated:false,items,total:items.length,observedAt:time,baseline};

 const errors:string[]=[],writes:string[]=[],external:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){external.push(url.origin);return route.abort();}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  if(request.method()!=='GET')writes.push(request.method());
  const path=url.pathname;
  requests.push(path);
  if(path==='/api/platform/status'&&ownerCheckFailure)return route.fulfill({status:ownerCheckFailure,json:{}});
  if(path.endsWith('/personal/requirements/snapshot')){
   if(request.frame().url()===development)snapshots++;
   return route.fulfill({json:snapshot});
  }
  if(path==='/api/platform/personal/requirements/'+expectedRequirement.id){
   return route.fulfill({json:{entry:expectedRequirement}});
  }
  if(path.endsWith('/personal/requirements/development-progress')){
   summaries++;
   const gate=summaryGate,error=summaryError;
   if(gate)await gate;
   if(error)return route.fulfill({status:error.status,json:{error:{code:error.code}}});
   return route.fulfill({json:readLifeOSDevelopmentProgress(snapshot)});
  }
  if(path.endsWith('/personal/career/snapshot'))return route.fulfill({json:{items:[entry,resumeEntry],truncated:false,total:2}});
  if(path.endsWith('/personal/career/'+id)){careerReads++;return route.fulfill({json:{entry}});}
  if(path.endsWith('/personal/career/'+id+'/history')){revisionReads++;return route.fulfill({json:{items:[entry]}});}
  if(path.endsWith('/personal/status'))return route.fulfill({json:{scope:'personal-manual-candidate',ownerId,
   spaceId,storageVerified:poolStorageVerified,writable,
   requirementsEnabled:true,careerEnabled:true,allowedTypes:['todo','career','project','domain']}});
  if(path.endsWith('/personal/availability'))return route.fulfill({json:{configured:true,loginAllowed:true,https:false,transport:'ssh-loopback',origin,writable}});
  if(path.endsWith('/personal/todo/workspace-snapshot')||path.endsWith('/personal/overview')){
   const narrow=path.endsWith('/workspace-snapshot');
   if(narrow&&!poolStorageVerified)return route.fulfill({status:503,json:{error:{code:'TASK_WORKSPACE_SNAPSHOT_UNAVAILABLE'}}});
   const scope=narrow?'task-workspace-current-snapshot':'full-current-snapshot';
   const access=narrow&&url.searchParams.get('include')==='access'?{
    scope:'personal-manual-candidate',ownerId,spaceId,storageVerified:poolStorageVerified,writable,
    allowedTypes:['todo','career','project','domain'],
   }:undefined;
   return route.fulfill({json:{scope,access,items:[],total:0,truncated:false,today:url.searchParams.get('today')??'2026-11-25',observedAt:time}});
  }
  return route.fulfill({json:{scope:'isolated-synthetic-review'}});
 });
 const card=page.getByRole('region',{name:'LifeOS 网站需求进度',exact:true});
 const poolLink=card.getByRole('link',{name:'打开需求池',exact:true});
 const pool=page.getByRole('region',{name:'需求池',exact:true});
 const poolUrl=origin+'/personal?page=requirements';
 const requirementRow=pool.getByRole('list',{name:'需求清单',exact:true})
  .getByRole('button',{name:expectedRequirement.requirement.title,exact:true});
 const openPool=async()=>{
  await expect(poolLink).toHaveAttribute('href','/personal?page=requirements');
  await poolLink.click();
  await expect(page).toHaveURL(poolUrl);
  const summary=pool.getByRole('group',{name:'需求统计',exact:true});
  await expect(summary.getByRole('button',{name:'总需求 '+items.length,exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(summary.getByRole('button',{name:'已完成 0',exact:true})).toHaveAttribute('aria-pressed','false');
  await expect(summary.getByRole('button',{name:'未完成 '+items.length,exact:true})).toHaveAttribute('aria-pressed','false');
  await expect(requirementRow).toBeVisible();
  const detailRead=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/platform/personal/requirements/'+expectedRequirement.id);
  await requirementRow.click();
  assert.equal((await detailRead).status(),200);
  const detail=page.getByRole('dialog',{name:expectedRequirement.requirement.title,exact:true});
  await expect(detail.getByText(expectedRequirement.id,{exact:true})).toBeVisible();
  await detail.getByRole('button',{name:'关闭',exact:true}).click();
  await expect(requirementRow).toBeFocused();
 };
 const firstCareerRecord=page.getByRole('button',{name:fields.title,exact:true});
 const openLegacyResume=async()=>{
  await expect(firstCareerRecord).toBeVisible({timeout:30000});
  await page.getByRole('button',{name:'简历',exact:true}).click();
 };
 const targets=[
  {name:'development',url:development,ready:card.locator('dd').last()},
  {name:'career',url:career,ready:firstCareerRecord},
  {name:'resume',url:baselineSource?career:resume,ready:page.getByLabel('简历版本'),open:baselineSource?openLegacyResume:undefined},
 ].filter(target=>!process.env.LIFEOS_PERFORMANCE_TARGET||target.name===process.env.LIFEOS_PERFORMANCE_TARGET);
 if(process.env.LIFEOS_VERIFY_ROUTES_ONLY!=='1')for(const width of [1365,390]){
  await page.setViewportSize({width,height:900});
  for(const {name,url,ready,open} of targets){
   await page.goto(url,{waitUntil:'load',timeout:60000});
   await open?.();
   await expect(ready).toBeVisible({timeout:30000});
   const samples=[];
   for(let run=0;run<3;run++){
    await page.goto('about:blank');
    const first=requests.length,started=performance.now();
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
    await open?.();
    await expect(ready).toBeVisible({timeout:30000});
    if(name==='resume')await expect(ready).toHaveValue(resumeId);
    const milliseconds=Math.round(performance.now()-started);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const counts=Object.fromEntries([...new Set(requests.slice(first))].sort()
     .map(path=>[path,requests.slice(first).filter(requestPath=>requestPath===path).length]));
    if(name==='development'&&!baselineSource){
     assert.equal(counts['/api/platform/personal/requirements/development-progress'],1);
     assert.equal(counts['/api/platform/personal/requirements/snapshot'],undefined);
    }
    samples.push({milliseconds,counts});
   }
   t.diagnostic(JSON.stringify({kind:'first-content',baseline:!!baselineSource,width,name,samples}));
  }
 }
 if(baselineSource)return;

 const header=page.locator('header.lo-header');
 const drawer=page.getByRole('dialog',{name:'LifeOS',exact:true});
 const openHome=async()=>{
  await page.goto(origin+'/personal',{waitUntil:'networkidle',timeout:60000});
  await expect(header.getByRole('link',{name:'搜索本人记录',exact:true})).toBeVisible();
 };
 const openMobileNavigation=async()=>{
  await expect(header.getByRole('button',{name:'切换到桌面版',exact:true})).toBeVisible();
  await header.getByRole('button',{name:'打开导航',exact:true}).click();
  await expect(drawer).toBeVisible();
 };

 for(const width of [1365,390]){
  await page.setViewportSize({width,height:900});
  await openHome();
  if(width===390)await openMobileNavigation();
  const switcher=(width===390?drawer:header).getByRole('navigation',{name:'切换模块'});
  const link=switcher.getByRole('link',{name:'开发项目',exact:true});
  const before=summaries,beforeSnapshots=snapshots,started=performance.now();
  await link.click();
  await expect(page).toHaveURL(development);
  await expect(card.locator('dd').last()).toBeVisible({timeout:30000});
  t.diagnostic('development-projects '+width+'px: '+Math.round(performance.now()-started)+'ms click to summary in isolated Next');
  assert.equal(summaries-before,1);
  assert.equal(snapshots,beforeSnapshots);
  const counts=await card.locator('dd').allTextContents();
  assert.equal(counts.reduce((sum,value)=>sum+Number(value),0),baseline.requirements.length);
  await expect(card.locator('time')).toHaveText(/08:00/);
  await expect(card.getByRole('link',{name:'打开需求池'})).toHaveAttribute('href','/personal?page=requirements');
  assert.ok(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  // Observe a full browser turn after the focus event.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(summaries-before,1);
  await openPool();

  summaryError={status:503,code:'PERSONAL_STORAGE_UNAVAILABLE'};
  await page.goto(development,{waitUntil:'domcontentloaded'});
  await expect(card.getByText('需求进度暂不可用。',{exact:true})).toBeVisible();
  await expect(card.locator('dd')).toHaveCount(0);
  assert.equal(snapshots,beforeSnapshots);
  await openPool();

  for(const denial of [
   {status:401,code:'AUTHENTICATION_REQUIRED'},
   {status:403,code:'OWNER_ONLY'},
   {status:503,code:'PERSONAL_PLATFORM_UNAVAILABLE'},
  ]){
   summaryError=denial;
   await page.goto(development,{waitUntil:'domcontentloaded'});
   await expect(card.getByText('需求进度暂不可用。',{exact:true})).toBeVisible();
   await expect(poolLink).toHaveCount(0);
   await expect(card.locator('dd')).toHaveCount(0);
   assert.equal(snapshots,beforeSnapshots);
  }
  summaryError=null;
 }

 // The canonical workspace still enforces its own storage gate.
 summaryError={status:503,code:'PERSONAL_STORAGE_UNAVAILABLE'};
 poolStorageVerified=false;
 await page.goto(development,{waitUntil:'domcontentloaded'});
 await expect(poolLink).toBeVisible();
 const blockedSnapshot=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/platform/personal/todo/workspace-snapshot');
 await poolLink.click();
 await expect(page).toHaveURL(poolUrl);
 const blocked=await blockedSnapshot;
 assert.equal(blocked.status(),503);
 assert.equal((await blocked.json()).error.code,'TASK_WORKSPACE_SNAPSHOT_UNAVAILABLE');
 await expect(page.getByText('暂时无法读取完整待办列表，请重试。',{exact:true})).toBeVisible();
 await expect(requirementRow).toHaveCount(0);
 poolStorageVerified=true;
 summaryError=null;

 // The same document must discard an earlier successful read once re-verification starts.
 await page.goto(development,{waitUntil:'domcontentloaded'});
 await expect(card.locator('dd').last()).toBeVisible();
 ownerCheckFailure=503;
 await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
 await expect(page.getByText('暂时无法核对登录状态。私人页面已隐藏。',{exact:true})).toBeVisible();
 await expect(card).toHaveCount(0);

 const beforeRecovery=summaries;
 let releaseSummary:()=>void=()=>{};
 summaryGate=new Promise(resolve=>{releaseSummary=resolve;});
 summaryError={status:403,code:'OWNER_ONLY'};
 ownerCheckFailure=null;
 try{
  await page.getByRole('button',{name:'重新核对',exact:true}).click();
  await expect(card.getByText('正在读取需求进度…',{exact:true})).toBeVisible();
  await expect(card.locator('dd')).toHaveCount(0);
  await expect(poolLink).toHaveCount(0);
  await expect.poll(()=>summaries).toBe(beforeRecovery+1);
 }finally{
  releaseSummary();
  summaryGate=null;
 }
 await expect(card.getByText('需求进度暂不可用。',{exact:true})).toBeVisible();
 await expect(card.locator('dd')).toHaveCount(0);
 await expect(poolLink).toHaveCount(0);

 // An earlier storage failure must not reopen the fallback after current owner denial.
 const beforeSuperseded=summaries;
 let releaseSuperseded:()=>void=()=>{};
 summaryError={status:503,code:'PERSONAL_STORAGE_UNAVAILABLE'};
 summaryGate=new Promise(resolve=>{releaseSuperseded=resolve;});
 try{
  await page.goto(development,{waitUntil:'domcontentloaded'});
  await expect(card.getByText('正在读取需求进度…',{exact:true})).toBeVisible();
  await expect.poll(()=>summaries).toBe(beforeSuperseded+1);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(summaries,beforeSuperseded+1);

  const oldAbort=page.waitForEvent('requestfailed',request=>new URL(request.url()).pathname.endsWith('/development-progress'));
  ownerCheckFailure=503;
  await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
  await expect(card).toHaveCount(0);
  await oldAbort;

  summaryError={status:403,code:'OWNER_ONLY'};
  summaryGate=null;
  ownerCheckFailure=null;
  await page.getByRole('button',{name:'重新核对',exact:true}).click();
  await expect(card.getByText('需求进度暂不可用。',{exact:true})).toBeVisible();
  assert.equal(summaries,beforeSuperseded+2);
 }finally{
  releaseSuperseded();
  summaryGate=null;
 }
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await expect(card.locator('dd')).toHaveCount(0);
 await expect(poolLink).toHaveCount(0);
 ownerCheckFailure=403;
 await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
 await expect(page).toHaveURL(origin+'/login');
 await expect(card).toHaveCount(0);
 ownerCheckFailure=null;
 summaryError=null;

 await openHome();
 await openMobileNavigation();
 await drawer.getByRole('button',{name:'职业成长',exact:true}).click();
 await drawer.getByRole('link',{name:'简历',exact:true}).click();
 await expect(page).toHaveURL(resume);
 await expect(page.getByLabel('简历版本')).toHaveValue(resumeId);
 await expect(page.getByRole('button',{name:fields.title,exact:true})).toHaveCount(0);
 await page.setViewportSize({width:1365,height:900});
 const careerNavigation=page.locator('header').getByRole('button',{name:'职业成长',exact:true});
 await careerNavigation.click();
 await page.locator('aside.lo-sidebar').getByRole('link',{name:'职业',exact:true}).click();
 await expect(page).toHaveURL(career);
 await expect(page.getByRole('button',{name:resumeFields.title,exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:fields.title,exact:true}).click({timeout:30000});
 const dialog=page.getByRole('dialog',{name:'编辑职业'});
 await expect(dialog.getByRole('textbox',{name:'备注',exact:true})).toHaveValue(fields.text);
 await expect(dialog.getByLabel('记录类别')).toHaveValue('achievement');
 await expect(dialog.getByText('历史版本（1）')).toBeVisible();
 assert.equal(careerReads,1);assert.equal(revisionReads,1);
 await page.goto(origin+'/personal?page=tasks',{waitUntil:'networkidle',timeout:60000});
 await expect(header.getByRole('link',{name:'搜索本人记录',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'项目分类视图',exact:true}).click();
 await expect(page.getByRole('group',{name:/项目视图/})).toBeVisible({timeout:30000});
 await expect(page).toHaveURL(origin+'/personal?page=projects');
 await expect(page.getByRole('link',{name:'新建项目',exact:true})).toHaveCount(0);
 writable=true;
 await page.reload({waitUntil:'networkidle'});
 await readyHeading(page,'个人项目');
 await page.locator('aside').getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'领域',exact:true}).click();
 await expect(page).toHaveURL(origin+'/personal?page=areas');
 await readyHeading(page,'领域');
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(external,[]);
});
