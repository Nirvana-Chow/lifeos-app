import test from 'node:test';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {renderedContrast} from './helpers/personal-contrast.ts';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';
import {chromium,type Browser,type BrowserServer,type BrowserContext,type Page,type Request as BrowserRequest} from '@playwright/test';
import {Pool} from 'pg';
import {readReviewConfig} from '../src/platform/private-config.ts';
import {readPlatformConfig} from '../src/platform/config.ts';
import {createPlatformAuth,readOwnerMfaState} from '../src/platform/auth.ts';
import {syntheticOwnerTotp} from './helpers/owner-mfa-fixture.ts';
import {verifyRestrictedPool,type SqlPool} from '../src/platform/postgres.ts';
import {ownerRecoveryLock,ownerRecoveryRateLimit} from '../src/personal-candidate/owner-recovery-lock.ts';
import {ownerOperatorRecovery} from '../src/personal-candidate/owner-email-reset.ts';
import {safeScreenshot as guardedAuthScreenshot,trustFixtureCA,applyAuthFixtureAppearance,assertPublicLayout,assertPublicStaticCache} from './helpers/owner-recovery-browser-fixture.ts';
import {measureTaskGrid} from './helpers/task-grid-performance-fixture.ts';
import {verifyPersonalWorkspace} from './helpers/personal-workspace-browser-fixture.ts';
import {themeStorageKey} from '../src/workbench/theme.ts';

import {withPrivateBrowserFixture,verifyPrivateRouteBoundaries,verifyPrivateAppearanceAndDrafts,verifyPrivatePresentationMatrix,type PrivateBrowserHandoff} from './helpers/private-business-browser-fixture.ts';
import {recordSyntheticCapture,publishSyntheticCaptureManifest,assertFixtureCompletion} from '../scripts/synthetic-rendered-qualification.ts';
async function safeScreenshot(page:Page,name:string){await guardedAuthScreenshot(page,name);recordSyntheticCapture({name,url:page.url(),...await page.evaluate(()=>({width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.lifeosTheme??''}))});}
let completedHandoff:PrivateBrowserHandoff|undefined;
const enabled=process.env.RUN_OWNER_RECOVERY_BROWSER_TESTS==='1';
const qualificationMode=process.env.LIFEOS_OWNER_BROWSER_QUALIFICATION_MODE??'full';
if(!['full','visual','release'].includes(qualificationMode))throw Error('BROWSER_QUALIFICATION_MODE_INVALID');
const origin='https://review.example.test',target='postgresql://lifeos_platform_candidate_runtime:fixture-ci-runtime-never-live@127.0.0.1:55432/lifeos_platform_test_local';
const args=['--no-proxy-server','--disable-background-networking','--host-resolver-rules=MAP review.example.test 127.0.0.1, MAP * ~NOTFOUND'];
const must=(ok:unknown,stage:string)=>{if(!ok)throw Error(stage);};
function setApproval(value:string|undefined){const file='/run/lifeos-platform/runtime.json',env=JSON.parse(readFileSync(file,'utf8'));if(value===undefined)delete env.LIFEOS_PERSONAL_RECOVERY_APPROVAL;else env.LIFEOS_PERSONAL_RECOVERY_APPROVAL=value;writeFileSync(file+'.next',JSON.stringify(env),{mode:0o600});renameSync(file+'.next',file);}
async function cleanFields(page:Page){return page.locator('input,textarea').evaluateAll(nodes=>nodes.every(node=>{const input=node as HTMLInputElement;return ['email','username'].includes(input.name)?input.value===''||input.value==='owner':input.value==='';}));}
// Rejected Chromium navigations can leave response.finished() pending until close.
async function isolatedPage<T extends {close:()=>Promise<void>}>(open:()=>Promise<T>,check:(page:T)=>Promise<{finished:Promise<'failed'|'finished'>}>){const page=await open();let finished:Promise<'failed'|'finished'>;try{({finished}=await check(page));}finally{await page.close();}return await finished;}
async function observeFinished(finish:()=>Promise<unknown>):Promise<'failed'|'finished'>{try{return await finish()?'failed':'finished';}catch{return 'failed';}}
async function assertAuthTheme(page:Page,theme:'light'|'dark'){
 const facts=await page.evaluate(()=>{
  const style=(node:Element|null)=>{if(!node)throw Error('THEME_ELEMENT_MISSING');const s=getComputedStyle(node);return {background:s.backgroundColor,color:s.color,colorScheme:s.colorScheme};};
  return {theme:document.documentElement.dataset.lifeosTheme,root:style(document.documentElement),body:style(document.body),page:style(document.querySelector('main')),input:style(document.querySelector('form input')),button:style(document.querySelector('form button'))};
 });
 // Approved Radix3 slate/indigo default in app/theme.css; literal expectations stay
 // independent of computed styles. Auth input maps to card, not root background.
 const paper=theme==='dark'?'rgb(17, 17, 19)':'rgb(252, 252, 253)',ink=theme==='dark'?'rgb(237, 238, 240)':'rgb(28, 32, 36)';
 const inputPaper=theme==='dark'?'rgb(17, 17, 19)':'rgb(252, 252, 253)';
 const buttonInk='rgb(255, 255, 255)',buttonPaper='rgb(62, 99, 221)';
 must(facts.theme===theme&&facts.root.colorScheme===theme,'theme-resolved');
 for(const part of ['root','body','page'] as const)must(facts[part].background===paper&&facts[part].color===ink,'theme-'+part);
 must(facts.input.background===inputPaper&&facts.input.color===ink&&facts.input.colorScheme===theme,'theme-input');must(facts.button.background===buttonPaper&&facts.button.color===buttonInk&&facts.button.colorScheme===theme,'theme-button');
}
async function assertAuthPresentation(page:Page,system:'light'|'dark'){
 await assertAuthTheme(page,system);const preference=system==='dark'?'light':'dark',sibling=await page.context().newPage();
 try{await sibling.goto(origin+'/login',{waitUntil:'domcontentloaded'});await sibling.evaluate(({key,value})=>localStorage.setItem(key,value),{key:themeStorageKey,value:preference});await page.waitForFunction(t=>document.documentElement.dataset.lifeosTheme===t,preference);await assertAuthTheme(page,preference);}
 finally{await sibling.evaluate(key=>localStorage.removeItem(key),themeStorageKey);await page.waitForFunction(t=>document.documentElement.dataset.lifeosTheme===t,system);await sibling.close();}
 await assertAuthTheme(page,system);
}
async function assertPublicChineseHeading(page:Page,heading:'main h1'|'main h2'){
 await page.evaluate(()=>document.fonts.ready.then(()=>undefined));const session=await page.context().newCDPSession(page);
 try{
  await session.send('DOM.enable');await session.send('CSS.enable');const {root}=await session.send('DOM.getDocument',{depth:0});const {nodeId}=await session.send('DOM.querySelector',{nodeId:root.nodeId,selector:heading});must(nodeId>0,'cjk-heading');
  const {fonts}=await session.send('CSS.getPlatformFontsForNode',{nodeId}),used=fonts.filter(font=>/^Noto Sans CJK(?: (?:SC|TC|HK|JP|KR))?$/.test(font.familyName)&&!font.isCustomFont&&Number.isInteger(font.glyphCount)&&font.glyphCount>0);
  must(used.length>0,'cjk-heading-glyphs');console.log('PUBLIC_FORM_CJK '+JSON.stringify({form:heading==='main h2'?'login':'recovery',fonts:used.map(font=>({family:font.familyName,glyphCount:font.glyphCount}))}));
 }finally{await session.detach();}
}

