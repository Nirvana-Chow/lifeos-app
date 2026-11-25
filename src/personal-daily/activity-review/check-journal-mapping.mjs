import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { journalFixture, journalStatus } from '../../../test/helpers/journal-history.ts';
import { journalActivityJson, readJournalActivity } from './journal-source.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const origin = 'http://activity-review.test';
const paths = new Map([
  ['/review.css', 'text/css; charset=utf-8'],
  ['/view.mjs', 'text/javascript; charset=utf-8'],
  ['/review.mjs', 'text/javascript; charset=utf-8'],
  ['/activity.mjs', 'text/javascript; charset=utf-8'],
  ['/fixtures.mjs', 'text/javascript; charset=utf-8'],
]);
const original = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const marker = '</script><i id="injected">synthetic title</i>';
const worn = journalFixture(1, '2026-11-24', 'synthetic diary body stays outside the heatmap');
const entries = [
  { ...worn, draft: { ...worn.draft, title: marker } },
  journalFixture(2, null, 'undated synthetic body'),
  journalFixture(3, '2026-11-25', 'future synthetic body'),
];
const snapshot = { scope: 'full-current-snapshot', truncated: false, total: entries.length, items: entries, observedAt: '2026-11-23T16:00:00.000Z' };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });

async function open(mode) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, offline: true });
  const calls = [];
  const unexpected = [];
  let statusCalls = 0;
  await context.route('**/*', async route => {
    const { origin: host, pathname } = new URL(route.request().url());
    if (host !== origin || route.request().method() !== 'GET') {
      unexpected.push(pathname);
      return route.abort();
    }
    if (pathname === '/journal-mapping') {
      const mapped = await readJournalActivity(async (input, init) => {
        calls.push(input);
        assert.equal(init?.credentials, 'same-origin');
        assert.equal(init?.cache, 'no-store');
        assert.equal(init?.method ?? 'GET', 'GET');
        if (input === '/api/platform/personal/status') {
          statusCalls += 1;
          if (mode === 'revoked' && statusCalls === 2) return Response.json({}, { status: 403 });
          if (mode === 'switched' && statusCalls === 2) {
            return Response.json({ ...journalStatus, ownerId: 'different-synthetic-owner' });
          }
          return Response.json(journalStatus);
        }
        assert.equal(input, '/api/platform/personal/journal/snapshot');
        return Response.json(mode === 'truncated' ? { ...snapshot, truncated: true } : snapshot);
      });
      const json = journalActivityJson(mapped);
      const html = original.replace('</head>', '<script type="application/json" id="journal-activity-input">' + json + '</script></head>');
      return route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' });
    }
    const mime = paths.get(pathname);
    if (mime) {
      const body = await readFile(new URL('.' + pathname, import.meta.url), 'utf8');
      // Exercise a plausible shortcut without changing candidate assets on disk.
      const served = mode === 'shortcut' && pathname === '/view.mjs'
        ? body.replace("[entry.when.date, 'observed']", "[entry.when.date, 'complete']")
        : body;
      if (mode === 'shortcut' && pathname === '/view.mjs') assert.notEqual(served, body);
      return route.fulfill({ body: served, contentType: mime });
    }
    unexpected.push(pathname);
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/journal-mapping');
  await page.locator('#mapping-state').waitFor({ state: 'visible' });
  return { context, page, calls, errors, unexpected };
}

try {
  const loaded = await open('ready');
  const { page } = loaded;
  const summary = page.locator('#detail-summary');
  const detail = page.locator('#detail');
  assert.equal(await summary.innerText(), '2026-11-24 · 记录 · 已核对 1 条记录 · 部分覆盖');
  assert.equal(await page.locator('#injected').count(), 0);
  assert.equal(await detail.locator('h3').innerText(), marker);
  assert.equal(await detail.getByRole('link').getAttribute('href'), '/personal/journal?record=' + worn.id);
  assert.doesNotMatch(await page.content(), /body stays outside|undated synthetic body|future synthetic body/);
  assert.match(await detail.innerText(), /Memos 未接入 · 日记 覆盖未知/);
  const dateCell = date => page.locator('button[data-date="' + date + '"]');
  assert.equal(await dateCell('2026-11-24').getAttribute('data-level'), 'partial');
  assert.equal(await dateCell('2026-11-23').getAttribute('data-level'), 'unknown');
  assert.equal(await dateCell('2026-11-25').getAttribute('data-level'), 'future');
  await dateCell('2026-11-23').click();
  assert.match(await summary.innerText(), /覆盖未知/);
  assert.equal(await detail.locator('article').count(), 0);
  await page.locator('button[data-period="day"]').click();
  assert.match(await summary.innerText(), /2026-11-23.*覆盖未知/);
  await page.locator('#next-period').click();
  assert.match(await summary.innerText(), /2026-11-24.*部分覆盖/);
  await page.locator('button[data-period="year"]').click();
  assert.equal(await page.locator('#period-metrics dd').first().innerText(), '1');
  assert.equal(await page.locator('#period-metrics dd').last().innerText(), '0');
  await page.getByRole('button', { name: '开发', exact: true }).click();
  assert.match(await summary.innerText(), /覆盖未知/);
  assert.equal(await page.locator('#period-metrics dd').first().innerText(), '—');
  assert.equal(await page.locator('#example-actions').isVisible(), false);
  await page.getByRole('button', { name: '记录', exact: true }).click();
  for (const dimension of ['day', 'week', 'month', 'quarter', 'year']) {
    await page.locator('button[data-period="' + dimension + '"]').click();
    if (dimension !== 'day') await dateCell('2026-11-24').click();
    assert.match(await summary.innerText(), /2026-11-24.*部分覆盖/);
    assert.equal(await detail.getByRole('link').getAttribute('href'), '/personal/journal?record=' + worn.id);
  }
  assert.deepEqual(loaded.calls, [
    '/api/platform/personal/status',
    '/api/platform/personal/journal/snapshot',
    '/api/platform/personal/status',
  ]);
  assert.deepEqual(loaded.errors, []);
  assert.deepEqual(loaded.unexpected, []);
  await loaded.context.close();
  console.log('ready: actual heatmap entry preserves partial positives, unknown adjacent day, Shanghai as-of, original link and strict GET boundary');

  const shortcut = await open('shortcut');
  assert.match(await shortcut.page.locator('#detail-summary').innerText(), /已核对 1 条记录/);
  assert.match(await shortcut.page.locator('#detail').innerText(), /Memos 未接入/);
  assert.doesNotMatch(await shortcut.page.locator('#detail').innerText(), /日记 覆盖未知/);
  assert.equal(await shortcut.page.locator('#period-metrics dd').last().innerText(), '0');
  assert.deepEqual(shortcut.errors, []);
  assert.deepEqual(shortcut.unexpected, []);
  await shortcut.context.close();
  console.log('counterexample: marking positive diary dates complete leaves the right count but hides the diary coverage gap at the user entry');

  for (const mode of ['revoked', 'switched', 'truncated']) {
    const blocked = await open(mode);
    assert.equal(await blocked.page.locator('main').isVisible(), true);
    assert.equal(await blocked.page.locator('#detail article').count(), 0);
    assert.doesNotMatch(await blocked.page.locator('#detail-summary').innerText(), /0 条记录|已核对/);
    assert.doesNotMatch(await blocked.page.content(), new RegExp(worn.id));
    assert.match(await blocked.page.locator('#mapping-state').innerText(), mode === 'revoked' ? /未获授权/ : /无法核对/);
    assert.deepEqual(blocked.errors, []);
    assert.deepEqual(blocked.unexpected, []);
    await blocked.context.close();
    console.log(mode + ': private records and synthetic fallback are both absent');
  }
} finally {
  await browser.close();
}
