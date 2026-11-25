import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {memoryAdapter} from 'better-auth/adapters/memory';
import {chromium,expect,type Page} from '@playwright/test';
import {authRequest,createPlatformAuth,readOwnerMfaState,readVerifiedOwnerSession} from '../../src/platform/auth.ts';
import {enrollSyntheticOwnerMfa,mergeSyntheticAuthCookies,syntheticOwnerTotp} from './owner-mfa-fixture.ts';
import {sessionDurationFixture} from './session-duration.ts';

export async function checkNativeBrowserSessions(t:TestContext,root:string,origin:string,executablePath:string){
 const fixture=await sessionDurationFixture(true,true);
 const {auth,config,db,password}=fixture;
 assert.equal(config.baseURL,origin);
 const initial=await fixture.login();
 assert.equal(initial.status,200);
 const enrolled=await enrollSyntheticOwnerMfa(auth,config.ownerId,password,fixture.send,mergeSyntheticAuthCookies(initial));
 assert.equal((await fixture.send('sign-out',{},enrolled.cookie)).status,200);
 const reader=createPlatformAuth(config,memoryAdapter(db),{requireMfa:true,sessionDuration:true,readOnlySessions:true,forceSecureCookies:true});
 const native=await auth.$context;
 const posts:string[]=[];
 const service=createServer(async(request,response)=>{
  try{
   const url=new URL(request.url!,origin),headers=new Headers();
   for(const [name,value] of Object.entries(request.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join('; '):value);
   headers.set('host',url.host);
   headers.delete('content-length');
   const method=request.method!,parts:Buffer[]=[];
   for await(const part of request)parts.push(part);
   if(method==='POST')posts.push(url.pathname);
   const result=await authRequest(new Request(url,{method,headers,...(method==='POST'?{body:Buffer.concat(parts)}:{})}),config,
    input=>(method==='GET'?reader:auth).handler(input),{
    requireMfa:true,sessionDuration:true,ownerLoginAlias:'owner',
    readMfaState:headers=>readOwnerMfaState(reader,config,headers),
    withOwnerLock:async run=>run(), // Requests are serial in this isolated fixture.
    trustedDeviceCookieNames:[native.createAuthCookie('trust_device').name],
    sessionCookieNames:[native.authCookies.sessionToken.name],
    twoFactorCookieNames:[native.createAuthCookie('two_factor').name],
   });
   response.statusCode=result.status;
   for(const [name,value] of result.headers)if(name!=='set-cookie')response.setHeader(name,value);
   if(result.headers.getSetCookie().length)response.setHeader('set-cookie',result.headers.getSetCookie());
   response.end(await result.text());
  }catch{
   response.statusCode=500;
   response.end();
  }
 });
 service.listen(0,'127.0.0.1');
 await once(service,'listening');
 const address=service.address();
 assert.ok(address&&typeof address!=='string');
 const fixtureOrigin='http://127.0.0.1:'+address.port;
 const launch=async(profile:string)=>{
  const context=await chromium.launchPersistentContext(join(root,profile),{
   executablePath,viewport:{width:390,height:844},args:['--disable-background-networking'],
  });
  await context.route('**/api/platform/**',async route=>{
   const url=new URL(route.request().url());
   assert.equal(url.origin,origin);
   if(!url.pathname.startsWith('/api/platform/auth/'))return route.fulfill({status:404});
   return route.fulfill({response:await route.fetch({url:fixtureOrigin+url.pathname,maxRedirects:0})});
  });
  return context;
 };
 const privateHeading='合成本人空间',lockedHeading='登录已到期或需要重新验证',day=86400;
 const start=async(page:Page)=>{
  await page.goto(origin+'/login');
  await expect(page.getByLabel('这台设备保持登录')).toHaveValue('month');
  await page.getByLabel('密码',{exact:true}).fill(password);
  await page.getByLabel('验证器动态码',{exact:true}).fill(await syntheticOwnerTotp(auth,config.ownerId));
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await expect(page).toHaveURL(origin+'/personal');
  await expect(page.getByRole('heading',{name:privateHeading})).toBeVisible();
  const cookie=(await page.context().cookies(origin)).find(value=>value.name===native.authCookies.sessionToken.name);
  assert.ok(cookie?.secure&&cookie.httpOnly&&cookie.sameSite==='Strict'&&cookie.expires>Date.now()/1000+29*day);
  return cookie.name+'='+cookie.value;
 };
 let first:Awaited<ReturnType<typeof launch>>|undefined,second:Awaited<ReturnType<typeof launch>>|undefined;
 try{
  first=await launch('default-device');
  const firstCookie=await start(first.pages()[0]??await first.newPage());
  const firstRow=db.platform_session.at(-1)!;
  const expires=new Date(firstRow.expiresAt as Date).valueOf();
  const issued=new Date(firstRow.createdAt as Date).valueOf();
  assert.equal(firstRow.sessionDurationMode,'fixed');
  assert.equal(firstRow.sessionDurationSeconds,30*day);
  assert.equal(expires-issued,30*day*1000);
  await first.close();first=undefined;

  t.mock.timers.enable({apis:['Date'],now:issued+31*60*1000});
  first=await launch('default-device');
  const reopened=first.pages()[0]??await first.newPage();
  await reopened.goto(origin+'/personal');
  await expect(reopened.getByRole('heading',{name:privateHeading})).toBeVisible();
  assert.equal(await readVerifiedOwnerSession(reader,config,new Headers({cookie:firstCookie})),null);
  assert.equal(new Date(db.platform_session.find(row=>row.id===firstRow.id)!.expiresAt as Date).valueOf(),expires);
  assert.equal(posts.filter(path=>path.endsWith('/get-session')).length,0);

  second=await launch('other-device');
  const other=second.pages()[0]??await second.newPage();
  await start(other);
  await other.getByRole('button',{name:'退出',exact:true}).click();
  await expect(other).toHaveURL(origin+'/login');
  await second.close();second=undefined;
  second=await launch('other-device');
  const loggedOut=second.pages()[0]??await second.newPage();
  await loggedOut.goto(origin+'/personal');
  await expect(loggedOut.getByRole('heading',{name:lockedHeading})).toBeVisible();
  assert.deepEqual(db.platform_session.map(row=>row.id),[firstRow.id]);
  await reopened.reload();
  await expect(reopened.getByRole('heading',{name:privateHeading})).toBeVisible();
  t.mock.timers.setTime(expires+1);
  await reopened.reload();
  await expect(reopened.getByRole('heading',{name:lockedHeading})).toBeVisible();
  await expect(reopened.getByRole('heading',{name:privateHeading})).toBeHidden();
 }finally{
  t.mock.timers.reset();
  await Promise.allSettled([first?.close(),second?.close()]);
  await new Promise<void>((resolve,reject)=>service.close(error=>error?reject(error):resolve()));
 }
}
