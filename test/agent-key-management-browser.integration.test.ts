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
  await mkdir(join(root, 'app'));
  await Promise.all([
    cp(join(source, 'app/layout.tsx'), join(root, 'app/layout.tsx')),
    cp(join(source, 'app/globals.css'), join(root, 'app/globals.css')),
    cp(join(source, 'app/theme.css'), join(root, 'app/theme.css')),
    cp(join(source, 'postcss.config.mjs'), join(root, 'postcss.config.mjs')),
    symlink(join(source, 'node_modules'), join(root, 'node_modules')),
    symlink(join(source, 'src'), join(root, 'src')),
    symlink(join(source, 'components'), join(root, 'components')),
    writeFile(join(root, 'app/page.tsx'), `export {AccountApiKeys as default} from '../src/personal-candidate/account-api-keys';\n`),
  ]);
  return spawn(process.execPath, [join(source, 'node_modules/next/dist/bin/next'), 'dev', '--webpack',
    '--hostname', '127.0.0.1', '--port', '0'], {
    cwd: root,
    env: {PATH: process.env.PATH, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1'},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('OPT-IN synthetic browser creates and revokes API keys, and never restores a revealed token', {
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
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      const path = url.pathname;
      if (path === keyEndpoint && request.method() === 'GET') return route.fulfill({json: {keys: grants}});
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
      if (path.startsWith(keyEndpoint)) return route.fulfill({status: 404});
      return route.continue();
    });

    await page.goto(origin, {waitUntil: 'domcontentloaded', timeout: 55_000});
    await expect(page.getByRole('heading', {name: 'API 密钥'})).toBeVisible();
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
    await page.getByRole('button', {name: '关闭密钥'}).click();
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
    await page.close();
  }
});
