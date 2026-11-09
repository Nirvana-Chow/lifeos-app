import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect,type Browser} from '@playwright/test';
import {renderedContrast} from './helpers/personal-contrast.ts';

test('OPT-IN local training analytics preserves incomplete coverage and clears file data', {
  skip:process.env.RUN_TRAINING_ANALYTICS_BROWSER_TESTS !== '1' && 'Requires native Chrome and a temporary Next fixture',
  timeout:120_000,
}, async t => {
  const source = resolve(import.meta.dirname,'..');
  const root = await mkdtemp(join(tmpdir(),'lifeos-training-analytics-'));
  let browser: Browser | undefined;
  let stopServer = async () => {};
  t.after(async () => {
    await browser?.close();
    await stopServer();
    await rm(root,{recursive:true,force:true});
  });
  await mkdir(join(root,'app'));
  await Promise.all([
    cp(join(source,'src'),join(root,'src'),{recursive:true}),
    ...['layout.tsx','globals.css','theme.css'].map(file => cp(join(source,'app',file),join(root,'app',file))),
    cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
    symlink(join(source,'node_modules'),join(root,'node_modules')),
    symlink(join(source,'components'),join(root,'components')),
  ]);
  await writeFile(join(root,'app/page.tsx'),`import {TrainingAnalyticsPanel} from '../src/personal-health/training-analytics/panel';
export default function Page(){return <main data-lifeos-surface="internal-training" style={{maxWidth:1120,margin:'auto',padding:16}}><TrainingAnalyticsPanel/></main>;}`);
  const server = spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'], {
    cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],
  });
  const stopped = once(server,'exit');
  let output = '';
  server.stdout.on('data', chunk => {output += String(chunk);});
  server.stderr.on('data', chunk => {output += String(chunk);});
  stopServer = async () => {server.kill('SIGTERM');await stopped;};
  const origin = await new Promise<string>((accept,reject) => {
    const poll = setInterval(() => {
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {clearInterval(poll);clearTimeout(timeout);accept(match[0]);}
    },30);
    const timeout = setTimeout(() => {clearInterval(poll);reject(Error('Fixture startup timeout: '+output.slice(-1500)));},30_000);
    server.once('exit',() => {clearInterval(poll);clearTimeout(timeout);reject(Error('Fixture exited: '+output.slice(-1500)));});
  });

  browser = await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
  const page = await browser.newPage({viewport:{width:1366,height:900}});
  page.setDefaultTimeout(6_000);
  const requests:string[] = [];
  let watchFileInteractions = false;
  page.on('request', request => {if (watchFileInteractions) requests.push(request.url());});
  const response = await page.goto(origin,{waitUntil:'networkidle',timeout:60_000});
  assert.equal(response?.status(),200);
  watchFileInteractions = true;
  const input = page.getByLabel('选择训记分析文件');
  const synthetic = {
    schemaVersion:1, source:'xunji',
    days:[
      {date:'2026-10-30',status:'complete',sets:[{exercise:'合成卧推',muscle:'chest',reps:5,load:{amount:20,unit:'kg'}}]},
      {date:'2026-11-02',status:'complete',sets:[{exercise:'合成卧推',muscle:'chest',reps:10,load:{amount:20,unit:'kg'}}]},
      {date:'2026-11-07',status:'partial',sets:[
        {exercise:'合成划船',muscle:'back',reps:5,load:{amount:40,unit:'lb'}},
        {exercise:'合成未归类',muscle:null,reps:8,load:null},
      ]},
    ],
  };
  const file = {name:'synthetic-training.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(synthetic))};
  await input.setInputFiles(file);
  await page.getByRole('button',{name:'周',exact:true}).click();
  const summary = page.getByRole('region',{name:'所选周期概览'});
  await expect(summary.getByText('2 / 10',{exact:true})).toBeVisible();
  await expect(summary.getByText('实际覆盖可能更多',{exact:true})).toBeVisible();
  await expect(summary.getByText('200 kg',{exact:true})).toBeVisible();
  await expect(summary.getByText('200 lb',{exact:true})).toBeVisible();
  await expect(summary.getByText(/1 天部分可读/)).toBeVisible();
  await page.getByLabel('指标').selectOption('coverage');
  const trend = page.getByRole('region',{name:'训练量趋势'});
  await expect(trend.getByText('至少 1 / 10',{exact:true})).toBeVisible();
  await expect(trend.getByText('至少 2 / 10',{exact:true})).toBeVisible();
  await page.getByLabel('查看日期').selectOption('2026-11-07');
  await expect(page.getByText('合成划船',{exact:true})).toBeVisible();
  await page.getByLabel('统计范围').selectOption('chest');
  await expect(page.getByText('合成划船',{exact:true})).toHaveCount(0);

  await page.getByRole('button',{name:'日',exact:true}).click();
  await expect(summary.locator('dd').first()).toHaveText('未知');
  await page.getByRole('button',{name:'周',exact:true}).click();
  await page.getByLabel('统计范围').selectOption('all');
  const reviewDirectory = process.env.LIFEOS_TRAINING_ANALYTICS_SCREENSHOT_DIR;
  if (reviewDirectory) await page.screenshot({path:join(reviewDirectory,'1366-light.png'),fullPage:true});

  await page.setViewportSize({width:390,height:844});
  await page.evaluate(() => {document.documentElement.dataset.lifeosTheme = 'dark';});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  const controlHeight = await page.getByLabel('统计范围').evaluate(node => node.getBoundingClientRect().height);
  assert.ok(controlHeight >= 44);
  await expect.poll(async () => {
    const facts = await page.getByRole('button',{name:'年',exact:true}).evaluate(node => {
      const panel = node.closest('section')!;
      return {foreground:getComputedStyle(node).color,layers:[node,panel].map(item => ({backgroundColor:getComputedStyle(item).backgroundColor}))};
    });
    return renderedContrast(facts.foreground,facts.layers).contrast;
  }).toBeGreaterThanOrEqual(4.5);
  assert.ok(await input.evaluate(node => {
    const control = node.getBoundingClientRect();
    const panel = node.closest('section')!.getBoundingClientRect();
    return control.right <= panel.right;
  }));
  if (reviewDirectory) await page.screenshot({path:join(reviewDirectory,'390-dark.png'),fullPage:true});
  await page.getByRole('button',{name:'清除本次数据',exact:true}).click();
  await expect(summary).toHaveCount(0);
  await expect(page.getByText(/仅在此页面内分析/)).toBeVisible();
  await input.setInputFiles(file);
  await expect(summary).toBeVisible();
  watchFileInteractions = false;
  await page.reload();
  await expect(summary).toHaveCount(0);
  assert.deepEqual(requests,[]);
});
