import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';

// Internal rendering fixture only; no identity, API, persistence or source sync is claimed.
test('OPT-IN health fields and real chart rendering preserve unknowns, units and plan separation',{
  skip:process.env.RUN_PERSONAL_HEALTH_BROWSER_TESTS !== '1' && 'Requires an isolated internal fixture and native Chrome',
  timeout:180_000,
},async t => {
  const source = resolve(import.meta.dirname,'..');
  const root = await mkdtemp(join(tmpdir(),'lifeos-personal-health-fields-'));
  await mkdir(join(root,'app'),{recursive:true});
  await Promise.all([
    cp(join(source,'src'),join(root,'src'),{recursive:true}),
    ...['layout.tsx','globals.css','theme.css'].map(file => cp(join(source,'app',file),join(root,'app',file))),
    cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
    symlink(join(source,'node_modules'),join(root,'node_modules')),
    symlink(join(source,'components'),join(root,'components')),
  ]);
  await writeFile(join(root,'app/page.tsx'),`'use client';
import {useState} from 'react';
import {HealthFields} from '../src/personal-health/fields';
import {HealthEntriesSummary} from '../src/personal-health/summary';
import {HealthTrendView} from '../src/personal-health/trend';
import {emptyHealthFields,healthMetricLabels} from '../src/personal-health/presentation';
import {normalizeHealthPersonalFields} from '../src/personal-health/domain';
import {projectHealthTrend,healthMetrics,type HealthEntry,type HealthMetric} from '../src/personal-health/projection';
export default function Page(){
 const [fields,setFields]=useState(emptyHealthFields('body','UTC')),[entries,setEntries]=useState<HealthEntry[]>([]),[metric,setMetric]=useState<HealthMetric>('weight'),[error,setError]=useState('');
 return <main style={{maxWidth:900,margin:'auto',padding:16,font:'var(--lo-font-body)'}}><h1>内部健康字段验证</h1><HealthEntriesSummary entries={entries}/><form onSubmit={event=>{event.preventDefault();try{const saved=normalizeHealthPersonalFields(fields);setEntries(rows=>[...rows,{id:'internal-'+rows.length,revision:1,fields:saved}]);setError('');}catch(error){setError((error as Error).message);}}}><label>记录名称<input required value={fields.title} onChange={event=>setFields({...fields,title:event.target.value})}/></label><label>记录日期<input type="date" value={fields.occurredOn??''} onChange={event=>setFields({...fields,occurredOn:event.target.value||null})}/></label><HealthFields value={fields.personal} onChange={personal=>setFields({...fields,personal})}/><button>内部保存</button></form>{error&&<p role="alert">{error}</p>}<output aria-label="内部已保存字段">{JSON.stringify(entries)}</output><label>趋势指标<select value={metric} onChange={event=>setMetric(event.target.value as HealthMetric)}>{healthMetrics.map(value=><option key={value} value={value}>{healthMetricLabels[value]}</option>)}</select></label><HealthTrendView trend={projectHealthTrend(entries,metric)}/><style>{'output{display:block;overflow-wrap:anywhere;font-size:12px}main>form{display:grid;gap:12px}main>form>label{display:grid;gap:4px}main>form>label>input{min-height:44px;min-width:0;width:100%;box-sizing:border-box}'}</style></main>;
}`);
  const server = spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
  const stopped = once(server,'exit');
  let output = '';
  server.stdout.on('data',chunk => {output += String(chunk);});
  server.stderr.on('data',chunk => {output += String(chunk);});
  t.after(async () => {server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
  const origin = await new Promise<string>((accept,reject) => {
    const timer = setInterval(() => {const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);if (match) {clearInterval(timer);clearTimeout(timeout);accept(match[0]);}},30);
    const timeout = setTimeout(() => {clearInterval(timer);reject(Error('Health fixture startup timeout: '+output.slice(-1500)));},30_000);
    server.once('exit',() => {clearInterval(timer);clearTimeout(timeout);reject(Error('Health fixture exited: '+output.slice(-1500)));});
  });
  const browser = await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport:{width:1366,height:900},timezoneId:'UTC'});
  page.setDefaultTimeout(10_000);
  const errors:string[] = [];
  page.on('pageerror',error => errors.push(error.message));
  await page.goto(origin,{waitUntil:'networkidle',timeout:60_000});
  await expect(page.getByText(/暂无健康记录/)).toBeVisible();
  await page.getByLabel('记录名称',{exact:true}).fill('内部合成磅制测量');
  await page.getByLabel('记录日期',{exact:true}).fill('2026-11-05');
  await page.getByRole('combobox',{name:'体重单位',exact:true}).selectOption('lb');
  await page.getByLabel('体重',{exact:true}).fill('180.5');
  await page.getByRole('button',{name:'内部保存',exact:true}).click();
  const saved = JSON.parse(await page.getByLabel('内部已保存字段',{exact:true}).innerText());
  assert.deepEqual(saved[0].fields.personal.weight,{value:180.5,unit:'lb'});
  assert.equal(saved[0].fields.personal.bodyFatPercent,null);
  await expect(page.getByRole('img',{name:/^体重，lb，1 条有日期的记录/}).locator('svg')).toBeVisible();
  await page.getByLabel('记录类别',{exact:true}).selectOption('training');
  await expect(page.getByRole('combobox',{name:'完成状态',exact:true})).toHaveValue('planned');
  await page.getByLabel('训练分钟（可留空）',{exact:true}).fill('30');
  await page.getByRole('button',{name:'内部保存',exact:true}).click();
  await page.getByRole('combobox',{name:'趋势指标',exact:true}).selectOption('trainingMinutes');
  await expect(page.getByText(/1 条训练计划已排除/)).toBeVisible();
  await expect(page.getByText('当前筛选没有可绘制的已完成训练时长记录。',{exact:true})).toBeVisible();
  await page.getByRole('combobox',{name:'完成状态',exact:true}).selectOption('completed');
  await page.getByRole('button',{name:'内部保存',exact:true}).click();
  await expect(page.getByRole('img',{name:/^已完成训练时长，min，1 条有日期的记录/}).locator('svg')).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(() => {document.documentElement.dataset.lifeosTheme = 'dark';});
  const facts = await page.getByLabel('训练分钟（可留空）',{exact:true}).evaluate(node => ({font:parseFloat(getComputedStyle(node).fontSize),height:node.getBoundingClientRect().height}));
  assert.ok(facts.font >= 16 && facts.height >= 44,JSON.stringify(facts));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  const dateLabels = await page.getByRole('img',{name:/^已完成训练时长，min，1 条有日期的记录/}).locator('svg text').evaluateAll(nodes => nodes.filter(node => /^\d{4}-\d{2}-\d{2}$/.test(node.textContent ?? '') && getComputedStyle(node).visibility !== 'hidden').map(node => {const box = node.getBoundingClientRect();return {left:box.left,right:box.right};}).sort((a,b) => a.left-b.left));
  assert.ok(dateLabels.length > 0,'the actual date axis remains visible');
  for (let index=1;index<dateLabels.length;index++) assert.ok(dateLabels[index].left >= dateLabels[index-1].right,'date axis labels must not overlap on mobile');
  await mkdir(join(source,'.review-results'),{recursive:true});
  await page.screenshot({path:join(source,'.review-results/personal-health-fields-390-dark.png'),fullPage:true});
  assert.deepEqual(errors,[]);
});
