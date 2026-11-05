import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';

// Internal synthetic render only. Root must integrate the real owner-scoped PersonalService separately.
test('OPT-IN portfolio desktop/mobile editing keeps exact currency amounts, dates and unknowns',{
 skip:process.env.RUN_PERSONAL_PORTFOLIO_BROWSER_TESTS!=='1'&&'Requires isolated rendering fixture and native Chrome',timeout:180_000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-portfolio-fixture-'));
 await mkdir(join(root,'app'),{recursive:true});
 await Promise.all([cp(join(source,'src'),join(root,'src'),{recursive:true}),...['layout.tsx','globals.css','theme.css'].map(file=>cp(join(source,'app',file),join(root,'app',file))),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components'))]);
 await writeFile(join(root,'app/page.tsx'),`'use client';
import {useState} from 'react';
import {PortfolioFields} from '../src/personal-portfolio/fields';
import {PortfolioOverview} from '../src/personal-portfolio/overview';
import {emptyPortfolioPersonal,normalizePortfolioPersonalFields,type PortfolioKind,type PortfolioPersonalFields} from '../src/personal-portfolio/model';
import type {PortfolioRecord} from '../src/personal-portfolio/projection';
export default function Page(){const [fields,setFields]=useState<PortfolioPersonalFields>({title:'',text:'',occurredOn:null,personal:emptyPortfolioPersonal('account')}),[records,setRecords]=useState<PortfolioRecord[]>([]),[opened,setOpened]=useState(''),[error,setError]=useState('');return <main data-lifeos-surface style={{maxWidth:920,margin:'auto',padding:20}}><h1>内部持有字段验证</h1><PortfolioOverview records={records} onOpenRecord={row=>setOpened(row.id)} onCreateKind={kind=>setFields({title:'',text:'',occurredOn:null,personal:emptyPortfolioPersonal(kind)})}/><form style={{display:'grid',gap:16,marginTop:24}} onSubmit={event=>{event.preventDefault();try{const saved=normalizePortfolioPersonalFields(fields);setRecords(rows=>[...rows,{id:'internal-'+rows.length,sourceId:'internal-source',revision:1,fields:saved}]);setError('');}catch(e){setError((e as Error).message);}}}><label>记录名称<input required maxLength={240} value={fields.title} onChange={e=>setFields({...fields,title:e.target.value})}/></label><label>内部类别<select value={fields.personal.portfolioKind} onChange={e=>setFields({...fields,personal:emptyPortfolioPersonal(e.target.value as PortfolioKind)})}><option value="account">账户</option><option value="asset">资产</option><option value="investment">投资</option></select></label><PortfolioFields value={fields.personal} onChange={personal=>setFields({...fields,personal})} options={{}}/><button>内部保存</button></form>{error&&<p role="alert">{error}</p>}<output aria-label="内部保存内容" style={{display:'block',overflowWrap:'anywhere',fontSize:12,marginTop:24}}>{JSON.stringify(records)}</output><output aria-label="内部打开结果">{opened}</output><style>{'main>form>label{display:grid;gap:4px}main>form>label>input,main>form>label>select,main>form>button{min-height:44px;font-size:16px;min-width:0;width:100%;padding:8px;border:1px solid var(--input);border-radius:6px;background:var(--card)}'}</style></main>}
`);
 const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 const stopped=once(server,'exit');let output='';server.stdout.on('data',chunk=>output+=String(chunk));server.stderr.on('data',chunk=>output+=String(chunk));
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await new Promise<string>((accept,reject)=>{const timer=setInterval(()=>{const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearInterval(timer);clearTimeout(timeout);accept(match[0]);}},30);const timeout=setTimeout(()=>{clearInterval(timer);reject(Error(output.slice(-1800)));},30_000);server.once('exit',()=>{clearInterval(timer);clearTimeout(timeout);reject(Error(output.slice(-1800)));});});
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1366,height:900}}),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin,{waitUntil:'networkidle',timeout:60_000});
 await page.getByLabel('记录名称',{exact:true}).fill('内部手工账户');
 await page.getByLabel('手工余额（CNY）',{exact:true}).fill('0.01');
 await page.getByRole('button',{name:'内部保存',exact:true}).click();
 assert.deepEqual(JSON.parse(await page.getByLabel('内部保存内容').innerText()),[],'native date requirement blocks an undated known balance');
 await page.getByLabel('截至日期',{exact:true}).fill('2026-11-05');
 await page.getByRole('button',{name:'内部保存',exact:true}).click();
 let saved=JSON.parse(await page.getByLabel('内部保存内容').innerText());assert.equal(saved[0].fields.personal.balanceMinor,'1');assert.equal(saved[0].fields.personal.asOf,'2026-11-05');
 await expect(page.getByRole('button',{name:/内部手工账户/})).toContainText('CNY 0.01');
 await page.getByRole('button',{name:/内部手工账户/}).click();await expect(page.getByLabel('内部打开结果')).toHaveText('internal-0');
 await page.getByLabel('币种',{exact:true}).selectOption('JPY');await expect(page.getByLabel('手工余额（JPY）',{exact:true})).toHaveValue('');
 await page.getByLabel('手工余额（JPY）',{exact:true}).fill('1.1');await page.getByRole('button',{name:'内部保存',exact:true}).click();assert.equal(JSON.parse(await page.getByLabel('内部保存内容').innerText()).length,1);
 await page.getByLabel('手工余额（JPY）',{exact:true}).fill('-12');await page.getByRole('button',{name:'内部保存',exact:true}).click();
 await expect(page.getByRole('tabpanel')).toContainText('JPY -12');
 await page.getByRole('tab',{name:/投资/}).click();await page.getByRole('button',{name:'添加投资',exact:true}).click();
 await page.getByLabel('记录名称',{exact:true}).fill('内部手工持仓');await page.getByLabel('持有数量（可留空）',{exact:true}).fill('0001.2300');await page.getByRole('button',{name:'内部保存',exact:true}).click();
 saved=JSON.parse(await page.getByLabel('内部保存内容').innerText());assert.equal(saved[2].fields.personal.quantity,'0001.2300');assert.equal(saved[2].fields.personal.valuationMinor,null);assert.equal(saved[2].fields.personal.costMinor,null);
 await expect(page.getByRole('tabpanel')).toContainText('估值未知');await expect(page.getByRole('tabpanel')).toContainText('成本未知');
 const results=join(tmpdir(),'lifeos-portfolio-render');await mkdir(results,{recursive:true});
 await page.screenshot({path:join(results,'desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.documentElement.dataset.lifeosTheme='dark';});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const size=await page.getByLabel('持有数量（可留空）',{exact:true}).evaluate(node=>({font:parseFloat(getComputedStyle(node).fontSize),height:node.getBoundingClientRect().height}));assert.ok(size.font>=16&&size.height>=44,JSON.stringify(size));
 await page.getByRole('tab',{name:/投资/}).focus();await page.keyboard.press('ArrowLeft');await expect(page.getByRole('tab',{name:/资产/})).toHaveAttribute('aria-selected','true');
 await page.getByRole('button',{name:'添加资产',exact:true}).click();await page.getByLabel('记录名称',{exact:true}).fill('内部手工资产');await page.getByLabel('手工估值（CNY）',{exact:true}).fill('123.45');await page.getByLabel('估值日期',{exact:true}).fill('2026-11-05');await page.getByRole('button',{name:'内部保存',exact:true}).click();
 await expect(page.getByRole('tabpanel')).toContainText('CNY 123.45');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(results,'mobile-dark.png'),fullPage:true});assert.deepEqual(errors,[]);
});
