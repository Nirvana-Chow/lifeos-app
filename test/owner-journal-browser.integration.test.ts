import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {chromium,expect,type Browser,type BrowserContext} from '@playwright/test';
import {Pool} from 'pg';
import {readReviewConfig} from '../src/platform/private-config.ts';
import {readPlatformConfig} from '../src/platform/config.ts';
import {createPlatformAuth} from '../src/platform/auth.ts';
import {verifyRestrictedPool,type SqlPool} from '../src/platform/postgres.ts';
import {syntheticOwnerTotp} from './helpers/owner-mfa-fixture.ts';
import {trustFixtureCA} from './helpers/owner-recovery-browser-fixture.ts';

const enabled=process.env.RUN_OWNER_RECOVERY_BROWSER_TESTS==='1';
const origin='https://review.example.test';
const target='postgresql://lifeos_platform_candidate_runtime:fixture-ci-runtime-never-live@127.0.0.1:55432/lifeos_platform_test_local';
test('isolated synthetic journal receipt and refresh readback',{skip:!enabled?'isolated browser CI not requested':false,timeout:90000},async()=>{
 if(process.platform!=='linux'||process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||process.env.LIFEOS_FIXTURE_FRESH!=='approved-isolated-fixture'||process.env.LIFEOS_PLATFORM_TEST_DATABASE_URL!==target||process.env.OWNER_HTTPS_SCENARIO!=='journal'||!process.env.RUNNER_TEMP)throw Error('BROWSER_FIXTURE_UNAVAILABLE');
 const config=readPlatformConfig(readReviewConfig('/run/lifeos-platform/runtime.json'));
 if(!config||config.ownerId!=='personal-review-user'||config.ownerEmail!=='owner@example.test'||config.baseURL!==origin||config.databaseURL!==target)throw Error('BROWSER_FIXTURE_UNAVAILABLE');
 const pool=new Pool({connectionString:target,max:3,connectionTimeoutMillis:2000,statement_timeout:5000,options:'-c search_path=pg_catalog,lifeos_platform'});
 let browser:Browser|undefined,context:BrowserContext|undefined,untrust:(()=>void)|undefined;
 try{
  await verifyRestrictedPool(pool as SqlPool);
  untrust=trustFixtureCA(join(process.env.RUNNER_TEMP,'recovery-tls','ca.crt'));
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server','--disable-background-networking','--host-resolver-rules=MAP review.example.test 127.0.0.1, MAP * ~NOTFOUND']});
  context=await browser.newContext();const page=await context.newPage();
  await page.goto(origin+'/login',{waitUntil:'domcontentloaded'});await page.getByLabel('密码',{exact:true}).fill('fixture-personal-initial-password');await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(origin+'/account/mfa');
  const auth=createPlatformAuth(config,pool,{requireMfa:true,forceSecureCookies:true});
  await page.getByLabel('账号密码',{exact:true}).fill('fixture-personal-initial-password');await page.getByRole('button',{name:'生成绑定信息'}).click();await page.locator('#mfa-setup-key').waitFor();await page.getByLabel('我已妥善保存备用恢复码',{exact:true}).check();await page.getByLabel('验证器动态码',{exact:true}).fill(await syntheticOwnerTotp(auth,config.ownerId));await page.getByRole('button',{name:'验证并继续'}).click();await page.waitForURL(origin+'/personal');
  await page.goto(origin+'/personal/edit?type=journal',{waitUntil:'domcontentloaded'});const title=page.getByLabel('标题',{exact:true}),body=page.getByLabel(/^说明 \/ 正文/),date=page.getByLabel(/^记录日期/);
  await expect(title).toBeEnabled();await title.fill('合成日记回读');await body.fill('仅用于隔离验收的正文');await date.fill('2030-11-02');await page.getByLabel('我已核对这一条内容，确认保存到本人空间。',{exact:true}).check();
  const waiting=page.waitForResponse(r=>r.url()===origin+'/api/platform/personal/journal'&&r.request().method()==='POST');await page.getByRole('button',{name:'确认保存',exact:true}).click();const response=await waiting;assert.equal(response.status(),201);const result=await response.json();assert.equal(result.duplicate,false);const entry=result.entry;assert.equal(entry.revision,1);assert.equal(entry.source.original.marker,'personal-manual-v1');assert.equal(entry.draft.title,'合成日记回读');assert.equal(entry.draft.text,'仅用于隔离验收的正文');assert.equal(entry.draft.occurredOn,'2030-11-02');await expect(page.getByRole('status').filter({hasText:'已收到服务器保存回执。'})).toBeVisible();
  await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'合成日记回读',exact:true}).click();await expect(title).toHaveValue('合成日记回读');await expect(body).toHaveValue('仅用于隔离验收的正文');await expect(date).toHaveValue('2030-11-02');
  const readback=await page.evaluate(async id=>{const r=await fetch('/api/platform/personal/journal/'+encodeURIComponent(id),{cache:'no-store'});return {status:r.status,cache:r.headers.get('cache-control'),body:await r.json()};},entry.id);assert.equal(readback.status,200);assert.match(readback.cache??'',/no-store/);assert.deepEqual(readback.body.entry,entry);
 }finally{let failed=false;try{await context?.close();}catch{failed=true;}try{await browser?.close();}catch{failed=true;}try{untrust?.();}catch{failed=true;}try{await pool.end();}catch{failed=true;}if(failed)throw Error('BROWSER_FIXTURE_CLEANUP_FAILED');}
});
