import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {on} from 'node:events';
import {cp, mkdir, mkdtemp, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'node:test';
import {chromium, expect, type Browser, type BrowserServer} from '@playwright/test';
import {cleanupAuthThemeFixture, trackAuthThemeProcess, type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';

const fixture = `'use client';
import {useState} from 'react';
import {Alert, AlertAction, AlertDescription, AlertTitle} from '../src/ui-review/reui/alert';

export default function Page() {
  const [retrying, setRetrying] = useState(false);
  return <main className="mx-auto max-w-3xl space-y-4 p-4">
    <h1 id="group">合成日程与设置</h1>
    <section aria-labelledby="group" id="messages">
        <Alert role="alert" variant="destructive" aria-atomic="true" tabIndex={-1}>
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="6"/></svg>
          <AlertTitle>合成日程读取失败，请核对原请求后继续。</AlertTitle>
          <AlertDescription><p>{'A'.repeat(120)}</p></AlertDescription>
          <AlertAction><button type="button" onClick={() => setRetrying(true)}>重试原请求</button></AlertAction>
        </Alert>
        <Alert role="status" aria-live="polite" className="mt-2">
          <AlertDescription>{retrying ? '正在核对原请求' : '等待原请求'}</AlertDescription>
        </Alert>
        <Alert id="static-note" className="mt-2">
          <AlertDescription>静态说明</AlertDescription>
        </Alert>
      <a href="#group">返回分组</a>
    </section>
  </main>;
}
`;

test('OPT-IN ReUI Alert retains caller semantics, keyboard focus and LifeOS theme tokens', {
  skip: process.env.RUN_REUI_ALERT_BROWSER_TESTS !== '1' && 'Requires isolated Next and Chromium',
  timeout: 100_000,
}, async t => {
  const source = resolve(import.meta.dirname, '..');
  const root = await mkdtemp(join(tmpdir(), 'lifeos-auth-theme-reui-alert-'));
  let server: FixtureProcess | undefined;
  let browserProcess: FixtureProcess | undefined;
  let browser: Browser | undefined;
  let browserServer: BrowserServer | undefined;
  t.after(() => cleanupAuthThemeFixture({root, server, browserProcess, browser, browserServer}));

  await Promise.all(['app', 'src/ui-review/reui', 'src/ui-review/ui'].map(directory =>
    mkdir(join(root, directory), {recursive: true})
  ));
  await Promise.all([
    ...['app/globals.css', 'app/theme.css', 'postcss.config.mjs', 'src/ui-review/reui/alert.tsx',
      'src/ui-review/ui/utils.ts'].map(file => cp(join(source, file), join(root, file))),
    symlink(join(source, 'node_modules'), join(root, 'node_modules')),
    writeFile(join(root, 'app/page.tsx'), fixture),
    writeFile(join(root, 'app/layout.tsx'), `import './globals.css'; import './theme.css';
      export default function Layout({children}: {children: React.ReactNode}) {
        return <html lang="zh-CN"><body>{children}</body></html>;
      }`),
    writeFile(join(root, 'next.config.mjs'), 'export default {devIndicators:false};\n'),
  ]);

  const child = spawn(process.execPath, [
    join(source, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '0',
  ], {
    cwd: root, detached: true, env: {PATH: process.env.PATH, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1'},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server = trackAuthThemeProcess(child, true);
  let output = '';
  let origin = '';
  for await (const [chunk] of on(child.stdout, 'data', {signal: AbortSignal.timeout(30_000)})) {
    output = (output + String(chunk)).slice(-4000);
    const match = output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    if (match && /Ready in\b/.test(output)) {
      origin = match;
      break;
    }
  }
  assert.ok(origin);

  browserServer = await chromium.launchServer({executablePath: process.env.LIFEOS_TEST_CHROMIUM_PATH});
  browserProcess = trackAuthThemeProcess(browserServer.process());
  browser = await chromium.connect(browserServer.wsEndpoint());
  for (const [width, colorScheme] of [[1365, 'light'], [390, 'dark']] as const) {
    const page = await browser.newPage({viewport: {width, height: 844}, colorScheme});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await expect(page.getByRole('heading', {name: '合成日程与设置', level: 1})).toBeVisible();
    const messages = page.locator('#messages');
    const alert = messages.getByRole('alert');
    const status = messages.getByRole('status');
    await expect(alert).toHaveCount(1);
    await expect(alert).toHaveAttribute('aria-atomic', 'true');
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('#static-note')).not.toHaveAttribute('role');
    await alert.focus();
    await expect(alert).toBeFocused();
    await page.keyboard.press('Tab');
    const retry = page.getByRole('button', {name: '重试原请求'});
    await expect(retry).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(status).toHaveText('正在核对原请求');
    await expect(retry).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', {name: '返回分组'})).toBeFocused();

    const styles = await page.evaluate(() => {
      const read = (selector: string) => getComputedStyle(document.querySelector(selector)!);
      const resolveColor = (token: string) => {
        const probe = document.createElement('span');
        probe.style.color = 'var(' + token + ')';
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      };
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        neutralColor: read('#static-note').backgroundColor,
        card: resolveColor('--card'),
        alertColor: read('[role="alert"]').backgroundColor,
        danger: resolveColor('--danger-background'),
        alertText: read('[role="alert"]').color,
        dangerText: resolveColor('--danger'),
        actionOnNextRow: document.querySelector('[data-slot="alert-action"]')!.getBoundingClientRect().top >=
          document.querySelector('[role="alert"] [data-slot="alert-description"]')!.getBoundingClientRect().bottom,
      };
    });
    assert.equal(styles.overflow, false);
    assert.equal(styles.neutralColor, styles.card);
    assert.equal(styles.alertColor, styles.danger);
    assert.equal(styles.alertText, styles.dangerText);
    assert.equal(styles.actionOnNextRow, width === 390);
    assert.deepEqual(errors, []);
    if (process.env.LIFEOS_REUI_ALERT_EVIDENCE) {
      await mkdir(process.env.LIFEOS_REUI_ALERT_EVIDENCE, {recursive: true});
      await page.screenshot({path: join(process.env.LIFEOS_REUI_ALERT_EVIDENCE, `alert-${width}.png`)});
    }
    await page.close();
  }
});
