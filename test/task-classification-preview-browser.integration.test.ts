import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'node:test';
import {chromium, expect} from '@playwright/test';

const source = resolve(import.meta.dirname, '..');
const space = 'synthetic-space';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function record(n: number, type: string, draft: object) {
  return {id: id(n), kind: type === 'todo' ? 'todo' : 'inbox', draft, revision: 1,
    createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-01-01T00:00:00Z', syncState: 'draft', externalStatus: null,
    source: {id: id(n + 100), system: 'website', externalId: id(n), version: 1, asOf: '2030-01-01T00:00:00Z',
      original: {marker: 'personal-manual-v1', spaceId: space, type, input: {}}}};
}

test('task toolbar opens a private, read-only classification preview', {
  skip: process.env.RUN_TASK_CLASSIFICATION_PREVIEW_BROWSER_TESTS !== '1', timeout: 120_000,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'lifeos-task-preview-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'app/personal/task-classification-preview'), {recursive: true});
  await Promise.all([
    ...['layout.tsx', 'globals.css', 'theme.css', 'personal/page.tsx', 'personal/layout.tsx',
      'personal/task-classification-preview/page.tsx'].map(file => cp(join(source, 'app', file), join(root, 'app', file))),
    cp(join(source, 'src'), join(root, 'src'), {recursive: true}),
    cp(join(source, 'postcss.config.mjs'), join(root, 'postcss.config.mjs')),
    symlink(join(source, 'node_modules'), join(root, 'node_modules')),
    symlink(join(source, 'components'), join(root, 'components')),
  ]);
  await writeFile(join(root, 'src/platform/runtime.ts'), `
    export const readPlatformPagePrincipal=async headers=>headers.get('cookie')?.includes('fixture-owner=1')?{id:'synthetic-owner'}:null;
    export const readPlatformPasswordCapability=async()=>false;
    export const readPlatformLoginCapability=async()=>({sessionDuration:false});
  `);
  const server = spawn(process.execPath, [join(source, 'node_modules/next/dist/bin/next'), 'dev',
    '--webpack', '--hostname', '127.0.0.1', '--port', '0'],
    {cwd: root, env: {PATH: process.env.PATH, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1'}});
  const stopped = once(server, 'exit');
  t.after(async () => {if (server.exitCode === null) server.kill('SIGTERM'); await stopped;});
  const origin = await new Promise<string>((accept, reject) => {
    const timeout = setTimeout(() => reject(Error('Synthetic server did not start')), 30_000);
    server.stdout?.on('data', chunk => {
      const address = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (address) {clearTimeout(timeout); accept(address);}
    });
    server.once('exit', () => {clearTimeout(timeout); reject(Error('Synthetic server exited'));});
  });
  const browser = await chromium.launch({executablePath: process.env.LIFEOS_TEST_CHROMIUM_PATH});
  t.after(() => browser.close());
  const preview = '/personal/task-classification-preview';
  const guest = await browser.newPage();
  await guest.goto(origin + preview);
  await expect(guest).toHaveURL(origin + '/login');
  await guest.close();

  const task = {title: '合成归档', notes: '备份原件', status: 'open', dueOn: null};
  const entries = [record(1, 'todo', task), record(2, 'todo', task), record(3, 'todo', {...task, notes: '独立校验'}),
    record(4, 'todo', {...task, title: '合成备份'}),
    record(5, 'project', {title: '合成整理', text: '', occurredOn: null, disposition: 'reference',
      personal: {type: 'project', stage: 'active', purpose: null, nextStep: '', domain: null, topics: []}}),
    record(6, 'topic', {title: '合成标签', text: '', occurredOn: null, disposition: 'reference', personal: {type: 'topic'}}),
    record(7, 'todo', {...task, title: '合成旧记录', status: 'done'}),
    record(8, 'todo', {...task, title: '合成过期引用', personal: {
      project: {id: id(5), sourceId: id(105), revision: 2}, domain: null, topics: [],
    }}),
    record(9, 'todo', {...task, title: '合成显式空分类', personal: {project: null, domain: null, topics: []}})];
  for (const width of [390, 1365]) {
    const page = await browser.newPage({viewport: {width, height: 900}});
    await page.context().addCookies([{url: origin, name: 'fixture-owner', value: '1'}]);
    let incomplete = false;
    let revised = false;
    let downloads = 0;
    page.on('download', () => {downloads++;});
    let writes = 0;
    await page.route('**/api/platform/personal/**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== 'GET') {writes++; return route.abort();}
      if (url.pathname.endsWith('/availability')) return route.fulfill({json: {configured: true, loginAllowed: true, transport: 'ssh-loopback', origin}});
      if (url.pathname.endsWith('/status')) return route.fulfill({json: {scope: 'personal-manual-candidate',
        storageVerified: true, writable: false, ownerId: 'synthetic-owner', spaceId: space, allowedTypes: ['todo', 'project', 'topic']}});
      if (url.pathname.endsWith('/overview')) return route.fulfill({json: {scope: 'full-current-snapshot',
        today: url.searchParams.get('today'), observedAt: '2030-01-01T00:00:00Z', truncated: incomplete,
        total: entries.length, items: revised ? entries.map((entry, index) => index ? entry : {...entry, revision: 2}) : entries}});
      return route.abort();
    });
    await page.goto(origin + '/personal?page=tasks');
    await page.getByRole('link', {name: '分类预览'}).click();
    await expect(page).toHaveURL(origin + preview);
    await expect(page.getByRole('heading', {name: '待办分类预览'})).toBeVisible();
    await expect(page.getByText('完整字段与建议分类相同，建议人工核对重复。')).toHaveCount(1);
    const independent = page.getByRole('article').filter({hasText: '独立校验'});
    for (const [title, reason] of [['合成旧记录', '保留已结束的待办'], ['合成过期引用', '原分类关联已经变化或无法核对']]) {
      const row = page.getByRole('article').filter({hasText: title});
      await expect(row.getByText('受保护 · ' + reason)).toBeVisible();
      await expect(row.getByRole('checkbox')).toHaveCount(0);
      await expect(row.getByText('调整建议')).toHaveCount(0);
    }
    await expect(independent.getByText('单独保留。')).toBeVisible();
    await independent.getByText('调整建议').click();
    await independent.getByLabel('建议项目').selectOption(id(5));
    await independent.getByRole('checkbox', {name: '合成标签'}).check();
    await expect(independent.getByText('建议项目 合成整理 · 建议标签 合成标签')).toBeVisible();
    await independent.getByRole('checkbox', {name: '纳入预览'}).uncheck();
    await expect(independent.getByText('已排除')).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const visibility = (state: 'hidden' | 'visible') => page.evaluate(state => {
      Object.defineProperty(document, 'visibilityState', {configurable: true, value: state});
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
    await visibility('hidden');
    await expect(page.getByRole('article')).toHaveCount(0);
    await visibility('visible');
    await expect(independent.getByText('建议项目 合成整理 · 建议标签 合成标签')).toBeVisible();
    await expect(independent.getByText('已排除')).toBeVisible();
    const requested = page.waitForEvent('download');
    await page.getByRole('button', {name: '保存预览副本'}).click();
    const file = await requested;
    assert.equal(file.suggestedFilename(), 'lifeos-todo-classification-preview.json');
    const saved = JSON.parse(await readFile((await file.path())!, 'utf8'));
    assert.equal(saved.format, 'lifeos.todo-classification.review-copy.v1');
    const indexed = Object.fromEntries(saved.records.map((row: {original: {id: string}}) => [row.original.id, row]));
    assert.equal(indexed[id(2)].duplicateOf, id(1));
    assert.equal(indexed[id(3)].disposition, 'excluded');
    assert.equal(indexed[id(3)].suggestion, null);
    assert.equal(indexed[id(7)].disposition, 'protected');
    assert.equal(indexed[id(7)].original.fields.status, 'done');
    assert.equal(indexed[id(8)].suggestion, null);
    assert.equal(indexed[id(8)].original.fields.personal.project.revision, 2);
    assert.equal(Object.hasOwn(indexed[id(1)].original.fields, 'personal'), false);
    assert.deepEqual(indexed[id(9)].original.fields.personal, {project: null, domain: null, topics: []});
    await expect(page.getByText('已生成预览副本，请查看浏览器下载记录。待办记录未修改。')).toBeVisible();
    await page.getByRole('button', {name: '取消本次调整'}).click();
    await expect(page.getByText('已取消本次调整。待办记录未修改。')).toBeVisible();
    await expect(independent.getByText('建议项目 未归组 · 建议标签 无')).toBeVisible();
    await independent.getByRole('checkbox', {name: '纳入预览'}).uncheck();
    revised = true;
    await page.getByRole('button', {name: '保存预览副本'}).click();
    await expect(page.getByText('已重新核对范围，旧预览建议已清除。')).toBeVisible();
    await expect(page.getByText('未保存预览。请重新核对完整快照后再试。')).toBeVisible();
    await expect(independent.getByRole('checkbox', {name: '纳入预览'})).toBeChecked();
    assert.equal(downloads, 1);
    revised = false;
    await visibility('hidden');
    await expect(page.getByRole('article')).toHaveCount(0);
    await visibility('visible');
    await expect(page.getByText('已重新核对范围，旧预览建议已清除。')).toBeVisible();
    await expect(independent.getByText('已排除')).toHaveCount(0);
    await expect(independent.getByText('建议项目 未归组 · 建议标签 无')).toBeVisible();
    incomplete = true;
    await page.getByRole('button', {name: '重新读取'}).click();
    await expect(page.getByText('无法核对完整待办快照。')).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(0);
    assert.equal(writes, 0);
    await page.close();
  }
});
