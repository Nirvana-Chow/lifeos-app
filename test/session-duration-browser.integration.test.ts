import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {chromium,expect,type Browser} from '@playwright/test';import {trackAuthThemeProcess,cleanupAuthThemeFixture,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';
import {journalFixture,journalStatus} from './helpers/journal-history.ts';
test('OPT-IN real login page and mounted expiry guard preserve device choice, keyboard use, drafts and return path',{skip:process.env.RUN_SESSION_DURATION_BROWSER_TESTS==='1'?false:'Requires isolated Next and native Chrome',timeout:180000},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-session-'));let server:FixtureProcess|undefined,browser:Browser|undefined;
 try{
  for(const path of ['app/login','app/personal/journal'])await mkdir(join(root,path),{recursive:true});
  await Promise.all([cp(join(source,'src'),join(root,'src'),{recursive:true}),...['app/login/page.tsx','app/personal/layout.tsx','app/personal/journal/page.tsx','app/globals.css','app/theme.css','postcss.config.mjs'].map(path=>cp(join(source,path),join(root,path))),symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components'))]);
  await writeFile(join(root,'src/platform/runtime.ts'),`import {headers as readHeaders} from 'next/headers';export const readPlatformLoginCapability=async()=>({mode:'personal',enabled:true,sessionDuration:!(await readHeaders()).get('cookie')?.includes('fixture-legacy=1'),ownerAlias:'owner'});export const readPlatformPagePrincipal=async(headers:Headers)=>headers.get('cookie')?.includes('fixture-ready=1')?{userId:'fixture-owner'}:null;\n`);
  await writeFile(join(root,'src/business-mcp-oauth/page-state.ts'),`export const readOAuthPageState=async()=>null;\n`);
  await writeFile(join(root,'app/layout.tsx'),`import type{ReactNode}from'react';import './globals.css';import './theme.css';import './style.css';export default function Layout({children}:{children:ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}`);
  await writeFile(join(root,'app/style.css'),`*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif} :root{--lo-content-padding:24px;--background:#fafafa;--foreground:#111;--card:#fff;--border:#ddd;--input:#aaa;--lo-radius-surface:12px;--lo-radius-control:6px;--lo-font-title:28px;--muted-foreground:#555;--primary:#111;--primary-foreground:#fff}input:focus-visible,select:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid #111;outline-offset:3px}`);
  await writeFile(join(root,'app/personal/page.tsx'),`'use client';import{useState}from'react';import{DeviceSessionsSettings}from'../../src/session-duration/settings';export default function Page(){const[value,setValue]=useState('');return <main><h1>合成本人空间</h1><label>未发送草稿<input value={value} onChange={e=>setValue(e.target.value)}/></label><DeviceSessionsSettings/></main>;}`);
  await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
  const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','32142'],{cwd:root,detached:true,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});server=trackAuthThemeProcess(child,true);
  await new Promise<void>((accept,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Session fixture startup timeout')),30000);child.stdout.on('data',part=>{output+=String(part);if(/Ready in/.test(output)){clearTimeout(timer);accept();}});child.stderr.on('data',part=>{output+=String(part);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Session fixture exited: '+output.slice(-300)));});});
  const origin='http://127.0.0.1:32142';browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const active=(mode='fixed',expires=Date.now()+60000,needsRefresh=false)=>({user:{id:'fixture-owner'},session:{mfaVerified:true,sessionDurationMode:mode,sessionDurationSeconds:mode==='rolling'?34560000:1800,expiresAt:new Date(expires).toISOString()},needsRefresh});
  await t.test('actual login page carries day selection through both native requests and supports mobile keyboard/custom validity',async()=>{
   const context=await browser!.newContext({viewport:{width:390,height:844}}),page=await context.newPage();const bodies:Record<string,unknown>[]=[];
   try{await page.route('**/api/platform/**',async route=>{const path=new URL(route.request().url()).pathname;if(path.endsWith('/get-session'))return route.fulfill({json:active()});if(path.endsWith('/device-sessions'))return route.fulfill({status:404});bodies.push(JSON.parse(route.request().postData()??'{}'));return route.fulfill({json:path.endsWith('/sign-in/email')?{twoFactorRedirect:true}:{user:{id:'fixture-owner'}}});});
    await page.goto(origin+'/login',{waitUntil:'networkidle'});const select=page.getByLabel('这台设备保持登录');await expect(select).toHaveValue('temporary');await expect(select).toBeEnabled();await select.focus();await expect(select).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'登录',exact:true})).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(select).toBeFocused();await select.selectOption('day');await expect(select).toHaveValue('day');
    await page.getByLabel('密码',{exact:true}).fill('Synthetic-browser-password');await page.getByLabel('验证器动态码',{exact:true}).fill('123456');await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page).toHaveURL(origin+'/personal');assert.deepEqual(bodies.map(body=>body.sessionDuration),[{mode:'fixed',seconds:86400},{mode:'fixed',seconds:86400}]);assert.equal(bodies[0].rememberMe,true);assert.equal(bodies[1].trustDevice,false);
    await page.goto(origin+'/login?reauthenticate=1',{waitUntil:'networkidle'});await select.selectOption('custom');await page.getByLabel('密码',{exact:true}).fill('Synthetic-browser-password');await page.getByLabel('登录时长',{exact:true}).fill('0');await page.getByRole('button',{name:'登录',exact:true}).click();assert.equal(bodies.length,2);await expect(page.getByLabel('登录时长',{exact:true})).toBeFocused();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   }finally{await context.close();}
  });
  await t.test('deadline locks without unmounting the draft; reauthentication restores it and keeps return query',async()=>{
   const context=await browser!.newContext(),page=await context.newPage();let expires=Date.now()+60000,posts=0;
   try{await page.route('**/api/platform/**',route=>{if(route.request().method()==='POST')posts++;return route.fulfill(new URL(route.request().url()).pathname.endsWith('/get-session')?{json:active('fixed',expires)}:{status:404});});
    await page.clock.install();
    await page.goto(origin+'/personal?page=tasks&create=todo',{waitUntil:'domcontentloaded'});const draft=page.getByLabel('未发送草稿');await expect(draft).toBeVisible({timeout:30000});await draft.fill('Synthetic unsent draft');await page.clock.fastForward(61000);await expect(page.getByRole('heading',{name:'登录已到期或需要重新验证'})).toBeVisible({timeout:10000});assert.equal(await draft.inputValue(),'Synthetic unsent draft');await expect(draft).toBeHidden();
    const login=page.getByRole('link',{name:'重新登录',exact:true});await expect(login).toHaveAttribute('target','_blank');assert.ok((await login.getAttribute('href'))!.includes(encodeURIComponent('/personal?page=tasks&create=todo')));expires=Date.now()+120000;await page.getByRole('button',{name:'已完成登录，继续编辑'}).click();await expect(draft).toBeVisible();assert.equal(await draft.inputValue(),'Synthetic unsent draft');assert.equal(posts,0);
   }finally{await context.close();}
  });
  await t.test('existing device reopens directly; rolling renewal uses one explicitPOST and device revocation uses opaque ID',async()=>{
   const context=await browser!.newContext(),page=await context.newPage();await context.addCookies([{name:'fixture-ready',value:'1',url:origin}]);let refreshed=false,refreshPosts=0,revokeBody:unknown;
   try{await page.route('**/api/platform/**',async route=>{const request=route.request(),path=new URL(request.url()).pathname;if(path.endsWith('/get-session')){if(request.method()==='POST'){refreshPosts++;assert.equal(request.postData(),'{}');refreshed=true;}return route.fulfill({json:active('rolling',Date.now()+60000,!refreshed)});}if(request.method()==='POST'){revokeBody=JSON.parse(request.postData()??'{}');return route.fulfill({json:{revoked:true,signedOut:false}});}return route.fulfill({json:{sessions:[{id:'fixture-other-session',current:false,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),userAgent:'Synthetic browser',duration:{mode:'fixed',seconds:86400}}],truncated:false}});});
    await page.goto(origin+'/login',{waitUntil:'networkidle'});await expect(page).toHaveURL(origin+'/personal');await expect(page.getByRole('heading',{name:'合成本人空间'})).toBeVisible();assert.equal(refreshPosts,1);page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'撤销这次登录'}).click();await expect(page.getByText('已撤销该设备登录。')).toBeVisible();assert.deepEqual(revokeBody,{id:'fixture-other-session'});
   }finally{await context.close();}
  });
  await t.test('legacy journal stays in place on a failed read, then retries or redirects on explicit denial',async()=>{
   const context=await browser!.newContext(),page=await context.newPage(),journal=origin+'/personal/journal';
   let failure:503|401|'offline'|null=null,unverifiedJournalReads=0;
   const commands:string[]=[],record=journalFixture(1,'2026-11-13');
   await context.addCookies([{name:'fixture-ready',value:'1',url:origin},{name:'fixture-legacy',value:'1',url:origin}]);
   try{
    await page.route(origin+'/api/platform/**',route=>{
     const request=route.request();
     const path=new URL(request.url()).pathname;
     if(request.method()!=='GET')commands.push(request.method()+' '+path);
     if(path==='/api/platform/auth/sign-out'&&request.method()==='POST'){
      return route.fulfill({headers:{'set-cookie':'fixture-ready=; Path=/; Max-Age=0'},json:{success:true}});
     }
     if(path==='/api/platform/status'&&failure!==null){
      return failure==='offline'?route.abort('internetdisconnected'):route.fulfill({status:failure,json:{}});
     }
     if(path.startsWith('/api/platform/personal/')&&failure!==null){
      if(path.startsWith('/api/platform/personal/journal/')||path==='/api/platform/personal/overview')unverifiedJournalReads++;
      if(failure==='offline')return route.abort('internetdisconnected');
     }
     const data:Record<string,unknown>={
      '/api/platform/status':{scope:'isolated-synthetic-review'},
      '/api/platform/personal/status':{...journalStatus,writable:true},
      '/api/platform/personal/journal/snapshot':{scope:'full-current-snapshot',items:[record],total:1,truncated:false,observedAt:'2026-11-12T16:00:00.000Z'},
      '/api/platform/personal/overview':{items:[]},
     };
     return route.fulfill({json:data[path]??{}});
    });
    await page.goto(journal,{waitUntil:'domcontentloaded',timeout:90000});
    await page.getByText('管理日记',{exact:true}).click();
    await page.getByRole('button',{name:'新增日记',exact:true}).click();
    const draft=page.getByRole('textbox',{name:'正文',exact:true});
    await page.getByRole('textbox',{name:'标题',exact:true}).fill('Synthetic unsaved title');
    await draft.fill('Synthetic journal draft');
    const visibility=(state:'hidden'|'visible')=>page.evaluate(value=>{
     Object.defineProperty(document,'visibilityState',{configurable:true,value});
     document.dispatchEvent(new Event('visibilitychange'));
    },state);
    const restore=async()=>{
     await visibility('hidden');
     await visibility('visible');
    };
    const retry=page.getByRole('button',{name:'重新核对',exact:true});
    for(const mode of [503,'offline'] as const){
     failure=mode;
     await restore();
     await expect(retry).toBeVisible();
     await expect(page).toHaveURL(journal);
     await expect(draft).toBeHidden();
     await expect(page.getByRole('heading',{name:'记录',exact:true,level:1})).toBeHidden();
     failure=null;
     await retry.click();
     await expect(draft).toBeVisible();
     await expect(draft).toHaveValue('Synthetic journal draft');
    }
    page.once('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:'取消',exact:true}).click();
    await context.clearCookies({name:'fixture-ready'});
    failure=401;
    await restore();
    await expect(page).toHaveURL(origin+'/login');
    await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();
    assert.deepEqual(commands,[]);
    assert.equal(unverifiedJournalReads,0);
    failure=null;
    await context.addCookies([{name:'fixture-ready',value:'1',url:origin}]);
    await page.goto(journal,{waitUntil:'domcontentloaded',timeout:90000});
    await page.getByRole('button',{name:'退出登录',exact:true}).click();
    await expect(page).toHaveURL(origin+'/login');
    assert.deepEqual(commands,['POST /api/platform/auth/sign-out']);
    assert.ok(!(await context.cookies(origin)).some(cookie=>cookie.name==='fixture-ready'));
   }finally{await context.close();}
  });
 }finally{await cleanupAuthThemeFixture({root,browser,server});}
});
