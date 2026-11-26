import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {on} from 'node:events';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect,type Browser,type BrowserServer} from '@playwright/test';
import {requirements,type Requirement} from '../src/platform/requirements.ts';
import {requirementBinding,type RequirementItem,type RequirementsSnapshot} from '../src/requirements-candidate/service.ts';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';

const baseline=requirements();
const sha='a'.repeat(40),commit='https://github.com/Nirvana-Chow/lifeos-app/commit/'+sha;
const publishedEvidence:Requirement['evidence']=[
 {scope:'delivery-merged',ref:commit},
 {scope:'delivery-production-verified',ref:commit,resultHref:'https://lifeos.nirvanachow.com/personal?page=projects',
  verificationHref:`https://github.com/Nirvana-Chow/lifeos-app/blob/${sha}/docs/verification/fixture.md`},
];
const states=['done','planned','done','blocked','awaiting_review',null] as const;
const titles=['开发完成待上线','待开发','已上线待验收','上线且已验收','待工程审查','未标记'];
const items:RequirementItem[]=states.map((state,index)=>{
 const requirement:Requirement={...baseline.requirements[index],title:'合成需求 '+titles[index],
  status:index===3?'accepted':index===2?'awaiting_acceptance':'not_started',
  acceptance:index===3?{by:'user',baselineVersion:baseline.baselineVersion,ref:'synthetic-owner-acceptance'}:undefined,
  evidence:index===2||index===3?publishedEvidence:[]};
 return {id:requirement.id,requirement,sourceId:null,revision:0,baselineConflict:false,baselineBinding:requirementBinding(baseline,requirement.id),
  fields:{title:requirement.title,body:'合成说明',phaseId:requirement.roadmap!.phaseId,priority:requirement.roadmap!.priority,plannedStartOn:null,plannedEndOn:null,
   ...(state?{workflow:{state,purpose:'合成用途',nextStep:'合成下一步'}}:{})}};
});
const snapshot:RequirementsSnapshot={scope:'full-current-requirements-snapshot',total:items.length,truncated:false,observedAt:'2026-11-26T00:00:00Z',baseline,items};

