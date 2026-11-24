import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { journalFixture, journalStatus } from './helpers/journal-history.ts';

test('OPT-IN journal activity retains owner and restoration guards at the canonical entry', {
  skip: process.env.RUN_ACTIVITY_OWNER_BROWSER !== '1' && 'Requires an isolated Next and Chromium slot',
  timeout: 150000,
}, async t => {
  const source = resolve(import.meta.dirname, '..');
  const root = await mkdtemp(join(tmpdir(), 'lifeos-activity-browser-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'app/personal/activity'), { recursive: true });
  await mkdir(join(root, 'app/login'), { recursive: true });
  await Promise.all([
    cp(join(source, 'src'), join(root, 'src'), { recursive: true }),
    cp(join(source, 'app/personal/activity/page.tsx'), join(root, 'app/personal/activity/page.tsx')),
    cp(join(source, 'app/personal/layout.tsx'), join(root, 'app/personal/layout.tsx')),
    symlink(join(source, 'node_modules'), join(root, 'node_modules')),
  ]);
  await writeFile(join(root, 'app/layout.tsx'), 'export default function Layout({children}){return <html><body>{children}</body></html>}');
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
    cwd: root, env: { PATH: process.env.PATH, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stopped = once(server, 'exit');
  let log = '';
  server.stderr.on('data', data => { log += String(data); });
  t.after(async () => { if (server.exitCode === null) server.kill('SIGTERM'); await stopped; });
  await new Promise<void>((done, fail) => {
    const timer = setTimeout(() => fail(Error(log || 'Fixture startup timed out')), 30000);
    server.once('exit', () => { clearTimeout(timer); fail(Error(log || 'Fixture exited')); });
    server.stdout.on('data', data => { if (String(data).includes('Ready')) { clearTimeout(timer); done(); } });
  });

  const browser = await chromium.launch({ executablePath: process.env.LIFEOS_TEST_CHROMIUM_PATH });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin + '/personal/activity');
  await expect(page.getByRole('heading', { name: 'Fixture login' })).toBeVisible();
  await context.addCookies([{ name: 'activity-fixture', value: 'owner', url: origin }]);

  const fixture = journalFixture(1, '2026-11-24', 'Body stays in journal');
  let authorized = true;
  let snapshotRequests = 0;
  let expiresAt = new Date(Date.now() + 300000);
  const writes: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/platform/**', async route => {
    const request = route.request();
    if (request.method() !== 'GET') writes.push(request.method());
    const path = new URL(request.url()).pathname;
    if (!authorized) return route.fulfill({ status: 401, json: {} });
    if (path.endsWith('/auth/get-session')) return route.fulfill({ json: { session: {
      mfaVerified: true, sessionDurationMode: 'fixed', sessionDurationSeconds: 1800,
      expiresAt: expiresAt.toISOString(),
    } } });
    if (path.endsWith('/journal/snapshot')) {
      snapshotRequests += 1;
      return route.fulfill({ json: {
        scope: 'full-current-snapshot', truncated: false, total: 1,
        items: [fixture], observedAt: '2026-11-23T16:00:00.000Z',
      } });
    }
    assert.ok(path.endsWith('/status'));
    return route.fulfill({ json: journalStatus });
  });

  await page.goto(origin + '/personal/activity');
  const title = page.getByText('Synthetic diary 1', { exact: true });
  await expect(title).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('2026-11-24 · 记录 · 已核对 1 条记录 · 部分覆盖')).toBeVisible();
  await expect(page.getByRole('link', { name: '打开日记原记录' })).toHaveAttribute('href', '/personal/journal?record=' + fixture.id);
  assert.doesNotMatch(await page.content(), /Body stays in journal|journal-activity-input/);

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
