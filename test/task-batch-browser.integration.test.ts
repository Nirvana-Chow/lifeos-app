import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {personalEntryType} from '../src/personal-candidate/service.ts';
import type {PersonalConfig} from '../src/personal-candidate/config.ts';
import {MemoryPort} from './helpers/platform.ts';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';

test('OPT-IN multiline todo preview sequential readback reload and mobile keyboard',{
 skip:process.env.RUN_TASK_BATCH_BROWSER_TESTS!=='1'&&'Requires isolated synthetic Next fixture and native Chrome',timeout:180_000,
},async()=>{
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
  const page=await browser.newPage({viewport:{width:1365,height:900},colorScheme:'light'});page.setDefaultTimeout(9000);page.setDefaultNavigationTimeout(60000);
  const ownerId='synthetic-planning-owner',spaceId='synthetic-batch-space';
  const config:PersonalConfig={ownerId,spaceId,ownerEmail:'fixture@example.invalid',databaseName:'lifeos_platform_test_local',
   allowedTypes:['todo'],approval:'personal-manual-v1',baseURL:origin,transport:'ssh-loopback'};
  const repo=Object.assign(new MemoryPort(),{
   async readTaskWorkspaceSnapshot(owner:string,space:string,types:readonly string[]){
    return structuredClone([...repo.rows.values()].filter(row=>row.ownerId===owner&&types.includes(personalEntryType(row,space)??'')));
   },
  });
  repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(row=>row.ownerId===owner));
  const calls:{key:string;body:any}[]=[],errors:string[]=[];
  let readbacks=0,loseSecond=true,expired=false,expirePost=false;
  const handler=createPersonalPlatformHandler({repository:repo,config,storageVerified:true,
   sessions:{read:async headers=>expired||expirePost&&headers.has('idempotency-key')?null:{userId:ownerId,email:config.ownerEmail}},
   assertWritable:async()=>{},
  });
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/login',route=>route.fulfill({contentType:'text/html',body:'<html><body>synthetic login destination</body></html>'}));
  await page.route('**/api/platform/personal/**',async route=>{
   const request=route.request(),url=new URL(request.url()),method=request.method(),headers=new Headers(request.headers());
   headers.set('host',url.host);
   const body=request.postData()??undefined;
   if(method==='POST')calls.push({key:headers.get('idempotency-key')!,body:JSON.parse(body!)});
   const reply=await handler(new Request(url,{method,headers,body}));
   if(method==='POST'&&reply.status===201&&JSON.parse(body!).fields.title==='合成原单条待确认')return route.abort();
   const entries=[...repo.rows.values()];
   if(method==='GET'&&entries.some(row=>url.pathname.endsWith('/'+row.id))){
    readbacks++;
    if(loseSecond&&url.pathname.endsWith('/'+entries[1]?.id))return route.abort();
   }
   return route.fulfill({status:reply.status,headers:Object.fromEntries(reply.headers),body:await reply.text()});
  });
  const read=async(path:string)=>handler(new Request(origin+'/api/platform/personal/'+path,{headers:{host:new URL(origin).host}}));
  await page.goto(origin+'/personal?page=tasks',{waitUntil:'networkidle',timeout:60000});
  await page.getByRole('button',{name:'多行录入',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'多行录入待办',exact:true});await expect(dialog).toBeVisible();
  await dialog.getByLabel('原始输入（最多50行）').fill('明天交稿\n\n 明天交稿 \n第三项');
  await dialog.getByRole('button',{name:'预检条目'}).click();
  await expect(dialog.getByText('空白行：请填写或取消勾选',{exact:true})).toBeVisible();
  await expect(dialog.getByText('重复行：请编辑或取消勾选',{exact:true})).toBeVisible();
  await dialog.getByRole('checkbox',{name:'保存第2项',exact:true}).uncheck();
  await dialog.getByRole('textbox',{name:'第3项标题',exact:true}).fill('第二项');
  assert.equal(calls.length,0);assert.equal(repo.rows.size,0);assert.equal(repo.receipts.size,0);await dialog.getByRole('button',{name:'确认顺序保存'}).click();
  await expect(dialog.getByRole('button',{name:'核对原请求并继续'})).toBeEnabled();
  assert.equal(calls.length,2);assert.equal(repo.rows.size,2);assert.equal(readbacks,2);
  const [first,second]=[...repo.rows.values()];
  assert.equal('dueOn'in first.draft&&first.draft.dueOn,null);
  assert.equal(calls[0].body.originalLine,'明天交稿');
  assert.equal(calls[1].body.originalLine,' 明天交稿 ');
  const secondRead=await read('todo/'+second.id);assert.equal(secondRead.status,200);
  const {entry:observed}=await secondRead.json();
  assert.equal(observed.draft.title,'第二项');assert.equal(observed.draft.dueOn,null);
  assert.equal(observed.source.original.input.originalLine,' 明天交稿 ');
  assert.equal(observed.source.original.input.fields.title,'第二项');
  assert.equal(repo.receipts.size,2);assert.equal(repo.events.length,2);
  page.once('dialog',d=>d.accept());await page.reload({waitUntil:'networkidle'});
  await expect(dialog).toBeVisible();await expect(dialog.getByText('第1项 · 已保存并回读',{exact:true})).toBeVisible();
  expired=true;
  for(const path of ['todo/'+second.id,'todo/'+second.id+'/history']){
   const denied=await read(path);assert.equal(denied.status,401);assert.doesNotMatch(await denied.text(),/明天交稿|第二项/);
  }
  await dialog.getByRole('button',{name:'核对原请求并继续'}).click();
  await expect(dialog).toHaveCount(0);assert.equal(calls.length,2);await expect(page.getByRole('textbox',{name:'第3项标题',exact:true})).toHaveCount(0);
  expired=false;page.once('dialog',d=>d.accept());await page.reload({waitUntil:'networkidle'});await expect(dialog).toBeVisible();
  expirePost=true;await dialog.getByRole('button',{name:'核对原请求并继续'}).click();await expect.poll(()=>calls.length).toBe(3);await expect(dialog).toHaveCount(0);
  assert.deepEqual(calls[1],calls[2]);assert.equal(repo.rows.size,2);
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'前往登录',exact:true}).click();await page.waitForURL(origin+'/login');assert.equal(calls.length,3);
  expirePost=false;loseSecond=false;await page.goto(origin+'/personal?page=tasks',{waitUntil:'networkidle'});await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'核对原请求并继续'}).click();
  await expect(dialog.getByText('第4项 · 已保存并回读',{exact:true})).toBeVisible();
  assert.equal(calls.length,5);assert.deepEqual(calls[1],calls[3]);assert.equal(repo.rows.size,3);
  assert.equal(calls.filter(c=>c.key===calls[0].key).length,1);
  assert.equal(calls[4].body.originalLine,'第三项');assert.equal(repo.receipts.size,3);assert.equal(repo.events.length,3);
  const history=await (await read('todo/'+second.id+'/history')).json();
  assert.equal(history.items[0].source.original.input.originalLine,' 明天交稿 ');
  assert.equal(history.items[0].source.original.input.fields.title,'第二项');
  const search=await (await read('search?q='+encodeURIComponent('第二项'))).json();
  assert.equal(search.items[0].id,second.id);
  await page.setViewportSize({width:360,height:800});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await dialog.getByRole('button',{name:'清空批次'}).click();await expect(dialog.getByLabel('原始输入（最多50行）')).toBeVisible();
  await dialog.getByLabel('原始输入（最多50行）').focus();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await page.goto(origin+'/personal/edit?type=todo&id='+second.id,{waitUntil:'networkidle'});
  const detail=page.getByRole('dialog',{name:'待办详情',exact:true});
  await expect(detail).toBeVisible();
  const capture=detail.locator('details').filter({has:page.getByText('录入原文与初次确认',{exact:true})});
  await capture.locator('summary').click();
  await expect(capture).toContainText('初次确认标题');
  assert.deepEqual(await capture.locator('dd').allTextContents(),[' 明天交稿 ','第二项','未设置']);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.goto(origin+'/personal?page=tasks',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'多行录入',exact:true}).click();
  await dialog.getByLabel('原始输入（最多50行）').fill('合成保留未尝试批次');await dialog.getByRole('button',{name:'预检条目'}).click();
  page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'关闭并保留',exact:true}).click();await expect(dialog).toHaveCount(0);
  assert.equal(calls.length,5);assert.equal(repo.receipts.size,3);assert.equal(repo.events.length,3);
  await page.getByRole('button',{name:'新建待办',exact:true}).click();const single=page.getByRole('dialog',{name:'新建待办',exact:true});await single.getByLabel('标题',{exact:true}).fill('合成原单条待确认');await single.getByRole('button',{name:'保存待办',exact:true}).click();await expect(single.getByRole('button',{name:'重试同一请求',exact:true})).toBeEnabled();
  assert.equal(calls.length,6);page.once('dialog',d=>d.accept());await page.reload({waitUntil:'networkidle'});await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'重试同一请求',exact:true}).click();await expect(page.getByRole('button',{name:'重试同一请求',exact:true})).toHaveCount(0);assert.equal(calls.length,7);assert.deepEqual(calls[5],calls[6]);assert.equal(repo.rows.size,4);
  await page.getByRole('button',{name:'多行录入',exact:true}).click();await expect(dialog.getByRole('textbox',{name:'第1项标题',exact:true})).toHaveValue('合成保留未尝试批次');assert.equal(calls.length,7);
  assert.equal(Object.hasOwn(calls[5].body,'originalLine'),false);
  const legacy=[...repo.rows.values()].find(row=>'title'in row.draft&&row.draft.title==='合成原单条待确认')!;
  page.once('dialog',d=>d.accept());await page.goto(origin+'/personal/edit?type=todo&id='+legacy.id,{waitUntil:'networkidle'});
  await expect(detail).toBeVisible();await detail.getByText('录入原文与初次确认',{exact:true}).click();
  await expect(detail.getByText('原始输入未记录。',{exact:true})).toBeVisible();
  assert.deepEqual(errors,[]);console.log('TASK_BATCH_BROWSER_PASS '+JSON.stringify({calls:calls.length,records:repo.rows.size,readbacks,history:true,revocation:true,desktop:true,mobile:true,keyboard:true}));
 }finally{await cleanupAuthThemeFixture({root,browser,browserServer,browserProcess,server:serverProcess});}
});