test('OPT-IN native requirements route shows complete owner counts, filters and existing detail', {
 skip:process.env.RUN_REQUIREMENTS_SUMMARY_BROWSER_TESTS!=='1'&&'Requires isolated Next and Chromium',timeout:150_000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-requirements-summary-'));
 let server:FixtureProcess|undefined,browserProcess:FixtureProcess|undefined,browser:Browser|undefined,browserServer:BrowserServer|undefined;
 t.after(()=>cleanupAuthThemeFixture({root,server,browserProcess,browser,browserServer}));
 await mkdir(join(root,'app/personal'),{recursive:true});
 await Promise.all([
  ...['layout.tsx','globals.css','theme.css','personal/page.tsx'].map(file=>cp(join(source,'app',file),join(root,'app',file))),
  cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  cp(join(source,'src'),join(root,'src'),{recursive:true}),
  symlink(join(source,'node_modules'),join(root,'node_modules')),
  symlink(join(source,'components'),join(root,'components')),
 ]);
 await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
 await writeFile(join(root,'src/platform/runtime.ts'),'export const readPlatformPagePrincipal=async()=>({id:"synthetic-owner"});export const readPlatformPasswordCapability=async()=>false;\n');
 const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{
  cwd:root,detached:true,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],
 });
 server=trackAuthThemeProcess(child,true);
 let origin='',output='';
 for await(const [chunk] of on(child.stdout,'data',{signal:AbortSignal.timeout(30000)})){
  output=(output+String(chunk)).slice(-4000);
  const match=output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
  if(match&&/Ready in\b/.test(output)){origin=match;break;}
 }
 assert.ok(origin);
 browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
 browserProcess=trackAuthThemeProcess(browserServer.process());
 browser=await chromium.connect(browserServer.wsEndpoint());
 for(const width of [1365,390]){
  const page=await browser.newPage({viewport:{width,height:844},colorScheme:width===390?'dark':'light'});
  const errors:string[]=[],writes:string[]=[],outside:string[]=[],details:string[]=[];
  let snapshotReads=0, writable=true, ownerId='synthetic-owner';
  let switchAccountOnObservation=false, awaitingObservation=false;
  let fallback:'latest'|'missing'|null=null;
  let singleObservation:RequirementItem|null=null, delayedDetail:RequirementItem|null=null;
  let holdSnapshot:ReturnType<typeof Promise.withResolvers<void>>|null=null, holdDetail:ReturnType<typeof Promise.withResolvers<void>>|null=null;
  let currentItems=items;
  page.on('pageerror',error=>errors.push(error.message));
  let mode:'full'|'empty'|'error'|'partial'='full';
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname;
   if(url.origin!==origin){outside.push(url.origin);return route.abort();}
   if(!path.startsWith('/api/'))return route.continue();
   if(req.method()==='PATCH'){
    writes.push(path);
    const previous=currentItems.find(item=>path.endsWith('/requirements/'+item.id));
    assert.ok(previous);
    const command=req.postDataJSON();
    assert.equal(command.expectedRevision,previous.revision);
    assert.deepEqual(command.baselineBinding,previous.baselineBinding);
    assert.equal(command.spaceId,'synthetic-space');
    const project=(title:string,revision:number)=>({...previous,sourceId:previous.sourceId??'c4940508-10f1-4ee7-a5e1-6501b9be7411',revision,
     fields:{...command.fields,title},requirement:{...previous.requirement,title}});
    const receipt=project(command.fields.title,previous.revision+1);
    const observed=project('合成需求 独立读回',receipt.revision+1);
    singleObservation=fallback?{...observed,baselineConflict:true}:observed;
    const latest={...observed,fields:{...observed.fields,title:'合成需求 全量最新'},
     requirement:{...observed.requirement,title:'合成需求 全量最新'}};
    currentItems=fallback==='missing'?currentItems.filter(item=>item.id!==previous.id):
     currentItems.map(item=>item.id===previous.id?fallback?latest:observed:item);
    awaitingObservation=true;
    return route.fulfill({json:{entry:receipt,duplicate:false}});
   }
   if(req.method()!=='GET'){writes.push(path);return route.fulfill({status:405});}
   if(path.endsWith('/availability'))return route.fulfill({json:{configured:true,loginAllowed:true,transport:'ssh-loopback',origin}});
   if(path.endsWith('/status'))return route.fulfill({json:{scope:'personal-manual-candidate',ownerId,spaceId:'synthetic-space',storageVerified:true,writable,requirementsEnabled:true,allowedTypes:['todo']}});
   if(path.endsWith('/overview'))return route.fulfill({json:{scope:'full-current-snapshot',truncated:false,total:0,items:[],observedAt:snapshot.observedAt,today:url.searchParams.get('today')}});
   if(path.endsWith('/requirements/snapshot')){
    snapshotReads++;
    const snapshotItems=currentItems;
    if(holdSnapshot)await holdSnapshot.promise;
    if(mode==='error')return route.fulfill({status:503,json:{}});
    return route.fulfill({json:mode==='empty'?{...snapshot,total:0,items:[]}:mode==='partial'?{...snapshot,truncated:true}:{...snapshot,total:snapshotItems.length,items:snapshotItems}});
   }
   if(awaitingObservation&&singleObservation&&path.endsWith('/requirements/'+singleObservation.id)){
    awaitingObservation=false;
    if(switchAccountOnObservation)ownerId='foreign-owner';
    details.push(singleObservation.id);
    return route.fulfill({json:{entry:singleObservation}});
   }
   const entry=currentItems.find(item=>path.endsWith('/requirements/'+item.id));
   if(entry){
    details.push(entry.id);
    const responseEntry=delayedDetail?.id===entry.id?delayedDetail:entry;
    if(responseEntry===delayedDetail&&holdDetail)await holdDetail.promise;
    return route.fulfill({json:{entry:responseEntry}});
   }
   return route.fulfill({status:404,json:{}});
  });
  await page.goto(origin+'/personal?page=requirements',{waitUntil:'networkidle',timeout:60000});
  const pool=page.getByRole('region',{name:'需求池',exact:true});
  const counts=pool.getByRole('group',{name:'需求统计'});
  const all=counts.getByRole('button',{name:'总需求 6',exact:true});
  await expect(all).toBeVisible();
  await expect(all).toHaveAttribute('aria-pressed','true');
  const list=pool.getByRole('list',{name:'需求清单'});
  await expect(list.getByRole('listitem')).toHaveCount(6);
  await expect(pool.getByRole('group',{name:'需求视图'})).toHaveCount(0);
  await expect(pool.getByLabel('阶段',{exact:true})).toHaveCount(0);
  await expect(pool.getByRole('button',{name:'刷新需求',exact:true})).toHaveCount(0);
  await expect(pool.getByRole('button',{name:'新增需求',exact:true})).toHaveCount(0);
  await expect(pool.getByRole('button',{name:'管理视图',exact:true})).toHaveCount(1);
  const range=(name:string)=>counts.getByRole('button',{name,exact:true});
  await range('已完成 2').click();
  await expect(list.getByRole('button')).toHaveText(['合成需求 开发完成待上线','合成需求 已上线待验收']);
  await list.getByRole('button',{name:'合成需求 开发完成待上线',exact:true}).click();
  const detail=page.getByRole('dialog');
  await expect(detail.getByRole('textbox',{name:'需求标题',exact:true})).toHaveValue('合成需求 开发完成待上线');
  await expect(detail.getByRole('button',{name:'保存需求',exact:true})).toBeEnabled();
  assert.ok(details.includes(items[0].id));
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await range('未完成 4').click();
  await expect(list.getByRole('button')).toHaveText(['合成需求 待开发','合成需求 上线且已验收','合成需求 待工程审查','合成需求 未标记']);
  const readsBeforePatch=snapshotReads;
  await list.getByRole('button',{name:'合成需求 待开发',exact:true}).click();
  await expect(detail.getByRole('textbox',{name:'需求标题',exact:true})).toHaveValue('合成需求 待开发');
  await detail.getByLabel('推进状态',{exact:true}).selectOption('done');
  await detail.getByLabel('需求标题',{exact:true}).fill('合成需求 PATCH 回执');
  await detail.getByRole('button',{name:'保存需求',exact:true}).click();
  await expect(detail.getByRole('heading',{name:'合成需求 独立读回',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await expect(range('总需求 6')).toBeVisible();
  await expect(range('未完成 3')).toHaveAttribute('aria-pressed','true');
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(list.getByRole('button',{name:'合成需求 独立读回',exact:true})).toHaveCount(0);
  await range('已完成 3').click();
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(list.getByRole('button',{name:'合成需求 独立读回',exact:true})).toBeVisible();
  await expect(list.getByRole('button',{name:'合成需求 PATCH 回执',exact:true})).toHaveCount(0);
  assert.equal(snapshotReads,readsBeforePatch,'verified PATCH should use the observed row without another snapshot read');
  const readsBeforeFallback=snapshotReads;
  const title=detail.getByRole('textbox',{name:'需求标题',exact:true});
  const saveButton=detail.getByRole('button',{name:'保存需求',exact:true});
  await list.getByRole('button',{name:'合成需求 独立读回',exact:true}).click();
  await expect(title).toHaveValue('合成需求 独立读回');
  const olderRow=currentItems.find(item=>item.id===items[1].id)!;
  fallback='latest';
  await title.fill('合成需求 回退保存');
  await saveButton.click();
  await expect(page.locator('[data-requirements-page] button').filter({hasText:'合成需求 全量最新'})).toBeAttached();
  await expect(detail.getByRole('heading',{name:'合成需求 全量最新',exact:true})).toBeVisible();
  await expect(title).toHaveValue('合成需求 全量最新');
  assert.equal(snapshotReads,readsBeforeFallback+1);
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);

  delayedDetail=olderRow;
  holdDetail=Promise.withResolvers<void>();
  try{
   await list.getByRole('button',{name:'合成需求 全量最新',exact:true}).click();
   await expect(detail.getByText('正在读取当前需求…',{exact:true})).toBeVisible();
  }finally{
   holdDetail.resolve();
   holdDetail=null;
   delayedDetail=null;
  }
  await expect(title).toHaveValue('合成需求 全量最新');

  // A delayed refresh for the saved item must not replace a different detail.
  holdSnapshot=Promise.withResolvers<void>();
  try{
   await title.fill('合成需求 延迟回退');
   await saveButton.click();
   await expect.poll(()=>snapshotReads).toBe(readsBeforeFallback+2);
   const dismiss=async(dialog:import('@playwright/test').Dialog)=>{await dialog.accept();};
   page.on('dialog',dismiss);
   await page.keyboard.press('Escape');
   await expect(detail).toHaveCount(0);
   page.off('dialog',dismiss);
   await list.getByRole('button',{name:'合成需求 已上线待验收',exact:true}).click();
   await expect(title).toHaveValue('合成需求 已上线待验收');
  }finally{
   holdSnapshot.resolve();
   holdSnapshot=null;
  }
  await expect(saveButton).toBeEnabled();
  await expect(title).toHaveValue('合成需求 已上线待验收');

  fallback='missing';
  await title.fill('合成需求 已失效');
  await saveButton.click();
  await expect(detail).toHaveCount(0);
  await expect(counts.getByRole('button',{name:'总需求 5',exact:true})).toBeVisible();
  currentItems=[...currentItems,items[2]];
  fallback=null;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(all).toBeVisible();

  await all.click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.LIFEOS_REQUIREMENTS_EVIDENCE)await page.screenshot({path:join(process.env.LIFEOS_REQUIREMENTS_EVIDENCE,'requirements-'+width+'.png'),animations:'disabled'});
  for(const next of ['error','partial'] as const){
   mode=next;
   await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
   await expect(pool.getByText('需求读取暂不可用，当前内容尚未刷新。',{exact:true})).toBeVisible();
   await expect(counts).toHaveCount(0);
   await expect(list).toHaveCount(0);
   mode='full';
   await pool.getByRole('button',{name:'刷新需求',exact:true}).click();
   await expect(all).toBeVisible();
  }
  writable=false;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(pool.getByText('当前仅可查看需求。',{exact:true})).toBeVisible();
  await list.getByRole('button',{name:'合成需求 全量最新',exact:true}).click();
  await expect(detail.getByRole('button',{name:'保存需求',exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');
  await pool.getByRole('button',{name:'管理视图',exact:true}).click();
  await expect(pool.getByRole('button',{name:'新增需求',exact:true})).toBeDisabled();
  await pool.getByLabel('显示范围',{exact:true}).selectOption('completed');
  await expect(pool.locator('[data-requirement-id="'+items[3].id+'"]')).toBeVisible();
  await expect(pool.locator('[data-requirement-id="'+items[0].id+'"]')).toHaveCount(0);
  await pool.getByRole('button',{name:'返回需求清单',exact:true}).click();
  mode='empty';
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  for(const label of ['总需求','已完成','未完成'])await expect(counts.getByRole('button',{name:label+' 0',exact:true})).toBeVisible();
  await expect(pool.getByText('暂无需求。',{exact:true})).toBeVisible();
  await range('已完成 0').click();
  await expect(pool.getByText('暂无已完成需求。',{exact:true})).toBeVisible();
  await range('未完成 0').click();
  await expect(pool.getByText('暂无未完成需求。',{exact:true})).toBeVisible();
  await range('总需求 0').click();
  assert.deepEqual(errors,[]);
  mode='full';
  writable=true;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(all).toBeVisible();
  await list.getByRole('button',{name:'合成需求 开发完成待上线',exact:true}).click();
  await expect(detail.getByRole('textbox',{name:'需求标题',exact:true})).toHaveValue('合成需求 开发完成待上线');
  const readsBeforeAccountSwitch=snapshotReads;
  switchAccountOnObservation=true;
  await detail.getByLabel('需求标题',{exact:true}).fill('合成需求 切换前保存');
  await detail.getByRole('button',{name:'保存需求',exact:true}).click();
  await expect(counts).toHaveCount(0);
  await expect(list).toHaveCount(0);
  await expect(detail).toHaveCount(0);
  assert.equal(snapshotReads,readsBeforeAccountSwitch,'account change clears the existing snapshot before requesting any new rows');
  assert.deepEqual(writes,[items[1].id,items[1].id,items[1].id,items[2].id,items[0].id].map(id=>'/api/platform/personal/requirements/'+id));
  assert.deepEqual(outside,[]);
  await page.close();
 }
});
