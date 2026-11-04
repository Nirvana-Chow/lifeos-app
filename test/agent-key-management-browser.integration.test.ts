import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp, mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {once} from 'node:events';
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
    writeFile(join(root, 'app/personal/page.tsx'), `import {LivePersonalWorkspace} from '../../src/personal-candidate/live-workspace';
import {readWorkspacePage} from '../../src/workbench/private-navigation';
export default async function Page({searchParams}:{searchParams:Promise<{page?:string}>}){const q=await searchParams;return <LivePersonalWorkspace initialPage={readWorkspacePage(q.page)} showApiKeys/>;}\n`),
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

test('OPT-IN synthetic account routes preserve the shared shell, key lifecycle and password return path', {
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

  for (const width of [360, 1365]) {
    const page = await browser.newPage({viewport: {width, height: 900}, timezoneId: 'Asia/Shanghai'});
    const grants: {id: string; name: string; scopes: string[]; createdAt: string; expiresAt: string; status: string}[] = [];
    const posts: unknown[] = [];
    let deletes = 0;
    let pageAttempts = 0;
    let personalReads = 0;
    let passwordWrites = 0;
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
      if(path==='/api/platform/personal/password'&&request.method()==='POST'){
        passwordWrites++;
        assert.deepEqual(request.postDataJSON(),{mode:'change',currentPassword:'Synthetic-current-password-0001',newPassword:'Synthetic-next-password-0002'});
        return route.fulfill({json:{ok:true}});
      }
      if(path.startsWith('/api/platform/personal/')){
        personalReads++;
        if(path==='/api/platform/personal/status')return route.fulfill({json:{scope:'personal-manual-candidate',ownerId:'synthetic-account-owner',spaceId:'synthetic-account-space',storageVerified:true,writable:true,allowedTypes:['todo','journal','project','domain','topic']}});
        if(path==='/api/platform/personal/availability')return route.fulfill({json:{configured:true,loginAllowed:true,transport:'ssh-loopback',origin}});
        if(path==='/api/platform/personal/overview')return route.fulfill({json:{scope:'full-current-snapshot',truncated:false,total:0,items:[],today:url.searchParams.get('today'),observedAt:'2030-11-02T12:00:00.000Z'}});
        throw Error('Unexpected synthetic account request');
      }
      if (path === keyEndpoint && request.method() === 'GET') {
        if (!url.search) return route.fulfill({json: {keys: grants, nextCursor: grants.length ? cursor : undefined}});
        if (url.searchParams.get('cursor') !== cursor) return route.fulfill({status: 400});
        if (++pageAttempts === 1) return route.fulfill({status: 503});
        return route.fulfill({json: {keys: [grants[0], olderGrant]}});
      }
      if (path === keyEndpoint && request.method() === 'POST') {
        const data = request.postDataJSON();
        posts.push(data);
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

    const settingsURL=origin+'/personal?page=settings',keysURL=origin+'/account/api-keys';
    const openSettings=async()=>{
      if(width<850)await page.getByRole('button',{name:'打开导航',exact:true}).click();
      await page.getByRole('button',{name:'设置',exact:true}).click();
      await expect(page).toHaveURL(settingsURL);
      await expect(page.getByRole('heading',{level:1,name:'设置',exact:true})).toBeVisible();
    };
    await page.goto(settingsURL, {waitUntil: 'domcontentloaded', timeout: 55_000});
    await page.getByRole('link',{name:'API 密钥',exact:true}).click();
    await expect(page).toHaveURL(keysURL);
    await expect(page.getByRole('heading', {level:1,name: 'API 密钥',exact:true})).toBeVisible();
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('.lo-shell')).toHaveCount(1);
    await expect(page.locator('header [data-slot="theme-toggle"]')).toHaveCount(1);
    await expect(page.getByRole('link',{name:'修改密码',exact:true})).toHaveCount(0);
    const beforeAccountRead=personalReads;
    await page.reload({waitUntil:'domcontentloaded'});
    await expect(page.getByText('还没有签发密钥。')).toBeVisible();
    assert.equal(personalReads,beforeAccountRead,'the account shell must not load Todo records');
    await expect(page.getByText('还没有签发密钥。')).toBeVisible();
    await page.locator('[name="name"]').fill('Synthetic Skill');
    await page.locator('[name="permission"]').selectOption('write');
    await page.locator('[name="expiry"]').selectOption('custom');
    const customExpiry = page.locator('[name="custom-expiry"]');
    await customExpiry.fill('2099-01-01T09:30');
    await page.getByRole('button', {name: '创建密钥'}).click();
    await expect(page.getByRole('status').filter({hasText: '365 天'})).toBeVisible();
    assert.equal(posts.length, 0);

    const date = await page.evaluate(() => {
      const local = new Date(Date.now() + 86_400_000);
      local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
      return local.toISOString().slice(0, 16);
    });
    await customExpiry.fill(date);
    await page.getByRole('button', {name: '创建密钥'}).click();
    const reveal = page.locator('code[aria-label="新密钥"]');
    await expect(reveal).toHaveText(syntheticKey);
    assert.deepEqual(posts, [{name: 'Synthetic Skill', scopes: ['todo:read', 'todo:write'],
      expiresAt: new Date(date + ':00+08:00').toISOString()}]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.getByRole('button', {name: '关闭密钥'}).click();
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
    await openSettings();
    await page.goBack({waitUntil:'domcontentloaded'});
    await expect(page).toHaveURL(keysURL);
    await expect(page.getByText(syntheticKey,{exact:true})).toHaveCount(0);
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
    await openSettings();
    await page.getByRole('link',{name:'修改密码',exact:true}).click();
    await expect(page).toHaveURL(origin+'/account/password');
    await expect(page.getByRole('heading',{level:1,name:'修改密码',exact:true})).toBeVisible();
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('.lo-shell')).toHaveCount(1);
    const current=page.getByLabel('原密码',{exact:true});
    await current.fill('Synthetic-discarded-password-0001');
    await page.getByRole('link',{name:'取消',exact:true}).click();
    await expect(page).toHaveURL(settingsURL);
    await page.getByRole('link',{name:'修改密码',exact:true}).click();
    await expect(current).toHaveValue('');
    assert.equal(passwordWrites,0);
    await current.fill('Synthetic-current-password-0001');
    await page.getByLabel('新密码',{exact:true}).fill('Synthetic-next-password-0002');
    await page.getByLabel('确认新密码',{exact:true}).fill('Synthetic-next-password-0002');
    await page.getByRole('button',{name:'保存密码',exact:true}).click();
    await expect(page).toHaveURL(origin+'/login');
    assert.equal(passwordWrites,1);
    await page.close();
  }
});
