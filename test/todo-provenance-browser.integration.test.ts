import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';

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
 const portProbe=createServer();
 portProbe.listen(0,'127.0.0.1');
 await once(portProbe,'listening');
 const address=portProbe.address();
 assert.ok(address&&typeof address!=='string');
 const port=address.port;
 await new Promise<void>((resolve,reject)=>portProbe.close(error=>error?reject(error):resolve()));
 const baseURL='http://127.0.0.1:'+port;
 const appRoute='app/api/platform/[[...resource]]/route.ts';
 const fixtureIds=join(root,'fixture-ids.json');
 await Promise.all(['app/personal','app/api/platform/[[...resource]]','test/helpers'].map(path=>mkdir(join(root,path),{recursive:true})));
 await Promise.all([
  ...['app/layout.tsx','app/globals.css','app/theme.css','app/personal/page.tsx',appRoute,'postcss.config.mjs','test/helpers/platform.ts'].map(path=>cp(join(source,path),join(root,path))),
  cp(join(source,'src'),join(root,'src'),{recursive:true}),
  ...['node_modules','components'].map(path=>symlink(join(source,path),join(root,path))),
 ]);
 await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
 // The real Next catch-all route calls the real owner HTTP handler. Only
 // identity and storage are supplied by the disposable synthetic fixture.
 await writeFile(join(root,'src/platform/runtime.ts'),`
  import {writeFile} from 'node:fs/promises';
  import {createPersonalPlatformHandler} from '../personal-candidate/runtime-http';
  import {PersonalService} from '../personal-candidate/service';
  import {DraftService} from './service';
  import {MemoryPort} from '../../test/helpers/platform';

  const ownerId='synthetic-browser-source-owner',spaceId='synthetic-browser-source-space',ownerEmail='synthetic@example.test';
  function principal(headers:Headers){
   const match=headers.get('cookie')?.match(/(?:^|; *)todo-source-fixture=(owner|foreign)(?:;|$)/)?.[1];
   return match==='owner'?{userId:ownerId,email:ownerEmail}:match==='foreign'?{userId:'synthetic-foreign',email:'foreign@example.test'}:null;
  }
  export const readPlatformPagePrincipal=async(headers:Headers)=>principal(headers);
  export const readPlatformPasswordCapability=async()=>false;
  async function prepare(baseURL:string){
   const config={ownerId,spaceId,ownerEmail,baseURL,transport:'ssh-loopback',
    approval:'personal-manual-v1',databaseName:'lifeos_platform_test_local',allowedTypes:['todo']} as const;
   const repo=new MemoryPort();
   repo.readCurrentSnapshot=async owner=>[...repo.rows.values()].filter(row=>row.ownerId===owner);
   const repository=Object.assign(repo,{readTaskWorkspaceSnapshot:repo.readCurrentSnapshot});
   const personal=new PersonalService(repository,config);
   const scoped=await personal.mutate(ownerId,'todo',null,{spaceId,confirmed:true,fields:{
    title:'旧待办来源回归',notes:'合成材料',dueOn:null,status:'open',
   }},'synthetic-todo-origin-legacy');
   const legacy=new DraftService(repository);
   const inbox=await legacy.mutate(ownerId,'inbox',null,{title:'旧评审原件',text:'合成私有原件标记',occurredOn:null,disposition:'pending'},'synthetic-inbox-origin');
   const derived=await legacy.createTodoFromInbox(ownerId,inbox.entry.id,{expectedRevision:1,title:'旧评审派生待办'},'synthetic-inbox-to-todo');
   await writeFile(${JSON.stringify(fixtureIds)},JSON.stringify({inbox:inbox.entry.id,derived:derived.entry.id,scoped:scoped.entry.id}));
   return createPersonalPlatformHandler({repository,config,storageVerified:true,assertWritable:async()=>{},sessions:{read:async headers=>principal(headers)}});
  }
  let runtime:ReturnType<typeof prepare>|undefined;
  export const handlePlatformRequest=async(request:Request)=>(await (runtime??=prepare(${JSON.stringify(baseURL)})))(request);
 `);
 const fixture=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{
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
 assert.equal(origin,baseURL);
 browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
 const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai'});
 page.setDefaultTimeout(15_000);
 const errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.context().addCookies([{name:'todo-source-fixture',value:'owner',url:origin}]);
 const status=await page.request.get(origin+'/api/platform/personal/status',{timeout:60_000});
 assert.equal(status.status(),200,(await status.text()).slice(0,300)+'\n'+output);
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin+'/personal?page=tasks',{waitUntil:'domcontentloaded',timeout:60_000});
 const grid=page.locator('[data-task-grid="reui"]');
 const openTask=async(title:string)=>{
  await grid.getByRole('button',{name:'查看待办详情：'+title,exact:true}).click();
  return page.getByRole('dialog',{name:'待办详情',exact:true});
 };
 let detail=await openTask('旧待办来源回归');
 const fixtureRecords=JSON.parse(await readFile(fixtureIds,'utf8')) as {inbox:string;derived:string;scoped:string};
 const todoPath=origin+'/api/platform/personal/todo/';
 const oldHistory=origin+'/api/platform/inbox/'+fixtureRecords.inbox+'/history';
 const checkDenied=async(url:string,status:number,code:string)=>{
  const response=await page.request.get(url);
  assert.equal(response.status(),status);
  const body=await response.text();
  assert.equal(JSON.parse(body).error.code,code);
  assert.doesNotMatch(body,/合成私有原件标记/);
 };
 await expect(grid.getByRole('button',{name:'查看待办详情：旧评审派生待办',exact:true})).toHaveCount(0);
 await checkDenied(oldHistory,404,'PERSONAL_ROUTE_ONLY');
 await checkDenied(todoPath+fixtureRecords.derived,404,'NOT_FOUND');
 await checkDenied(todoPath+fixtureRecords.derived+'/history',404,'NOT_FOUND');
 assert.equal((await page.request.get(todoPath+fixtureRecords.scoped)).status(),200);
 await page.context().addCookies([{name:'todo-source-fixture',value:'foreign',url:origin}]);
 await checkDenied(oldHistory,403,'ACCOUNT_NOT_ALLOWED');
 await checkDenied(todoPath+fixtureRecords.scoped,403,'ACCOUNT_NOT_ALLOWED');
 await page.context().clearCookies();
 await checkDenied(oldHistory,401,'LOGIN_REQUIRED');
 await checkDenied(todoPath+fixtureRecords.scoped,401,'LOGIN_REQUIRED');
 await page.context().addCookies([{name:'todo-source-fixture',value:'owner',url:origin}]);
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
 const currentBody=()=>detail.getByRole('textbox',{name:'正文',exact:true});
 await expect(currentBody()).toHaveValue(original,{timeout:15_000});
 await expect(detail.getByRole('combobox',{name:'表达类型（可选）',exact:true})).toHaveCount(0);
 await detail.getByText('来源与修订历史',{exact:true}).click();
 await expect(detail.getByText('本人网页',{exact:true})).toBeVisible();
 await expect(detail.getByText('口述表达',{exact:true})).toBeVisible();
 await detail.getByText('修订 1',{exact:true}).click();
 await expect(detail.getByRole('listitem').getByText(original,{exact:true})).toBeVisible();
 await expect(currentBody()).toHaveValue(original,{timeout:15_000});
 await currentBody().fill(corrected);
 await detail.getByRole('button',{name:'保存待办',exact:true}).click();
 await expect(detail).toHaveCount(0);
 await page.reload({waitUntil:'domcontentloaded'});
 detail=await openTask(title);
 await expect(currentBody()).toHaveValue(corrected,{timeout:15_000});
 await detail.getByText('来源与修订历史',{exact:true}).click();
 await expect(detail.getByText('修订 2',{exact:true})).toBeVisible();
 await detail.getByText('最初录入内容',{exact:true}).click();
 await expect(detail.locator('pre')).toContainText(original);
 await detail.getByText('修订 1',{exact:true}).click();
 await expect(detail.getByRole('listitem').getByText(original,{exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'搜索本人记录',exact:true}).click();
 const search=page.getByRole('dialog',{name:'搜索本人记录',exact:true});
 const query=search.getByRole('searchbox',{name:'搜索标题与正文',exact:true});
 await query.fill(title);
 await query.press('Enter');
 await search.getByRole('button',{name:title+' 查看原记录',exact:true}).click();
 await expect(search.getByText('输入渠道 本人网页 · 表达 口述表达 · 版本 2',{exact:true})).toBeVisible();
 await expect(search.getByText(corrected,{exact:true})).toBeVisible();
 assert.deepEqual(errors,[]);
});