// Real public components and shared styles; synthetic form only, no runtime/PG or submissions.
if(!enabled||process.env.RUN_AUTH_THEME_FIXTURE_BROWSER_TESTS==='1')test('OPT-IN public auth theme oracle follows approved shared palette',{
 skip:process.env.RUN_AUTH_THEME_FIXTURE_BROWSER_TESTS!=='1',timeout:120000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-'));
 let browser:Browser|undefined,browserServer:BrowserServer|undefined,ownedServer:FixtureProcess|undefined,ownedBrowser:FixtureProcess|undefined;
 t.after(()=>cleanupAuthThemeFixture({root,browser,browserServer,browserProcess:ownedBrowser,server:ownedServer}));
 let stage='setup';try{
 await mkdir(join(root,'app','recover'),{recursive:true});
 await Promise.all([cp(join(source,'src'),join(root,'src'),{recursive:true}),...['layout.tsx','globals.css','theme.css'].map(file=>cp(join(source,'app',file),join(root,'app',file))),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components'))]);
 await writeFile(join(root,'app','page.tsx'),`import {LoginPage} from '../src/personal-candidate/login';export default function Page(){return <LoginPage capability={{mode:'synthetic',enabled:true}}/>}`);
 await writeFile(join(root,'app','recover','page.tsx'),`import {OwnerRecoveryFinishPanel} from '../../src/personal-candidate/owner-recovery-finish-panel';export default function Page(){return <OwnerRecoveryFinishPanel enabled/>}`);
 const detached=process.platform!=='win32',server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],detached});
 ownedServer=trackAuthThemeProcess(server,detached);server.stderr.resume();
 stage='startup';const base=await new Promise<string>((accept,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('AUTH_THEME_FIXTURE_STARTUP')),30000);server.once('exit',()=>{clearTimeout(timer);reject(Error('AUTH_THEME_FIXTURE_EXIT'));});server.once('error',()=>{clearTimeout(timer);reject(Error('AUTH_THEME_FIXTURE_SPAWN'));});server.stdout.on('data',chunk=>{output=(output+String(chunk)).slice(-65536);const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});});
 stage='browser-launch';browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH,host:'127.0.0.1'});ownedBrowser=trackAuthThemeProcess(browserServer.process());
 stage='browser-connect';browser=await chromium.connect(browserServer.wsEndpoint());
 stage='context';
 for(const width of [1365,390])for(const theme of ['light','dark'] as const){
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme,hasTouch:width===390,isMobile:width===390});
  try{const page=await context.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
   for(const route of ['/','/recover']){
    stage='navigation';await page.goto(base+route,{waitUntil:'networkidle'});await page.waitForFunction(()=>!!document.querySelector('form button:not(:disabled)'));
    stage='theme';await assertAuthTheme(page,theme);stage='layout';await assertPublicLayout(page,{expectFits:true});
    const facts=await page.locator('form input').first().evaluate(node=>{const style=getComputedStyle(node);return {font:parseFloat(style.fontSize),height:node.getBoundingClientRect().height,ink:style.color,paper:style.backgroundColor};});
    stage='input';must(facts.font>=16&&facts.height>=44,'auth-input-geometry');must(renderedContrast(facts.ink,[{backgroundColor:facts.paper}]).contrast>=4.5,'auth-input-contrast');
    const button=await page.locator('form button').evaluate(node=>{const style=getComputedStyle(node);return {height:node.getBoundingClientRect().height,ink:style.color,paper:style.backgroundColor};});
    stage='button';must(button.height>=44&&renderedContrast(button.ink,[{backgroundColor:button.paper}]).contrast>=4.5,'auth-button-contrast');
   }must(errors.length===0,'auth-page-errors');
  }finally{await context.close();}
 }
 }catch(error){const reason=error instanceof Error&&/^(?:theme-(?:resolved|root|body|page|input|button)|auth-(?:input-geometry|input-contrast|button-contrast|page-errors))$/.test(error.message)?error.message:error instanceof Error&&error.name==='TimeoutError'?'timeout':error instanceof Error&&error.name==='AssertionError'?'assertion':'other';console.log('AUTH_THEME_FIXTURE_FAILURE '+JSON.stringify({stage,reason}));throw error;}
});

