import test from 'node:test';import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {chromium,expect,type Browser,type BrowserContext,type BrowserServer,type Page} from '@playwright/test';
import {makeSignature} from 'better-auth/crypto';
import {prepareSessionOAuthBrowser} from './helpers/session-duration-oauth-browser.ts';
import {trackAuthThemeProcess,cleanupAuthThemeFixture,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';
import {probeDisabledNoJsAuthForm} from './helpers/owner-nojs-auth-form.ts';

test('OPT-IN actual OAuth pages and native MFA preserve signed step-up continuation without replay',{skip:process.env.RUN_SESSION_DURATION_OAUTH_BROWSER_TESTS==='1'?false:'Requires isolated loopback Next and native Chrome',timeout:180000},async t=>{
 const source=resolve(process.env.LIFEOS_SESSION_BROWSER_SOURCE??resolve(import.meta.dirname,'..')),deps=resolve(import.meta.dirname,'../node_modules');
 const occupied=execFileSync('sh',['-c','lsof -nP -iTCP:32142 -sTCP:LISTEN -t || true'],{encoding:'utf8'});assert.equal(occupied.trim(),'','dedicated fixture port must be free');
 const root=await prepareSessionOAuthBrowser(source,deps);let server:FixtureProcess|undefined,browser:Browser|undefined,browserServer:BrowserServer|undefined,browserProcess:FixtureProcess|undefined;
 const origin='http://127.0.0.1:32142',secret='synthetic-duration-secret-never-production-0000';
 try{
  const child=spawn(process.execPath,[join(deps,'next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','32142'],{cwd:root,detached:true,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});server=trackAuthThemeProcess(child,true);
  console.log('SESSION_OAUTH_FIXTURE_RESOURCE '+JSON.stringify({owner:'EXEC-SESSION-001',root,serverPid:child.pid,port:32142}));
  await new Promise<void>((accept,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('OAuth fixture startup timeout')),30000);const data=(part:Buffer)=>{output+=String(part);if(/Ready in/.test(output)){clearTimeout(timer);accept();}};child.stdout.on('data',data);child.stderr.on('data',data);child.once('exit',()=>{clearTimeout(timer);reject(Error('OAuth fixture exited: '+output.slice(-500)));});});
  browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});browserProcess=trackAuthThemeProcess(browserServer.process());browser=await chromium.connect(browserServer.wsEndpoint());
  console.log('SESSION_OAUTH_BROWSER_RESOURCE '+JSON.stringify({pid:browserServer.process().pid}));
  async function context(){const c=await browser!.newContext();await c.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.fulfill({status:200,body:'Synthetic callback only; no external request'}));await control(c,'fresh');return c;}
  async function control(c:BrowserContext,action?:string){const response=action?await c.request.post(origin+'/fixture/control',{data:{action}}):await c.request.get(origin+'/fixture/control');assert.equal(response.status(),200);return response.json();}
  async function query(){const params=new URLSearchParams({client_id:'https://client.example/meta',redirect_uri:'https://client.example/callback',resource:'https://lifeos.nirvanachow.com/api/platform/mcp',scope:'todo:read',code_challenge_method:'S256',code_challenge:'x'.repeat(43),state:'synthetic original + raw & state',exp:String(Math.floor(Date.now()/1000)+300)});const canonical=new URLSearchParams([...params].sort(([a],[b])=>a<b?-1:a>b?1:0));params.set('sig',await makeSignature(canonical.toString(),secret));return params.toString();}
  async function login(c:BrowserContext,page:Page){const data=await control(c);await page.getByLabel('邮箱',{exact:true}).fill('fixture@example.invalid');await page.getByLabel('密码',{exact:true}).fill('Synthetic-duration-password-001');await page.getByLabel('验证器动态码',{exact:true}).fill(data.code);await page.getByLabel('这台设备保持登录').selectOption('day');await page.getByRole('button',{name:'登录',exact:true}).click();}
  await t.test('stale yet valid owner is redirected to exact reauth envelope then native MFA resumes the original continuation',async()=>{
   const c=await context(),page=await c.newPage();try{
    await page.goto(origin+'/login',{waitUntil:'networkidle'});await login(c,page);await expect(page).toHaveURL(origin+'/personal');assert.ok((await control(c,'age')).staleValidSessions>0);const signed=await query();
    await page.goto(origin+'/personal/oauth/continue?oauth_query='+encodeURIComponent(signed),{waitUntil:'networkidle'});await expect(page).toHaveURL(origin+'/login?reauthenticate=1&oauth_query='+encodeURIComponent(signed));
    await login(c,page);await expect(page).toHaveURL(origin+'/personal/oauth/continue?oauth_query='+encodeURIComponent(signed));await expect(page.getByRole('heading',{name:'继续连接',exact:true})).toBeVisible();const state=await control(c);assert.equal(state.providerCalls,0);assert.deepEqual(state.authRequests,[...Array(2)].flatMap(()=>[{path:'/api/platform/auth/sign-in/email',status:200},{path:'/api/platform/auth/two-factor/verify-totp',status:200}]));
   }finally{await c.close();}
  });
  await t.test('actual owner-required401 after consent render preserves the exact request through a fresh native login',async()=>{
   const c=await context(),page=await c.newPage();try{
    await page.goto(origin+'/login',{waitUntil:'networkidle'});await login(c,page);await expect(page).toHaveURL(origin+'/personal');const signed=await query();await control(c,'reset');
    await page.goto(origin+'/personal/oauth?oauth_query='+encodeURIComponent(signed),{waitUntil:'networkidle'});await control(c,'age');await page.getByRole('button',{name:'允许连接',exact:true}).click();await expect(page).toHaveURL(origin+'/login?reauthenticate=1&oauth_query='+encodeURIComponent(signed));
    const state=await control(c);assert.deepEqual(state.requests,[{path:'/api/platform/auth/oauth2/consent',query:signed}]);assert.equal(state.providerCalls,0);await login(c,page);await expect(page).toHaveURL(origin+'/personal/oauth/continue?oauth_query='+encodeURIComponent(signed));
   }finally{await c.close();}
  });
  await t.test('unconfirmed consent and continuation disable both automatic and repeated interaction',async()=>{
   const c=await context(),page=await c.newPage();try{
    await page.goto(origin+'/login',{waitUntil:'networkidle'});await login(c,page);await expect(page).toHaveURL(origin+'/personal');
    for(const continuation of [false,true]){await control(c,'reset');await control(c,'unconfirmed');const signed=await query();await page.goto(origin+'/personal/oauth'+(continuation?'/continue':'')+'?oauth_query='+encodeURIComponent(signed),{waitUntil:'networkidle'});const button=page.getByRole('button',{name:continuation?'继续':'允许连接',exact:true});await button.click();await expect(page.getByRole('status')).toContainText('连接结果未确认');await expect(button).toBeDisabled();await button.evaluate(node=>(node as HTMLButtonElement).click());await page.waitForTimeout(250);const state=await control(c);assert.equal(state.requests.length,1);assert.equal(state.requests[0].query,signed);assert.equal(state.providerCalls,1);assert.equal(new URL(page.url()).pathname,'/personal/oauth'+(continuation?'/continue':''));}
   }finally{await c.close();}
  });
  await t.test('original no-JS consumer keeps canonical disabled POST after authenticated reopen',async()=>{
   const c=await context(),page=await c.newPage();let nojs:BrowserContext|undefined;
   try{
    await page.goto(origin+'/login',{waitUntil:'networkidle'});await login(c,page);await expect(page).toHaveURL(origin+'/personal');await page.goto(origin+'/login',{waitUntil:'networkidle'});await expect(page).toHaveURL(origin+'/personal');
    nojs=await browser!.newContext({javaScriptEnabled:false});await nojs.addCookies(await c.cookies(origin));
    for(const[route,field]of[['/login','password'],['/account/password','currentPassword']] as const){const probe=await nojs.newPage();probe.setDefaultTimeout(5000);let terminal:Promise<'failed'|'finished'>|undefined;
     try{({finished:terminal}=await probeDisabledNoJsAuthForm(probe,{origin,route,field,stage:value=>console.log('LOCAL_ORIGINAL_NOJS_STAGE '+value)}));}finally{await probe.close();}
     assert.ok(['failed','finished'].includes(await terminal!));
    }
   }finally{await nojs?.close();await c.close();}
  });
 }finally{await cleanupAuthThemeFixture({root,browser,browserServer,browserProcess,server});}
});
