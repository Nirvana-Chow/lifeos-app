import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,devices,expect,type Browser,type BrowserServer} from '@playwright/test';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';

test('OPT-IN mobile Expand survives missing native clone and recovers after a stalled owner read',{
 skip:process.env.RUN_PERSONAL_TASK_EXPAND_BROWSER_TESTS!=='1'&&'Requires an isolated Next fixture and native Chromium',timeout:100_000,
},async()=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-task-expand-'));
 let server:FixtureProcess|undefined,browserProcess:FixtureProcess|undefined,browserServer:BrowserServer|undefined,browser:Browser|undefined;
 let holdSnapshot=false,releaseSnapshot!:()=>void;
 const heldSnapshot=new Promise<void>(resolve=>releaseSnapshot=resolve);
 try{
  await mkdir(join(root,'app/personal'),{recursive:true});
  await Promise.all([
   cp(join(source,'src'),join(root,'src'),{recursive:true}),
   ...['layout.tsx','globals.css','theme.css','personal/page.tsx','personal/layout.tsx','personal/error.tsx'].map(file=>cp(join(source,'app',file),join(root,'app',file))),
   cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
   symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components')),
  ]);
  await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false,reactStrictMode:false};\n');
  await writeFile(join(root,'src/platform/runtime.ts'),`
export const readPlatformPagePrincipal=async()=>({id:'synthetic-expand-owner'});
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
  const page=await browser.newPage({...devices['iPhone 13'],viewport:{width:390,height:844}});
  const errors:string[]=[],writes:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>Object.defineProperty(window,'structuredClone',{configurable:true,value:undefined}));
  const id='11111111-1111-4111-8111-111111111111',title='合成手机展开待办',spaceId='synthetic-expand-space',ownerId='synthetic-expand-owner';
  const fields={title,notes:'Synthetic editor only',dueOn:null,status:'open'};
  const at='2030-11-01T00:00:00Z';
  const task={
   id,kind:'todo',revision:1,draft:fields,createdAt:at,updatedAt:at,syncState:'draft',externalStatus:null,
   source:{id,system:'website',externalId:id,version:1,asOf:at,original:{marker:'personal-manual-v1',spaceId,type:'todo',input:{spaceId,confirmed:true,fields}}},
  };
  const appleId='77777777-7777-4777-8777-777777777777',reminderTitle='合成苹果提醒事项';
  const reminderFields={...fields,title:reminderTitle,notes:''};
  const reminder={
   ...task,id:appleId,draft:reminderFields,
   source:{...task.source,id:appleId,externalId:appleId,original:{
    marker:'personal-apple-reminders-v1',spaceId,type:'todo',sourceRef:'apple-reminder:'+appleId,sourceDigest:'a'.repeat(64),
    source:{id:appleId,listID:'88888888-8888-4888-8888-888888888888',capturedAt:at,isCompleted:false,dueDate:null,dueDateIsAllDay:null,completionDate:null,original:{title:reminderTitle},notesIncluded:false,sourceTimes:{}},
    initialDraft:reminderFields,
   }},
  };
  let heldReads=0,workspaceReads=0,wideReads=0,earlyStandaloneStatus=0;
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname;
   if(url.origin!==origin)return route.abort();
   if(!path.startsWith('/api/'))return route.continue();
   if(request.method()!=='GET'){writes.push(request.method());return route.fulfill({status:405});}
   if(path.endsWith('/personal/availability'))return route.fulfill({json:{configured:true,loginAllowed:true,transport:'ssh-loopback',origin}});
   if(path.endsWith('/personal/status')){
    if(workspaceReads===0)earlyStandaloneStatus++;
    return route.fulfill({json:{scope:'personal-manual-candidate',ownerId,spaceId,storageVerified:true,allowedTypes:['todo'],writable:true}});
   }
   if(path.endsWith('/personal/overview')){wideReads++;return route.fulfill({status:500});}
   if(path.endsWith('/personal/todo/workspace-snapshot')){
    workspaceReads++;
    assert.equal(url.searchParams.get('include'),'access');
    if(holdSnapshot){heldReads++;await heldSnapshot;if(page.isClosed())return;}
    return route.fulfill({json:{scope:'task-workspace-current-snapshot',access:{scope:'personal-manual-candidate',ownerId,spaceId,storageVerified:true,writable:true,allowedTypes:['todo']},truncated:false,total:2,items:[task,reminder],today:url.searchParams.get('today'),observedAt:at}});
   }
   return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
  });
  await page.goto(origin+'/personal',{waitUntil:'domcontentloaded',timeout:60_000});
  const workspace=page.locator('[data-workspace-state]');
  const expand=page.getByRole('button',{name:'展开详情：'+title,exact:true});
  const details=page.getByRole('dialog',{name:'待办详情',exact:true});
  const boundary=page.getByRole('heading',{name:'本人工作台暂不可用',exact:true});
  assert.equal(await page.evaluate(()=>typeof window.structuredClone),'undefined');
  await expect(workspace).toHaveAttribute('data-workspace-state','ready');
  const initialReads=workspaceReads;
  assert.equal(initialReads,1,'cold entry reads the narrow workspace once');
  assert.equal(earlyStandaloneStatus,0,'the task workspace does not wait for a separate status request');
  for(let iteration=0;iteration<2;iteration++){
   await expand.tap();
   await expect(details.getByLabel('标题',{exact:true})).toHaveValue(title);
   await page.keyboard.press('Escape');
   await expect(details).toHaveCount(0);
  }
  await page.getByRole('button',{name:'展开详情：'+reminderTitle,exact:true}).tap();
  await expect(details.getByLabel('标题',{exact:true})).toHaveValue(reminderTitle);
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
  assert.equal(workspaceReads,initialReads,'opening details does not reload the workspace');
  const returnToForeground=()=>page.evaluate(()=>{
   for(const visibilityState of ['hidden','visible']){
    Object.defineProperty(document,'visibilityState',{configurable:true,value:visibilityState});
    document.dispatchEvent(new Event('visibilitychange'));
   }
  });
  await returnToForeground();
  await expect.poll(()=>workspaceReads).toBe(initialReads+1);
  await expect(workspace).toHaveAttribute('data-workspace-state','ready');
  await expand.tap();
  holdSnapshot=true;
  await returnToForeground();
  await expect(details).toHaveCount(0);
  await expect.poll(()=>heldReads).toBeGreaterThan(0);
  await expect(workspace).toHaveAttribute('data-workspace-state','error',{timeout:12_000});
  await expect(page.getByText('本人空间读取超时，请重试。',{exact:true})).toBeVisible();
  const attempts=workspaceReads;
  assert.equal(attempts,initialReads+2,'a stalled foreground return requests one snapshot');
  holdSnapshot=false;
  releaseSnapshot();
  await expect(workspace).toHaveAttribute('data-workspace-state','error');
  assert.equal(workspaceReads,attempts);
  await workspace.getByRole('button',{name:'重新读取',exact:true}).tap();
  await expect(workspace).toHaveAttribute('data-workspace-state','ready');
  await expand.tap();
  await expect(details.getByLabel('标题',{exact:true})).toHaveValue(title);
  await expect(boundary).toHaveCount(0);
  assert.equal(wideReads,0);
  assert.equal(workspaceReads,attempts+1,'explicit retry requests one snapshot');
  assert.deepEqual(errors,[]);
  assert.deepEqual(writes,[]);
 }finally{
  releaseSnapshot();
  await cleanupAuthThemeFixture({root,browser,browserServer,browserProcess,server});
 }
});
