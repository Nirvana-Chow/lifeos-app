import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';

// Internal fixture only: no account, API, source synchronization or persistence.
test('OPT-IN reused xunji calendar renders real SVG, original sport details and responsive native controls',{
  skip:process.env.RUN_XUNJI_LOG_BROWSER_TESTS !== '1' && 'Requires native Chrome and a temporary internal Next fixture',timeout:180_000,
},async t => {
  const source = resolve(import.meta.dirname,'..'),root = await mkdtemp(join(tmpdir(),'lifeos-xunji-log-'));
  await mkdir(join(root,'app'),{recursive:true});
  await Promise.all([cp(join(source,'src'),join(root,'src'),{recursive:true}),...['layout.tsx','globals.css','theme.css'].map(file => cp(join(source,'app',file),join(root,'app',file))),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components'))]);
  await writeFile(join(root,'app/page.tsx'),`'use client';
import {useState} from 'react';
import {TrainingCalendar} from '../src/personal-health/xunji-log/calendar';
import {emptyHealthFields} from '../src/personal-health/presentation';
import type {TrainingCalendarRecord} from '../src/personal-health/xunji-log/adapter';
function record(id:string,title:string,date:string,patch:object){const fields=emptyHealthFields('training','UTC');fields.title=title;fields.occurredOn=date;fields.personal={...fields.personal,...patch} as typeof fields.personal;return {id,revision:2,fields};}
const rows=[record('frisbee','飞盘投掷与对抗','2026-11-05',{healthKind:'training',activity:'other',state:'completed',durationMinutes:60,distance:{value:2,unit:'mi'}}),record('run','公园慢跑','2026-11-05',{healthKind:'training',activity:'cardio',state:'completed',durationMinutes:30,distance:{value:3,unit:'km'}}),record('unknown','球场运动（时长待补）','2026-11-04',{healthKind:'training',state:'completed'}),record('plan','周末计划','2026-11-06',{healthKind:'training',state:'planned',durationMinutes:90})];
export default function Page(){const [records,setRecords]=useState<TrainingCalendarRecord[]>([]),[opened,setOpened]=useState('');return <main data-lifeos-surface="internal-xunji" style={{maxWidth:1120,margin:'auto',padding:16,font:'var(--lo-font-body)'}}><h1>内部复用验证</h1><button data-slot="button" onClick={()=>setRecords(rows)}>加载内部合成记录</button><output aria-label="打开的原记录">{opened}</output><TrainingCalendar records={records} onOpenRecord={setOpened}/></main>;}
`);
  const server = spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
  const stopped = once(server,'exit');let output = '';
  server.stdout.on('data',chunk => {output += String(chunk);});server.stderr.on('data',chunk => {output += String(chunk);});
  t.after(async () => {server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
  const origin = await new Promise<string>((accept,reject) => {
    const timer = setInterval(() => {const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);if (match) {clearInterval(timer);clearTimeout(timeout);accept(match[0]);}},30);
    const timeout = setTimeout(() => {clearInterval(timer);reject(Error('Xunji fixture startup timeout: '+output.slice(-1500)));},30_000);
    server.once('exit',() => {clearInterval(timer);clearTimeout(timeout);reject(Error('Xunji fixture exited: '+output.slice(-1500)));});
  });
  const browser = await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(() => browser.close());
  const page = await browser.newPage({viewport:{width:1366,height:900},timezoneId:'UTC'});page.setDefaultTimeout(10_000);
  const errors:string[] = [];page.on('pageerror',error => errors.push(error.message));
  await page.goto(origin,{waitUntil:'networkidle',timeout:60_000});
  const calendar = page.getByRole('region',{name:'运动日历与记录',exact:true});
  await expect(page.getByText(/暂无已完成的运动记录/)).toBeVisible();
  await expect(calendar.getByRole('img')).toHaveCount(0);
  await page.getByRole('button',{name:'加载内部合成记录',exact:true}).click();
  const chart = calendar.getByRole('img',{name:/^已读运动日历，2 个/});
  await expect(chart.locator('svg')).toBeVisible();
  await expect(page.getByText(/1 条计划单独保留/)).toBeVisible();
  await expect(page.getByRole('button',{name:'周末计划',exact:true})).toHaveCount(0);
  const cell = await chart.locator('svg path').evaluateAll(nodes => {
    const color = document.createElement('span');color.style.color = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
    return nodes.map(node => ({fill:getComputedStyle(node).fill,box:node.getBoundingClientRect()})).filter(value => value.fill === color.style.color && value.box.width > 0 && value.box.height > 0 && value.box.height <= 24).map(value => ({x:value.box.x+value.box.width/2,y:value.box.y+value.box.height/2}))[0] ?? null;
  });
  assert.ok(cell,'an actual maximum-count heatmap cell is rendered');await page.mouse.click(cell.x,cell.y);
  const group = page.getByRole('group',{name:'2026-11-05 的运动记录',exact:true});await expect(group).toBeVisible();
  await group.getByRole('button',{name:/飞盘投掷与对抗/}).click();await expect(page.getByLabel('打开的原记录',{exact:true})).toHaveText('frisbee');
  await page.getByRole('button',{name:'公园慢跑',exact:true}).click();await expect(page.getByLabel('打开的原记录',{exact:true})).toHaveText('run');
  await page.getByRole('button',{name:'运动时长（分钟）',exact:true}).click();await expect(chart.locator('svg')).toBeVisible();
  const unknownCell = await chart.locator('svg path').evaluateAll(nodes => {
    const color = document.createElement('span');color.style.color = getComputedStyle(document.documentElement).getPropertyValue('--input').trim();
    return nodes.map(node => ({fill:getComputedStyle(node).fill,box:node.getBoundingClientRect()})).filter(value => value.fill === color.style.color && value.box.width > 0 && value.box.height > 0 && value.box.height <= 24).map(value => ({x:value.box.x+value.box.width/2,y:value.box.y+value.box.height/2}))[0] ?? null;
  });
  assert.ok(unknownCell,'a missing metric keeps a neutral actual-record cell');await page.mouse.click(unknownCell.x,unknownCell.y);await expect(page.getByLabel('打开的原记录',{exact:true})).toHaveText('unknown');
  await expect(page.getByText('其他运动 · 60 分钟 · 2 mi',{exact:true}).first()).toBeVisible();
  await mkdir(join(source,'.review-results'),{recursive:true});
  await page.screenshot({path:join(source,'.review-results/xunji-log-1366-light.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.evaluate(() => {document.documentElement.dataset.lifeosTheme = 'dark';});
  await expect.poll(() => chart.locator('svg').evaluate(node => node.getBoundingClientRect().width)).toBeLessThanOrEqual(390);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  const facts = await page.getByRole('combobox',{name:'查看范围',exact:true}).evaluate(node => ({font:parseFloat(getComputedStyle(node).fontSize),height:node.getBoundingClientRect().height}));
  assert.ok(facts.font >= 16 && facts.height >= 44,JSON.stringify(facts));
  const button = await page.getByRole('button',{name:'公园慢跑',exact:true}).evaluate(node => ({height:node.getBoundingClientRect().height,slot:node.getAttribute('data-slot')}));
  assert.ok(button.height >= 44);assert.equal(button.slot,'button');
  await page.screenshot({path:join(source,'.review-results/xunji-log-390-dark.png'),fullPage:true});
  assert.deepEqual(errors,[]);
});
