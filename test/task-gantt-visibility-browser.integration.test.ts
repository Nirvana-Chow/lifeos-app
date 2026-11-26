import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {workspaceData} from '../src/personal-candidate/workspace-data.ts';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';

test('OPT-IN task and project Gantt share their axis and keep titles visible on real workspace routes',{
 skip:process.env.RUN_TODO_GANTT_VISIBILITY_BROWSER_TESTS!=='1'&&'Requires isolated synthetic Next fixture and native Chrome',timeout:180_000,
},async()=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-todo-gantt-'));
 let serverProcess:FixtureProcess|undefined,browserProcess:FixtureProcess|undefined,browserServer:Awaited<ReturnType<typeof chromium.launchServer>>|undefined,browser:Awaited<ReturnType<typeof chromium.connect>>|undefined;
 try{
  await mkdir(join(root,'app/personal'),{recursive:true});
  await Promise.all([cp(join(source,'src'),join(root,'src'),{recursive:true}),...['layout.tsx','globals.css','theme.css'].map(file=>cp(join(source,'app',file),join(root,'app',file))),cp(join(source,'app/personal/page.tsx'),join(root,'app/personal/page.tsx')),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components'))]);
  await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
  await writeFile(join(root,'src/platform/runtime.ts'),'export const readPlatformPagePrincipal=async()=>({id:"synthetic-gantt-owner"});export const readPlatformPasswordCapability=async()=>false;\n');
  const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],detached:true});serverProcess=trackAuthThemeProcess(server,true);server.stderr.resume();
  const origin=await new Promise<string>((accept,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Fixture startup timeout')),30_000);server.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture exited'));});server.once('error',error=>{clearTimeout(timer);reject(error);});server.stdout.on('data',chunk=>{output=(output+String(chunk)).slice(-65536);const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});});
  browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH,host:'127.0.0.1'});browserProcess=trackAuthThemeProcess(browserServer.process());browser=await chromium.connect(browserServer.wsEndpoint());
  const page=await browser.newPage();
  page.setDefaultTimeout(9000);
  const ownerId='synthetic-gantt-owner',spaceId='synthetic-gantt-space';
  const uuid=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  function entry(n:number,type:'todo'|'project',title:string,dates:{plannedStartOn?:string;plannedEndOn?:string;dueOn?:string}){
   const id=uuid(n);
   const fields=type==='todo'
    ?{title,notes:'Synthetic only',dueOn:null,status:'open',personal:{project:null,domain:null,topics:[]},...dates}
    :{title,text:'Synthetic only',occurredOn:null,personal:{type:'project',stage:'active',purpose:null,nextStep:'',domain:null,topics:[],...dates}};
   return {id,kind:type==='todo'?'todo':'inbox',revision:1,draft:type==='todo'?fields:{...fields,disposition:'reference'},
    source:{id:uuid(n+100),system:'website',externalId:id,version:1,asOf:'2030-11-01T00:00:00Z',
     original:{marker:'personal-manual-v1',spaceId,type,input:{spaceId,confirmed:true,fields}}},
    createdAt:'2030-11-01T00:00:00Z',updatedAt:'2030-11-01T00:00:00Z',syncState:'draft',externalStatus:null};
  }
  const dates={plannedStartOn:'2030-10-28',plannedEndOn:'2030-11-08'};
  const title='合成完整计划：标题在时间轴横向滚动后仍保持可读';
  const rows=[
   entry(1,'todo',title,dates),
   entry(2,'todo','合成截止日期',{dueOn:'2030-12-06'}),
   entry(3,'todo','合成未排期待办',{plannedStartOn:'2030-11-03'}),
   entry(4,'project',title,dates),
   entry(5,'project','合成未排期项目',{}),
  ];
  const fixture = {scope:'full-current-snapshot',truncated:false,total:rows.length,items:rows,today:'2030-11-01',observedAt:'2030-11-01T00:00:00Z'};
  assert.equal(workspaceData(fixture,spaceId,fixture.today).data.projects.length,2);
  let writes=0;
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==origin)return route.abort();
   if(!['GET','HEAD'].includes(request.method())){writes++;return route.abort();}
   if(!url.pathname.startsWith('/api/'))return route.continue();
   if(url.pathname==='/api/platform/personal/availability')return route.fulfill({json:{configured:true,loginAllowed:true,https:false,transport:'ssh-loopback',origin,writable:false}});
   if(url.pathname==='/api/platform/personal/status')return route.fulfill({json:{scope:'personal-manual-candidate',ownerId,spaceId,storageVerified:true,allowedTypes:['todo','journal','project','domain','topic'],writable:false}});
   if(url.pathname==='/api/platform/personal/overview')return route.fulfill({json:{scope:'full-current-snapshot',truncated:false,total:rows.length,items:rows,today:url.searchParams.get('today'),observedAt:'2030-11-01T00:00:00Z'}});
   if(url.pathname==='/api/platform/personal/todo/'+uuid(1))return route.fulfill({json:{entry:rows[0]}});
   if(url.pathname==='/api/platform/personal/todo/'+uuid(1)+'/history')return route.fulfill({json:{items:[rows[0]],truncated:false}});
   return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
  });
  const failedLayouts:string[]=[];
  for(const width of [390,1365])for(const theme of ['light','dark'] as const)for(const label of ['项目','待办'] as const){
   await page.setViewportSize({width,height:900});
   await page.emulateMedia({colorScheme:theme});
   const path='/personal?page='+(label==='待办'?'tasks':'projects');
   await page.goto(origin+path,{waitUntil:'domcontentloaded',timeout:60000});
   await expect(page.locator('html')).toHaveAttribute('data-lifeos-theme',theme);
   const switcher=page.getByRole('group',{name:label+'视图',exact:true});
   if(label==='待办')await expect(page.locator('[data-task-grid="reui"]')).toBeVisible();
   await switcher.getByRole('button',{name:'甘特',exact:true}).click();
   const gantt=page.getByRole('region',{name:label+'甘特',exact:true});
   const row=gantt.locator('[data-gantt-record="'+uuid(label==='待办'?1:4)+'"]');
   await expect(row.getByRole('img',{name:'计划 2030-10-28 至 2030-11-08'})).toBeVisible();
   const viewport=gantt.locator('header + div');
   const geometry=await viewport.evaluate((node,id)=>{
    const row=node.querySelector('[data-gantt-record="'+id+'"]')!;
    const control=row.querySelector('a,button')!;
    const track=row.querySelector('[role=img]')!;
    const axis=node.querySelector('[data-gantt-scale]')!;
    const before=control.getBoundingClientRect();
    const x=track.getBoundingClientRect().left;
    const aligned=Math.abs(x-axis.getBoundingClientRect().left)<=1;
    node.scrollLeft=node.scrollWidth;
    const after=control.getBoundingClientRect(),frame=node.getBoundingClientRect();
    const titleStaysVisible=after.left>=frame.left-1&&after.right<=frame.right+1&&Math.abs(after.left-before.left)<=1;
    const lastTick=node.querySelector('[data-gantt-scale] time:last-child')!.getBoundingClientRect();
    const endVisible=lastTick.right<=frame.right+1;
    const canScroll=node.scrollWidth>node.clientWidth;
    node.scrollLeft=0;
    return {aligned,titleStaysVisible,endVisible,canScroll,gap:x-before.right,height:before.height,pageFits:document.documentElement.scrollWidth<=innerWidth};
   },uuid(label==='待办'?1:4));
   const valid=geometry.titleStaysVisible&&geometry.aligned&&geometry.endVisible&&geometry.pageFits
    &&geometry.gap>=0&&geometry.gap<=18&&geometry.height<=64
    &&(width!==390||geometry.canScroll&&geometry.height>=44);
   const evidence=JSON.stringify({width,theme,label,...geometry});
   console.log('GANTT_LAYOUT '+evidence);
   if(!valid){failedLayouts.push(evidence);continue;}
   if(width===390){
    await viewport.press('ArrowRight');
    await expect.poll(()=>viewport.evaluate(node=>node.scrollLeft)).toBeGreaterThan(0);
    await viewport.evaluate(node=>{node.scrollLeft=0;});
   }
   await expect(gantt.locator('[data-gantt-bar]')).toHaveCount(1);
   await expect(gantt.locator('[data-gantt-milestone]')).toHaveCount(label==='待办'?1:0);
   if(label==='待办'){
    await expect(gantt.getByText('合成未排期待办',{exact:true})).toBeVisible();
    const button=row.getByRole('button',{name:'查看待办 '+title,exact:true});
    await button.press('Enter');
    await expect(page.getByRole('dialog',{name:'待办详情',exact:true}).getByRole('heading',{name:title,exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(button).toBeFocused();
   }else{
    const link=row.getByRole('link',{name:title,exact:true});
    const href='/personal/edit?type=project&id='+uuid(4);
    await expect(link).toHaveAttribute('href',href);
    await page.route(origin+href,route=>route.fulfill({body:'Synthetic project destination'}),{times:1});
    await link.press('Enter');
    await expect(page).toHaveURL(origin+href);
    await page.goto(origin+path,{waitUntil:'domcontentloaded'});
    await switcher.getByRole('button',{name:'甘特',exact:true}).click();
   }
   await gantt.getByRole('button',{name:'查看'+label+'表格',exact:true}).press('Enter');
   await expect(gantt).toHaveCount(0);
  }
  assert.deepEqual(failedLayouts,[]);
  assert.equal(writes,0);
  assert.deepEqual(errors,[]);
 }finally{await cleanupAuthThemeFixture({root,browser,browserServer,browserProcess,server:serverProcess});}
});
