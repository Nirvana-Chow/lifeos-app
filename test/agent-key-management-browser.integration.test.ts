import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {once} from 'node:events';
import {gunzipSync} from 'node:zlib';
import test from 'node:test';
import {chromium, expect} from '@playwright/test';

const keyEndpoint = '/api/platform/account/api-keys';
const syntheticKey = 'fixture-only-lifeos-agent-key-not-a-real-token';
const source = resolve(import.meta.dirname, '..');

async function startFixture(root: string) {
  await mkdir(join(root, 'app/account/api-keys'), {recursive:true});
  await mkdir(join(root, 'app/account/password'), {recursive:true});
  await mkdir(join(root, 'app/personal'), {recursive:true});
  await mkdir(join(root, 'app/login'), {recursive:true});
  await mkdir(join(root, 'app/api/agent-skill'), {recursive:true});
  await Promise.all([
    cp(join(source, 'app/layout.tsx'), join(root, 'app/layout.tsx')),
    cp(join(source, 'app/globals.css'), join(root, 'app/globals.css')),
    cp(join(source, 'app/theme.css'), join(root, 'app/theme.css')),
    cp(join(source, 'postcss.config.mjs'), join(root, 'postcss.config.mjs')),
    symlink(join(source, 'node_modules'), join(root, 'node_modules')),
    cp(join(source, 'src'), join(root, 'src'), {recursive:true}),
    symlink(join(source, 'components'), join(root, 'components')),
    cp(join(source, 'app/account/api-keys/page.tsx'), join(root, 'app/account/api-keys/page.tsx')),
    cp(join(source, 'app/account/password/page.tsx'), join(root, 'app/account/password/page.tsx')),
    cp(join(source, 'app/api/agent-skill/route.ts'), join(root, 'app/api/agent-skill/route.ts')),
    writeFile(join(root, 'app/personal/page.tsx'), `import {LivePersonalWorkspace} from '../../src/personal-candidate/live-workspace';
import {readWorkspaceLocation} from '../../src/workbench/private-navigation';
export default async function Page({searchParams}:{searchParams:Promise<{page?:string;modal?:string;panel?:string}>}){const location=readWorkspaceLocation(await searchParams);return <LivePersonalWorkspace initialPage={location.page} initialModal={location.modal} initialSettingsPanel={location.panel} showApiKeys/>;}\n`),
    writeFile(join(root, 'app/login/page.tsx'), `export default function Page(){return <main><h1>合成登录</h1></main>;}\n`),
  ]);
  // Actual account route modules keep their server gates. The disposable
  // runtime supplies a fixed synthetic owner to those checks.
  await writeFile(join(root,'src/platform/runtime.ts'), `export const readPlatformPagePrincipal=async()=>({id:'synthetic-account-owner'});
export const readPlatformPasswordCapability=async()=>true;
export const readPlatformMfaState=async()=>({kind:'ready'});\n`);
  return spawn(process.execPath, [join(source, 'node_modules/next/dist/bin/next'), 'dev', '--webpack',
    '--hostname', '127.0.0.1', '--port', '0'], {
    cwd: root,
    env: {PATH: process.env.PATH, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1'},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('OPT-IN API dialogs preserve one-time secrets, expiry, focus, uncertain results and pagination', {
  skip: process.env.RUN_AGENT_KEY_BROWSER_TESTS !== '1' && 'Requires local Chromium and a synthetic Next.js fixture',
  timeout: 150_000,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'lifeos-agent-key-browser-'));
  const fixture = await startFixture(root).catch(async error => {
    await rm(root, {recursive: true, force: true});
    throw error;
  });
  const stopped = once(fixture, 'exit');
  t.after(async () => {
    fixture.kill('SIGTERM');
    await stopped;
    await rm(root, {recursive: true, force: true});
  });

  let output = '';
  const origin = await new Promise<string>((accept, reject) => {
    const timer = setTimeout(() => reject(Error('Synthetic key UI fixture did not start')), 30_000);
    fixture.once('exit', code => {clearTimeout(timer); reject(Error('Synthetic key UI fixture exited: ' + code));});
    fixture.stdout.on('data', data => {
      output += String(data);
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {clearTimeout(timer); accept(match[0]);}
    });
  });
  const browser = await chromium.launch({executablePath: process.env.LIFEOS_TEST_CHROMIUM_PATH});
  t.after(() => browser.close());

  for (const theme of ['light','dark'] as const) for (const width of [360, 1365]) {
    const page = await browser.newPage({viewport: {width, height: 900}, timezoneId: 'Asia/Shanghai',colorScheme:theme});
    await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{(window as unknown as {copied:string}).copied=value;}}}));
    const grants: {id: string; name: string; scopes: string[]; createdAt: string; expiresAt: string; status: string}[] = [];
    const posts: unknown[] = [];
    let deletes = 0;
    let pageAttempts = 0;
    let personalReads = 0;
    let failReadback = false;
    let unknownResponse = false;
    let releasePost: (()=>void) | undefined;
    let holdPost = false;
    const cursor = 'fixture/older+keys';
    const olderGrant = {id: 'fixture-older-key', name: 'Synthetic older key', scopes: ['todo:read'],
      status: 'active', createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString()};
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      const path = url.pathname;
      if(path==='/api/platform/status')return route.fulfill({json:{authenticated:true}});
      if(path.startsWith('/api/platform/personal/')){
        personalReads++;
        if(path==='/api/platform/personal/status')return route.fulfill({json:{scope:'personal-manual-candidate',ownerId:'synthetic-account-owner',spaceId:'synthetic-account-space',storageVerified:true,writable:true,allowedTypes:['todo','journal','project','domain','topic']}});
        if(path==='/api/platform/personal/availability')return route.fulfill({json:{configured:true,loginAllowed:true,transport:'ssh-loopback',origin}});
        if(path==='/api/platform/personal/overview')return route.fulfill({json:{scope:'full-current-snapshot',truncated:false,total:0,items:[],today:url.searchParams.get('today'),observedAt:'2030-11-02T12:00:00.000Z'}});
        throw Error('Unexpected synthetic account request');
      }
      if (path === keyEndpoint && request.method() === 'GET') {
        if (failReadback) return route.fulfill({status:503});
        if (!url.search) return route.fulfill({json: {keys: grants, nextCursor: grants.length ? cursor : undefined}});
        if (url.searchParams.get('cursor') !== cursor) return route.fulfill({status: 400});
        if (++pageAttempts === 1) return route.fulfill({status: 503});
        return route.fulfill({json: {keys: [grants[0], olderGrant]}});
      }
      if (path === keyEndpoint && request.method() === 'POST') {
        const data = request.postDataJSON();
        posts.push(data);
        if (holdPost) await new Promise<void>(resolve=>{releasePost=resolve;});
        if (unknownResponse) return route.fulfill({status:201,body:'invalid-json'});
        const now = Date.now();
        const grant = {id: 'fixture-grant-' + (grants.length + 1), name: data.name, scopes: data.scopes, status: 'active',
          createdAt: new Date(now).toISOString(),
          expiresAt: data.expiresAt ?? new Date(now + data.expiresInDays * 86_400_000).toISOString()};
        grants.push(grant);
        return route.fulfill({status: 201, json: {key: syntheticKey, grant}});
      }
      if (path === keyEndpoint + '/fixture-grant-1' && request.method() === 'DELETE') {
        deletes += 1;
        grants[0].status = 'revoked';
        return route.fulfill({status: 204});
      }
      if (path === keyEndpoint + '/' + olderGrant.id && request.method() === 'DELETE') {
        olderGrant.status = 'revoked';
        return route.fulfill({status: 204});
      }
      if (path.startsWith(keyEndpoint)) return route.fulfill({status: 404});
      return route.continue();
    });

    const keysURL=origin+'/personal?modal=settings&panel=api-keys';
    await page.goto(origin+'/account/api-keys', {waitUntil: 'domcontentloaded', timeout: 55_000});
    await expect(page.getByRole('dialog',{name:'设置',exact:true})).toBeVisible();
    await expect(page.getByRole('heading', {level:2,name: 'API 密钥',exact:true})).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-lifeos-theme',theme);
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('.lo-shell')).toHaveCount(1);
    await expect(page.locator('header [data-slot="theme-toggle"]')).toHaveCount(1);
    await expect(page.getByRole('link',{name:'修改密码',exact:true})).toHaveCount(0);
    await page.reload({waitUntil:'domcontentloaded'});
    await expect(page.getByText('还没有签发密钥。')).toBeVisible();
    const beforeAccountRead=personalReads;
    await expect(page.getByText('还没有签发密钥。')).toBeVisible();
    await expect(page.locator('[name="name"]')).toHaveCount(0);
    const newKey=page.getByRole('button',{name:'新建密钥',exact:true});
    await newKey.click();
    const createDialog=page.getByRole('dialog',{name:'新建密钥',exact:true});
    await expect(createDialog).toBeVisible();
    await expect(createDialog.locator('[name="name"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(createDialog).toHaveCount(0);
    await expect(newKey).toBeFocused();
    await newKey.click();
    await page.locator('[name="name"]').fill('Synthetic Skill');
    await page.locator('[name="permission"]').selectOption('write');
    await page.locator('[name="expiry"]').selectOption('custom');
    const customExpiry = page.locator('[name="custom-expiry"]');
    const controls = await page.locator('[name="name"], [name="permission"], [name="expiry"], [name="custom-expiry"]').evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      return {name: element.getAttribute('name'), height: box.height, width: box.width};
    }));
    await mkdir(join(source, '.review-results'), {recursive: true});
    await page.screenshot({path: join(source, `.review-results/api-key-${process.env.LIFEOS_KEY_SCREENSHOT_STAGE ?? 'current'}-${theme}-${width}.png`), fullPage: true});
    assert.ok(controls.every(control => Math.abs(control.height - 44) <= 1), JSON.stringify(controls));
    const formWidth = await page.locator('fieldset').evaluate(element => element.getBoundingClientRect().width);
    assert.ok(Math.abs(controls[3].width - formWidth) <= 1, 'custom date uses the full form row');
    await page.locator('[name="expiry"]').selectOption('30');
    await expect(page.getByText(/预计到期：.*Asia\/Shanghai/)).toBeVisible();
    await expect(page.getByText('实际到期时间以签发后服务端返回为准。')).toBeVisible();
    await page.screenshot({path: join(source, `.review-results/api-key-${process.env.LIFEOS_KEY_SCREENSHOT_STAGE ?? 'current'}-preset-${theme}-${width}.png`), fullPage: true});
    await page.locator('[name="expiry"]').selectOption('custom');
    await customExpiry.fill('2099-01-01T09:30');
    await page.getByRole('button', {name: '创建密钥'}).click();
    await expect(page.getByRole('status').filter({hasText: '365 天'})).toBeVisible();
    assert.equal(posts.length, 0);
    assert.equal(personalReads,beforeAccountRead,'opening key dialogs does not refetch background records');

    const date = await page.evaluate(() => {
      const local = new Date(Date.now() + 86_400_000);
      local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
      return local.toISOString().slice(0, 16);
    });
    await customExpiry.fill(date);
    holdPost=true;
    await page.getByRole('button', {name: '创建密钥'}).click();
    await expect.poll(()=>posts.length).toBe(1);
    await page.keyboard.press('Escape');
    await page.mouse.click(1,1);
    await expect(createDialog).toBeVisible();
    await expect(createDialog.getByRole('button',{name:'取消',exact:true})).toBeDisabled();
    assert.equal(posts.length,1,'pending cannot repeat issuance or lose its response');
    releasePost!();
    holdPost=false;
    const reveal = page.locator('code[aria-label="新密钥"]');
    await expect(reveal).toHaveText(syntheticKey);
    const revealDialog=page.getByRole('dialog',{name:'复制新密钥',exact:true});
    await expect(revealDialog).toBeVisible();
    await expect(revealDialog.getByRole('heading',{name:'复制新密钥'})).toBeFocused();
    await page.screenshot({path:join(source,`.review-results/api-key-reveal-${theme}-${width}.png`),fullPage:true});
    assert.deepEqual(posts, [{name: 'Synthetic Skill', scopes: ['todo:read', 'todo:write'],
      expiresAt: new Date(date + ':00+08:00').toISOString()}]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('blocked');}}}));
    await page.getByRole('button',{name:'复制密钥',exact:true}).click();
    await expect(revealDialog.getByRole('status')).toContainText('手动选中');
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{(window as unknown as {copied:string}).copied=value;}}}));
    await page.getByRole('button',{name:'复制密钥',exact:true}).click();
    await expect(revealDialog.getByText('已复制',{exact:true})).toBeVisible();
    assert.equal(await page.evaluate(()=>(window as unknown as {copied:string}).copied),syntheticKey);
    await page.getByRole('button', {name: '关闭密钥'}).click();
    await expect(newKey).toBeFocused();
    await expect(reveal).toHaveCount(0);
    await page.reload({waitUntil: 'domcontentloaded'});
    await expect(page.getByText('Synthetic Skill', {exact: true})).toBeVisible();
    await expect(page.getByText(syntheticKey, {exact: true})).toHaveCount(0);

    await page.getByRole('button', {name: '替换 Synthetic Skill'}).click();
    await expect(page.getByRole('heading', {name: '创建替换密钥'})).toBeVisible();
    await expect(page.locator('[name="name"]')).toHaveValue('Synthetic Skill');
    await page.locator('[name="name"]').fill('Synthetic replacement');
    await page.locator('[name="expiry"]').selectOption('365');
    await page.getByRole('button', {name: '创建密钥'}).click();
    await expect(reveal).toHaveText(syntheticKey);
    assert.equal(posts.length, 2);
    assert.deepEqual(posts[1], {name: 'Synthetic replacement', scopes: ['todo:read', 'todo:write'], expiresInDays: 365});
    assert.equal(deletes, 0, 'replacement creation preserves the original grant');
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await expect(reveal).toHaveCount(0);
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow')));
    await expect(page.getByRole('button',{name:'替换 Synthetic Skill'})).toBeFocused();
    await page.goto(origin+'/login');
    await page.goBack({waitUntil:'domcontentloaded'});
    await expect(page).toHaveURL(keysURL);
    await expect(page.getByText(syntheticKey,{exact:true})).toHaveCount(0);
    await page.goForward({waitUntil:'domcontentloaded'});
    await page.goBack({waitUntil:'domcontentloaded'});
    await expect(reveal).toHaveCount(0);
    await page.getByRole('button', {name: '撤销 Synthetic Skill'}).click();
    const dialog = page.getByRole('dialog', {name: '撤销密钥'});
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', {name: '取消', exact: true}).click();
    await expect(dialog).toHaveCount(0);
    assert.equal(deletes, 0);
    await page.getByRole('button', {name: '撤销 Synthetic Skill'}).click();
    await dialog.getByRole('button', {name: '确认撤销'}).click();
    await expect(page.getByText('已撤销', {exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: '撤销 Synthetic Skill'})).toHaveCount(0);
    assert.equal(deletes, 1);
    await expect(page.getByRole('button', {name: '撤销 Synthetic replacement'})).toBeVisible();
    const loadMore = page.getByRole('button', {name: '加载更多密钥'});
    await loadMore.click();
    await expect(page.getByRole('status').filter({hasText: '暂时无法读取更多密钥'})).toBeVisible();
    await expect(page.getByRole('button', {name: '撤销 Synthetic replacement'})).toBeVisible();
    await loadMore.click();
    await expect(page.getByRole('button', {name: '撤销 Synthetic older key'})).toBeVisible();
    await expect(page.getByText('Synthetic Skill', {exact: true})).toHaveCount(1);
    await expect(loadMore).toHaveCount(0);
    await page.getByRole('button', {name: '撤销 Synthetic older key'}).click();
    await dialog.getByRole('button', {name: '确认撤销'}).click();
    await loadMore.click();
    const olderRow = page.getByRole('listitem').filter({hasText: 'Synthetic older key'});
    await expect(olderRow.getByText('已撤销', {exact: true})).toBeVisible();
    await newKey.click();
    await page.locator('[name="name"]').fill('Synthetic uncertain');
    unknownResponse=true;failReadback=true;
    await page.getByRole('button',{name:'创建密钥',exact:true}).click();
    await expect(createDialog.getByRole('status')).toContainText('创建结果未确认');
    await page.keyboard.press('Escape');
    await expect(createDialog).toBeVisible();
    await expect(createDialog.getByRole('button',{name:'创建密钥',exact:true})).toBeDisabled();
    assert.equal(posts.length,3,'unknown issuance waits for list readback before retry');
    failReadback=false;
    await createDialog.getByRole('button',{name:'重新读取密钥列表',exact:true}).click();
    await expect(createDialog.getByRole('button',{name:'创建密钥',exact:true})).toBeEnabled();
    await createDialog.getByRole('button',{name:'取消',exact:true}).click();
    await expect(newKey).toBeFocused();
    await page.getByRole('button',{name:'复制安装说明',exact:true}).click();
    const instructions=await page.evaluate(()=>(window as unknown as {copied:string}).copied);
    assert.ok(instructions.includes(origin+'/api/agent-skill'));
    assert.ok(!instructions.includes(syntheticKey));
    await expect(page.getByRole('link',{name:'下载 LifeOS Agent Skill',exact:true})).toHaveAttribute('href','/api/agent-skill');
    const downloading=page.waitForEvent('download');
    await page.getByRole('link',{name:'下载 LifeOS Agent Skill',exact:true}).click();
    const download=await downloading;
    assert.equal(download.suggestedFilename(),'lifeos-agent.tar.gz');
    const archive=gunzipSync(await readFile((await download.path())!)).toString();
    assert.ok(archive.includes('lifeos-agent/SKILL.md'));
    assert.ok(archive.includes('references/operations.md'));
    assert.ok(!archive.includes(syntheticKey));
    await page.close();
  }
});
