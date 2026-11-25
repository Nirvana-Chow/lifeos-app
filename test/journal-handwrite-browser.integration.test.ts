import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {MemoryPort} from './helpers/platform.ts';
import {journalRoutineTemplate} from '../src/personal-journal/routine.ts';

test('OPT-IN actual records entry keeps journal drafts and verifies manual saves and edits',{
 skip:process.env.RUN_JOURNAL_HANDWRITE_BROWSER!=='1'&&'Requires isolated Next and Chromium',timeout:180000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-journal-handwrite-'));
 await mkdir(join(root,'app/personal/journal'),{recursive:true});
 await mkdir(join(root,'app/login'),{recursive:true});
 await Promise.all([
  ...['layout.tsx','globals.css','theme.css','personal/layout.tsx','personal/journal/page.tsx'].map(name=>cp(join(source,'app',name),join(root,'app',name))),
  cp(join(source,'src'),join(root,'src'),{recursive:true}),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components')),
 ]);
 await writeFile(join(root,'app/login/page.tsx'),'export default function Page(){return <h1>Synthetic sign in</h1>}');
 await writeFile(join(root,'src/platform/runtime.ts'),`
  export const readPlatformPagePrincipal=async (headers:Headers)=>headers.get('cookie')?.includes('handwrite-fixture=owner')?{userId:'journal-owner'}:null;
  export const readPlatformLoginCapability=async()=>({sessionDuration:true});
 `);
 const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{
  cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],
 });
 const stopped=once(child,'exit');
 let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
 t.after(async()=>{try{await browser?.close();}finally{if(child.exitCode===null)child.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});}});
 let log='';child.stderr.on('data',chunk=>{log=(log+String(chunk)).slice(-4000);});
 const origin=await new Promise<string>((done,fail)=>{
  const timer=setTimeout(()=>fail(Error(log||'Fixture startup timeout')),30000);
  child.once('exit',()=>{clearTimeout(timer);fail(Error(log||'Fixture exited'));});
  child.stdout.on('data',chunk=>{const address=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(address){clearTimeout(timer);done(address[0]);}});
 });
 browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
 const context=await browser.newContext({viewport:{width:1365,height:900},timezoneId:'America/Los_Angeles'});
 const page=await context.newPage();
 const url=origin+'/personal/journal';
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:90000});
 await expect(page.getByRole('heading',{name:'Synthetic sign in'})).toBeVisible();
 await context.addCookies([{name:'handwrite-fixture',value:'owner',url:origin}]);
 const config={ownerId:'journal-owner',ownerEmail:'fixture@example.test',spaceId:'journal-space',baseURL:origin,
  databaseName:'fixture',approval:'personal-manual-v1',allowedTypes:['todo','journal','topic']} as const;
 const repo=new MemoryPort();
 repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(row=>row.ownerId===owner));
 let writable=false,mfa=true,failSnapshot=false,failDetail=false,detailReadCount=0;
 let holdHistory:Promise<void>|undefined;
 const handler=createPersonalPlatformHandler({config,repository:repo,storageVerified:true,
  sessions:{read:async()=>({userId:config.ownerId,email:config.ownerEmail})},assertWritable:async()=>{if(!writable)throw Error('Fixture is read only');}});
 const commands:{method:string;key:string;body:string}[]=[];
 const external:string[]=[],errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),target=new URL(request.url()),path=target.pathname;
  if(target.origin!==origin){external.push(target.origin);return route.abort();}
  if(!path.startsWith('/api/platform/'))return route.continue();
  if(path.startsWith('/api/platform/install/'))return route.fulfill({status:404,body:''});
  if(path==='/api/platform/status')return route.fulfill({json:{scope:'isolated-synthetic-review'}});
  if(path.endsWith('/auth/get-session'))return route.fulfill({json:{session:{mfaVerified:mfa,sessionDurationMode:'fixed',sessionDurationSeconds:3600,expiresAt:new Date(Date.now()+3600000).toISOString()}}});
  if(path.endsWith('/journal/snapshot')){
   if(holdHistory)await holdHistory;
   if(failSnapshot)return route.fulfill({status:503,json:{}});
  }
  if(request.method()==='GET'&&/\/journal\/[0-9a-f-]+$/.test(path)){
   detailReadCount++;
   if(failDetail)return route.fulfill({status:503,json:{}});
  }
  const body=request.postData()??undefined;
  if(request.method()!=='GET'){
   assert.match(path,/\/personal\/journal(?:\/[0-9a-f-]+)?$/);
   commands.push({method:request.method(),key:request.headers()['idempotency-key'],body:body??''});
  }
  const response=await handler(new Request(target,{method:request.method(),headers:{...request.headers(),host:target.host},...(body?{body}:{})}));
  return route.fulfill({status:response.status,json:await response.json()});
 });
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:90000});
 const journal=page.getByRole('region',{name:'日记',exact:true});
 const memos=page.getByRole('region',{name:'Memos',exact:true});
 const write=journal.getByRole('button',{name:'写日记',exact:true});
 await expect(journal.getByText(/北京时间/)).toBeVisible({timeout:30000});
 await expect(write).toHaveCount(0);
 await expect(memos.getByRole('link',{name:'查看每日活动 · 记录与开发'})).toHaveAttribute('href','/personal/activity');
 writable=true;mfa=false;
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByText('登录已到期或需要重新验证',{exact:true})).toBeVisible();
 await expect(write).toBeHidden();
 mfa=true;
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:90000});
 await expect(journal.getByText(/北京时间/)).toBeVisible({timeout:30000});
 await expect(write).toBeEnabled({timeout:15000});
 let releaseHistory=()=>{};
 holdHistory=new Promise<void>(resolve=>{releaseHistory=resolve;});
 try{
  await journal.getByRole('button',{name:'重新读取历史',exact:true}).click();
  await expect(write).toBeDisabled();
  await expect(page.getByRole('dialog',{name:'新增日记',exact:true})).toHaveCount(0);
 }finally{holdHistory=undefined;releaseHistory();}
 await write.click({timeout:15000});
 const editor=page.getByRole('dialog',{name:'新增日记',exact:true});
 const title='Synthetic hand-written journal',original='Synthetic original body\nSecond line stays intact.';
 await expect(editor.getByLabel('记录日期')).not.toHaveValue('');
 await expect(editor.getByLabel('正文',{exact:true})).toHaveValue('');
 await editor.getByLabel('标题',{exact:true}).fill(title);
 await editor.getByLabel('正文',{exact:true}).fill(original);
 await expect(editor.getByRole('button',{name:'使用「计划／发生／总结」提纲',exact:true})).toBeDisabled();
 const visibility=(state:'hidden'|'visible')=>page.evaluate(value=>{
  Object.defineProperty(document,'visibilityState',{configurable:true,value});
  document.dispatchEvent(new Event('visibilitychange'));
 },state);
 failSnapshot=true;
 await visibility('hidden');await expect(editor).toBeHidden();
 await visibility('visible');
 await expect(journal.getByRole('button',{name:'重新读取日记编辑器'})).toBeVisible();
 assert.equal(commands.length,0);
 failSnapshot=false;
 await journal.getByRole('button',{name:'重新读取日记编辑器'}).click();
 await expect(editor.getByLabel('正文',{exact:true})).toHaveValue(original);
 await expect(editor.getByLabel('标题',{exact:true})).toHaveValue(title);
 await page.setViewportSize({width:390,height:844});
 assert.ok(await editor.evaluate(node=>node.scrollWidth<=node.clientWidth+1));
 failDetail=true;
 await editor.getByRole('button',{name:'保存',exact:true}).click();
 await expect(editor.getByRole('alert')).toContainText('保存结果尚未确认');
 assert.equal(commands.length,1);
 failDetail=false;
 await editor.getByRole('button',{name:'继续上次保存（日记）'}).click();
 await expect(editor).toBeHidden();
 await expect(journal.getByRole('link',{name:title,exact:true})).toBeVisible({timeout:15000});
 assert.equal(commands.length,2);assert.deepEqual(commands[0],commands[1]);
 assert.equal(repo.rows.size,1);assert.ok(detailReadCount>=2);
 await page.reload({waitUntil:'domcontentloaded',timeout:90000});
 await journal.getByRole('link',{name:title,exact:true}).click();
 await expect(journal.getByRole('article',{name:'日记原文'})).toContainText('Second line stays intact.');
 await journal.getByText('管理日记',{exact:true}).click();
 await journal.getByRole('button',{name:title,exact:true}).click();
 const edit=page.getByRole('dialog',{name:'编辑日记',exact:true});
 await expect(edit.getByLabel('正文',{exact:true})).toHaveValue(original);
 const legacyText='## 计划\nLegacy plan\n## 发生\nLegacy unmarked section\n## 总结\nLegacy summary';
 await edit.getByLabel('正文',{exact:true}).fill(legacyText);
 await edit.getByRole('button',{name:'保存',exact:true}).click();
 await expect(edit).toBeHidden();
 await journal.getByRole('link',{name:title,exact:true}).click();
 await expect(journal.getByRole('article',{name:'日记原文'})).toContainText('Legacy unmarked section');
 await expect(journal.getByText('查看当前原文',{exact:true})).toHaveCount(0);
 await journal.getByText('最初保存的原文',{exact:true}).click();
 await expect(journal.getByRole('article',{name:'日记原文'})).toContainText('Second line stays intact.');
 assert.equal(commands.length,3);assert.equal(commands[2].method,'PATCH');assert.equal(repo.rows.size,1);

 const routineTitle='Synthetic routine journal';
 const plan='Synthetic plan for later',happened='Synthetic recorded occurrence',summary='Synthetic hand-written summary';
 const planOnly=journalRoutineTemplate.replace('## 计划\n','## 计划\n'+plan+'\n');
 const routine=planOnly.replace('## 发生\n','## 发生\n'+happened+'\n')+summary;
 await write.click();
 await editor.getByLabel('标题',{exact:true}).fill(routineTitle);
 await editor.getByRole('button',{name:'使用「计划／发生／总结」提纲',exact:true}).click();
 await expect(editor.getByLabel('正文',{exact:true})).toBeFocused();
 await expect(editor.getByLabel('正文',{exact:true})).toHaveValue(journalRoutineTemplate);
 await editor.getByRole('button',{name:'保存',exact:true}).click();
 await expect(editor.getByRole('alert')).toHaveText('请至少填写一段日记内容。');
 assert.equal(commands.length,3);
 await editor.getByLabel('正文',{exact:true}).fill(planOnly);
 await editor.getByRole('button',{name:'保存',exact:true}).click();
 await expect(editor).toBeHidden();
 await expect(journal.getByRole('link',{name:routineTitle,exact:true})).toBeVisible({timeout:15000});
 const occurrenceToggle=journal.getByText('查看日记里写下的发生事项',{exact:true});
 const occurrence=occurrenceToggle.locator('..');
 await occurrenceToggle.click();
 await expect(occurrence).toContainText('当天日记中暂无已填写的「发生」段落。');
 await expect(occurrence).not.toContainText(plan);
 await expect(occurrence).not.toContainText('Legacy unmarked section');
 await page.setViewportSize({width:1365,height:900});
 await journal.getByRole('button',{name:routineTitle,exact:true}).click();
 await edit.getByLabel('正文',{exact:true}).fill(routine);
 await edit.getByRole('button',{name:'保存',exact:true}).click();
 await expect(edit).toBeHidden();
 await expect(occurrence.getByText(happened,{exact:true})).toBeVisible();
 await expect(occurrence).not.toContainText(plan);
 await expect(occurrence).not.toContainText(summary);
 await page.reload({waitUntil:'domcontentloaded',timeout:90000});
 await journal.getByRole('link',{name:routineTitle,exact:true}).click({timeout:30000});
 const routineOriginal=journal.getByRole('article',{name:'日记原文'});
 await expect(routineOriginal.getByText(plan,{exact:true})).toBeVisible();
 await expect(routineOriginal.getByText(summary,{exact:true})).toBeVisible();
 await routineOriginal.getByText('查看当前原文',{exact:true}).click();
 assert.equal(await routineOriginal.getByText('查看当前原文',{exact:true}).locator('..').locator('p').textContent(),routine);
 assert.equal(commands.length,5);assert.equal(repo.rows.size,2);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
});
