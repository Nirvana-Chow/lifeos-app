import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {on} from 'node:events';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,expect,type Browser,type BrowserServer} from '@playwright/test';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';

test('OPT-IN storage workbench recovers after session denial during a pending write',{
 skip:process.env.RUN_STORAGE_REVIEW_REAUTH_BROWSER_TESTS!=='1'&&'Requires disposable Next/Chromium',
 timeout:180_000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-storage-workspace-'));
 let server:FixtureProcess|undefined,browserProcess:FixtureProcess|undefined,browser:Browser|undefined,browserServer:BrowserServer|undefined;
 t.after(()=>cleanupAuthThemeFixture({root,server,browserProcess,browser,browserServer}));
 const files=['app/layout.tsx','app/globals.css','app/theme.css','app/personal/layout.tsx','app/personal/storage-review/workbench/page.tsx','postcss.config.mjs'];
 for(const file of files){await mkdir(join(root,file,'..'),{recursive:true});await cp(join(source,file),join(root,file));}
 await mkdir(join(root,'app/login'),{recursive:true});
 await cp(join(source,'src'),join(root,'src'),{recursive:true});
 await symlink(join(source,'node_modules'),join(root,'node_modules'));
 await symlink(join(source,'components'),join(root,'components'));
 await writeFile(join(root,'app/personal/storage-review/page.tsx'),'export default function Page(){return <h1>Synthetic return</h1>}');
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
 const page=await browser.newPage();
 await page.context().addCookies([{name:'storage-fixture',value:'1',url:origin,httpOnly:true}]);
 const endpoint='/api/platform/personal/storage-review';
 const errors:string[]=[],methods:string[]=[],commands:{key:string;body:string|null}[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 let denied=false,ownerId='synthetic-owner',spaceId='synthetic-space',heldWrite:Promise<void>|undefined;
 let heldRead:Promise<void>|undefined,revision=1,notes:{id:string;note:string}[]=[];
 const snapshot=()=>({revision,checklist:{schema:1,revision:'synthetic-v1',items:[
  {id:'A-1',kind:'file',status:'pending',title:ownerId+'/'+spaceId},
 ]},decisions:[],notes});
 await page.route('**/api/platform/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(path.endsWith('/personal/status'))return route.fulfill(denied?{status:401,json:{}}:{json:{
   scope:'personal-manual-candidate',ownerId,spaceId,storageVerified:true,storageReviewEnabled:true,
  }});
  if(path===endpoint&&request.method()==='GET'){
   methods.push('GET');
   const review=snapshot();
   await heldRead;
   return route.fulfill({json:{review}});
  }
  if(path===endpoint+'/notes'&&request.method()==='PATCH'){
   methods.push('PATCH');
   commands.push({key:request.headers()['idempotency-key']!,body:request.postData()});
   const wait=heldWrite;
   if(wait){await wait;return route.fulfill({status:503,json:{}});}
   notes=[{id:'A-1',note:request.postDataJSON().note}];
   revision++;
   return route.fulfill({json:{review:snapshot()}});
  }
  return route.fulfill({status:404,json:{}});
 });
 const focus=()=>page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 const note=page.getByLabel('备注与处理要求');
 const save=page.getByRole('button',{name:'保存备注',exact:true});
 const recheck=page.getByRole('button',{name:'重新核对'});
 await page.goto(origin+'/personal/storage-review/workbench');
 await expect(note).toBeVisible({timeout:30_000});
 await note.fill('保留合成原文');
 let releaseOld!:()=>void;
 heldWrite=new Promise(resolve=>{releaseOld=resolve;});
 await save.click();
 await expect.poll(()=>methods.join()).toBe('GET,PATCH');
 denied=true;
 await focus();
 await expect(page.getByRole('link',{name:'重新登录',exact:true})).toBeVisible();
 await expect(note).toHaveCount(0);
 heldWrite=undefined;
 releaseOld();
 denied=false;
 await recheck.click();
 await expect.poll(()=>methods.join(),{message:'Same-owner recheck must read storage again'}).toBe('GET,PATCH,GET');
 await expect(note).toHaveValue('保留合成原文');
 await expect(page.getByText('待确认的选择',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'按原请求重试确认'}).click();
 await expect(page.locator('#notice')).toHaveText('备注已保存，并已读回 LifeOS。');
 assert.deepEqual(commands[1],commands[0]);
 assert.deepEqual(methods,['GET','PATCH','GET','PATCH','GET']);

 await note.fill('旧空间合成草稿');
 heldWrite=new Promise(resolve=>{releaseOld=resolve;});
 await save.click();
 await expect.poll(()=>commands.length).toBe(3);
 ownerId='new-synthetic-owner';spaceId='new-synthetic-space';notes=[];
 let releaseRead!:()=>void;
 heldRead=new Promise(resolve=>{releaseRead=resolve;});
 await focus();
 await expect.poll(()=>methods.at(-1)).toBe('GET');
 await expect(note).toBeHidden();
 heldWrite=undefined;
 releaseOld();
 await expect(note).toBeHidden();
 assert.equal(methods.length,7,'old completion must not issue a readback in the new scope');
 heldRead=undefined;
 releaseRead();
 await expect(note).toHaveValue('');
 await expect(page.getByRole('heading',{name:ownerId+'/'+spaceId})).toBeVisible();
 // A second switch in the same account must clear the old space's local draft.
 await note.fill('切换前的合成草稿');
 spaceId='third-synthetic-space';
 await focus();
 await expect(page.getByRole('heading',{name:ownerId+'/'+spaceId})).toBeVisible();
 await expect(note).toHaveValue('');

 heldRead=new Promise(resolve=>{releaseRead=resolve;});
 const beforeUnmount=methods.length;
 spaceId='fourth-synthetic-space';
 await focus();
 await expect.poll(()=>methods.length).toBe(beforeUnmount+1);
 await page.evaluate(()=>{document.documentElement.dataset.retainedDocument='synthetic';});
 const aborted=page.waitForEvent('requestfailed',request=>new URL(request.url()).pathname===endpoint);
 await page.getByRole('link',{name:'返回存储审核独立入口'}).click();
 await expect(page.getByRole('heading',{name:'Synthetic return'})).toBeVisible();
 await expect(page.locator('html')).toHaveAttribute('data-retained-document','synthetic');
 await aborted;
 heldRead=undefined;
 releaseRead();
 await focus();
 assert.equal(methods.length,beforeUnmount+1);
 assert.deepEqual(errors,[]);
 console.log('STORAGE_REAUTH_PASS same-owner GET, same idempotency key, independent GET, late completion, owner/space reset, soft unmount abort');
});
