import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const previewOrigin = 'http://activity-review.test';
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/review.css', ['review.css', 'text/css; charset=utf-8']],
  ['/view.mjs', ['view.mjs', 'text/javascript; charset=utf-8']],
  ['/review.mjs', ['review.mjs', 'text/javascript; charset=utf-8']],
  ['/fixtures.mjs', ['fixtures.mjs', 'text/javascript; charset=utf-8']],
  ['/activity.mjs', ['activity.mjs', 'text/javascript; charset=utf-8']],
]);
const expectedTitle = '2026-11-24 · 开发 · 3 项可核成果';
const artifactDir = process.argv[2];
if (artifactDir) await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox'],
});

async function open(options) {
  const context = await browser.newContext(options);
  const outsideRequests = [];
  const methods = new Set();
  await context.route('**/*', route => {
    methods.add(route.request().method());
    const url = new URL(route.request().url());
    const file = url.origin === previewOrigin ? files.get(url.pathname) : undefined;
    if (!file) {
      outsideRequests.push(url.pathname);
      return route.abort();
    }
    return route.fulfill({ path: fileURLToPath(new URL(file[0], import.meta.url)), contentType: file[1] });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(previewOrigin);
  await page.getByRole('button', { name: '2026-11-24 · 3 项可核成果' }).waitFor();
  return { context, page, errors, outsideRequests, methods };
}

try {
  const desktop = await open({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const { page } = desktop;
  const summary = page.locator('#detail-summary');
  const details = page.locator('#detail');
  const dimensions = page.locator('button[data-period]');
  const time = value => page.locator('button[data-period="' + value + '"]');
  const dateButton = date => page.locator('button[data-date="' + date + '"]');
  assert.equal(await summary.innerText(), expectedTitle);
  assert.equal(await page.locator('.tile').count(), 92);
  assert.deepEqual(await dimensions.allTextContents(), ['日', '周', '月', '季度', '年']);
  assert.equal(await time('quarter').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#period-title').innerText(), '季度总览');
  assert.equal(await page.locator('#period-current').innerText(), '2026-10-01 至 12-31');
  assert.match(await page.locator('#period-coverage').innerText(), /覆盖未知.*未获授权.*未到日期/);
  assert.equal(await page.locator('#period-stages li').count(), 4);
  assert.deepEqual(await details.locator('.badge').allTextContents(), ['代码候选', '已合并', '实际发布', '验收']);
  assert.equal(await details.getByText('待确认的构建').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 1440);
  assert.equal(await page.locator('#month-axis span').count(), 3);
  const firstMonth = await page.locator('#month-axis span').first().boundingBox();
  const firstDay = await dateButton('2026-10-01').boundingBox();
  assert.equal(firstMonth.x, firstDay.x);
  await page.evaluate(() => document.fonts.ready);
  if (artifactDir) await page.screenshot({ path: join(artifactDir, 'daily-activity-period-quarter-1440.png'), fullPage: true });
  console.log('desktop Q4: 92 days, 3 month ticks, quarter overview, 4 separate evidence stages');

  await dateButton('2026-11-24').focus();
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.date), '2026-11-23');
  assert.equal(await summary.innerText(), expectedTitle);
  await page.keyboard.press('Enter');
  assert.match(await summary.innerText(), /2026-11-23 .*未获授权/);
  assert.match(await details.innerText(), /样例来源未获授权/);
  await dateButton('2026-11-22').click();
  assert.match(await summary.innerText(), /覆盖未知/);
  assert.equal(await dateButton('2026-11-22').getAttribute('data-level'), 'unknown');
  assert.equal(await dateButton('2026-11-23').getAttribute('data-level'), 'unauthorized');
  await dateButton('2026-11-21').click();
  assert.equal(await dateButton('2026-11-21').getAttribute('data-level'), '0');
  assert.match(await details.innerText(), /已核对，暂无/);
  console.log('desktop interaction: arrow focus, Enter/click selection, separate unauthorized / unknown / confirmed zero');

  await page.locator('#jump').fill('2026-11-24');
  await time('week').click();
  assert.equal(await page.locator('.tile').count(), 7);
  assert.match(await page.locator('#month-axis span').first().innerText(), /^周一$/);
  assert.equal(await page.locator('#period-current').innerText(), '2026-11-23 至 11-29');
  assert.equal(await summary.innerText(), expectedTitle);
  await dateButton('2026-11-24').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.date), '2026-11-25');
  await page.keyboard.press('Enter');
  assert.equal(await dateButton('2026-11-25').getAttribute('data-level'), 'future');
  assert.match(await summary.innerText(), /未到日期/);
  assert.doesNotMatch(await summary.innerText(), /0 项/);
  await dateButton('2026-11-24').click();
  if (artifactDir) await page.screenshot({ path: join(artifactDir, 'daily-activity-period-week-1440.png'), fullPage: true });
  await page.locator('#jump').fill('2026-12-31');
  assert.equal(await page.locator('#period-current').innerText(), '2026-12-28 至 2027-01-03');
  await page.getByRole('button', { name: '下一周' }).click();
  assert.equal(await page.locator('#period-current').innerText(), '2027-01-04 至 01-10');
  assert.equal(await page.locator('#period-metrics dd').first().innerText(), '—');
  await page.getByRole('button', { name: '上一周' }).click();
  assert.equal(await page.locator('#period-current').innerText(), '2026-12-28 至 2027-01-03');
  await time('month').click();
  await page.locator('#jump').fill('2024-02-29');
  assert.equal(await page.locator('.tile').count(), 29);
  assert.equal(await page.locator('#period-current').innerText(), '2024-02-01 至 02-29');
  assert.equal(await dateButton('2024-02-29').getAttribute('data-level'), 'unknown');
  await page.locator('#jump').fill('2026-11-24');
  assert.equal(await page.locator('.tile').count(), 30);
  await time('year').click();
  assert.equal(await page.locator('.tile').count(), 365);
  assert.equal(await page.locator('#period-title').innerText(), '全年总览');
  await time('quarter').click();
  await page.getByRole('button', { name: '上一季度' }).click();
  assert.equal(await page.locator('#period-current').innerText(), '2026-07-01 至 09-30');
  await page.locator('#jump').fill('2026-11-24');
  assert.equal(await summary.innerText(), expectedTitle);
  await page.getByRole('button', { name: '记录', exact: true }).click();
  assert.deepEqual(await page.locator('[data-source]').allTextContents(), ['记录', '开发']);
  assert.match(await summary.innerText(), /2026-11-24 · 记录 · 3 条记录/);
  assert.deepEqual(await details.locator('.source-badge').allTextContents(), ['Memos', 'Memos', '日记']);
  assert.equal(await details.getByText('下次到河边带一本小速写本。').count(), 1);
  assert.match(await details.locator('.record-body').last().textContent(), /\n\n/);
  await time('day').click();
  assert.equal(await page.locator('.tile').count(), 0);
  assert.equal(await page.locator('#chart-body').isVisible(), false);
  assert.match(await summary.innerText(), /记录 · 3 条记录/);
  if (artifactDir) await page.screenshot({ path: join(artifactDir, 'daily-activity-period-day-1440.png'), fullPage: true });
  await page.getByRole('button', { name: '下一日' }).click();
  assert.match(await summary.innerText(), /2026-11-25 .*未到日期/);
  await page.getByRole('button', { name: '上一日' }).click();
  await time('quarter').click();
  await dateButton('2026-11-20').click();
  assert.equal(await dateButton('2026-11-20').getAttribute('data-level'), 'partial');
  assert.match(await details.innerText(), /日记 未获授权/);
  await page.locator('#jump').fill('2026-11-24');
  await page.getByRole('button', { name: '开发', exact: true }).click();
  assert.equal(await summary.innerText(), expectedTitle);
  for (const label of ['下一步样例', '回退入口样例']) {
    await page.locator('summary').getByText(label).click();
    assert.equal(await page.locator('details[open]').getByText(label).count(), 1);
  }
  assert.deepEqual(desktop.errors, []);
  assert.deepEqual(desktop.outsideRequests, []);
  assert.deepEqual([...desktop.methods], ['GET']);
  await desktop.context.close();
  console.log('desktop: five time dimensions, Monday and cross-year week, leap-month boundary, period stepping, original details, future and coverage states');

  const mobile = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'zh-CN' });
  const phone = mobile.page;
  assert.equal(await phone.locator('#detail-summary').innerText(), expectedTitle);
  assert.deepEqual(await phone.locator('[data-source]').allTextContents(), ['记录', '开发']);
  assert.equal(await phone.locator('.tile').count(), 92);
  assert.equal(await phone.evaluate(() => window.innerWidth), 1024);
  assert.deepEqual(await phone.locator('button[data-period]').allTextContents(), ['日', '周', '月', '季度', '年']);
  const before = await phone.evaluate(() => visualViewport.scale);
  const session = await mobile.context.newCDPSession(phone);
  const touch = (type, touchPoints) => session.send('Input.dispatchTouchEvent', { type, touchPoints });
  const pinch = distance => [{ x: 195 - distance, y: 185, id: 1 }, { x: 195 + distance, y: 185, id: 2 }];
  await touch('touchStart', pinch(22));
  for (const distance of [32, 48, 67, 90, 120, 145]) await touch('touchMove', pinch(distance));
  await touch('touchEnd', []);
  let pinchVerified = false;
  try {
    await phone.waitForFunction(scale => visualViewport.scale > scale * 1.25, before, { timeout: 1800 });
    pinchVerified = true;
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 0.85 });
    await phone.waitForFunction(scale => visualViewport.scale > scale * 1.25, before, { timeout: 4000 });
  }
  const zoomed = await phone.evaluate(() => ({ scale: visualViewport.scale, x: visualViewport.pageLeft }));
  await touch('touchStart', [{ x: 250, y: 240, id: 1 }]);
  for (const x of [230, 208, 179, 151, 123]) await touch('touchMove', [{ x, y: 240, id: 1 }]);
  await touch('touchEnd', []);
  await phone.waitForFunction(x => Math.abs(visualViewport.pageLeft - x) > 8, zoomed.x, { timeout: 4000 });
  assert.deepEqual(mobile.errors, []);
  assert.deepEqual(mobile.outsideRequests, []);
  assert.deepEqual([...mobile.methods], ['GET']);
  await mobile.context.close();
  if (pinchVerified) console.log('mobile 390px: desktop layout preserved, emulated pinch and horizontal touch pan passed');
  else console.log('mobile 390px: desktop layout preserved, compositor zoom and horizontal touch pan passed; synthetic pinch not verified');
} finally {
  await browser.close();
}
