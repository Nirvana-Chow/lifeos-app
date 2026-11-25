import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {requirements} from '../src/platform/requirements.ts';
import {emptyCareerPersonal} from '../src/personal-career/domain.ts';

test('OPT-IN development projects respects owner binding and preserves the career and legacy project entries',{
 skip:process.env.RUN_DEVELOPMENT_PROJECTS_BROWSER!=='1'&&'Requires isolated Next and Chromium',timeout:180000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-development-projects-'));
 const pages=['personal','personal/career','personal/development-projects','login'];
 for(const path of pages)await mkdir(join(root,'app',path),{recursive:true});
 await Promise.all([
  cp(join(source,'src'),join(root,'src'),{recursive:true}),
  ...['layout.tsx','globals.css','theme.css','personal/layout.tsx','personal/page.tsx','personal/career/page.tsx','personal/development-projects/page.tsx'].map(name=>cp(join(source,'app',name),join(root,'app',name))),
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
 for(const url of [development, career]){
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  await expect(page.getByRole('heading',{name:'Synthetic login'})).toBeVisible();
 }
 await context.addCookies([{name:'dev-fixture',value:'owner',url:origin}]);
 const baseline=requirements(),time='2026-11-25T00:00:00.000Z';
 const items=baseline.requirements.map(requirement=>({id:requirement.id,revision:0,sourceId:null,
  fields:{title:'Synthetic requirement',body:'Private fixture body',phaseId:'foundation',priority:'P2',plannedStartOn:null,plannedEndOn:null},
  baselineBinding:{baselineVersion:baseline.baselineVersion,itemVersion:requirement.version,digest:'a'.repeat(64)},baselineConflict:false,requirement}));
 const ownerId='synthetic-owner',spaceId='synthetic-space';
 const id='11111111-1111-4111-8111-111111111111',sourceId='22222222-2222-4222-8222-222222222222';
 const fields={title:'Synthetic career record',text:'Synthetic career original',occurredOn:'2026-11-20',personal:emptyCareerPersonal('achievement')};
 const entry={id,kind:'inbox',revision:1,draft:{...fields,disposition:'reference'},source:{id:sourceId,system:'website',externalId:id,version:1,asOf:time,
  original:{marker:'personal-manual-v1',spaceId,type:'career',input:{spaceId,confirmed:true,fields}}},
  createdAt:time,updatedAt:time,syncState:'draft',externalStatus:null};
 let mode:'ready'|'switched'|'disabled'|'denied'='ready',readSnapshot=false;
 let snapshots=0,careerReads=0,revisionReads=0;
 const errors:string[]=[],writes:string[]=[],external:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){external.push(url.origin);return route.abort();}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  if(request.method()!=='GET')writes.push(request.method());
  const path=url.pathname;
  if(path.endsWith('/personal/requirements/snapshot')){
   snapshots++;readSnapshot=true;
   if(mode==='denied')return route.fulfill({status:403,json:{}});
   return route.fulfill({json:{scope:'full-current-requirements-snapshot',truncated:false,items,total:items.length,observedAt:time}});
  }
  if(path.endsWith('/personal/career/snapshot'))return route.fulfill({json:{items:[entry],truncated:false,total:1}});
  if(path.endsWith('/personal/career/'+id)){careerReads++;return route.fulfill({json:{entry}});}
  if(path.endsWith('/personal/career/'+id+'/history')){revisionReads++;return route.fulfill({json:{items:[entry]}});}
  if(path.endsWith('/personal/status'))return route.fulfill({json:{scope:'personal-manual-candidate',ownerId,
   spaceId:mode==='switched'&&readSnapshot?'other-fixture-space':spaceId,storageVerified:true,writable:false,
   requirementsEnabled:mode!=='disabled',careerEnabled:true,allowedTypes:['todo','career','project','domain']}});
  if(path.endsWith('/personal/availability'))return route.fulfill({json:{configured:true,loginAllowed:true,https:false,transport:'ssh-loopback',origin,writable:false}});
  if(path.endsWith('/personal/overview'))return route.fulfill({json:{scope:'full-current-snapshot',items:[],total:0,truncated:false,today:url.searchParams.get('today')??'2026-11-25',observedAt:time}});
  return route.fulfill({json:{scope:'isolated-synthetic-review'}});
 });
 await page.goto(development,{waitUntil:'domcontentloaded',timeout:60000});
 const card=page.getByRole('region',{name:'LifeOS 网站需求进度',exact:true});
 await expect(card.locator('dd').last()).toBeVisible({timeout:30000});
 const counts=await card.locator('dd').allTextContents();
 assert.equal(counts.reduce((sum,value)=>sum+Number(value),0),baseline.requirements.length);
 await expect(card.locator('time')).toHaveText(/08:00/);
 await expect(card).not.toContainText('Private fixture body');
 await expect(page.getByRole('navigation',{name:'切换模块'}).getByRole('button',{name:'项目',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'开发项目'})).toHaveAttribute('href','/personal/development-projects');
 await expect(card.getByRole('link',{name:'打开需求池'})).toHaveAttribute('href','/personal?page=requirements');
 await page.setViewportSize({width:390,height:844});
 assert.ok(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 for(const next of ['switched','denied','disabled'] as const){
  const before=snapshots;mode=next;readSnapshot=false;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(card.getByText('需求进度暂不可用。')).toBeVisible();
  await expect(card.locator('dd')).toHaveCount(0);
  if(next==='disabled')assert.equal(snapshots,before);
 }
 mode='ready';
 await page.goto(career,{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByRole('button',{name:fields.title,exact:true}).click({timeout:30000});
 const dialog=page.getByRole('dialog',{name:'编辑职业与简历'});
 await expect(dialog.getByRole('textbox',{name:'备注',exact:true})).toHaveValue(fields.text);
 await expect(dialog.getByLabel('记录类别')).toHaveValue('achievement');
 await expect(dialog.getByText('历史版本（1）')).toBeVisible();
 assert.equal(careerReads,1);assert.equal(revisionReads,1);
 await page.goto(origin+'/personal?page=projects',{waitUntil:'domcontentloaded',timeout:60000});
 await expect(page.getByRole('group',{name:'项目视图'})).toBeVisible({timeout:30000});
 await expect(page).toHaveURL(origin+'/personal?page=projects');
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(external,[]);
});
