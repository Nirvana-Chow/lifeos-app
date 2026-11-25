import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { journalFixture, journalStatus, journalWithTopic, topicFixture } from './helpers/journal-history.ts';
import { mergedSlices } from '../src/ui-review/requirements-delivery.ts';

test('OPT-IN records and development retain date, evidence and owner guards at the canonical entry', {
  skip: process.env.RUN_ACTIVITY_OWNER_BROWSER !== '1' && 'Requires an isolated Next and Chromium slot',
  timeout: 150000,
}, async t => {
  const source = resolve(import.meta.dirname, '..');
  const root = await mkdtemp(join(tmpdir(), 'lifeos-activity-browser-'));
  let closeBrowser: (() => Promise<void>) | undefined;
  let stopServer: (() => Promise<void>) | undefined;
  t.after(async () => {
    try { await closeBrowser?.(); }
    finally {
      try { await stopServer?.(); }
      finally { await rm(root, { recursive: true, force: true }); }
    }
  });
  await mkdir(join(root, 'app/personal/activity'), { recursive: true });
  await mkdir(join(root, 'app/login'), { recursive: true });
  await Promise.all([
    cp(join(source, 'src'), join(root, 'src'), { recursive: true }),
    cp(join(source, 'app/personal/activity/page.tsx'), join(root, 'app/personal/activity/page.tsx')),
    cp(join(source, 'app/personal/layout.tsx'), join(root, 'app/personal/layout.tsx')),
    ...['layout.tsx', 'globals.css', 'theme.css'].map(name => cp(join(source, 'app', name), join(root, 'app', name))),
    cp(join(source, 'postcss.config.mjs'), join(root, 'postcss.config.mjs')),
    ...['node_modules', 'components'].map(name => symlink(join(source, name), join(root, name))),
  ]);
  await writeFile(join(root, 'app/login/page.tsx'), 'export default function Page(){return <h1>Fixture login</h1>}');
  await writeFile(join(root, 'src/platform/runtime.ts'),
    'export async function readPlatformLoginCapability(){return {sessionDuration:true}}\n' +
    'export async function readPlatformPagePrincipal(headers:Headers){return headers.get("cookie")?.includes("activity-fixture=owner") ? {userId:"synthetic"} : null}');
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>(done => probe.close(() => done()));
  const origin = 'http://127.0.0.1:' + port;
  const server = spawn(process.execPath, [join(source, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: root, env: { PATH: process.env.PATH, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stopped = once(server, 'exit');
  let log = '';
  server.stderr.on('data', data => { log += String(data); });
  stopServer = async () => { if (server.exitCode === null) server.kill('SIGTERM'); await stopped; };
  await new Promise<void>((done, fail) => {
    const timer = setTimeout(() => fail(Error(log || 'Fixture startup timed out')), 30000);
    server.once('exit', () => { clearTimeout(timer); fail(Error(log || 'Fixture exited')); });
    server.stdout.on('data', data => { if (String(data).includes('Ready')) { clearTimeout(timer); done(); } });
  });

  const browser = await chromium.launch({ executablePath: process.env.LIFEOS_TEST_CHROMIUM_PATH });
  closeBrowser = () => browser.close();
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  const page = await context.newPage();
  await page.goto(origin + '/personal/activity', {waitUntil:'domcontentloaded',timeout:90000});
  await expect(page.getByRole('heading', { name: 'Fixture login' })).toBeVisible();
  await context.addCookies([{ name: 'activity-fixture', value: 'owner', url: origin }]);

  const fixture = journalFixture(1, '2026-11-24', 'Body stays in journal');
  const topic = topicFixture(101, '思考');
  const memo = journalWithTopic(journalFixture(70, '2026-11-25', 'Memo body stays at the original'), topic);
  const mergesOnSelectedDay = [...mergedSlices.values()].filter(({ at }) =>
    Date.parse(at) >= Date.parse('2026-11-24T16:00:00Z') && Date.parse(at) < Date.parse('2026-11-25T16:00:00Z')).length;
  const mergedDetail = '2026-11-25 · 开发 · 已核对 ' + mergesOnSelectedDay + ' 项可核成果 · 部分覆盖';
  let authorized = true;
  let journalAllowed = true;
  let observedAt = '2026-11-23T16:00:00.000Z';
  let snapshotRequests = 0;
  let expiresAt = new Date(Date.now() + 300000);
  const writes: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/platform/**', async route => {
    const request = route.request();
    if (request.method() !== 'GET') writes.push(request.method());
    const path = new URL(request.url()).pathname;
    if (['manifest.webmanifest', 'icon.svg', 'apple-icon.png'].some(asset => path === '/api/platform/install/' + asset)) {
      return route.fulfill({ status: 404, body: '' });
    }
    if (!authorized) return route.fulfill({ status: 401, json: {} });
    if (path.endsWith('/auth/get-session')) return route.fulfill({ json: { session: {
      mfaVerified: true, sessionDurationMode: 'fixed', sessionDurationSeconds: 1800,
      expiresAt: expiresAt.toISOString(),
    } } });
    if (path.endsWith('/journal/snapshot')) {
      if (!journalAllowed) return route.fulfill({ status: 403, json: {} });
      snapshotRequests += 1;
      return route.fulfill({ json: {
        scope: 'full-current-snapshot', truncated: false, total: 2,
        items: [fixture, memo], observedAt,
      } });
    }
    if (path.endsWith('/topic/snapshot')) return route.fulfill({ json: {
      scope: 'full-current-snapshot', truncated: false, total: 1, items: [topic],
    } });
    assert.ok(path.endsWith('/status'), path);
    return route.fulfill({ json: { ...journalStatus, allowedTypes: ['journal', 'topic'] } });
  });

  await page.goto(origin + '/personal/activity', {waitUntil:'domcontentloaded',timeout:90000});
  const title = page.getByText('Synthetic diary 1', { exact: true });
  await expect(title).toBeVisible({ timeout: 30000 });
  await expect(page.locator('header.lo-header')).toBeVisible();
  await expect(page.locator('header.lo-header')).toHaveCount(1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 1365);
  await expect(page.getByRole('link', { name: '返回日记', exact: true })).toHaveAttribute('href', '/personal/journal');
  await expect(page.getByText('2026-11-24 · 记录 · 已核对 1 条记录 · 部分覆盖')).toBeVisible();
  await expect(page.getByRole('link', { name: '打开日记原记录' })).toHaveAttribute('href', '/personal/journal?record=' + fixture.id);
  await expect(page.getByText('Memos 覆盖未知 · 日记 覆盖未知')).toBeVisible();
  assert.doesNotMatch(await page.content(), /Body stays in journal|journal-activity-input/);

  observedAt = '2026-11-24T16:00:00.000Z';
  await page.goto(origin + '/personal/activity?date=2026-11-24', {waitUntil:'domcontentloaded',timeout:90000});
  await expect(page.getByRole('button', { name: '日', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(title).toBeVisible();
  for (const dimension of ['周', '月', '季度', '年', '日']) {
    await page.getByRole('button', { name: dimension, exact: true }).click();
    await expect(page.getByLabel('跳到日期')).toHaveValue('2026-11-24');
    await expect(title).toBeVisible();
  }
  await page.getByLabel('跳到日期').fill('2026-11-25');
  await expect(page.getByRole('link', { name: '打开随手记原记录' })).toHaveAttribute('href', '/personal/journal?record=' + memo.id);
  await expect(page.getByText('2026-11-25 · 记录 · 已核对 1 条记录 · 部分覆盖')).toBeVisible();
  await expect(page.getByText('Memo body stays at the original')).toHaveCount(0);
  await page.getByLabel('跳到日期').fill('2026-11-24');
  await page.getByRole('button', { name: '开发', exact: true }).click();
  await expect(page.getByText('2026-11-24 · 开发 · 覆盖未知')).toBeVisible();
  await page.getByLabel('跳到日期').fill('2026-11-25');
  await expect(page.getByText(mergedDetail)).toBeVisible();
  await expect(page.getByRole('link', { name: '查看合并记录 · 日记活动热力图' })).toHaveAttribute('href', 'https://github.com/Nirvana-Chow/lifeos-app/pull/98');
  await page.getByRole('button', { name: '季度', exact: true }).click();
  await expect(page.locator('#period-stages').getByText(/已合并 [1-9][0-9]*/)).toBeVisible();
  await expect(page.locator('#period-stages').getByText('实际发布 —')).toBeVisible();
  await expect(page.locator('#period-stages').getByText('验收 —')).toBeVisible();
  await expect(page.locator('#period-metrics dd').last()).toHaveText('0');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.getByText('日记活动热力图', { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.getByText(mergedDetail)).toBeVisible();
  await expect(page.getByRole('button', { name: '季度', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('跳到日期').fill('2026-11-26');
  await expect(page.getByText('2026-11-26 · 开发 · 未到日期')).toBeVisible();

  journalAllowed = false;
  await page.goto(origin + '/personal/activity?date=2026-11-25', {waitUntil:'domcontentloaded',timeout:90000});
  await expect(page.getByText('Memos 未获授权 · 日记 未获授权')).toBeVisible();
  await expect(title).toHaveCount(0);
  await page.getByRole('button', { name: '开发', exact: true }).click();
  await expect(page.getByRole('link', { name: '查看合并记录 · 日记活动热力图' })).toBeVisible();
  journalAllowed = true;
  await page.goto(origin + '/personal/activity?date=2026-02-30&date=2026-11-24', {waitUntil:'domcontentloaded',timeout:90000});
  await expect(page.getByLabel('跳到日期')).toHaveValue('2026-11-25');
  await expect(page.getByRole('button', { name: '季度', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto(origin + '/personal/activity?date=2026-11-24', {waitUntil:'domcontentloaded',timeout:90000});
  await expect(title).toBeVisible();

  expiresAt = new Date(Date.now() + 1000);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('登录已到期或需要重新验证', { exact: true })).toBeVisible();
  await expect(title).toBeHidden();
  expiresAt = new Date(Date.now() + 300000);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(title).toBeVisible();

  const before = snapshotRequests;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(title).toHaveCount(0);
  authorized = false;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.getByRole('heading', { name: 'Fixture login' })).toBeVisible();
  await expect(title).toHaveCount(0);
  assert.equal(snapshotRequests, before);
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
});