test('no-JS page lifecycle finishes and closes before the next page opens',{timeout:1000},async()=>{
 const events:string[]=[],outcomes:unknown[]=[];
 for(const label of ['login','password']){
  let finish!:(error:Error|null)=>void;const completion=new Promise<Error|null>(resolve=>{finish=resolve;});
  outcomes.push(await isolatedPage(async()=>{events.push('open-'+label);return {close:async()=>{events.push('close-'+label);finish(label==='login'?new Error('synthetic HTTP error'):null);}};},async()=>{
   events.push('response-'+label);return {finished:observeFinished(async()=>{const error=await completion;events.push('finished-'+label);return error;})};
  }));
 }
 must(outcomes.join(',')==='failed,finished','no-js-terminal-classification');
 must(events.join(',')==='open-login,response-login,close-login,finished-login,open-password,response-password,close-password,finished-password','no-js-order');
});

test('isolated browser owner recovery and password flow',{skip:!enabled?'isolated browser CI not requested':false,timeout:180000},async(t)=>{
 if(process.platform!=='linux'||process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||process.env.LIFEOS_FIXTURE_FRESH!=='approved-isolated-fixture'||process.env.LIFEOS_PLATFORM_TEST_DATABASE_URL!==target||!process.env.RUNNER_TEMP)throw Error('BROWSER_FIXTURE_UNAVAILABLE');
 completedHandoff=undefined;let pendingHandoff:PrivateBrowserHandoff|undefined;
 let stage='setup',noJsFinished='not-observed',approvalWritten=false,browser:Browser|undefined,context:BrowserContext|undefined,untrust:(()=>void)|undefined;const pool=new Pool({connectionString:target,max:3,connectionTimeoutMillis:2000,statement_timeout:5000,options:'-c search_path=pg_catalog,lifeos_platform'});
 try{
  const env=readReviewConfig('/run/lifeos-platform/runtime.json'),config=readPlatformConfig(env);must(config&&config.ownerId==='personal-review-user'&&config.ownerEmail==='owner@example.test'&&config.baseURL===origin&&config.databaseURL===target,'fixture');if(!config)throw Error('fixture');await verifyRestrictedPool(pool as SqlPool);
  stage='untrusted-ca';browser=await chromium.launch({channel:'chrome',headless:true,args});let refused=false;try{const page=await browser.newPage();try{await page.goto(origin+'/login',{waitUntil:'domcontentloaded',timeout:10000});}catch(error){refused=/ERR_CERT_AUTHORITY_INVALID/.test(error instanceof Error?error.message:'');}}finally{await browser.close();browser=undefined;}must(refused,'untrusted-ca');
  stage='trust-ca';untrust=trustFixtureCA(join(process.env.RUNNER_TEMP,'recovery-tls','ca.crt'));browser=await chromium.launch({channel:'chrome',headless:true,args});console.log('BROWSER_VERSION '+browser.version());stage='public-static-cache';await assertPublicStaticCache(browser);
  stage='closed';context=await browser.newContext({viewport:{width:1365,height:900}});const page=await context.newPage();stage='anonymous-root';const rootResponse=await page.goto(origin+'/',{waitUntil:'domcontentloaded'});must(rootResponse?.status()===200&&new URL(page.url()).pathname==='/','root-direct');const rootForm=page.locator('form[action="/login"]');must(await rootForm.getAttribute('method')==='post','root-form');for(const [name,autocomplete] of [['email','username'],['password','current-password'],['code','one-time-code']] as const)must(await rootForm.locator('input[name="'+name+'"]').getAttribute('autocomplete')===autocomplete,'root-'+name);must(await cleanFields(page),'root-clean');await assertPublicLayout(page,{expectFits:true});await page.setViewportSize({width:360,height:420});await assertPublicLayout(page,{expectScroll:true});await page.setViewportSize({width:1365,height:900});stage='closed';await page.goto(origin+'/account/recover',{waitUntil:'domcontentloaded'});must(new URL(page.url()).origin===origin,'origin');await page.getByText('安全恢复尚未启用，当前不能提交。').waitFor();must(await page.getByLabel('恢复码').isDisabled(),'closed');
  const proof=JSON.parse(readFileSync('.image-source-proof.json','utf8')),buildId=readFileSync('.next/BUILD_ID','utf8').trim(),now=Date.now();setApproval(JSON.stringify({version:1,attestation:'owner-host-recovery-v1',ownerId:config.ownerId,spaceId:'personal-review-space',origin,sourceSha:proof.sourceSha,sourceTreeDigest:proof.sourceTreeDigest,buildId,imageDigest:'sha256:'+'b'.repeat(64),issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+300000).toISOString()}));approvalWritten=true;
  stage='screenshots';for(const [name,width,height] of [['desktop',1365,900],['mobile',390,844]] as const)for(const theme of ['light','dark'] as const){const c=await browser.newContext({viewport:{width,height},isMobile:name==='mobile',hasTouch:name==='mobile',colorScheme:theme});try{const p=await c.newPage();await p.goto(origin+'/account/recover',{waitUntil:'domcontentloaded'});await p.getByLabel('恢复码').waitFor({state:'visible'});await p.waitForFunction(()=>{const input=document.querySelector('input[name="otp"]');return !!input&&!input.matches(':disabled');});must(await p.evaluate(t=>matchMedia('(prefers-color-scheme: '+t+')').matches,theme),'theme');const recoveryButton=p.getByRole('button',{name:'保存本人密码'});must(await recoveryButton.isVisible()&&await recoveryButton.isEnabled(),'recovery-button');must(await cleanFields(p),'screenshot');await assertAuthPresentation(p,theme);await assertPublicChineseHeading(p,'main h1');await assertPublicLayout(p,{expectFits:true});must(await p.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'layout');if((name==='desktop'&&theme==='light')||(name==='mobile'&&theme==='dark'))await safeScreenshot(p,'recovery-'+name+'.png');await p.goto(origin+'/',{waitUntil:'domcontentloaded'});await p.getByLabel('密码',{exact:true}).waitFor({state:'visible'});const loginButton=p.getByRole('button',{name:'登录',exact:true});await p.waitForFunction(()=>{const button=document.querySelector('form[action="/login"] button');return !!button&&!button.matches(':disabled');},null,{timeout:10000});must(await loginButton.isVisible()&&await loginButton.isEnabled(),'login-button');must(await cleanFields(p),'screenshot');await assertAuthPresentation(p,theme);await assertPublicChineseHeading(p,'main h2');await assertPublicLayout(p,{expectFits:true});must(await p.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'layout');if((name==='desktop'&&theme==='light')||(name==='mobile'&&theme==='dark'))await safeScreenshot(p,'login-'+name+'.png');}finally{await c.close();}}
  stage='attributes';await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>{const input=document.querySelector('input[name="otp"]');return !!input&&!input.matches(':disabled');});must(await page.locator('input[name="username"]').getAttribute('autocomplete')==='username','username');must(await page.locator('input[name="username"]').inputValue()==='owner','alias');must(await page.locator('input[name="otp"]').getAttribute('autocomplete')==='one-time-code','otp');must(await page.locator('input[name="newPassword"]').getAttribute('autocomplete')==='new-password','new-password');
  stage='invalid-code';const before=(await pool.query('SELECT password FROM lifeos_platform.platform_account WHERE "userId"=$1',[config.ownerId])).rows[0]?.password;const sessionsBefore=(await pool.query('SELECT id,"userId","expiresAt","createdAt","updatedAt" FROM lifeos_platform.platform_session WHERE "userId"=$1 ORDER BY id',[config.ownerId])).rows;await page.getByLabel('恢复码').fill('synthetic_invalid_code_123456');await page.getByLabel('新密码',{exact:true}).fill('fixture-browser-recovery-password');await page.getByLabel('确认新密码').fill('fixture-browser-recovery-password');await page.getByRole('button',{name:'保存本人密码'}).click();await page.getByRole('status').filter({hasText:'结果未确认'}).waitFor();must(await cleanFields(page),'reset');const after=(await pool.query('SELECT password FROM lifeos_platform.platform_account WHERE "userId"=$1',[config.ownerId])).rows[0]?.password;must(typeof before==='string'&&before===after,'invalid-code');const sessionsAfter=(await pool.query('SELECT id,\"userId\",\"expiresAt\",\"createdAt\",\"updatedAt\" FROM lifeos_platform.platform_session WHERE \"userId\"=$1 ORDER BY id',[config.ownerId])).rows;must(JSON.stringify(sessionsBefore)===JSON.stringify(sessionsAfter),'invalid-session');
  stage='issue';let code='';const issue=ownerOperatorRecovery(config,pool,{enabled:true,withOwnerLock:ownerRecoveryLock(pool as SqlPool,config.ownerId),limit:ownerRecoveryRateLimit(pool as SqlPool,config.ownerId),delivery:{kind:'trusted-operator',send:async message=>{code=message.code;}}});must((await issue()).status==='issued'&&code.length>=20,'issue');
  stage='recover';await page.getByLabel('恢复码').fill(code);code='';await page.getByLabel('新密码',{exact:true}).fill('fixture-browser-recovery-password');await page.getByLabel('确认新密码').fill('fixture-browser-recovery-password');await page.getByRole('button',{name:'保存本人密码'}).click();await page.getByRole('status').filter({hasText:'密码已更新'}).waitFor();must(await cleanFields(page),'recover-reset');
  const login=async(password:string,code?:string)=>{await page.goto(origin+'/login',{waitUntil:'domcontentloaded'});must(await page.locator('input[name="email"]').getAttribute('autocomplete')==='username','login-user');must(await page.locator('input[name="password"]').getAttribute('autocomplete')==='current-password','login-password');must(await page.locator('input[name="code"]').getAttribute('autocomplete')==='one-time-code','login-code');await page.getByLabel('密码',{exact:true}).fill(password);if(code)await page.getByLabel('验证器动态码',{exact:true}).fill(code);await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForFunction(()=>{const password=document.querySelector('input[name="password"]') as HTMLInputElement|null,fieldset=document.querySelector('form fieldset') as HTMLFieldSetElement|null;return location.pathname!=='/login'||!!password?.disabled&&!fieldset?.disabled||!!document.querySelector('[role="status"]')?.textContent;});};
  stage='login';await login('fixture-browser-recovery-password');await page.waitForURL(origin+'/account/mfa');
  const nativeMfa=createPlatformAuth(config,pool,{requireMfa:true,forceSecureCookies:true});
  stage='mfa-password-only-private-denied';
  const passwordHeaders=new Headers({cookie:(await context.cookies(origin)).map(c=>c.name+'='+c.value).join('; ')}),readMfa=createPlatformAuth(config,pool,{requireMfa:true,forceSecureCookies:true,readOnlySessions:true,disableSessionRefresh:true});
  const passwordSession=await readMfa.api.getSession({headers:passwordHeaders});must(passwordSession?.user.id===config.ownerId&&passwordSession.user.email===config.ownerEmail,'mfa-password-owner-binding');const passwordState=await readOwnerMfaState(readMfa,config,passwordHeaders);must(passwordState.kind==='enroll'&&passwordState.step==='start','mfa-native-enroll-start');
  for(const path of ['/personal','/personal/finance','/personal/outputs','/personal/settings/ai']){await page.goto(origin+path,{waitUntil:'domcontentloaded'});await page.waitForURL(origin+'/login');}await page.goto(origin+'/account/mfa',{waitUntil:'domcontentloaded'});
  stage='mfa-enrollment';await page.getByLabel('账号密码',{exact:true}).fill('fixture-browser-recovery-password');await page.getByRole('button',{name:'生成绑定信息'}).click();await page.locator('#mfa-setup-key').waitFor();
  must((await page.locator('#mfa-setup-key').textContent()??'').length>=16,'manual-totp-key');
  await page.waitForFunction(()=>{const c=document.querySelector('canvas[aria-label="验证器绑定二维码"]') as HTMLCanvasElement|null;const data=c?.getContext('2d')?.getImageData(0,0,c.width,c.height).data;return !!data&&data.some((value,index)=>index%4!==3&&value!==data[0]);});
  const backupCodes=await page.locator('ul[aria-label="备用恢复码"] code').allTextContents();must(backupCodes.length===10,'backup-codes');must(await page.getByRole('button',{name:'验证并继续'}).isDisabled(),'backup-save-required');
  let screenshotRefused=false;try{await safeScreenshot(page,'login-desktop.png');}catch(error){screenshotRefused=error instanceof Error&&error.message==='SCREENSHOT_DENIED';}must(screenshotRefused,'mfa-secret-screenshot-denied');
  await page.reload({waitUntil:'domcontentloaded'});await page.getByLabel('我已妥善保存此前显示的备用恢复码').waitFor();must(await page.locator('#mfa-setup-key').count()===0,'seed-not-persisted-after-reload');must(await page.getByRole('button',{name:'验证并继续'}).isDisabled(),'backup-save-required-after-reload');await page.getByLabel('我已妥善保存此前显示的备用恢复码').check();await page.getByLabel('验证器动态码',{exact:true}).fill(await syntheticOwnerTotp(nativeMfa,config.ownerId));await page.getByRole('button',{name:'验证并继续'}).click();await page.waitForURL(origin+'/personal');
  stage='personal-workspace';const {verifyPersisted,entries}=await verifyPersonalWorkspace(page);
  const finishSecondFactor=async()=>{await page.getByLabel('验证器动态码',{exact:true}).waitFor();await page.getByLabel('验证器动态码',{exact:true}).fill(await syntheticOwnerTotp(nativeMfa,config.ownerId));await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(origin+'/personal');};
  stage='no-js-fallback';const nojs=await browser.newContext({javaScriptEnabled:false,viewport:{width:1365,height:900}});try{
   await nojs.addCookies(await context.cookies(origin));
   const classifyRoute=(value:string)=>{try{const u=new URL(value);return u.origin===origin&&u.pathname==='/login'?'login':u.origin===origin&&u.pathname==='/account/password'?'password':'other';}catch{return 'other';}};
   const netCode=(value:string)=>value.match(/net::ERR_[A-Z_]+/)?.[0]??'OTHER';
   for(const [route,field] of [['/login','password'],['/account/password','currentPassword']] as const)noJsFinished=await isolatedPage(()=>nojs.newPage(),async p=>{
    p.on('framenavigated',frame=>{if(frame===p.mainFrame())console.log('NO_JS_FRAME '+classifyRoute(frame.url()));});
    p.on('requestfailed',request=>{if(request.isNavigationRequest()&&request.frame()===p.mainFrame())console.log('NO_JS_REQUEST_FAILED '+classifyRoute(request.url())+' '+netCode(request.failure()?.errorText??''));});
    const routeLabel=route==='/login'?'login':'password';stage='no-js-'+routeLabel+'-load';await p.goto(origin+route,{waitUntil:'domcontentloaded'});const form=p.locator('form');stage='no-js-'+routeLabel+'-form';must(await form.getAttribute('method')==='post'&&await form.getAttribute('action')===route,'no-js-form');stage='no-js-'+routeLabel+'-disabled';must(await p.locator('input[name="'+field+'"]') .isDisabled(),'no-js-disabled');
    stage='no-js-'+routeLabel+'-navigation';const navigation=p.waitForResponse(response=>response.request().isNavigationRequest()&&response.request().method()==='POST');
    await p.evaluate(name=>{const input=document.querySelector('input[name="'+name+'"]') as HTMLInputElement;input.value='synthetic-nojs-probe';(input.form as HTMLFormElement).requestSubmit();},field);
    const response=await navigation,request=response.request(),url=new URL(request.url());noJsFinished='pending';const facts={method:request.method()==='POST'?'POST':'OTHER',status:response.status(),originMatches:url.origin===origin,routeMatches:url.pathname===route,hasQuery:url.search!=='',hasMarker:(request.postData()??'').includes('synthetic-nojs-probe')};console.log('NO_JS_DIAGNOSTIC '+routeLabel+' '+JSON.stringify(facts));stage='no-js-'+routeLabel+'-response';must(facts.method==='POST'&&facts.originMatches&&facts.routeMatches&&!facts.hasQuery&&!facts.hasMarker&&facts.status>=400,'no-js-fallback');return {finished:observeFinished(()=>response.finished())};
   });
  }finally{await nojs.close();}
  stage='change-password';await page.goto(origin+'/account/password',{waitUntil:'domcontentloaded'});must(await page.locator('input[name="username"]').getAttribute('autocomplete')==='username','change-user');must(await page.locator('input[name="currentPassword"]').getAttribute('autocomplete')==='current-password','change-old');must(await page.locator('input[name="newPassword"]').getAttribute('autocomplete')==='new-password','change-new');await page.getByLabel('原密码').fill('fixture-browser-recovery-password');await page.getByLabel('新密码',{exact:true}).fill('fixture-browser-changed-password');await page.getByLabel('确认新密码').fill('fixture-browser-changed-password');await page.getByRole('button',{name:'保存密码',exact:true}).click();await page.waitForURL(origin+'/login');await page.goto(origin+'/personal',{waitUntil:'domcontentloaded'});await page.waitForURL(origin+'/login');
  stage='old-password-rejected';await login('fixture-browser-recovery-password');await page.getByRole('status').filter({hasText:'登录未通过'}).waitFor();must(await cleanFields(page),'old-reset');
  stage='new-password-login';await login('fixture-browser-changed-password');await page.getByLabel('验证器动态码',{exact:true}).waitFor();
  stage='mfa-challenge-layout';for(const [name,width,height,theme] of [['desktop',1365,900,'light'],['mobile',390,844,'dark']] as const){await page.setViewportSize({width,height});await applyAuthFixtureAppearance(page,theme);must(await cleanFields(page),'mfa-screenshot-empty');must(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'mfa-layout');await assertAuthPresentation(page,theme);await safeScreenshot(page,'mfa-login-'+name+'.png');}await page.setViewportSize({width:1365,height:900});await page.emulateMedia({colorScheme:'light'});
  await finishSecondFactor();await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'退出登录'}).click();await page.getByRole('button',{name:'前往登录'}).waitFor();await page.getByRole('button',{name:'前往登录'}).click();await page.waitForURL(origin+'/login');
  stage='native-rate-window';await new Promise(resolve=>setTimeout(resolve,61000));stage='combined-password-code-login';
  const loginDocuments={mfa:0,personal:0};const countLoginDocuments=(request:BrowserRequest)=>{try{if(!request.isNavigationRequest()||request.resourceType()!=='document'||request.frame()!==page.mainFrame())return;const url=new URL(request.url());if(url.origin!==origin||url.search||url.hash)return;if(url.pathname==='/account/mfa')loginDocuments.mfa=Math.min(1000,loginDocuments.mfa+1);if(url.pathname==='/personal')loginDocuments.personal=Math.min(1000,loginDocuments.personal+1);}catch{/* Observation never exposes or replaces native errors. */}};
  page.on('request',countLoginDocuments);
  try{await login('fixture-browser-changed-password',await syntheticOwnerTotp(nativeMfa,config.ownerId));await page.waitForURL(origin+'/personal');await verifyPersisted();must(loginDocuments.mfa===0&&loginDocuments.personal===1,'totp-direct-documents');}
  finally{page.off('request',countLoginDocuments);console.log('LOGIN_TRANSITION_DOCUMENTS '+JSON.stringify(loginDocuments));}
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'退出登录'}).click();await page.getByRole('button',{name:'前往登录'}).waitFor();stage='login-after-logout';await login('fixture-browser-changed-password');await page.getByRole('button',{name:'无法使用验证器？使用备用恢复码'}).click();await page.getByLabel('备用恢复码',{exact:true}).fill(backupCodes[0]);backupCodes.length=0;await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(origin+'/personal');await verifyPersisted();
  stage='private-handoff';const nativeContext=await nativeMfa.$context,cookieName=nativeContext.authCookies.sessionToken.name,cookies=(await context.cookies(origin)).filter(c=>c.name===cookieName);must(cookies.length===1,'private-session-cookie');pendingHandoff={origin,ownerId:'personal-review-user',spaceId:'personal-review-space',sourceSha:proof.sourceSha,cookies,entries};
 }catch(error){const name=error instanceof Error&&['Error','TypeError','TimeoutError'].includes(error.name)?error.name:'OTHER';const code=error instanceof Error?(error.message.match(/net::ERR_[A-Z_]+/)?.[0]??'OTHER'):'OTHER';const reason=error instanceof Error&&['theme-resolved','theme-root','theme-body','theme-page','theme-input','theme-button','mfa-layout','mfa-screenshot-empty','SCREENSHOT_DENIED'].includes(error.message)?error.message:'OTHER';console.log('BROWSER_ERROR_DIAGNOSTIC '+JSON.stringify({name,code,noJsFinished,reason}));throw Error('BROWSER_STAGE_'+stage);}finally{let cleanupFailed=false;try{if(approvalWritten)setApproval(undefined);}catch{cleanupFailed=true;}try{await context?.close();}catch{cleanupFailed=true;}try{await browser?.close();}catch{cleanupFailed=true;}try{untrust?.();}catch{cleanupFailed=true;}try{await pool.end();}catch{cleanupFailed=true;}if(cleanupFailed){pendingHandoff=undefined;throw Error('BROWSER_FIXTURE_CLEANUP_FAILED');}}
 // Publish only after every original assertion and every cleanup succeeded.
 assertFixtureCompletion(t.signal);completedHandoff=pendingHandoff;
});

