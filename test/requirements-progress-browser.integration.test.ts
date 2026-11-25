import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {requirements} from '../src/platform/requirements.ts';

import {requirementBinding} from '../src/requirements-candidate/service.ts';
import type {RequirementsSnapshot} from '../src/requirements-candidate/service.ts';
// Readonly public metadata fixture: no account service, credentials or real records.
test('OPT-IN requirement delivery filters, refresh and results render without reducing density',{
 skip:process.env.RUN_REQUIREMENTS_PROGRESS_BROWSER_TESTS!=='1'&&'Requires native Chrome and isolated Next fixture',timeout:180_000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-requirements-views-'));
 await mkdir(join(root,'app/personal'),{recursive:true});
 await Promise.all([
  cp(join(source,'src'),join(root,'src'),{recursive:true}),
  ...['layout.tsx','globals.css','theme.css'].map(file=>cp(join(source,'app',file),join(root,'app',file))),
  cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  symlink(join(source,'node_modules'),join(root,'node_modules')),
  symlink(join(source,'components'),join(root,'components')),
 ]);
 // Mount the normal workspace controller at the same URL the owner opens.
 await writeFile(join(root,'app/personal/page.tsx'),`import {LifeOSWorkspace} from '../../src/ui-review/workspace';
 import {readWorkspaceLocation} from '../../src/workbench/private-navigation';
 export default async function Page({searchParams}:{searchParams:Promise<{page?:string}>}){
  const {page}=readWorkspaceLocation(await searchParams);
  return <LifeOSWorkspace syncUrl initialPage={page} state={{status:'ready',data:{tasks:[],projects:[],areas:[],topics:[],today:'2026-11-25',asOf:'2026-11-25T00:00:00Z',coverage:'complete'}}} access={{authenticated:true,writable:false,loginAllowed:true,allowedTypes:['todo']}} viewPreferenceScope={JSON.stringify(['synthetic-owner','synthetic-space'])}/>;
 }`);
 const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 const stopped=once(server,'exit');
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await new Promise<string>((accept,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Fixture startup timeout')),30_000);server.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture exited'));});server.stdout.on('data',chunk=>{output+=String(chunk);const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});});
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 const baseline=requirements();
 const snapshot:RequirementsSnapshot={scope:'full-current-requirements-snapshot',total:baseline.requirements.length,truncated:false,observedAt:'2026-11-13T09:00:00Z',baseline,items:baseline.requirements.map((r,index)=>({id:r.id,revision:0,sourceId:null,baselineBinding:requirementBinding(baseline,r.id),baselineConflict:false,requirement:r,fields:{title:r.title,body:index===0?'开发队列顺序：2；下一步：继续核查\n【开发跟进 2026-11-13T09:00:00+08:00】\n合成检查已保存':index===1?'开发队列顺序：1':'',phaseId:r.roadmap!.phaseId,priority:r.roadmap!.priority,plannedStartOn:null,plannedEndOn:null,...(index<3?{workflow:{state:(['done','in_progress','planned'] as const)[index],purpose:'合成验证',nextStep:'合成下一步'}}:{})}}))};
 for(const width of [1365,390])for(const theme of ['light','dark'] as const)await t.test(`${width}x768 ${theme}`,async()=>{
  const page=await browser.newPage({viewport:{width,height:768},colorScheme:theme});t.after(()=>page.close());page.setDefaultTimeout(10000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/platform/personal/**',async route=>{const path=new URL(route.request().url()).pathname;await route.fulfill({json:path.endsWith('/status')?{scope:'personal-manual-candidate',ownerId:'synthetic-owner',spaceId:'synthetic-space',storageVerified:true,requirementsEnabled:true,requirementSupportEnabled:true,writable:false}:structuredClone(snapshot)});});
  await page.goto(origin+'/personal?page=requirements',{waitUntil:'networkidle',timeout:60000});const filter=page.getByRole('combobox',{name:'交付状态',exact:true});
  for(const label of ['尚未实现','进行中','已合并待上线','已上线','待核实'])await expect(filter.locator('option').filter({hasText:label})).toHaveCount(1);
  await filter.selectOption('unverified');
  await expect(page.locator('[data-requirement-id="'+snapshot.items[0].id+'"]')).toBeVisible();
  await filter.selectOption('live');
  await expect(page.locator('[data-requirement-id]')).toHaveCount(0);
  await filter.selectOption('all');
  await page.getByRole('combobox',{name:'表格分组'}).selectOption('none');
  assert.equal(await page.locator('[data-requirement-id]').first().getAttribute('data-requirement-id'),snapshot.items[1].id);
  await expect(page.getByText('顺序 1',{exact:false})).toBeVisible();
  const geometry=await page.locator('[data-slot="data-grid-table-viewport"]').evaluate(node=>{const box=node.getBoundingClientRect();return{height:box.height,visibleRows:[...node.querySelectorAll('tbody tr')].filter(row=>{const r=row.getBoundingClientRect();return r.top>=box.top&&r.bottom<=box.bottom}).length};});
  if(width===1365)assert.ok(geometry.visibleRows>=8,'Compact desktop retains at least eight complete rows: '+JSON.stringify(geometry));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:join(source,'.review-results',`requirements-progress-${width}-${theme}.png`)});
  await expect(page.getByText(/每日进展|开发路线|阶段路线图|反馈 Inbox|更新记录/)).toHaveCount(0);
  for(const destination of ['roadmap','feedback','updates']){
   await expect(page.locator('a[href="/personal/requirements/'+destination+'"]')).toHaveCount(0);
  }
  await expect(page.getByRole('link',{name:'人物只读总览（合并记录）',exact:true})).toHaveAttribute('href','https://github.com/Nirvana-Chow/lifeos-app/pull/93');
  await page.getByRole('button',{name:'看板视图',exact:true}).click();
  const first='[data-requirement-id="'+snapshot.items[0].id+'"]';
  await expect(page.locator('[data-requirements-progress="unverified"] '+first)).toHaveCount(1);
  await expect(page.getByText('下一步：合成下一步',{exact:true}).first()).toBeVisible();
  snapshot.items[0].fields.workflow!.state='in_progress';
  await page.getByRole('button',{name:'刷新需求',exact:true}).click();
  await expect(page.locator('[data-requirements-progress="in_progress"] '+first)).toHaveCount(1);
  snapshot.items[0].fields.workflow!.state='done';
  assert.deepEqual(errors,[]);
 });
});
