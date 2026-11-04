import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp, mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {once} from 'node:events';
import test from 'node:test';
import {chromium, expect} from '@playwright/test';
const source=resolve(import.meta.dirname,'..');
async function fixture(root:string){
 await mkdir(join(root,'app/personal'),{recursive:true});
 await Promise.all([
  ...['layout.tsx','globals.css','theme.css'].map(file=>cp(join(source,'app',file),join(root,'app',file))),
  cp(join(source,'app/personal/page.tsx'),join(root,'app/personal/page.tsx')),
  cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  cp(join(source,'src'),join(root,'src'),{recursive:true}),
  symlink(join(source,'node_modules'),join(root,'node_modules')),
  symlink(join(source,'components'),join(root,'components')),
 ]);
 await writeFile(join(root,'src/platform/runtime.ts'),'export const readPlatformPagePrincipal=async()=>({id:"synthetic-owner"}); export const readPlatformPasswordCapability=async()=>true;\n');
 const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],
  {cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 return server;
}

test('classification dialog preserves context and recovers explicit commands', {skip:process.env.RUN_CLASSIFICATION_BROWSER_TESTS!=='1',timeout:180_000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-classification-')),server=await fixture(root),stopped=once(server,'exit');
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await new Promise<string>((accept,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('fixture start timeout')),30000);server.stdout.on('data',chunk=>{text+=String(chunk);const match=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});server.once('exit',()=>reject(Error('fixture exited')));});
 const captureDir=join(source,'.superpowers/sdd/2026-11-05-atomic-classification/task-4-captures');await mkdir(captureDir,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 const newPlanId='44444444-4444-4444-8444-444444444444',secondId='55555555-5555-4555-8555-555555555555';
 const planId='11111111-1111-4111-8111-111111111111',todoId='22222222-2222-4222-8222-222222222222',projectId='33333333-3333-4333-8333-333333333333';
 const after={project:{id:projectId,sourceId:projectId,revision:1},domain:null,topics:[]},digest='a'.repeat(64);
 const preview={planId,digest,expiresAt:'2035-01-01T00:00:00Z',changes:[{todo:{id:todoId,sourceId:todoId,expectedRevision:1},before:null,after}],unchangedIds:[]};
 let approval=false,receipt=false,auth=false,commitUnknown=false,approvalFail=false,commitConflict=false,two=false;const posts:{url:string;body:string;key:string|null}[]=[];
 for(const [width,theme] of [[360,'light'],[360,'dark'],[1365,'light'],[1365,'dark']] as const){
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme});
  await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin)return route.abort();
   if(url.pathname.includes('/todo-classifications/')){
    if(req.method()==='POST'){posts.push({url:url.pathname,body:req.postData()??'',key:req.headers()['idempotency-key']??null});if(url.pathname.endsWith('/preview'))return route.fulfill({json:{...preview,planId:newPlanId}});if(url.pathname.endsWith('/approve')){if(approvalFail)return route.fulfill({status:503,json:{}});approval=true;return route.fulfill({json:{}});}if(commitUnknown)return route.fulfill({status:503,json:{}});if(commitConflict)return route.fulfill({status:409,json:{}});receipt=true;return route.fulfill({json:{}});}
    if(auth)return route.fulfill({status:401,json:{}});
    const currentPreview=url.pathname.endsWith(newPlanId)?{...preview,planId:newPlanId}:two?{...preview,changes:[...preview.changes,{todo:{id:secondId,sourceId:secondId,expectedRevision:1},before:null,after}]}:preview;return route.fulfill({json:{preview:currentPreview,approval:approval?{planId}:null,committed:receipt,stale:receipt,receipt:receipt?{planId,digest,duplicate:false,entries:[{id:todoId,sourceId:todoId,revision:2,personal:after}],unchangedIds:[]}:null,labels:{todos:[{id:todoId,sourceId:todoId,revision:1,title:'合成待办'},{id:secondId,sourceId:secondId,revision:1,title:'合成待办乙'}],organization:[{id:projectId,sourceId:projectId,revision:1,type:'project',title:'合成项目'}]}}});
   }
   if(url.pathname.endsWith('/personal/todo/'+todoId))return route.fulfill({json:{entry:{source:{id:todoId},revision:2,draft:{personal:after}}}});
   if(url.pathname.endsWith('/personal/status'))return route.fulfill({json:{scope:'personal-manual-candidate',ownerId:'synthetic-owner',spaceId:'synthetic-space',storageVerified:true,writable:true,allowedTypes:['todo']}});
   if(url.pathname.endsWith('/personal/availability'))return route.fulfill({json:{configured:true,loginAllowed:true,transport:'ssh-loopback',origin}});
   if(url.pathname.endsWith('/personal/overview'))return route.fulfill({json:{scope:'full-current-snapshot',total:0,truncated:false,items:[],today:url.searchParams.get('today'),observedAt:'2030-01-01T00:00:00Z'}});
   return route.continue();});
  const address=origin+'/personal?page=tasks&modal=classification&planId='+planId;
  await page.goto(address);const dialog=page.getByRole('dialog',{name:'审核待办分类'});await expect(dialog).toBeVisible();await expect(dialog.getByText('合成待办')).toBeVisible();await expect(dialog.getByText('合成项目')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-lifeos-theme',theme);await page.screenshot({path:join(captureDir,`synthetic-${width}-${theme}.png`),animations:'disabled'});assert.ok((await dialog.boundingBox())!.width<=width);await dialog.getByRole('button',{name:'展开全屏'}).click();await expect(dialog.getByRole('button',{name:'恢复窗口'})).toBeVisible();await dialog.getByRole('button',{name:'恢复窗口'}).click();
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('heading',{name:'待办',exact:true})).toBeFocused();assert.equal(posts.length,0);
  if(width===1365&&theme==='dark'){
   await page.goto(address);await expect(dialog).toBeVisible();commitUnknown=true;await dialog.getByRole('button',{name:'确认并提交'}).click();await expect(dialog.getByText(/提交结果未确认/)).toBeVisible();await page.screenshot({path:join(captureDir,'synthetic-1365-dark-unknown.png'),animations:'disabled'});assert.equal(posts.length,2);assert.match(posts[0].url,/\/approve$/);assert.match(posts[1].url,/\/commit$/);assert.equal(posts[0].body,JSON.stringify({digest,confirmed:true}));assert.equal(posts[1].body,posts[0].body);assert.match(posts[1].key!,/^cls-[a-f0-9]{64}$/);
   await page.keyboard.press('Escape');await expect(dialog).toBeVisible();auth=true;await dialog.getByRole('button',{name:'读取结果'}).click();await expect(dialog.getByText('合成待办')).toHaveCount(0);const login=dialog.getByRole('link',{name:'在新标签登录'});await expect(login).toHaveAttribute('href','/login');await expect(login).toHaveAttribute('target','_blank');const popupPromise=page.waitForEvent('popup');await login.click();const popup=await popupPromise;await expect(page).toHaveURL(address);await popup.close();auth=false;await dialog.getByRole('button',{name:'重新读取'}).click();await expect(dialog.getByText(/原请求可能仍在处理/)).toBeVisible();assert.equal(posts.length,2);
   commitUnknown=false;await dialog.getByRole('button',{name:'重试同一请求'}).click();await expect(dialog.getByText('已核对')).toBeVisible();assert.equal(posts.length,3);assert.equal(posts[2].key,posts[1].key);assert.equal(posts[2].body,posts[1].body);
   await page.reload();await expect(dialog.getByText('已核对')).toBeVisible();assert.equal(posts.length,3);approval=false;receipt=false;approvalFail=true;await page.reload();await dialog.getByRole('button',{name:'确认并提交'}).click();await expect(dialog.getByText(/批准结果未确认/)).toBeVisible();assert.equal(posts.length,4);assert.match(posts[3].url,/\/approve$/);await dialog.getByRole('button',{name:'读取结果'}).click();await expect(dialog.getByRole('button',{name:'确认并提交'})).toBeVisible();assert.equal(posts.length,4);approvalFail=false;commitConflict=true;await dialog.getByRole('button',{name:'确认并提交'}).click();await expect(dialog.getByText(/提交冲突/)).toBeVisible();assert.equal(posts.length,6);await dialog.getByRole('button',{name:'读取结果'}).click();assert.equal(posts.length,6);approval=false;receipt=false;two=true;await page.reload();await dialog.getByLabel('合成待办乙').uncheck();await dialog.getByRole('button',{name:'为所选待办生成新预览'}).click();await expect(page).toHaveURL(origin+'/personal?page=tasks&modal=classification&planId='+newPlanId);assert.equal(posts.length,7);assert.deepEqual(JSON.parse(posts[6].body),{selectedTodoIds:[todoId]});await expect(dialog.getByText('合成待办乙')).toHaveCount(0);
  }
  await page.close();
 }
});
