import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {on} from 'node:events';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,expect,type Browser,type BrowserServer,type Page} from '@playwright/test';
import {journalFixture,journalStatus} from './helpers/journal-history.ts';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';

test('OPT-IN actual tasks and journal navigation preserve the owner shell across route commits',{
 skip:process.env.RUN_WORKSPACE_PERSISTENT_ROUTE_BROWSER_TESTS!=='1'&&'Requires synthetic Next and Chromium',timeout:180_000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'), root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-persistent-route-'));
 let server:FixtureProcess|undefined,browserProcess:FixtureProcess|undefined,browser:Browser|undefined,browserServer:BrowserServer|undefined;
 t.after(()=>cleanupAuthThemeFixture({root,server,browserProcess,browser,browserServer}));
 await mkdir(join(root,'app/personal/journal'),{recursive:true});
 await mkdir(join(root,'app/login'),{recursive:true});
 await Promise.all([
  ...['layout.tsx','globals.css','theme.css','personal/layout.tsx','personal/page.tsx','personal/journal/page.tsx'].map(file=>cp(join(source,'app',file),join(root,'app',file))),
  cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),cp(join(source,'src'),join(root,'src'),{recursive:true}),
  symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components')),
 ]);
 await writeFile(join(root,'app/login/page.tsx'),'export default function Page(){return <h1>Synthetic login</h1>}');
 await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
 await writeFile(join(root,'src/platform/runtime.ts'),`
 export const readPlatformLoginCapability=async()=>({sessionDuration:false});
 export const readPlatformPasswordCapability=async()=>false;
 export const readPlatformPagePrincipal=async(headers)=>headers.get('cookie')?.includes('synthetic-owner=1')&&!headers.get('cookie')?.includes('synthetic-deny=1')?{id:'synthetic-owner'}:null;
 `);
 const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{
  cwd:root,detached:true,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],
 });
 server=trackAuthThemeProcess(child,true);
 child.stderr.resume();
 let origin='',output='';
 for await(const [chunk] of on(child.stdout,'data',{signal:AbortSignal.timeout(30000)})){
  output=(output+String(chunk)).slice(-4000);
  const match=output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
  if(match&&/Ready in\b/.test(output)){origin=match;break;}
 }
 assert.ok(origin);
 browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
 browserProcess=trackAuthThemeProcess(browserServer.process());
 browser=await chromium.connect(browserServer.wsEndpoint());
 const artifactDir=process.env.LIFEOS_PERSISTENT_ROUTE_ARTIFACT_DIR;
 if(artifactDir)await mkdir(artifactDir,{recursive:true});
 const before=process.env.LIFEOS_PERSISTENT_ROUTE_EXPECT_RELOAD==='1';
 for(const width of [1365,390,430]){
  const page:Page=await browser.newPage({viewport:{width,height:900}});
  await page.context().addCookies([{name:'synthetic-owner',value:'1',url:origin}]);
  const documents:string[]=[],errors:string[]=[],writes:string[]=[];
  page.on('request',request=>{if(request.resourceType()==='document')documents.push(new URL(request.url()).pathname);});
  page.on('pageerror',error=>errors.push(error.message));
  const fixture=journalFixture(25,'2030-11-26','Synthetic journal body');
  const tasks=Array.from({length:55},(_,index)=>{
   const entry=journalFixture(100+index,null);
   const fields={title:'合成待办长标题 保留日记导航与滚动 '.repeat(3)+index,notes:'',dueOn:null,status:'open'};
   return {...entry,kind:'todo',draft:fields,source:{...entry.source,original:{marker:'personal-manual-v1',
    type:'todo',spaceId:journalStatus.spaceId,input:{spaceId:journalStatus.spaceId,confirmed:true,fields}}}};
  });
  await page.route('**/api/platform/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==origin)return route.abort();
   if(request.method()!=='GET'){writes.push(request.method());return route.fulfill({status:405,json:{}});}
   const path=url.pathname;
   if(path.endsWith('/availability'))return route.fulfill({json:{configured:true,loginAllowed:true,transport:'ssh-loopback',origin}});
   if(path.endsWith('/status'))return route.fulfill({json:{...journalStatus,ownerId:'synthetic-owner',scope:'personal-manual-candidate',writable:true,allowedTypes:['todo','journal']}});
   if(path.endsWith('/overview')||path.endsWith('/workspace-snapshot'))return route.fulfill({json:{scope:path.endsWith('/overview')?'full-current-snapshot':'task-workspace-current-snapshot',truncated:false,total:tasks.length,items:tasks,today:url.searchParams.get('today'),observedAt:'2030-11-26T00:00:00.000Z'}});
   if(path.endsWith('/journal/snapshot'))return route.fulfill({json:{scope:'full-current-snapshot',truncated:false,total:1,items:[fixture],observedAt:'2030-11-26T00:00:00.000Z'}});
   return route.fulfill({status:404,json:{}});
  });
  const coldStart=performance.now();
  await page.goto(origin+'/personal?page=tasks',{waitUntil:'domcontentloaded',timeout:60000});
  const menuButton=page.getByRole('button',{name:'打开导航',exact:true});
  const openNav=async()=>{
   if(await menuButton.isVisible()){
    await menuButton.click();
    return page.getByRole('dialog',{name:'LifeOS',exact:true}).getByRole('navigation',{name:'主导航',exact:true});
   }
   return page.locator('aside.lo-sidebar').getByRole('navigation',{name:'主导航',exact:true});
  };
  await expect(page.getByRole('heading',{name:'待办',exact:true,level:1})).toBeVisible();
  await expect(page.locator('header.lo-header').getByRole('link',{name:'搜索本人记录',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'列表',exact:true}).click();
  const taskRows=page.locator('.lo-list-rows');
  await expect(taskRows).toBeVisible();
  await expect(taskRows.locator('.lo-task-row')).toHaveCount(tasks.length);
  const taskDataReadyMs=Math.round(performance.now()-coldStart);
  await taskRows.evaluate(region=>{region.scrollTop=240;});
  await expect.poll(()=>taskRows.evaluate(region=>region.scrollTop)).toBe(240);
  const nodes=['.lo-shell','.lo-header','aside.lo-sidebar','.lo-header nav[aria-label="切换模块"]','#personal-main'];
  const capture=()=>page.evaluate((selectors)=>{
   const refs=selectors.map(selector=>document.querySelector(selector));
   Object.assign(window,{shellRouteProof:{document,refs}});
   return refs.map(node=>node&&[node.getBoundingClientRect().x,node.getBoundingClientRect().y,node.getBoundingClientRect().width,node.getBoundingClientRect().height]);
  },nodes);
  const compare=()=>page.evaluate((selectors)=>{
   const proof=(window as Window&{shellRouteProof?:{document:Document;refs:(Element|null)[]}}).shellRouteProof;
   return {sameDocument:proof?.document===document,sameNodes:selectors.map((selector,index)=>!!proof?.refs[index]&&proof.refs[index]===document.querySelector(selector))};
  },nodes);
  const initialFrame=await capture();
  if(artifactDir)await page.screenshot({path:join(artifactDir,`${before?'before':'after'}-tasks-${width}.png`)});
  const link=(await openNav()).getByRole('link',{name:/^(日记|记录)$/});
  await expect(link).toHaveAttribute('href','/personal/journal');
  await link.focus();
  const journalStart=performance.now();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(origin+'/personal/journal',{timeout:30000});
  await expect(page.getByRole('heading',{name:'记录',exact:true,level:1})).toBeVisible({timeout:30000});
  await expect(page.getByRole('link',{name:'Synthetic diary 25',exact:true})).toBeVisible({timeout:30000});
  const journalDataReadyMs=Math.round(performance.now()-journalStart);
  const journal=await compare();
  const journalFrame=await page.evaluate((selectors)=>selectors.map(selector=>{
   const box=document.querySelector(selector)?.getBoundingClientRect();
   return box&&[box.x,box.y,box.width,box.height];
  }),nodes);
  if(!before){
   assert.deepEqual(journalFrame.slice(0,4),initialFrame.slice(0,4));
   assert.deepEqual(journalFrame[4]?.slice(0,3),initialFrame[4]?.slice(0,3));
   await expect(page.getByRole('heading',{name:'记录',exact:true,level:1})).toBeFocused();
   const nav=await openNav();
   await expect(nav.getByRole('link',{name:/^(日记|记录)$/})).toHaveAttribute('aria-current','page');
   if(await page.getByRole('button',{name:'关闭导航',exact:true}).isVisible())await page.keyboard.press('Escape');
  }
  if(artifactDir)await page.screenshot({path:join(artifactDir,`${before?'before':'after'}-journal-${width}.png`)});
  let backStart=performance.now();
  if(!before&&width===1365){
   await page.getByText('管理日记',{exact:true}).click();
   await page.getByRole('button',{name:'新增日记',exact:true}).click();
   const draft=page.getByRole('textbox',{name:'正文',exact:true});
   await draft.fill('只保留在合成日记中的草稿');
   const dismissed=page.waitForEvent('dialog');
   await page.evaluate(()=>{setTimeout(()=>history.back(),0);});
   const prompt=await dismissed;
   assert.equal(prompt.type(),'confirm');
   await prompt.dismiss();
   await expect(page).toHaveURL(origin+'/personal/journal');
   await expect(draft).toHaveValue('只保留在合成日记中的草稿');
   const allowed=page.waitForEvent('dialog');
   backStart=performance.now();
   await page.evaluate(()=>{setTimeout(()=>history.back(),0);});
   await (await allowed).accept();
  }else if(!before&&width===430){
   await (await openNav()).getByRole('button',{name:'待办',exact:true}).click();
  }else await page.goBack();
  await expect(page).toHaveURL(origin+'/personal?page=tasks');
  await expect(page.getByRole('heading',{name:'待办',exact:true,level:1})).toBeVisible();
  await expect(page.locator('[data-workspace-state="ready"]')).toHaveCount(1);
  const returnDataReadyMs=Math.round(performance.now()-backStart);
  const back=await compare();
  console.log('WORKSPACE_PERSISTENT_ROUTE '+JSON.stringify({width,documents,journal,back,initialFrame,taskDataReadyMs,journalDataReadyMs,returnDataReadyMs}));
  assert.equal(journal.sameDocument,!before);
  if(!before){
   assert.deepEqual(journal.sameNodes,[true,true,true,true,true]);
   assert.equal(back.sameDocument,true);
   assert.deepEqual(back.sameNodes,[true,true,true,true,true]);
   assert.deepEqual(documents,['/personal']);
   await expect.poll(()=>taskRows.evaluate(region=>region.scrollTop)).toBe(240);
   const taskHeading=page.getByRole('heading',{name:'待办',exact:true,level:1});
   await expect(width===1365?link:width===390?menuButton:taskHeading).toBeFocused();
   const nav=await openNav();
   await expect(nav.getByRole('button',{name:'待办',exact:true})).toHaveAttribute('aria-current','page');
   if(await page.getByRole('button',{name:'关闭导航',exact:true}).isVisible())await page.keyboard.press('Escape');
   console.log('WORKSPACE_ROUTE_RETURN '+JSON.stringify({width,restoredScrollTop:240,draftGuard:width===1365,nativeBack:width!==430}));
   if(width===430){
    await page.getByRole('button',{name:'LifeOS 总览',exact:true}).click();
    await expect(page.getByRole('heading',{name:'总览',exact:true,level:1})).toBeVisible();
    const overviewUrl=page.url();
    await (await openNav()).getByRole('link',{name:/^(日记|记录)$/}).click();
    await expect(page.getByRole('link',{name:'Synthetic diary 25',exact:true})).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(overviewUrl);
    await expect(page.getByRole('heading',{name:'总览',exact:true,level:1})).toBeVisible();
    await expect(menuButton).toBeFocused();
    assert.deepEqual(await compare(),{sameDocument:true,sameNodes:[true,true,true,true,true]});
    assert.deepEqual(documents,['/personal']);
    console.log('WORKSPACE_OVERVIEW_RETURN '+JSON.stringify({width,restoredFocus:'打开导航',documents}));
   }
  }
  assert.deepEqual(errors,[]);
  assert.deepEqual(writes,[]);
  await page.close();
 }
 if(!before){
  const signedOut=await browser.newPage();
  await signedOut.goto(origin+'/personal/journal?record=bad');
  await expect(signedOut).toHaveURL(origin+'/login');
  await expect(signedOut.getByRole('heading',{name:'Synthetic login'})).toBeVisible();
  await expect(signedOut.locator('.lo-shell')).toHaveCount(0);
  await signedOut.close();
 }
});
