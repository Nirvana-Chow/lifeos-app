import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp, mkdir, mkdtemp, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'node:test';
import {chromium, expect} from '@playwright/test';
import {fileIndexFixture} from './helpers/personal-file-index-fixture.ts';
import {cleanupAuthThemeFixture, trackAuthThemeProcess, type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';

test('OPT-IN owner file map opens the exact project and conceals rows on revocation', {
  skip: process.env.RUN_PERSONAL_FILE_INDEX_BROWSER_TESTS !== '1' && 'Requires isolated Next and Chromium',
  timeout: 150_000,
}, async () => {
  const source = resolve(import.meta.dirname, '..');
  const root = await mkdtemp(join(tmpdir(), 'lifeos-auth-theme-file-index-'));
  let server: FixtureProcess | undefined;
  let browserProcess: FixtureProcess | undefined;
  let browserServer: Awaited<ReturnType<typeof chromium.launchServer>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.connect>> | undefined;
  try {
    const pages = ['personal/files/page.tsx', 'personal/edit/page.tsx'];
    await Promise.all(['app/personal/files','app/personal/edit','app/login'].map(dir => mkdir(join(root,dir), {recursive: true})));
    await Promise.all([
      ...['layout.tsx','globals.css','theme.css', ...pages].map(file => cp(join(source,'app',file), join(root,'app',file))),
      cp(join(source,'src'),join(root,'src'),{recursive:true}),
      cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
      symlink(join(source,'node_modules'),join(root,'node_modules')),
      symlink(join(source,'components'),join(root,'components')),
    ]);
    await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
    await writeFile(join(root,'app/login/page.tsx'),'export default function Page(){return <h1>Fixture login</h1>;}\n');
    await writeFile(join(root,'src/platform/runtime.ts'),
      'export const readPlatformPagePrincipal=async(h:Headers)=>h.get("cookie")?.split(/;\\s*/).includes("fixture-file-owner=yes")?{id:"file-index-fixture-owner"}:null; export const readPlatformPasswordCapability=async()=>false;\n');
    const processHandle = spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{
      cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},
      stdio:['ignore','pipe','pipe'],detached:true,
    });
    server = trackAuthThemeProcess(processHandle,true);
    processHandle.stderr.resume();
    const origin = await new Promise<string>((done, reject) => {
      const timer = setTimeout(() => reject(Error('Fixture startup timeout')),30_000);
      processHandle.once('error', reject);
      processHandle.once('exit', () => {clearTimeout(timer); reject(Error('Fixture exited'));});
      processHandle.stdout.on('data', chunk => {
        const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); done(match[0]); }
      });
    });
    const fixture = await fileIndexFixture(origin);
    const initialWrites = fixture.repository.events.length;
    const handler = fixture.handler(JSON.stringify(fixture.manifest));
    browserServer = await chromium.launchServer({executablePath: process.env.LIFEOS_TEST_CHROMIUM_PATH, host:'127.0.0.1'});
    browserProcess = trackAuthThemeProcess(browserServer.process());
    browser = await chromium.connect(browserServer.wsEndpoint());
    const context = await browser.newContext();
    const writes: string[] = [];
    await context.route('**/*', async route => {
      const browserRequest = route.request(), url = new URL(browserRequest.url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (browserRequest.method() !== 'GET') { writes.push(url.pathname); return route.abort(); }
      const response = await handler(new Request(url,{headers:{...await browserRequest.allHeaders(),host:url.host}}));
      return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
    });
    const page = await context.newPage();
    await page.goto(origin+'/personal/files',{waitUntil:'domcontentloaded',timeout:60_000});
    await expect(page.getByRole('heading',{name:'Fixture login'})).toBeVisible();
    await context.addCookies([{name:'fixture-file-owner',value:'yes',url:origin}]);
    await page.setViewportSize({width:1365,height:880});
    await page.goto(origin+'/personal/files',{waitUntil:'domcontentloaded',timeout:60_000});
    const panel = page.getByRole('region',{name:'文件索引',exact:true});
    await expect(panel.getByRole('button',{name:'打开项目：同名合成项目'})).toHaveCount(1,{timeout:30_000});
    await expect(panel.getByRole('link',{name:'合成索引甲',exact:true})).toBeVisible();
    const multiline = panel.getByRole('button',{name:'打开项目：合成项目第一行 第二行 <strong>示例</strong>',exact:true});
    await expect(multiline).toBeVisible();
    await expect(multiline.locator('strong')).toHaveCount(0);
    await expect(page.getByRole('alert').filter({hasText:'文件索引读取失败。'})).toHaveCount(0);
    await expect(panel.getByText('示例不可打开')).toBeVisible();
    await expect(panel.getByText('关联项目已升版或修订不一致，待核')).toBeVisible();
    await expect(panel.getByText('关联项目不可用',{exact:true})).toHaveCount(2);
    await expect(panel.getByText('位置待核',{exact:true})).toHaveCount(3);
    await panel.getByRole('link',{name:'合成索引甲',exact:true}).click();
    await expect(page).toHaveURL(origin+'/personal/files?id='+fixture.entries[0].id);
    await expect(panel.getByRole('link',{name:'合成索引乙',exact:true})).toHaveCount(0);
    await panel.getByRole('button',{name:'打开项目：同名合成项目'}).click();
    await expect(page).toHaveURL(origin+'/personal/edit?type=project&id='+fixture.exact.id,{timeout:30_000});
    await expect(page.getByRole('textbox',{name:'标题',exact:true})).toHaveValue('同名合成项目');
    await page.setViewportSize({width:390,height:844});
    await page.goto(origin+'/personal/files',{waitUntil:'domcontentloaded',timeout:60_000});
    await expect(panel.getByRole('button',{name:'打开项目：同名合成项目'})).toBeVisible();
    await expect(multiline).toBeVisible();
    await expect(panel.getByRole('link',{name:'合成索引甲',exact:true})).toBeVisible();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    fixture.setPrincipal(null);
    await panel.getByRole('button',{name:'打开项目：同名合成项目'}).click();
    await expect(page.getByText('当前会话无权查看文件索引。',{exact:false})).toBeVisible();
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(origin+'/personal/files');
    assert.deepEqual(writes,[]);
    assert.equal(fixture.repository.events.length,initialWrites);
    console.log('FILE_INDEX_BROWSER_PASS desktop=1365 mobile=390 exact_project=true mixed_multiline=true revoked_hidden=true navigation_writes=0');
  } finally {
    await cleanupAuthThemeFixture({root,browser,browserServer,browserProcess,server});
  }
});
