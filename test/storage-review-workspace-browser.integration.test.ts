import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {on} from 'node:events';
import {cp,mkdir,mkdtemp,readFile,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,expect,type Browser,type BrowserServer} from '@playwright/test';
import {PlatformError} from '../src/platform/domain.ts';
import {handleStorageReviewRequest} from '../src/storage-review/http.ts';
import {StorageReviewService} from '../src/storage-review/service.ts';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';
import {journalFixture} from './helpers/journal-history.ts';
import {MemoryPort} from './helpers/platform.ts';

test('OPT-IN authoritative storage route in the personal workspace preserves shell, drafts and server fences',{
 skip:process.env.RUN_STORAGE_REVIEW_WORKSPACE_BROWSER_TESTS!=='1'&&'Requires the composed storage route and disposable Next/Chromium',
 timeout:180_000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-storage-workspace-'));
 let server:FixtureProcess|undefined,browserProcess:FixtureProcess|undefined,browser:Browser|undefined,browserServer:BrowserServer|undefined;
 t.after(()=>cleanupAuthThemeFixture({root,server,browserProcess,browser,browserServer}));
 const files=['app/layout.tsx','app/globals.css','app/theme.css','app/personal/layout.tsx','app/personal/page.tsx','app/personal/storage-review/page.tsx','postcss.config.mjs'];
 for(const file of files){await mkdir(join(root,file,'..'),{recursive:true});await cp(join(source,file),join(root,file));}
 await mkdir(join(root,'app/login'),{recursive:true});
 await cp(join(source,'src'),join(root,'src'),{recursive:true});
 await symlink(join(source,'node_modules'),join(root,'node_modules'));
 await symlink(join(source,'components'),join(root,'components'));
 await writeFile(join(root,'app/login/page.tsx'),'export default function Page(){return <h1>Synthetic login</h1>}');
 await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};');
 await writeFile(join(root,'src/platform/runtime.ts'),`
 export const readPlatformLoginCapability=async()=>({sessionDuration:false});
 export const readPlatformPasswordCapability=async()=>false;
 export const readPlatformPagePrincipal=async(headers)=>headers.get('cookie')?.includes('storage-fixture=1')?{userId:'storage-synthetic-owner'}:null;
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
 const endpoint='/api/platform/personal/storage-review',canonical='/personal/storage-review',tasksHref='/personal?page=tasks';
 const ownerId='storage-synthetic-owner',spaceId='storage-synthetic-space';
 const gate={timeout:20_000};
 const item=(id:string,title:string,status:'pending'|'protected'='pending')=>({id,title,status,kind:'file' as const,group:'合成归档',body:'仅供审核测试',question:''});
 const checklist={schema:1 as const,revision:'storage-shell-v1',context:{summary:'合成清单'},items:[
  {...item('G43','合成父目录'),kind:'folder' as const},item('G43.01','合成子项'),item('SAFE','合成受保护项','protected'),
 ]};
 for(const width of [1365,390,430]){
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:width===390?'dark':'light'});
  await page.context().addCookies([{name:'storage-fixture',value:'1',url:origin,httpOnly:true}]);
  const memory=new MemoryPort(),transaction=memory.transaction.bind(memory);
  memory.transaction=(owner,key,run)=>transaction(owner,key,tx=>run({...tx,lockRecordIdentity:async()=>{}}));
  const service=new StorageReviewService(memory,{ownerId,spaceId});
  await service.saveChecklist(ownerId,{expectedRevision:null,checklist},'synthetic-workspace-seed');
  let denied=false,unavailable=false,currentSpace=spaceId,alternate=false;
  const documents:string[]=[],errors:string[]=[],egress:string[]=[],wire:{method:string;path:string;status:number}[]=[];
  page.on('request',request=>{if(request.resourceType()==='document')documents.push(new URL(request.url()).pathname);});
  page.on('pageerror',error=>errors.push(error.message));
  const tasks=Array.from({length:55},(_,index)=>{
   const entry=journalFixture(100+index,null),fields={title:'合成工作台待办第 '+index+' 项',notes:'',dueOn:null,status:'open'};
   return {...entry,kind:'todo',draft:fields,source:{...entry.source,original:{marker:'personal-manual-v1',
    type:'todo',spaceId,input:{spaceId,confirmed:true,fields}}}};
  });
  await page.route('**/*',async route=>{
   const input=route.request(),url=new URL(input.url());
   if(url.origin!==origin){egress.push(url.origin);return route.abort();}
   if(!url.pathname.startsWith('/api/'))return route.continue();
   const path=url.pathname,method=input.method();
   if(path==='/api/platform/status')return route.fulfill({status:denied?401:200,json:{}});
   if(path.endsWith('/availability'))return route.fulfill({json:{configured:true,loginAllowed:true,transport:'ssh-loopback',origin}});
   if(path.endsWith('/status'))return route.fulfill({
    status:denied?401:unavailable?503:200,
    json:{scope:'personal-manual-candidate',ownerId,spaceId:currentSpace,storageVerified:true,storageReviewEnabled:true,writable:true,allowedTypes:['todo']},
   });
   if(path.endsWith('/workspace-snapshot'))return route.fulfill({json:{scope:'task-workspace-current-snapshot',truncated:false,total:tasks.length,items:tasks,today:url.searchParams.get('today'),observedAt:'2030-11-26T00:00:00.000Z'}});
   if(path!==endpoint&&path!==endpoint+'/notes')return route.fulfill({status:404,json:{}});
   let response:Response;
   try{
    response=alternate?Response.json({review:null}):(await handleStorageReviewRequest(new Request(url,{method,headers:await input.allHeaders(),...(input.postData()?{body:input.postData()}: {})}),{
     ownerId,baseURL:origin,service,
     assertOwner:async()=>{if(denied)throw new PlatformError(401,'OWNER_ONLY','Synthetic denial');},
     assertWritable:async()=>{},
    }))!;
   }catch(error){
    if(!(error instanceof PlatformError))throw error;
    response=Response.json({error:{code:error.code}},{status:error.status});
   }
   wire.push({method,path,status:response.status});
   return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
  });
  await page.goto(origin+tasksHref,{waitUntil:'domcontentloaded',timeout:60_000});
  await expect(page.getByRole('heading',{name:'待办',exact:true,level:1})).toBeVisible(gate);
  await expect(page.locator('[data-workspace-state=ready]')).toHaveCount(1,gate);
  await page.locator('header.lo-header').getByRole('button',{name:'打开设置',exact:true}).click();
  await expect(page).toHaveURL(origin+'/personal?page=settings',gate);
  const main=page.locator('#personal-main');
  const returnScroll=await main.evaluate(region=>region.scrollTop);
  const selectors=['.lo-shell','.lo-header','aside.lo-sidebar','#personal-main'];
  await page.evaluate(names=>{Object.assign(window,{storageShellProof:[document,...names.map(name=>document.querySelector(name))]});},selectors);
  const compare=()=>page.evaluate(names=>{
   const refs=Reflect.get(window,'storageShellProof');
   return [document,...names.map(name=>document.querySelector(name))].map((node,index)=>!!node&&node===refs[index]);
  },selectors);
  const navButton=page.getByRole('button',{name:'打开导航',exact:true});
  const openNavigation=async()=>{
   if(width===1365)return page.locator('aside.lo-sidebar').getByRole('navigation',{name:'设置分类',exact:true});
   await navButton.click();
   return page.getByRole('dialog',{name:'LifeOS',exact:true}).getByRole('navigation',{name:'设置分类',exact:true});
  };
  assert.equal(wire.length,0,'storage data must not be prefetched');
  const link=(await openNavigation()).getByRole('link',{name:'存储审核',exact:true});
  await expect(link).toHaveAttribute('href',canonical,gate);
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(origin+canonical,gate);
  const heading=page.getByRole('heading',{name:'存储审核',level:1,exact:true});
  await expect(heading).toBeFocused(gate);
  const childRow=page.locator('[data-storage-review-body] [data-id="G43.01"]');
  const note=childRow.getByLabel('备注与处理要求');
  await expect(note).toBeVisible(gate);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(await compare(),[true,true,true,true,true]);
  assert.deepEqual(documents,['/personal']);
  const style=await page.locator('[data-storage-review-body]').evaluate(node=>({
   color:getComputedStyle(node).color,
   theme:getComputedStyle(document.documentElement).getPropertyValue('--foreground').trim(),
  }));
  assert.ok(style.color&&style.theme);
  const filter=page.getByRole('searchbox',{name:'搜索资料'});
  await filter.fill('合成子项');
  await expect(page.locator('[data-id="G43"]')).toHaveAttribute('data-context','true');
  await expect(page.locator('[data-id="SAFE"]')).toHaveCount(0);
  const raw='  合成原文\n保留空白 '+width+'  ';
  await note.fill(raw);
  const before=wire.filter(row=>row.method!=='GET').length;
  const exportButton=page.getByRole('button',{name:'导出决定',exact:true});
  const [download]=await Promise.all([page.waitForEvent('download'),exportButton.click()]);
  const exported=JSON.parse(await readFile(await download.path(),'utf8'));
  assert.deepEqual(exported.noteDrafts,[{id:'G43.01',note:raw,checklistRevision:checklist.revision,expectedRevision:1}]);
  assert.equal(wire.filter(row=>row.method!=='GET').length,before);
  const backPrompt=page.waitForEvent('dialog');
  await page.evaluate(()=>{setTimeout(()=>history.back(),0);});
  await (await backPrompt).dismiss();
  await expect(page).toHaveURL(origin+canonical,gate);
  await expect(note).toHaveValue(raw);
  await expect(filter).toHaveValue('合成子项');
  const beforeSave=wire.length;
  await childRow.getByRole('button',{name:'保存备注',exact:true}).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#notice')).toHaveText('备注已保存，并已读回 LifeOS。',gate);
  assert.deepEqual(wire.slice(beforeSave).map(row=>[row.method,row.status]),[['PATCH',200],['GET',200]]);
  assert.deepEqual((await service.get(ownerId))?.notes,[{id:'G43.01',note:raw}]);
  const keep=childRow.getByRole('radio',{name:'留',exact:true});
  await keep.focus();
  await page.keyboard.press('Space');
  await expect(keep).toBeChecked(gate);
  await childRow.getByRole('button',{name:'撤销决定'}).click();
  await expect(keep).not.toBeChecked(gate);
  await page.goBack();
  await expect(page).toHaveURL(origin+'/personal?page=settings',gate);
  assert.deepEqual(await compare(),[true,true,true,true,true]);
  await expect.poll(()=>main.evaluate(region=>region.scrollTop),gate).toBe(returnScroll);
  await expect(width===1365?link:navButton).toBeFocused(gate);
  assert.deepEqual(documents,['/personal']);

  await page.goto(origin+canonical+'?review=storage-shell-v1',{waitUntil:'domcontentloaded'});
  await expect(note).toHaveValue(raw,gate);
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(note).toHaveValue(raw,gate);
  assert.equal(new URL(page.url()).searchParams.get('review'),checklist.revision);
  if(width===1365){
   await note.fill('合成旧空间草稿');
   unavailable=true;
   await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
   await expect(page.getByText('暂时无法核对本人空间。清单已隐藏。')).toBeVisible(gate);
   await expect(note).toBeHidden();
   unavailable=false;alternate=true;currentSpace='storage-synthetic-other-space';
   await page.getByRole('button',{name:'重新核对'}).click();
   await expect(page.getByText('清单为空。请选择「导入清单」。')).toBeVisible(gate);
   await expect(childRow).toHaveCount(0);
   assert.equal((await page.locator('[data-storage-review-body]').textContent())?.includes('合成旧空间草稿'),false);
   denied=true;
   await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
   await expect(page.getByRole('button',{name:'重新核对'})).toBeVisible(gate);
   await expect(childRow).toHaveCount(0);
  }
  console.log('STORAGE_WORKSPACE_PROOF '+JSON.stringify({width,softDocuments:1,sameShell:true,scroll:returnScroll,keyboard:true,writeReadback:true,draftCancel:true,deepReload:true}));
  assert.deepEqual(errors,[]);assert.deepEqual(egress,[]);
  await page.close();
 }
 const anonymous=await browser.newPage();
 await anonymous.goto(origin+canonical);
 await expect(anonymous).toHaveURL(origin+'/login');
 await expect(anonymous.locator('[data-storage-review-body]')).toHaveCount(0);
 await anonymous.close();
});
