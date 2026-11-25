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

test('OPT-IN signed-in mobile routes keep the shared shell, layout preference and legacy links',{
 skip:process.env.RUN_MOBILE_ROUTE_CONTINUITY_BROWSER!=='1'&&'Requires isolated Next and Chromium',timeout:390000,
},async t=>{
 const source=process.env.LIFEOS_MOBILE_BASELINE_SOURCE??resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-mobile-continuity-'));
 await mkdir(join(root,'app/login'),{recursive:true});
 await Promise.all([
  cp(join(source,'src'),join(root,'src'),{recursive:true}),
  cp(join(source,'app/personal'),join(root,'app/personal'),{recursive:true}),
  ...['layout.tsx','globals.css','theme.css'].map(name=>cp(join(source,'app',name),join(root,'app',name))),
  cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  ...['node_modules','components'].map(name=>symlink(join(source,name),join(root,name))),
 ]);
 await writeFile(join(root,'app/login/page.tsx'),'export default function Page(){return <h1>Synthetic login</h1>}');
 await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false}');
 await writeFile(join(root,'src/platform/runtime.ts'),`
  export const readPlatformPagePrincipal=async(headers:Headers)=>headers.get('cookie')?.includes('mobile-fixture=owner')?{userId:'mobile-owner'}:null;
  export const readPlatformLoginCapability=async()=>({sessionDuration:false});
  export const readPlatformPasswordCapability=async()=>true;
  export const readPlatformMfaState=async()=>({kind:'ready'});
 `);
 const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 const stopped=once(child,'exit');let log='',browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
 child.stderr.on('data',chunk=>{log=(log+String(chunk)).slice(-5000);});
 t.after(async()=>{try{await browser?.close();}finally{if(child.exitCode===null)child.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});}});
 const origin=await new Promise<string>((done,fail)=>{
  const timer=setTimeout(()=>fail(Error(log||'Fixture startup timed out')),30000);
  child.once('exit',()=>{clearTimeout(timer);fail(Error(log||'Fixture exited'));});
  child.stdout.on('data',chunk=>{const found=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(found){clearTimeout(timer);done(found[0]);}});
 });
 const config={ownerId:'mobile-owner',ownerEmail:'fixture@example.test',spaceId:'mobile-space',databaseName:'fixture',baseURL:origin,approval:'personal-manual-v1',allowedTypes:['todo','journal','project','domain','topic'],requirementsEnabled:true,calendarEnabled:true,healthEnabled:true,mediaEnabled:true,careerEnabled:true} as const;
 const repo=new MemoryPort();
 repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(row=>row.ownerId===owner));
 let writable=true,writes=0;
 const handler=createPersonalPlatformHandler({config,repository:repo,storageVerified:true,sessions:{read:async()=>({userId:config.ownerId,email:config.ownerEmail})},assertWritable:async()=>{if(!writable)throw Error('read only');}});
 async function seed(type:string,key:string,fields:object){
  const response=await handler(new Request(origin+'/api/platform/personal/'+type,{method:'POST',headers:{origin,host:new URL(origin).host,'content-type':'application/json','idempotency-key':key},body:JSON.stringify({spaceId:config.spaceId,confirmed:true,fields})}));
  const value=await response.json();
  assert.equal(response.status,201,JSON.stringify(value.error??{}));
  return value.entry;
 }
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const diary=await seed('journal','mobile-diary',{title:'合成移动日记',text:'合成日记原文',occurredOn:today});
 const project=await seed('project','mobile-project',{title:'合成移动项目',text:'合成项目说明',occurredOn:null,personal:{type:'project',stage:'active',purpose:'advance',nextStep:'',domain:null,topics:[]}});
 await seed('todo','mobile-todo',{title:'合成移动待办',notes:'合成待办详情',status:'open',dueOn:null,personal:{project:{id:project.id,sourceId:project.source.id,revision:project.revision},domain:null,topics:[]}});
 writable=false;
 browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
 const failures:string[]=[];
 for(const width of [390,430]){
  const context=await browser.newContext({viewport:{width,height:920},isMobile:true,hasTouch:true});
  await context.addCookies([{name:'mobile-fixture',value:'owner',url:origin}]);
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.origin!==origin)return route.abort();
   if(!url.pathname.startsWith('/api/platform/'))return route.continue();
   if(req.method()!=='GET'){writes++;return route.fulfill({status:405,json:{}});}
   if(url.pathname==='/api/platform/status')return route.fulfill({json:{scope:'isolated-synthetic-review'}});
   if(url.pathname.endsWith('/personal/availability'))return route.fulfill({json:{configured:true,loginAllowed:true,https:false,transport:'ssh-loopback',origin,writable:false}});
   const response=await handler(new Request(url,{headers:{host:url.host}}));
   return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
  });
  const page=await context.newPage();page.setDefaultTimeout(60000);
  const header=page.locator('header.lo-header'),main=page.locator('main#personal-main'),shell=page.locator('.lo-shell');
  const drawer=page.getByRole('dialog',{name:'LifeOS',exact:true});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const go=async(path:string)=>{await page.goto(origin+path,{waitUntil:'domcontentloaded',timeout:80000});};
  const awaitMobile=async(title:string)=>{await expect(main.getByRole('heading',{name:title,level:1,exact:true})).toBeVisible({timeout:20000});await expect(header.getByRole('button',{name:'切换到桌面版'})).toBeVisible({timeout:20000});};
  const readyHome=async()=>{await go('/personal');await awaitMobile('总览');await expect(header.getByRole('link',{name:'搜索本人记录'})).toBeVisible({timeout:20000});};
  const openDrawer=async()=>{await header.getByRole('button',{name:'打开导航',exact:true}).click();await expect(drawer).toBeVisible();};
  const checkBox=async(path:string,title:string,mode='mobile')=>{
   await expect(page).toHaveURL(origin+path,{timeout:50000});
   await expect(page.getByRole('heading',{name:title,level:1,exact:true})).toBeVisible();
   assert.equal(await header.count(),1,'Expected the shared header for '+path);
   if(mode==='mobile')await awaitMobile(title);
   else await expect(main.getByRole('heading',{name:title,level:1,exact:true})).toBeVisible();
   const measured=await shell.evaluate(el=>({page:document.documentElement.scrollWidth,shell:el.scrollWidth,main:el.querySelector('main')!.scrollWidth,mode:document.documentElement.dataset.lifeosWorkspaceLayout??'auto'}));
   t.diagnostic(JSON.stringify({width,path,...measured}));
   assert.ok(measured.page<=width+1);
   if(mode==='mobile'){assert.ok(measured.shell<=width+1);assert.ok(measured.main<=width+1);}
   else{assert.equal(measured.mode,'desktop');assert.ok(measured.shell>=900);}
  };
  const run=async(name:string,fn:()=>Promise<void>)=>{
   const scope=process.env.LIFEOS_MOBILE_TEST_SCOPE;
   if(scope==='legacy'&&!name.startsWith('legacy'))return;
   if(scope==='changed'&&!name.startsWith('legacy')&&name!=='todo detail and close')return;
   try{await fn();}catch(error){
    const position=await page.evaluate(()=>({path:location.pathname,mode:document.documentElement.dataset.lifeosWorkspaceLayout??'auto',shared:!!document.querySelector('header.lo-header'),page:document.documentElement.scrollWidth})).catch(()=>null);
    failures.push(width+' '+name+' '+JSON.stringify(position)+' '+String(error));
    t.diagnostic(failures.at(-1)!);
   }
  };
  await run('layout switch',async()=>{
   await readyHome();
   await header.getByRole('button',{name:'切换到桌面版'}).click();
   await go('/personal/schedule');
   await checkBox('/personal/schedule','日程','desktop');
   await header.getByRole('button',{name:'切换到手机版'}).click();
   await checkBox('/personal/schedule','日程');
   await header.getByRole('button',{name:'LifeOS 总览',exact:true}).click();
   await checkBox('/personal','总览');
   await expect(page.locator('html')).toHaveAttribute('data-lifeos-workspace-layout','mobile');
  });
  await run('todo detail and close',async()=>{
   await readyHome();await openDrawer();
   await drawer.getByRole('button',{name:'待办',exact:true}).click();
   await checkBox('/personal?page=tasks','待办');
   await main.getByRole('button',{name:/查看待办详情：合成移动待办|打开任务：合成移动待办/}).first().click();
   const editor=page.getByRole('dialog',{name:/待办/});
   await expect(editor).toBeVisible();
   await editor.getByRole('button',{name:/关闭待办/}).click();
   await expect(editor).toBeHidden();
   await checkBox('/personal?page=tasks','待办');
  });
  await run('journal original and return',async()=>{
   await readyHome();await openDrawer();
   await drawer.getByRole('link',{name:'记录',exact:true}).click();
   await checkBox('/personal/journal','记录');
   await main.getByRole('link',{name:'合成移动日记',exact:true}).click();
   await expect(main.getByRole('article',{name:'日记原文'})).toContainText('合成日记原文');
   await expect(page).toHaveURL(origin+'/personal/journal');
   await header.getByRole('button',{name:'LifeOS 总览',exact:true}).click();
   await checkBox('/personal','总览');
  });
  for(const [group,label,path,title] of [
   ['日常','日程','/personal/schedule','日程'],
   ['身体基础','健康','/personal/health','健康'],
   ['兴趣学习','书影音','/personal/media','书影音'],
   ['兴趣学习','做饭','/personal/cooking','做饭'],
   ['职业成长','职业','/personal/career','职业'],
   ['职业成长','简历','/personal/resume','简历'],
   ['', '开发项目','/personal/development-projects','开发项目'],
  ]){
   await run(label,async()=>{
    await readyHome();await openDrawer();
    if(group)await drawer.getByRole('button',{name:group,exact:true}).click();
    await drawer.getByRole('link',{name:label,exact:true}).click();
    await checkBox(path,title);
    await expect(page.locator('html')).toHaveAttribute('data-lifeos-workspace-layout','mobile');
   });
  }
  await run('settings',async()=>{
   await readyHome();await header.getByRole('button',{name:'打开设置'}).click();await checkBox('/personal?page=settings','设置');
  });
  await run('legacy records alias',async()=>{await go('/personal/records');await checkBox('/personal/journal','记录');});
  await run('legacy journal editor',async()=>{
   const path='/personal/edit?type=journal&id='+diary.id;
   await go(path);await checkBox(path,'日记');
   await expect(main.getByLabel('标题',{exact:true})).toHaveValue('合成移动日记',{timeout:25000});
   await header.getByRole('button',{name:'LifeOS 总览',exact:true}).click();await checkBox('/personal','总览');
  });
  await run('legacy linked project editor',async()=>{
   await go('/personal?page=tasks');await awaitMobile('待办');
   await main.getByRole('link',{name:'查看项目：合成移动项目',exact:true}).click();
   const path='/personal/edit?type=project&id='+project.id;
   await checkBox(path,'项目');
   await expect(main.getByLabel('标题',{exact:true})).toHaveValue('合成移动项目',{timeout:25000});
   await header.getByRole('button',{name:'切换到桌面版'}).click();
   await page.reload({waitUntil:'domcontentloaded'});
   await checkBox(path,'项目','desktop');
   await header.getByRole('button',{name:'切换到手机版'}).click();
   await checkBox(path,'项目');
   await page.goBack({waitUntil:'domcontentloaded'});
   await checkBox('/personal?page=tasks','待办');
   await expect(page.locator('html')).toHaveAttribute('data-lifeos-workspace-layout','mobile');
   await page.goForward({waitUntil:'domcontentloaded'});
   await checkBox(path,'项目');
   if(width===430){
    writable=true;
    try{
     await page.reload({waitUntil:'domcontentloaded'});
     await checkBox(path,'项目');
     const title=main.getByLabel('标题',{exact:true});
     await expect(title).toBeEditable();
     await title.fill('合成未保存修改');
     const brand=header.getByRole('button',{name:'LifeOS 总览',exact:true});
     const refuse=page.waitForEvent('dialog').then(async dialog=>{assert.equal(dialog.type(),'confirm');await dialog.dismiss();});
     await Promise.all([refuse,brand.click()]);
     await expect(page).toHaveURL(origin+path);
     await expect(title).toHaveValue('合成未保存修改');
     const prompts:string[]=[];
     page.on('dialog',async dialog=>{prompts.push(dialog.type());await dialog.accept();});
     await brand.click();await checkBox('/personal','总览');
     assert.deepEqual(prompts,['confirm']);
    }finally{writable=false;}
   }
  });
  assert.deepEqual(errors,[]);
  await context.close();
 }
 assert.equal(writes,0);
 assert.deepEqual(failures,[]);
});
