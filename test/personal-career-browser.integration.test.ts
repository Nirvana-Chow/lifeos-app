import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';

// Internal synthetic rendering only. No personal data, API authority, persistence or owner acceptance.
test('OPT-IN career fields, JD board and pinned resume render and operate at desktop/mobile widths',{
 skip:process.env.RUN_PERSONAL_CAREER_BROWSER_TESTS!=='1'&&'Requires an isolated internal fixture and native Chrome',timeout:180_000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-personal-career-'));
 const normalRequirement='提供最近一次项目交付的原始记录';
 const normalAction='核对验收报告';
 const requirement='核对跨部门交付与整合证据，'.repeat(9)+'岗位要求末尾';
 const gap='当前仍需进一步核对原报告与交付范围。'.repeat(11)+'缺口末尾';
 const action='联系项目负责人，获取训练环境下的原始材料。'.repeat(11)+'行动末尾';
 await mkdir(join(root,'app/personal/career'),{recursive:true});
 await Promise.all([cp(join(source,'src'),join(root,'src'),{recursive:true}),...['layout.tsx','globals.css','theme.css'].map(file=>cp(join(source,'app',file),join(root,'app',file))),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components'))]);
 await Promise.all([
  cp(join(source,'app/personal/layout.tsx'),join(root,'app/personal/layout.tsx')),
  cp(join(source,'app/personal/career/page.tsx'),join(root,'app/personal/career/page.tsx')),
  writeFile(join(root,'src/platform/runtime.ts'),`
export const readPlatformPagePrincipal = async () => ({userId:'synthetic-career-owner'});
export const readPlatformPasswordCapability = async () => false;
export const readPlatformLoginCapability = async () => ({sessionDuration:false});`),
 ]);
 await writeFile(join(root,'app/page.tsx'),`'use client';
import {useState} from 'react';
import {CareerFields} from '../src/personal-career/CareerFields';
import {CareerBoard} from '../src/personal-career/CareerBoard';
import {CareerMatch} from '../src/personal-career/CareerMatch';
import {ResumePreview} from '../src/personal-career/ResumePreview';
import {emptyCareerPersonal,normalizeCareerPersonalFields,type CareerPersonalFields} from '../src/personal-career/domain';
import type {CareerRecord} from '../src/personal-career/projection';
export default function Page(){const [fields,setFields]=useState<CareerPersonalFields>({title:'',text:'',occurredOn:null,personal:emptyCareerPersonal()}),[records,setRecords]=useState<CareerRecord[]>([]),[error,setError]=useState(''),[opened,setOpened]=useState('');const opportunity=records.find(row=>row.fields.personal.careerKind==='opportunity');const options={career:records.map(row=>({id:row.id,revision:row.revision,source:{id:row.sourceId},draft:{...row.fields,disposition:'reference'}}))} as any;
return <main style={{maxWidth:1100,margin:'auto',padding:16,font:'var(--lo-font-body)'}}><h1>内部职业首版验证</h1><form onSubmit={e=>{e.preventDefault();try{const saved=normalizeCareerPersonalFields(fields);setRecords(rows=>[...rows,{id:crypto.randomUUID(),sourceId:crypto.randomUUID(),revision:1,fields:saved}]);setError('');}catch(e){setError((e as Error).message);}}}><label>记录名称<input required value={fields.title} onChange={e=>setFields({...fields,title:e.target.value})}/></label><label>原文<textarea aria-label="原文" value={fields.text} onChange={e=>setFields({...fields,text:e.target.value})}/></label><CareerFields value={fields.personal} options={options} onChange={personal=>setFields({...fields,personal})}/><button>内部保存</button></form>{error?<p role="alert">{error}</p>:null}<output aria-label="内部已保存字段">{JSON.stringify(records)}</output><CareerBoard records={records} onOpenRecord={row=>setOpened(row.fields.title)} onMoveRecord={(record,state)=>setRecords(rows=>rows.map(row=>row.id===record.id&&row.fields.personal.careerKind==='opportunity'?{...row,fields:{...row.fields,personal:{...row.fields.personal,applicationState:state}}}:row))}/><p aria-label="已打开记录">{opened}</p>{opportunity?<CareerMatch record={opportunity} records={records} onOpenRecord={row=>setOpened(row.fields.title)}/>:null}<ResumePreview records={records}/><style>{'main{display:grid;gap:24px}main>form{display:grid;gap:14px}main>form>label{display:grid;gap:4px}main>form>label>input,main>form>label>textarea{min-height:44px;width:100%;min-width:0;box-sizing:border-box;font-size:16px}output{display:block;overflow-wrap:anywhere;font-size:10px;max-height:80px;overflow:auto}'}</style></main>;
}`);
 const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 const stopped=once(server,'exit');let output='';server.stdout.on('data',chunk=>output+=String(chunk));server.stderr.on('data',chunk=>output+=String(chunk));t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await new Promise<string>((accept,reject)=>{const timer=setInterval(()=>{const m=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearInterval(timer);clearTimeout(timeout);accept(m[0]);}},30);const timeout=setTimeout(()=>{clearInterval(timer);reject(Error('Career fixture startup timeout: '+output.slice(-1500)));},30_000);server.once('exit',()=>{clearInterval(timer);clearTimeout(timeout);reject(Error('Career fixture exited: '+output.slice(-1500)));});});
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1366,height:900}});const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10_000);
 await page.goto(origin,{waitUntil:'networkidle',timeout:60_000});await expect(page.getByText(/暂无职位记录/)).toBeVisible();await expect(page.getByText(/暂无简历版本/)).toBeVisible();
 await page.getByLabel('记录名称',{exact:true}).fill('合成经历');await page.getByLabel('原文',{exact:true}).fill('内部事实原文');await page.getByLabel('学校 / 机构',{exact:true}).fill('内部学校');await page.getByLabel('学历 / 学位（未知可留空）',{exact:true}).fill('内部学位');await page.getByLabel('开始日期（已知的年、月或日）',{exact:true}).fill('2020');await page.getByLabel('经历状态',{exact:true}).selectOption('current');await page.getByRole('button',{name:'内部保存',exact:true}).click();
 let saved=JSON.parse(await page.getByLabel('内部已保存字段',{exact:true}).innerText());assert.deepEqual(saved[0].fields.personal.period,{startOn:'2020',endOn:null,status:'current'});assert.equal(saved[0].fields.personal.fieldOfStudy,null);
 await page.getByLabel('记录类别',{exact:true}).selectOption('resume');await page.getByLabel('记录名称',{exact:true}).fill('内部简历版本');await page.getByLabel('原文',{exact:true}).fill('内部简历摘要');await page.getByRole('checkbox',{name:'合成经历 · 版本 1',exact:true}).check();await page.getByRole('button',{name:'内部保存',exact:true}).click();await expect(page.getByRole('region',{name:'简历预览'}).getByRole('heading',{name:'合成经历'})).toBeVisible();await expect(page.getByRole('region',{name:'简历预览'})).toContainText('2020 – 至今');
 await page.getByLabel('记录类别',{exact:true}).selectOption('opportunity');await page.getByLabel('记录名称',{exact:true}).fill('内部职位 JD');await page.getByLabel('原文',{exact:true}).fill('内部 JD 原文：要求可核对的交付经历');await page.getByLabel('目标公司（可留空）',{exact:true}).fill('内部公司');await page.getByLabel('目标岗位（可留空）',{exact:true}).fill('内部岗位');await page.getByRole('button',{name:'添加岗位要求',exact:true}).click();
 await page.getByLabel('岗位要求 1',{exact:true}).fill(normalRequirement);
 await page.getByLabel('补证或行动 1',{exact:true}).fill(normalAction);
 await page.getByRole('button',{name:'添加岗位要求',exact:true}).click();
 await page.getByLabel('岗位要求 2',{exact:true}).fill(requirement);
 await page.getByRole('group',{name:'关联事实 2',exact:true}).getByRole('checkbox',{name:'合成经历 · 版本 1',exact:true}).check();
 await page.getByLabel('缺口 / 未知 2',{exact:true}).fill(gap);
 await page.getByLabel('补证或行动 2',{exact:true}).fill(action);await page.getByRole('button',{name:'内部保存',exact:true}).click();
 const evidence=page.getByRole('region',{name:'JD 要求与事实证据'});
 await expect(evidence.getByText(gap,{exact:true})).toBeVisible();
 await expect(evidence.getByRole('table')).toHaveAttribute('data-slot','data-grid-table');
 await expect(evidence.getByRole('rowheader',{name:requirement,exact:true})).toBeVisible();
 const factAction=evidence.getByRole('button',{name:'合成经历',exact:true});
 await factAction.focus();await page.keyboard.press('Enter');
 await expect(page.getByLabel('已打开记录',{exact:true})).toHaveText('合成经历');
 await expect(page.getByRole('region',{name:'已收藏',exact:true})).toContainText('内部职位 JD');await page.getByRole('region',{name:'已收藏',exact:true}).getByLabel('更新状态',{exact:true}).selectOption('preparing');await expect(page.getByRole('region',{name:'准备中',exact:true})).toContainText('内部职位 JD');await page.getByRole('button',{name:'内部职位 JD',exact:true}).click();await expect(page.getByLabel('已打开记录',{exact:true})).toHaveText('内部职位 JD');
 await page.evaluate(()=>{const getter=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'contentWindow')!.get!;Object.defineProperty(HTMLIFrameElement.prototype,'contentWindow',{configurable:true,get:function(this:HTMLIFrameElement){const win=getter.call(this) as Window|null;if(win&&this.dataset.careerPrintFrame==='true')win.print=()=>{(window as unknown as {careerPrinted:{body:string;title:string}}).careerPrinted={body:win.document.body.textContent??'',title:win.document.title};};return win;}});});
 await page.getByRole('button',{name:'打印此简历',exact:true}).click();const printed=await page.evaluate(()=>(window as unknown as {careerPrinted:{body:string;title:string}}).careerPrinted);assert.equal(printed.title,'内部简历版本');assert.match(printed.body,/合成经历/);assert.doesNotMatch(printed.body,/求职看板|内部职位 JD|内部保存/);await page.evaluate(()=>{document.querySelector<HTMLIFrameElement>('[data-career-print-frame]')?.contentWindow?.dispatchEvent(new Event('afterprint'));});
 await mkdir(join(source,'.review-results'),{recursive:true});await page.screenshot({path:join(source,'.review-results/personal-career-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.documentElement.dataset.lifeosTheme='dark';});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const coverage=await evidence.getByText('本人记录的要求、证据与待补行动；不生成资格判断或匹配分数。',{exact:true}).boundingBox();assert.ok(coverage&&coverage.width>=300,'mobile description uses the available evidence width: '+JSON.stringify(coverage));const facts=await page.getByLabel('目标岗位（可留空）',{exact:true}).evaluate(node=>({font:parseFloat(getComputedStyle(node).fontSize),height:node.getBoundingClientRect().height}));assert.ok(facts.font>=16&&facts.height>=44,JSON.stringify(facts));await expect(page.getByRole('region',{name:'JD 要求与事实证据'}).getByText(action,{exact:true})).toBeVisible();await page.screenshot({path:join(source,'.review-results/personal-career-mobile-dark.png'),fullPage:true});assert.deepEqual(errors,[]);

 saved=JSON.parse(await page.getByLabel('内部已保存字段',{exact:true}).innerText());
 const spaceId='synthetic-career-space',at='2030-11-02T00:00:00.000Z';
 const ownerRows=saved.map((row:{id:string;sourceId:string;revision:number;fields:unknown})=>({
  id:row.id,kind:'inbox',syncState:'draft',externalStatus:null,revision:row.revision,createdAt:at,updatedAt:at,
  draft:{...row.fields as object,disposition:'reference'},
  source:{id:row.sourceId,system:'website',externalId:row.id,version:1,asOf:at,
   original:{marker:'personal-manual-v1',type:'career',spaceId,input:{spaceId,confirmed:true,fields:row.fields}}},
 }));
 const reads:string[] = [],writes:string[] = [],getPaths:string[] = [];
 const focused=ownerRows.find((row:{draft:{title:string}})=>row.draft.title==='内部职位 JD');
 const proofDir=process.env.LIFEOS_CAREER_EVIDENCE_DIR;
 if(proofDir) await mkdir(proofDir,{recursive:true});
 await page.route('**/api/platform/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(request.method()!=='GET'){writes.push(request.method());return route.fulfill({status:405,json:{}});}
  getPaths.push(path);
  if(path.endsWith('/availability'))return route.fulfill({json:{configured:true,loginAllowed:true,transport:'ssh-loopback',origin}});
  if(path.endsWith('/status'))return route.fulfill({json:{scope:'personal-manual-candidate',ownerId:'synthetic-career-owner',spaceId,
   storageVerified:true,writable:false,allowedTypes:['todo','journal'],careerEnabled:true}});
  if(path.endsWith('/career/snapshot'))return route.fulfill({json:{scope:'full-current-snapshot',items:ownerRows,total:ownerRows.length,truncated:false,observedAt:at}});
  if(path.endsWith('/overview'))return route.fulfill({json:{scope:'full-current-snapshot',items:[],total:0,truncated:false,today:url.searchParams.get('today'),observedAt:at}});
  if(path.endsWith('/history'))return route.fulfill({json:{items:[]}});
  const entry=ownerRows.find((row:{id:string})=>path.endsWith('/career/'+row.id));
  if(entry){reads.push(entry.id);return route.fulfill({json:{entry}});}
  return route.fulfill({status:404,json:{}});
 });

 for(const width of [1366,390,430]){
  await page.setViewportSize({width,height:844});
  await page.goto(origin+'/personal/career',{waitUntil:'domcontentloaded',timeout:60_000});
  await expect(page).toHaveURL(origin+'/personal/career');
  const opening=page.getByRole('button',{name:'内部职位 JD',exact:true});
  await expect(opening).toBeVisible();
  const beforeOpen=getPaths.length;
  await opening.focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog');
  const report=dialog.getByRole('region',{name:'JD 要求与事实证据'});
  const table=report.getByRole('table');
  await expect(table).toHaveAttribute('data-slot','data-grid-table');
  await expect(table.getByRole('columnheader')).toHaveCount(width===1366?4:0);
  for(const title of [normalRequirement,requirement]){
   const header=table.getByRole('rowheader',{name:title,exact:true});
   await expect(header).toBeVisible();
   await expect(header).toHaveAttribute('scope',width===1366?'row':'rowgroup');
   if(width!==1366) assert.deepEqual(await header.evaluate(node=>{
    const table=node.closest('table')!;
    const detail=node.closest('tr')?.nextElementSibling?.querySelector('td');
    return {
     fullWidth:node.getBoundingClientRect().width>=table.getBoundingClientRect().width-2,
     associated:!!node.id&&detail?.getAttribute('headers')===node.id,
     labels:[...detail?.querySelectorAll('dt')??[]].map(label=>label.textContent),
    };
   }),{fullWidth:true,associated:true,labels:['已关联原事实','缺口 / 未知','补证或行动']});
  }
  for(const complete of [normalRequirement,normalAction,requirement,gap,action]){
   const value=table.getByText(complete,{exact:true});
   await value.scrollIntoViewIfNeeded();
   await expect(value).toBeVisible();
   await expect.poll(()=>value.evaluate(node=>{
    const range=document.createRange();
    range.selectNodeContents(node);
    const table=node.closest('table')!.getBoundingClientRect();
    return [...range.getClientRects()].every(rect=>rect.left>=table.left-1&&rect.right<=Math.min(table.right,innerWidth)+1);
   })).toBe(true);
  }
  await expect(table.getByRole('listitem').filter({hasText:'合成经历'})).toBeVisible();
  await expect(table.getByText('版本 1',{exact:true})).toBeVisible();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.ok(await dialog.evaluate(node=>node.scrollTop>0),'the actual career dialog scrolls to the long evidence');
  if(proofDir){
   await report.getByRole('heading').evaluate(heading=>heading.scrollIntoView({block:'start'}));
   await page.screenshot({path:join(proofDir,`synthetic-career-evidence-${width}.png`),animations:'disabled'});
   if(width<640){
    await table.getByText(action,{exact:true}).evaluate(value=>value.scrollIntoView({block:'end'}));
    await page.screenshot({path:join(proofDir,`synthetic-career-evidence-${width}-end.png`),animations:'disabled'});
   }
  }
  assert.deepEqual(getPaths.slice(beforeOpen),[
   '/api/platform/personal/career/'+focused.id,
   '/api/platform/personal/career/'+focused.id+'/history',
   '/api/platform/personal/status',
  ]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
 }
 assert.deepEqual(reads,[focused.id,focused.id,focused.id]);
 assert.deepEqual(writes,[]);
 assert.deepEqual(errors,[]);
});
