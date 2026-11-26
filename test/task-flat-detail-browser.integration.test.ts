import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,devices,expect,type Browser,type BrowserServer} from '@playwright/test';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {MemoryPort} from './helpers/platform.ts';
import {PersonalService,personalEntryType} from '../src/personal-candidate/service.ts';
import type {PersonalConfig,PersonalType} from '../src/personal-candidate/config.ts';
import type {PublicEntry} from '../src/platform/contracts.ts';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';

test('OPT-IN flat owner tasks preserve the shell, draft and relation receipts in place',{
 skip:process.env.RUN_TASK_FLAT_DETAIL_BROWSER_TESTS!=='1'&&'Requires an isolated Next fixture and native Chromium',timeout:180_000,
},async()=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-flat-task-detail-'));
 const owner={id:'synthetic-expand-owner',email:'phone-task@example.invalid'};
 const sessionCookie='lifeos-phone-task-fixture';
 const hasSession=(headers:Headers)=>headers.get('cookie')?.split(';').some(part=>part.trim()===sessionCookie+'=owner')===true;
 let server:FixtureProcess|undefined,browserProcess:FixtureProcess|undefined,browserServer:BrowserServer|undefined,browser:Browser|undefined;
 try{
  await mkdir(join(root,'app/personal'),{recursive:true});
  await mkdir(join(root,'app/login'),{recursive:true});
  await writeFile(join(root,'app/login/page.tsx'),'export default function Page(){return <h1>合成登录</h1>}');
  await Promise.all([
   cp(join(source,'src'),join(root,'src'),{recursive:true}),
   ...['layout.tsx','globals.css','theme.css','personal/page.tsx','personal/layout.tsx','personal/error.tsx'].map(file=>cp(join(source,'app',file),join(root,'app',file))),
   cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
   symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components')),
  ]);
  await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
  await writeFile(join(root,'src/platform/runtime.ts'),`
export const readPlatformPagePrincipal=async(headers:Headers)=>
 headers.get('cookie')?.split(';').some(part=>part.trim()==='${sessionCookie}=owner')?{userId:'${owner.id}'}:null;
export const readPlatformPasswordCapability=async()=>false;
export const readPlatformLoginCapability=async()=>({sessionDuration:false});
`);
  const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{
   cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],detached:true,
  });
  server=trackAuthThemeProcess(child,true);
  child.stderr.resume();
  const origin=await new Promise<string>((accept,reject)=>{
   const timer=setTimeout(()=>reject(Error('Synthetic Next fixture startup timeout')),30_000);
   child.once('exit',()=>{clearTimeout(timer);reject(Error('Synthetic Next fixture exited'));});
   child.once('error',error=>{clearTimeout(timer);reject(error);});
   child.stdout.on('data',chunk=>{
    const url=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if(url){clearTimeout(timer);accept(url);}
   });
  });
  browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH,host:'127.0.0.1'});
  browserProcess=trackAuthThemeProcess(browserServer.process());
  browser=await chromium.connect(browserServer.wsEndpoint());
  for(const width of [1365,390]){
   const page=await browser.newPage(width===1365?{viewport:{width,height:760}}:{...devices['iPhone 13'],viewport:{width,height:680}});
   await page.context().addCookies([{name:sessionCookie,value:'owner',url:origin,httpOnly:true,sameSite:'Lax'}]);
   const spaceId='synthetic-flat-task-space',ownerId=owner.id;
   const config:PersonalConfig={ownerId,ownerEmail:owner.email,spaceId,baseURL:origin,databaseName:'lifeos_platform_test_local',
    allowedTypes:['todo','domain','project','topic'],approval:'personal-manual-v1',transport:'ssh-loopback'};
   const repository=Object.assign(new MemoryPort(),{
    async readTaskWorkspaceSnapshot(verifiedOwner:string,verifiedSpace:string,types:readonly string[]){
     return structuredClone([...repository.rows.values()].filter(row=>row.ownerId===verifiedOwner&&types.includes(personalEntryType(row,verifiedSpace)??'')));
    },
   });
   repository.readCurrentSnapshot=async verifiedOwner=>structuredClone([...repository.rows.values()].filter(row=>row.ownerId===verifiedOwner));
   let writable=true;
   const make=(type:PersonalType,fields:object,key:string)=>new PersonalService(repository,config).mutate(ownerId,type,null,{spaceId,confirmed:true,fields},key);
   const reference=(entry:PublicEntry)=>({id:entry.id,sourceId:entry.source.id,revision:entry.revision});
   const domain=reference((await make('domain',{title:'合成旧领域',text:'',occurredOn:null,personal:{type:'domain'}},'flat-fixture-domain')).entry);
   const firstTag=reference((await make('topic',{title:'合成旧标签',text:'',occurredOn:null,personal:{type:'topic'}},'flat-fixture-topic1')).entry);
   const secondTag=reference((await make('topic',{title:'合成新标签',text:'',occurredOn:null,personal:{type:'topic'}},'flat-fixture-topic2')).entry);
   const projectFields={text:'',occurredOn:null,personal:{type:'project',stage:'active',purpose:null,nextStep:'',domain,topics:[]}};
   const oldProject=reference((await make('project',{...projectFields,title:'合成原项目'},'flat-fixture-project1')).entry);
   const nextProject=reference((await make('project',{...projectFields,title:'合成新项目'},'flat-fixture-project2')).entry);
   const notes='合成只用于长内容边界。'.repeat(650);
   const taskFields={status:'open',dueOn:null,notes:''};
   for(let index=0;index<5;index++)await make('todo',{...taskFields,title:'合成列表首行 '+index},'flat-fixture-first-'+index);
   const oldTask=(await make('todo',{...taskFields,title:'合成历史待办',notes,personal:{domain,project:oldProject,topics:[firstTag]}},'flat-fixture-old')).entry;
   const otherTask=(await make('todo',{...taskFields,title:'合成第二条待办'},'flat-fixture-other')).entry;
   for(let index=0;index<34;index++)await make('todo',{...taskFields,title:'合成列表行 '+index},'flat-fixture-row-'+index);
   const runtime=createPersonalPlatformHandler({repository,config,storageVerified:true,assertWritable:async()=>{
    if(!writable)throw Error('Synthetic permission closes writes');
   },sessions:{read:async headers=>hasSession(headers)?{userId:ownerId,email:owner.email}:null}});
   const requests:{method:string;path:string;body:unknown}[]=[],errors:string[]=[];
   page.on('pageerror',error=>errors.push(error.message));
   const rootPath='/api/platform/personal/';
   await page.route('**/api/platform/**',async route=>{
    const request=route.request(),url=new URL(request.url()),method=request.method();
    assert.equal(url.origin,origin);
    const headers=new Headers(await request.allHeaders());headers.set('host',url.host);
    const body=request.postData()??undefined;
    requests.push({method,path:url.pathname,body:body?JSON.parse(body):null});
    const reply=await runtime(new Request(url,{method,headers,body}));
    await route.fulfill({status:reply.status,headers:Object.fromEntries(reply.headers),body:await reply.text()});
   });
   const read=async(path:string)=>{
    const url=new URL(rootPath+path,origin);
    const res=await runtime(new Request(url,{headers:{host:url.host,cookie:sessionCookie+'=owner'}}));
    assert.equal(res.status,200);
    return res.json();
   };
   const writes=()=>requests.filter(call=>call.method==='POST'||call.method==='PATCH');
   await page.goto(origin+'/personal?page=tasks',{waitUntil:'domcontentloaded',timeout:60000});
   const grid=page.locator('[data-task-grid="reui"]');
   const detail=page.getByRole('dialog',{name:'待办详情',exact:true});
   const heading=(name:string)=>grid.getByRole('button',{name:'查看待办详情：'+name,exact:true});
   const oldButton=heading('合成历史待办');
   await expect(oldButton).toBeVisible({timeout:15000});
   await expect(grid.getByLabel('待办表格分组')).toHaveCount(0);
   await expect(grid.locator('th[data-col-id="project"],th[data-col-id="area"],[data-task-group]')).toHaveCount(0);
   await expect(grid.getByRole('list',{name:'待办标签',exact:true})).toHaveText('合成旧标签');
   const otherButton=heading('合成第二条待办');
   await expect(otherButton).toBeVisible();
   const viewport=grid.locator('[data-slot="data-grid-table-viewport"]');
   const priorShell=await page.evaluateHandle(()=>({
    header:document.querySelector('.lo-header'),aside:document.querySelector('.lo-sidebar'),main:document.querySelector('#personal-main'),
    viewport:document.querySelector('[data-slot="data-grid-table-viewport"]'),
   }));
   const position=await viewport.evaluate(element=>{element.scrollTop=48;return element.scrollTop;});
   assert.ok(position>0);
   await otherButton.press('F2');
   const inline=grid.getByRole('textbox',{name:'编辑待办',exact:true});
   await expect(inline).toBeFocused();
   await inline.fill('合成未保存表格草稿');
   const detailsTrigger=grid.locator('tr[data-row-id="'+oldTask.id+'"]').getByRole('button',{name:'打开任务：合成历史待办',exact:true});
   // Open by title on phone, and use the separate action on desktop to cover both entry points.
   const trigger=width===1365?detailsTrigger:oldButton;
   await trigger.scrollIntoViewIfNeeded();
   const before=await viewport.evaluate(element=>element.scrollTop);
   assert.ok(before>0,'detail is opened from a scrolled viewport');
   if(width===1365)await trigger.click();else await trigger.tap();
   const close=detail.getByRole('button',{name:'关闭待办详情',exact:true});
   await expect(close).toBeFocused();
   await expect(detail.getByLabel('标题',{exact:true})).toHaveValue('合成历史待办');
   assert.equal((await detail.getByRole('textbox',{name:'正文',exact:true}).inputValue()).length,notes.length);
   await expect(detail.getByRole('combobox',{name:'关联项目',exact:true})).toBeHidden();
   await expect(detail.getByRole('button',{name:/AI/})).toHaveCount(0);
   const panel=await detail.boundingBox();
   assert.ok(panel&&panel.width<=Math.min(480,width-16)&&panel.y>=48&&panel.y+panel.height<=(width===1365?760:680));
   const body=detail.locator('fieldset').first().locator('..');
   const scroll=await body.evaluate(element=>({body:element.clientHeight,content:element.scrollHeight}));
   assert.ok(scroll.content>scroll.body||width===1365);
   assert.equal(await page.evaluate(shell=>shell.header===document.querySelector('.lo-header')&&shell.aside===document.querySelector('.lo-sidebar')&&shell.main===document.querySelector('#personal-main')&&shell.viewport===document.querySelector('[data-slot="data-grid-table-viewport"]'),priorShell),true);
   await expect(page).toHaveURL(origin+'/personal?page=tasks');
   await page.keyboard.press('Escape');
   await expect(detail).toHaveCount(0);
   await expect(trigger).toBeFocused();
   await expect(inline).toHaveValue('合成未保存表格草稿');
   assert.equal(await viewport.evaluate(element=>element.scrollTop),before);
   assert.equal(writes().length,0);
   await inline.press('Escape');
   await expect(inline).toHaveCount(0);
   await oldButton.click();
   const titleField=detail.getByRole('textbox',{name:'标题',exact:true});
   await titleField.fill('合成详情草稿');
   page.once('dialog',dialog=>void dialog.dismiss());
   await page.keyboard.press('Escape');
   await expect(titleField).toHaveValue('合成详情草稿');
   assert.equal(writes().length,0);
   await titleField.fill('合成历史待办');
   await detail.getByText('关联',{exact:true}).click();
   const chooser=detail.getByRole('combobox',{name:'关联项目',exact:true});
   await expect(chooser).toHaveValue(oldProject.id);
   await chooser.selectOption(nextProject.id);
   await expect(detail.getByText('原有领域 合成旧领域',{exact:true})).toBeVisible();
   await detail.getByText('标签（可选）',{exact:false}).click();
   await detail.getByRole('checkbox',{name:'合成新标签',exact:true}).check();
   assert.equal(writes().length,0);
   await detail.getByRole('button',{name:'保存待办',exact:true}).click();
   await expect(detail).toHaveCount(0);
   assert.equal(writes().length,1);
   const saved=await read('todo/'+oldTask.id);
   assert.equal(saved.entry.revision,2);
   assert.deepEqual(saved.entry.draft.personal,{domain,project:nextProject,topics:[firstTag,secondTag]});
   assert.equal(saved.entry.draft.notes,notes);
   assert.deepEqual((await read('todo/'+oldTask.id+'/history')).items.map((entry:PublicEntry)=>entry.revision),[2,1]);
   await expect(grid.getByRole('list',{name:'待办标签',exact:true})).toHaveText('合成旧标签合成新标签');
   const create=page.getByRole('button',{name:'新建待办',exact:true});
   await create.click();
   const form=page.getByRole('dialog',{name:'新建待办',exact:true});
   await expect(form.getByRole('combobox',{name:'关联项目',exact:true})).toHaveCount(0);
   await expect(form.getByRole('combobox',{name:'领域',exact:true})).toHaveCount(0);
   await form.getByLabel('标题',{exact:true}).fill('合成无分类新待办');
   await form.getByText('标签（可选）',{exact:true}).click();
   await form.getByRole('checkbox',{name:'合成新标签',exact:true}).check();
   await form.getByRole('button',{name:'保存待办',exact:true}).click();
   await expect(form).toHaveCount(0);
   const created=[...repository.rows.values()].find(row=>'title'in row.draft&&row.draft.title==='合成无分类新待办');
   assert.ok(created);
   const savedNew=await read('todo/'+created.id);
   assert.deepEqual(savedNew.entry.draft.personal,{project:null,domain:null,topics:[secondTag]});
   assert.equal(savedNew.entry.draft.dueOn,null);
   assert.ok(requests.some(call=>call.method==='GET'&&call.path===rootPath+'todo/'+created.id));
   assert.equal(writes().length,2);
   assert.equal((await read('todo/'+otherTask.id)).entry.revision,1);
   await page.reload({waitUntil:'domcontentloaded'});
   await expect(grid).toBeVisible({timeout:15000});
   const search=page.getByRole('textbox',{name:'搜索待办'});
   await search.fill('合成无分类新待办');
   await expect(heading('合成无分类新待办')).toBeVisible();
   await search.fill('合成该关键词不存在');
   await expect(grid.getByText('没有符合条件的待办',{exact:true})).toBeVisible();
   await search.fill('');
   writable=false;
   await page.reload({waitUntil:'domcontentloaded'});
   await oldButton.click();
   await expect(detail.getByRole('status')).toHaveText('当前为只读，可查看内容。');
   await expect(detail.getByRole('button',{name:'保存待办',exact:true})).toHaveCount(0);
   assert.equal((await detail.locator('p').filter({hasText:'合成只用于长内容边界。'}).textContent())?.length,notes.length);
   assert.equal(writes().length,2);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.deepEqual(errors,[]);
   console.log('TASK_FLAT_DETAIL_PASS '+JSON.stringify({width,scroll:before,shell:true,inlineDraft:true,manualWrites:writes().length,readonly:true}));
   await page.close();
  }
 }finally{await cleanupAuthThemeFixture({root,browser,browserServer,browserProcess,server});}
});
