import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import type {PersonalConfig} from '../src/personal-candidate/config.ts';
import {MemoryPort} from './helpers/platform.ts';

test('OPT-IN Todo entry distinguishes explicit source evidence and keeps original text after correction',{
 skip:process.env.RUN_TODO_PROVENANCE_BROWSER!=='1'&&'Requires isolated Next and Chromium',
 timeout:180_000,
},async t=>{
 const source=resolve(import.meta.dirname,'..');
 const root=await mkdtemp(join(tmpdir(),'lifeos-todo-provenance-'));
 let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
 let server:ReturnType<typeof spawn>|undefined;
 let stopped:Promise<unknown>|undefined;
 t.after(async()=>{
  try{await browser?.close();}
  finally{if(server&&server.exitCode===null)server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});}
 });
 await mkdir(join(root,'app/personal'),{recursive:true});
 await Promise.all([
  ...['app/layout.tsx','app/globals.css','app/theme.css','app/personal/page.tsx','postcss.config.mjs'].map(path=>cp(join(source,path),join(root,path))),
  cp(join(source,'src'),join(root,'src'),{recursive:true}),
  ...['node_modules','components'].map(path=>symlink(join(source,path),join(root,path))),
 ]);
 await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
 const ownerId='synthetic-browser-source-owner',spaceId='synthetic-browser-source-space';
 await writeFile(join(root,'src/platform/runtime.ts'),
  'export const readPlatformPagePrincipal=async()=>({userId:'+JSON.stringify(ownerId)+'});export const readPlatformPasswordCapability=async()=>false;');
 const fixture=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{
  cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],
 });
 server=fixture;stopped=once(fixture,'exit');
 let output='';
 fixture.stderr.on('data',chunk=>{output=(output+String(chunk)).slice(-5000);});
 const origin=await new Promise<string>((accept,reject)=>{
  const timer=setTimeout(()=>reject(Error(output||'Fixture startup timeout')),30_000);
  fixture.once('exit',()=>{clearTimeout(timer);reject(Error(output||'Fixture exited'));});
  fixture.stdout.on('data',chunk=>{const address=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(address){clearTimeout(timer);accept(address[0]);}});
 });
 const ownerEmail='synthetic@example.test';
 const config:PersonalConfig={ownerId,spaceId,ownerEmail,baseURL:origin,transport:'ssh-loopback',
  approval:'personal-manual-v1',databaseName:'lifeos_platform_test_local',allowedTypes:['todo']};
 const repo=new MemoryPort();
 const repository=Object.assign(repo,{readTaskWorkspaceSnapshot:async(owner:string)=>[...repo.rows.values()].filter(row=>row.ownerId===owner)});
 const service=new PersonalService(repository,config);
 await service.mutate(ownerId,'todo',null,{spaceId,confirmed:true,fields:{
  title:'旧待办来源回归',notes:'合成材料',dueOn:null,status:'open',
 }},'synthetic-todo-origin-legacy');
 const handler=createPersonalPlatformHandler({repository,config,storageVerified:true,assertWritable:async()=>{},
  sessions:{read:async()=>({userId:ownerId,email:ownerEmail})}});
 browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
 const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai'});
 page.setDefaultTimeout(15_000);
 const errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const incoming=route.request(),url=new URL(incoming.url());
  if(url.origin!==origin)return route.abort();
  if(!url.pathname.startsWith('/api/'))return route.continue();
  if(!url.pathname.startsWith('/api/platform/personal/'))return route.fulfill({status:404,json:{}});
  const method=incoming.method();
  const headers={...await incoming.allHeaders(),host:url.host};
  const request=new Request(url,{method,headers,...(method==='GET'?{}:{body:incoming.postData()})});
  const response=await handler(request);
  return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
 });
 await page.goto(origin+'/personal?page=tasks',{waitUntil:'domcontentloaded',timeout:60_000});
 const grid=page.locator('[data-task-grid="reui"]');
 const openTask=async(title:string)=>{
  await grid.getByRole('button',{name:'查看待办详情：'+title,exact:true}).click();
  return page.getByRole('dialog',{name:'待办详情',exact:true});
 };
 let detail=await openTask('旧待办来源回归');
 await detail.getByText('来源与修订历史',{exact:true}).click();
 await expect(detail.getByText('未知',{exact:true})).toHaveCount(2);
 await detail.getByText('修订 1',{exact:true}).click();
 await expect(detail.getByRole('listitem').getByText('合成材料',{exact:true})).toBeVisible();
 await page.keyboard.press('Escape');

 const title='来源双维度回归',original='Synthetic original source text',corrected='Synthetic corrected current text';
 await page.getByRole('button',{name:'新建待办',exact:true}).click();
 const create=page.getByRole('dialog',{name:'新建待办',exact:true});
 await create.getByLabel('标题',{exact:true}).fill(title);
 await create.getByLabel('正文',{exact:true}).fill(original);
 const expression=create.getByRole('combobox',{name:'表达类型（可选）',exact:true});
 await expect(expression).toHaveValue('');
 await expression.selectOption('spoken');
 await create.getByRole('button',{name:'保存待办',exact:true}).click();
 await expect(create).toHaveCount(0);
 detail=await openTask(title);
 await expect(detail.getByRole('combobox',{name:'表达类型（可选）',exact:true})).toHaveCount(0);
 await detail.getByText('来源与修订历史',{exact:true}).click();
 await expect(detail.getByText('本人网页',{exact:true})).toBeVisible();
 await expect(detail.getByText('口述表达',{exact:true})).toBeVisible();
 await detail.getByText('修订 1',{exact:true}).click();
 await expect(detail.getByRole('listitem').getByText(original,{exact:true})).toBeVisible();
 await detail.getByLabel('正文',{exact:true}).fill(corrected);
 await detail.getByRole('button',{name:'保存待办',exact:true}).click();
 await expect(detail).toHaveCount(0);
 await page.reload({waitUntil:'domcontentloaded'});
 detail=await openTask(title);
 await expect(detail.getByLabel('正文',{exact:true})).toHaveValue(corrected);
 await detail.getByText('来源与修订历史',{exact:true}).click();
 await expect(detail.getByText('修订 2',{exact:true})).toBeVisible();
 await detail.getByText('最初录入内容',{exact:true}).click();
 await expect(detail.locator('pre')).toContainText(original);
 await detail.getByText('修订 1',{exact:true}).click();
 await expect(detail.getByRole('listitem').getByText(original,{exact:true})).toBeVisible();
 assert.deepEqual(errors,[]);
});
