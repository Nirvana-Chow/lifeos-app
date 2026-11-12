import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';

// Actual Next page modules with an isolated synthetic principal. Full TLS tests
// retain the real owner/session/MFA boundary; this fixture covers SSR/hydration.
test('OPT-IN legacy password keeps the disabled no-JS POST gate and enhances into Settings',{
 skip:process.env.RUN_SETTINGS_BROWSER_TESTS!=='1'&&'Requires native Chrome and isolated Next fixture',timeout:120_000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-password-entry-'));
 await mkdir(join(root,'app/account/password'),{recursive:true});await mkdir(join(root,'app/personal'),{recursive:true});
 await Promise.all([
  ...['layout.tsx','globals.css','theme.css'].map(file=>cp(join(source,'app',file),join(root,'app',file))),
  cp(join(source,'app/account/password/page.tsx'),join(root,'app/account/password/page.tsx')),
  cp(join(source,'app/personal/page.tsx'),join(root,'app/personal/page.tsx')),
  cp(join(source,'src'),join(root,'src'),{recursive:true}),
  cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  cp(join(source,'proxy.ts'),join(root,'proxy.ts')),
  symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components')),
 ]);
 await writeFile(join(root,'src/platform/runtime.ts'),'export const readPlatformPagePrincipal=async()=>({id:"synthetic-owner"});export const readPlatformPasswordCapability=async()=>true;\n');
 const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']}),stopped=once(server,'exit');
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await new Promise<string>((accept,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Password fixture startup timeout')),30000);server.stdout.on('data',chunk=>{output+=String(chunk);const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});server.once('exit',()=>{clearTimeout(timer);reject(Error('Password fixture exited'));});});
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 await t.test('no-JS native form retains original safe POST behavior',async()=>{
  const context=await browser.newContext({javaScriptEnabled:false}),page=await context.newPage();t.after(()=>context.close());
  const initial=await page.goto(origin+'/account/password',{waitUntil:'domcontentloaded'});assert.equal(initial?.status(),200);assert.ok((await initial!.text()).includes('<h1>修改密码</h1>'));
  t.diagnostic('No-JS final pathname: '+new URL(page.url()).pathname);
  const form=page.locator('form');await expect(form).toHaveCount(1);
  await expect(form).toHaveAttribute('method','post');await expect(form).toHaveAttribute('action','/account/password');
  const current=page.locator('input[name="currentPassword"]');await expect(current).toBeDisabled();
  const navigation=page.waitForResponse(response=>response.request().isNavigationRequest()&&response.request().method()==='POST');
  await page.evaluate(()=>{const input=document.querySelector<HTMLInputElement>('input[name="currentPassword"]')!;input.value='synthetic-nojs-probe';input.form!.requestSubmit();});
  const response=await navigation,request=response.request(),url=new URL(request.url());
  assert.equal(request.method(),'POST');assert.equal(url.origin,origin);assert.equal(url.pathname,'/account/password');assert.equal(url.search,'');
  assert.equal((request.postData()??'').includes('synthetic-nojs-probe'),false,'disabled credentials never enter native POST');
  assert.ok(response.status()>=400,'native POST remains rejected without a hydrated explicit action');
  t.diagnostic('Native no-JS POST: '+response.status()+', same route, no credential marker');
  // As in the TLS isolated-page helper, closing the test document can abort
  // the pending navigation. Drain it without changing the mandatory facts above.
  const finished=response.finished().then(()=>undefined,()=>undefined);await page.close();await finished;
 });
 await t.test('hydration never enables the legacy form before canonical Settings',async()=>{
  const context=await browser.newContext(),page=await context.newPage();t.after(()=>context.close());let posts=0;const legacyStates:boolean[]=[];
  await context.addInitScript(()=>{
   const w=window as Window&{__legacyPasswordWasEnabled?:boolean};w.__legacyPasswordWasEnabled=false;
   const check=()=>{if(!document.querySelector('[data-legacy-password-entry]'))return;if(document.querySelector('[data-legacy-password-entry] input:enabled'))w.__legacyPasswordWasEnabled=true;const report=(window as Window&{recordLegacyPasswordState?:(value:boolean)=>Promise<void>}).recordLegacyPasswordState;void report?.(!!w.__legacyPasswordWasEnabled);};
   new MutationObserver(check).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled']});document.addEventListener('DOMContentLoaded',check);
  });
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(url.origin!==origin)return route.abort();
   if(!['GET','HEAD'].includes(request.method())){posts++;return route.fulfill({status:405});}
   if(url.pathname.endsWith('/personal/status'))return route.fulfill({json:{scope:'personal-manual-candidate',ownerId:'synthetic-owner',spaceId:'synthetic-space',storageVerified:true,writable:true,allowedTypes:['todo','journal','domain','project','topic']}});
   if(url.pathname.endsWith('/personal/availability'))return route.fulfill({json:{configured:true,loginAllowed:true,transport:'ssh-loopback',origin}});
   if(url.pathname.endsWith('/personal/overview'))return route.fulfill({json:{scope:'full-current-snapshot',total:0,truncated:false,items:[],today:url.searchParams.get('today'),observedAt:'2030-11-02T00:00:00Z'}});
   return route.continue();
  });
  await page.exposeBinding('recordLegacyPasswordState',(_source,value:boolean)=>{legacyStates.push(value);});
  await page.goto(origin+'/account/password',{waitUntil:'domcontentloaded'});
  // The canonical target is cold-compiled by this disposable Next fixture.
  await page.waitForURL(origin+'/personal?page=settings&panel=security',{timeout:30_000,waitUntil:'domcontentloaded'});
  await expect(page).toHaveURL(origin+'/personal?page=settings&panel=security');
  const settings=page.locator('#personal-main:has([data-settings-page])');await expect(settings).toBeVisible();await expect(page.locator('form')).toHaveCount(1);
  await expect(settings.getByLabel('原密码',{exact:true})).toBeEnabled();await expect(settings.getByLabel('原密码',{exact:true})).toHaveValue('');
  await expect.poll(()=>legacyStates.length).toBeGreaterThan(0);assert.ok(legacyStates.every(value=>value===false),'legacy credentials remain disabled through hydration');
  assert.equal(posts,0,'canonicalization never submits credentials');
 });
});
