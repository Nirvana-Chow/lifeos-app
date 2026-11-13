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

test('OPT-IN multiline todo preview sequential readback reload and mobile keyboard',{
 skip:process.env.RUN_TASK_BATCH_BROWSER_TESTS!=='1'&&'Requires isolated synthetic Next fixture and native Chrome',timeout:180_000,
},async()=>{
 let releaseHeldReadback:(()=>void)|undefined;
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-task-project-planning-'));
 let serverProcess:FixtureProcess|undefined,browserProcess:FixtureProcess|undefined,browserServer:Awaited<ReturnType<typeof chromium.launchServer>>|undefined,browser:Awaited<ReturnType<typeof chromium.connect>>|undefined;
 try{
  await mkdir(join(root,'app/personal/edit'),{recursive:true});
  await Promise.all([cp(join(source,'src'),join(root,'src'),{recursive:true}),...['layout.tsx','globals.css','theme.css'].map(file=>cp(join(source,'app',file),join(root,'app',file))),cp(join(source,'app/personal/page.tsx'),join(root,'app/personal/page.tsx')),cp(join(source,'app/personal/edit/page.tsx'),join(root,'app/personal/edit/page.tsx')),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components'))]);
  await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
  await writeFile(join(root,'src/platform/runtime.ts'),'export const readPlatformPagePrincipal=async()=>({id:"synthetic-planning-owner"});export const readPlatformPasswordCapability=async()=>false;\n');
  const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3127'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],detached:true});serverProcess=trackAuthThemeProcess(server,true);server.stderr.on('data',chunk=>process.stderr.write(chunk));
  const origin=await new Promise<string>((accept,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Fixture startup timeout')),30_000);server.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture exited'));});server.once('error',error=>{clearTimeout(timer);reject(error);});server.stdout.on('data',chunk=>{process.stdout.write(chunk);output=(output+String(chunk)).slice(-65536);const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});});
  browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH,host:'127.0.0.1'});browserProcess=trackAuthThemeProcess(browserServer.process());browser=await chromium.connect(browserServer.wsEndpoint());
  const page=await browser.newPage({viewport:{width:1365,height:900},colorScheme:'light'});page.setDefaultTimeout(9000);
  const ownerId='synthetic-planning-owner',spaceId='synthetic-batch-space';
  const entries:any[]=[],receipts=new Map<string,any>(),calls:{key:string;body:any}[]=[],errors:string[]=[];
  let readbacks=0,loseSecond=true,expired=false,expirePost=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/login',route=>route.fulfill({contentType:'text/html',body:'<html><body>synthetic login destination</body></html>'}));
  await page.route('**/api/platform/personal/**',async route=>{
   const request=route.request(),url=new URL(request.url()),headers={'cache-control':'private, no-store'};
   if(request.method()==='POST'){
    const key=request.headers()['idempotency-key'],body=request.postDataJSON();calls.push({key,body});
    if(expired||expirePost)return route.fulfill({status:401,json:{error:{code:'UNAUTHORIZED'}},headers});
    const duplicate=receipts.has(key);let entry=receipts.get(key);
    if(!entry){const id=crypto.randomUUID();entry={id,kind:'todo',revision:1,draft:normalizePersonalFields('todo',body.fields),source:{id:crypto.randomUUID(),system:'website',externalId:id,version:1,asOf:'2030-11-01T00:00:00Z',original:{marker:'personal-manual-v1',spaceId,type:'todo',input:body}},createdAt:'2030-11-01T00:00:00Z',updatedAt:'2030-11-01T00:00:00Z',syncState:'draft',externalStatus:null};entries.push(entry);receipts.set(key,entry);}
    if(body.fields.title==='合成原单条待确认'&&!duplicate)return route.abort();
    return route.fulfill({status:duplicate?200:201,json:{entry,duplicate},headers});
   }
   if(url.pathname.endsWith('/availability'))return route.fulfill({json:{configured:true,loginAllowed:true,transport:'ssh-loopback',origin},headers});
   if(url.pathname.endsWith('/status'))return route.fulfill({status:expired?401:200,json:expired?{}:{scope:'personal-manual-candidate',ownerId,spaceId,storageVerified:true,writable:true,allowedTypes:['todo']},headers});
   if(url.pathname.endsWith('/overview'))return route.fulfill({json:{scope:'full-current-snapshot',truncated:false,total:entries.length,items:entries,today:url.searchParams.get('today'),observedAt:'2030-11-01T00:00:00Z'},headers});
   const entry=entries.find(e=>url.pathname.endsWith('/'+e.id));
   if(entry){readbacks++;if(loseSecond&&entries.indexOf(entry)===1)return route.abort();return route.fulfill({json:{entry},headers});}
   return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}},headers});
  });
  await page.goto(origin+'/personal?page=tasks',{waitUntil:'networkidle',timeout:60000});
  await page.getByRole('button',{name:'新建待办',exact:true}).click();
  await page.getByRole('button',{name:'多行录入',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'多行录入待办',exact:true});await expect(dialog).toBeVisible();
  await dialog.getByLabel('原始输入（最多50行）').fill('明天交稿\n\n明天交稿\n第三项');
  await dialog.getByRole('button',{name:'预检条目'}).click();
  await expect(dialog.getByText('空白行：请填写或取消勾选',{exact:true})).toBeVisible();
  await expect(dialog.getByText('重复行：请编辑或取消勾选',{exact:true})).toBeVisible();
  await dialog.getByRole('checkbox',{name:'保存第2项',exact:true}).uncheck();
  await dialog.getByRole('textbox',{name:'第3项标题',exact:true}).fill('第二项');
  assert.equal(calls.length,0);await dialog.getByRole('button',{name:'确认顺序保存'}).click();
  await expect(dialog.getByRole('button',{name:'核对原请求并继续'})).toBeEnabled();
  assert.equal(calls.length,2);assert.equal(entries.length,2);assert.equal(readbacks,2);
  assert.equal(entries[0].draft.dueOn,null);assert.equal(entries[0].draft.title,'明天交稿');
  page.once('dialog',d=>d.accept());await page.reload({waitUntil:'networkidle'});
  await expect(dialog).toBeVisible();await expect(dialog.getByText('第1项 · 已保存并回读',{exact:true})).toBeVisible();
  expired=true;await dialog.getByRole('button',{name:'核对原请求并继续'}).click();
  await expect(dialog).toHaveCount(0);assert.equal(calls.length,2);await expect(page.getByRole('textbox',{name:'第3项标题',exact:true})).toHaveCount(0);
  expired=false;page.once('dialog',d=>d.accept());await page.reload({waitUntil:'networkidle'});await expect(dialog).toBeVisible();
  expirePost=true;await dialog.getByRole('button',{name:'核对原请求并继续'}).click();await expect.poll(()=>calls.length).toBe(3);await expect(dialog).toHaveCount(0);
  assert.deepEqual(calls[1],calls[2]);assert.equal(entries.length,2);
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'前往登录',exact:true}).click();await page.waitForURL(origin+'/login');assert.equal(calls.length,3);
  expirePost=false;loseSecond=false;await page.goto(origin+'/personal?page=tasks',{waitUntil:'networkidle'});await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'核对原请求并继续'}).click();
  await expect(dialog.getByText('第4项 · 已保存并回读',{exact:true})).toBeVisible();
  assert.equal(calls.length,5);assert.deepEqual(calls[1],calls[3]);assert.equal(entries.length,3);
  assert.equal(calls.filter(c=>c.key===calls[0].key).length,1);
  await page.setViewportSize({width:360,height:800});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await dialog.getByRole('button',{name:'清空批次'}).click();await expect(dialog.getByLabel('原始输入（最多50行）')).toBeVisible();
  await dialog.getByLabel('原始输入（最多50行）').focus();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'新建待办',exact:true}).click();await page.getByRole('button',{name:'多行录入',exact:true}).click();
  await dialog.getByLabel('原始输入（最多50行）').fill('合成保留未尝试批次');await dialog.getByRole('button',{name:'预检条目'}).click();
  page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'关闭并保留',exact:true}).click();await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'新建待办',exact:true}).click();const single=page.getByRole('dialog',{name:'新建待办',exact:true});await single.getByLabel('标题',{exact:true}).fill('合成原单条待确认');await single.getByRole('button',{name:'保存待办',exact:true}).click();await expect(single.getByRole('button',{name:'重试同一请求',exact:true})).toBeEnabled();
  assert.equal(calls.length,6);page.once('dialog',d=>d.accept());await page.reload({waitUntil:'networkidle'});await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'重试同一请求',exact:true}).click();await expect(page.getByRole('button',{name:'重试同一请求',exact:true})).toHaveCount(0);assert.equal(calls.length,7);assert.deepEqual(calls[5],calls[6]);assert.equal(entries.length,4);
  await page.getByRole('button',{name:'新建待办',exact:true}).click();await page.getByRole('button',{name:'多行录入',exact:true}).click();await expect(dialog.getByRole('textbox',{name:'第1项标题',exact:true})).toHaveValue('合成保留未尝试批次');assert.equal(calls.length,7);
  assert.deepEqual(errors,[]);console.log('TASK_BATCH_BROWSER_PASS '+JSON.stringify({calls:calls.length,records:entries.length,readbacks,desktop:true,mobile:true,keyboard:true}));
 }finally{releaseHeldReadback?.();await cleanupAuthThemeFixture({root,browser,browserServer,browserProcess,server:serverProcess});}
});