const privateGroups=[
 ['isolated private business route boundaries',90000,verifyPrivateRouteBoundaries],
 ['isolated private appearance and draft lifecycle',90000,verifyPrivateAppearanceAndDrafts],
 ['isolated private business presentation matrix',180000,verifyPrivatePresentationMatrix],
] as const;
// Release retains the original safety/data assertions. The separate visual run
// retains the entire original matrix and its guarded screenshots/benchmarks.
const selectedPrivateGroups=privateGroups.filter(([name])=>qualificationMode!=='release'||name!=='isolated private business presentation matrix');
for(const [name,timeout,run] of selectedPrivateGroups)test(name,{skip:!enabled?'isolated browser CI not requested':false,concurrency:false,timeout},async(t)=>{
 const start=performance.now();let passed=false;
 try{
  const matrix=name==='isolated private business presentation matrix';
  const rowCount=process.env.LIFEOS_SYNTHETIC_GRID_ROWS;
  const samples=await withPrivateBrowserFixture(completedHandoff,async fixture=>{
   await run(fixture);
   if(!matrix||rowCount===undefined)return;
   if(rowCount==='both')return [...await measureTaskGrid(fixture,100),...await measureTaskGrid(fixture,1000,100)];
   if(rowCount!=='100'&&rowCount!=='1000')throw Error('INVALID_SYNTHETIC_GRID_ROWS');
   return measureTaskGrid(fixture,rowCount==='100'?100:1000);
  });
  assertFixtureCompletion(t.signal);
  if(matrix)publishSyntheticCaptureManifest(t.signal);
  if(samples)console.log('SYNTHETIC_GRID_PERFORMANCE '+JSON.stringify({sourceSha:completedHandoff?.sourceSha,samples}));
  passed=true;
 }
 catch(error){completedHandoff=undefined;const allowed=['PRIVATE_CAPTURE_DENIED','PRIVATE_SNAPSHOT_DENIED','PRIVATE_FIRST_VISIBLE_THEME','BROWSER_PRIVATE_HANDOFF_UNAVAILABLE','BROWSER_FIXTURE_UNAVAILABLE','BROWSER_FIXTURE_CLEANUP_FAILED'];const reason=error instanceof Error&&allowed.includes(error.message)?error.message:error instanceof Error&&error.name==='TimeoutError'?'timeout':error instanceof Error&&error.name==='AssertionError'?'assertion':'other';console.log('PRIVATE_BROWSER_FAILURE '+JSON.stringify({group:name,reason}));throw Error('PRIVATE_BROWSER_GROUP_FAILED_'+name.replaceAll(' ','_'));}
 finally{if(!passed||name===selectedPrivateGroups.at(-1)?.[0])completedHandoff=undefined;console.log('PRIVATE_BROWSER_GROUP '+JSON.stringify({group:name,elapsedMs:Math.round(performance.now()-start),passed}));}
});
