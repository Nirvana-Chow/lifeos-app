import {recordSyntheticCapture} from '../../scripts/synthetic-rendered-qualification.ts';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {chromium,expect,type Browser,type BrowserContext,type Cookie,type Page,type Request as BrowserRequest} from '@playwright/test';
import ts from 'typescript';
import type {PublicEntry} from '../../src/platform/contracts.ts';
import {personalEntryType} from '../../src/personal-candidate/service.ts';
import {draftTitles} from '../../src/workbench/draft-contract.ts';
import {privateHrefs} from '../../src/workbench/private-navigation.ts';
import {trustFixtureCA} from './owner-recovery-browser-fixture.ts';
import {renderedContrast,type ContrastLayer} from './personal-contrast.ts';
import {themeStorageKey} from '../../src/workbench/theme.ts';
import {requireTaskGrid,taskGridTitleCell,taskGridInput} from './task-grid-browser-driver.ts';
import {confirmDiscard,verifyPersonalPresentations} from './personal-workspace-browser-fixture.ts';

export const privateOrigin='https://review.example.test' as const;
const target='postgresql://lifeos_platform_candidate_runtime:fixture-ci-runtime-never-live@127.0.0.1:55432/lifeos_platform_test_local';
export const privateBrowserArgs=['--no-proxy-server','--disable-background-networking','--host-resolver-rules=MAP review.example.test 127.0.0.1, MAP * ~NOTFOUND'];
export type PrivateBrowserHandoff={origin:typeof privateOrigin;ownerId:'personal-review-user';spaceId:'personal-review-space';sourceSha:string;cookies:Cookie[];entries:readonly [PublicEntry,PublicEntry,PublicEntry]};
export type PrivateFixture={browser:Browser;context:BrowserContext;page:Page;entries:PrivateBrowserHandoff['entries']};
function requireFixture(){if(process.platform!=='linux'||process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||process.env.LIFEOS_FIXTURE_FRESH!=='approved-isolated-fixture'||process.env.LIFEOS_PLATFORM_TEST_DATABASE_URL!==target||process.env.RUN_OWNER_RECOVERY_BROWSER_TESTS!=='1'||!process.env.RUNNER_TEMP)throw Error('BROWSER_FIXTURE_UNAVAILABLE');}
/** Validate before any certificate/browser IO. Cookies are process-local only. */
export function assertPrivateHandoff(h:PrivateBrowserHandoff|undefined):asserts h is PrivateBrowserHandoff{
 try{
  if(!h||h.origin!==privateOrigin||h.ownerId!=='personal-review-user'||h.spaceId!=='personal-review-space'||!/^[0-9a-f]{40}$/.test(h.sourceSha)||!Array.isArray(h.entries)||h.entries.length!==3||new Set(h.entries.map(e=>e.id)).size!==3||!Array.isArray(h.cookies)||h.cookies.length!==1)throw Error();
  const types=['domain','project','todo'],titles=['合成浏览器领域','合成浏览器项目','合成浏览器待办更正'];
  const allowed=new Set(['','personal-manual-v1','personal-review-space','domain','project','todo','合成浏览器领域','合成浏览器项目','合成浏览器待办','隔离合成领域说明','隔离合成项目目标','仅用于隔离浏览器的合成补充内容','2030-11-02','open','idea',...h.entries.flatMap(e=>[e.id,e.source.id])]);
  const sourceValues=(v:unknown):boolean=>typeof v==='string'?allowed.has(v):v===null||typeof v==='boolean'||typeof v==='number'?true:typeof v==='object'&&!!v&&Object.values(v).every(sourceValues);
  for(const [i,e] of h.entries.entries())if(Object.keys(e).sort().join(',')!=='createdAt,draft,externalStatus,id,kind,revision,source,syncState,updatedAt'||personalEntryType(e,h.spaceId)!==types[i]||!('title'in e.draft)||e.draft.title!==titles[i]||Object.keys(e.source).sort().join(',')!=='asOf,externalId,id,original,system,version'||!sourceValues(e.source.original))throw Error();
  const timestamp=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString()===value;
  for(const e of h.entries)if(!timestamp(e.createdAt)||!timestamp(e.updatedAt)||!timestamp(e.source.asOf)||e.source.asOf!==e.createdAt||e.updatedAt<e.createdAt||!Number.isInteger(e.revision)||e.revision<1||e.revision>100)throw Error();
  assert.deepEqual(h.entries[0].draft,{title:titles[0],text:'隔离合成领域说明',occurredOn:null,disposition:'reference',personal:{type:'domain'}});
  const ref=(e:PublicEntry)=>({id:e.id,sourceId:e.source.id,revision:e.revision});
  assert.deepEqual(h.entries[1].draft,{title:titles[1],text:'隔离合成项目目标',occurredOn:null,disposition:'reference',personal:{type:'project',stage:'idea',purpose:null,nextStep:'',domain:ref(h.entries[0]),topics:[]}});
  assert.deepEqual(h.entries[2].draft,{title:titles[2],notes:'仅用于隔离浏览器的合成更正内容',dueOn:'2030-11-03',status:'in_progress',personal:{project:ref(h.entries[1]),domain:ref(h.entries[0]),topics:[]}});
  const c=h.cookies[0];if(c.name!=='__Secure-lifeos-platform-candidate.session_token'||c.domain!=='review.example.test'||c.path!=='/'||!c.secure||!c.httpOnly||c.sameSite!=='Strict'||!c.value||(c.expires!==-1&&(!Number.isFinite(c.expires)||c.expires<=Date.now()/1000)))throw Error();
 }catch{throw Error('BROWSER_PRIVATE_HANDOFF_UNAVAILABLE');}
}
export function assertPrivateSnapshot(value:unknown,entries:readonly PublicEntry[]):void{
 try{const s=value as {scope:string;truncated:boolean;total:number;items:PublicEntry[]};assert.equal(s.scope,'full-current-snapshot');assert.equal(s.truncated,false);assert.equal(s.total,3);assert.equal(s.items.length,3);assert.equal(new Set(s.items.map(e=>e.id)).size,3);assert.equal(new Set(entries.map(e=>e.id)).size,3);for(const e of s.items)assert.deepEqual(e,entries.find(expected=>expected.id===e.id));}catch{throw Error('PRIVATE_SNAPSHOT_DENIED');}
}
export async function privateRead(page:Page,path:string):Promise<any>{
 const value=await page.evaluate(async path=>{const r=await fetch(path,{credentials:'same-origin',cache:'no-store'});return {ok:r.ok,cache:r.headers.get('cache-control'),body:await r.json()};},path);
 assert.equal(value.ok,true);assert.match(value.cache??'',/private.*no-store/);return value.body;
}
export async function assertPrivateReceipts(page:Page,entries:readonly PublicEntry[]){assertPrivateSnapshot(await privateRead(page,'/api/platform/personal/overview?today=2030-11-02'),entries);}
export async function withPrivateBrowserFixture<T>(handoff:PrivateBrowserHandoff|undefined,run:(f:PrivateFixture)=>Promise<T>):Promise<T>{
 assertPrivateHandoff(handoff);requireFixture();
 const proof=JSON.parse(readFileSync('.image-source-proof.json','utf8')),runtime=JSON.parse(readFileSync('/run/lifeos-platform/runtime.json','utf8'));
 if(proof.sourceSha!==handoff.sourceSha||Object.hasOwn(runtime,'LIFEOS_PERSONAL_RECOVERY_APPROVAL'))throw Error('BROWSER_PRIVATE_HANDOFF_UNAVAILABLE');
 let browser:Browser|undefined,context:BrowserContext|undefined,untrust:(()=>void)|undefined;
 try{
  untrust=trustFixtureCA(join(process.env.RUNNER_TEMP!,'recovery-tls','ca.crt'));browser=await chromium.launch({channel:'chrome',headless:true,args:privateBrowserArgs});context=await browser.newContext({viewport:{width:1365,height:900},colorScheme:'light'});context.setDefaultTimeout(5000);context.setDefaultNavigationTimeout(10000);await context.addCookies(handoff.cookies);const page=await context.newPage();await page.goto(privateOrigin+'/personal',{waitUntil:'domcontentloaded'});
  const status=await privateRead(page,'/api/platform/personal/status');assert.equal(status.ownerId,'personal-review-user');assert.equal(status.scope,'personal-manual-candidate');assert.equal(status.spaceId,handoff.spaceId);assert.equal(status.storageVerified,true);assert.equal(status.writable,true);assert.deepEqual(status.allowedTypes,['todo','journal','project','domain','topic']);await assertPrivateReceipts(page,handoff.entries);
  return await run({browser,context,page,entries:handoff.entries});
 }finally{let failed=false;try{await context?.close();}catch{failed=true;}try{await browser?.close();}catch{failed=true;}try{untrust?.();}catch{failed=true;}if(failed)throw Error('BROWSER_FIXTURE_CLEANUP_FAILED');}
}

// Independent literals, calibrated against Task4. Do not derive expected routes from the map under test.
export const privateDestinations=[
 ['overview','/personal','总览'],['search','/personal/search','统一搜索'],['records','/personal/records','记录'],['inbox','/personal?page=inbox','收件箱'],['todos','/personal?page=tasks','待办'],['finance','/personal/finance','财务'],['health','/personal/health','运动健康'],['growth','/personal/growth','学习与项目'],['journal','/personal/edit?type=journal','日记'],['articles','/personal/articles','文章'],['albums','/personal/albums','相册'],['schedule','/personal/schedule','日历与日程'],['time','/personal/time','时间分配'],['people','/personal/people','人际与纪念日'],['files','/personal/files','文件地图'],['reports','/personal/reports','回顾与报告'],['outputs','/personal/outputs','输出中心'],['chat','/personal/chat','AI 聊天'],['knowledge','/personal/knowledge','资料索引'],['rag','/personal/rag','RAG 知识库'],['agents','/personal/agents','Agent'],['workflows','/personal/workflows','固定流程'],['executions','/personal/executions','执行历史'],['approvals','/personal/approvals','待审批'],['tools','/personal/tools','工具与连接'],['settings','/personal?page=settings','设置'],['ai-settings','/personal/settings/ai','AI 服务设置'],['database','/personal/settings/data','数据库与数据'],
] as const;
const families=[
 ['private-home','/personal','总览'],['private-projects','/personal?page=projects','项目'],['private-areas','/personal?page=areas','领域'],['private-journal','/personal/edit?type=journal','日记'],['private-finance','/personal/finance','财务'],['private-health','/personal/health','运动健康'],['private-workflows','/personal/workflows','固定流程'],['private-tools','/personal/tools','工具与连接'],['private-data','/personal/settings/data','数据库与数据'],['private-chat','/personal/chat','AI 聊天'],['private-settings','/personal?page=settings','设置'],['private-outputs-dialog','/personal/outputs','输出中心'],
] as const;
export const privateCaptureCases=Object.freeze(families.flatMap(([key,path,heading])=>[1365,360,390,430].flatMap(width=>(['light','dark'] as const).map(theme=>Object.freeze({key,path,heading,width,theme,name:`${key}-${width}-${theme}.png`,dialog:key==='private-outputs-dialog'?1:0})))));
export function assertPrivateCaptureScope(f:{name:string;url:string;width:number;theme:string;heading:string;dialog:number}):void{
 const row=privateCaptureCases.find(row=>row.name===f.name);if(!row||f.url!==privateOrigin+row.path||row.width!==f.width||row.theme!==f.theme||row.heading!==f.heading||row.dialog!==f.dialog)throw Error('PRIVATE_CAPTURE_DENIED');
}
export function assertPrivateCaptureContent(f:{forbidden:number;values:string[];texts:string[];editable:string[];recordIds:string[]},texts:ReadonlySet<string>,values:ReadonlySet<string>,recordIds:readonly string[]):void{
 if(f.forbidden!==0||!f.values.every(v=>values.has(v))||!f.texts.every(t=>texts.has(t))||f.editable.length!==0||!f.recordIds.every(id=>recordIds.includes(id)))throw Error('PRIVATE_CAPTURE_DENIED');
}
export type FirstVisibleTheme={theme:string|undefined;scheme:string;checked:string|null;control?:'missing'|'hidden'|'visible';time:number};
export function assertFirstVisibleTheme(frames:FirstVisibleTheme[],theme:'light'|'dark',preference:'light'|'dark'|'system'){
 if(!frames.length||frames.some(frame=>frame.theme!==theme||frame.scheme!==theme||frame.checked!==preference||!Number.isFinite(frame.time)||frame.time<0))throw Error('PRIVATE_FIRST_VISIBLE_THEME');
}
type FirstVisiblePhase='initial-system'|'saved-dark-reload'|'saved-dark-navigation';
type FirstVisibleDocument='new'|'same'|'unknown';
export function projectFirstVisibleDiagnostic(phase:unknown,frames:readonly unknown[],document:unknown){
 const fixedPhase=(['initial-system','saved-dark-reload','saved-dark-navigation'] as const).includes(phase as FirstVisiblePhase)?phase as FirstVisiblePhase:'other';
 const fixedDocument=document==='new'||document==='same'?document:'unknown';
 const enumValue=(value:unknown,allowed:readonly string[])=>value===undefined||value===null?'missing':allowed.includes(value as string)?value as string:'other';
 return {phase:fixedPhase,document:fixedDocument,frames:frames.slice(0,3).map(frame=>{
  const value=frame&&typeof frame==='object'?frame as Record<string,unknown>:{};
  const timeMs=typeof value.time==='number'&&Number.isFinite(value.time)&&value.time>=0&&value.time<=180000?Math.round(value.time):undefined;
  return {theme:enumValue(value.theme,['light','dark']),scheme:enumValue(value.scheme,['light','dark']),checked:enumValue(value.checked,['light','dark','system']),control:enumValue(value.control,['missing','hidden','visible']),...(timeMs===undefined?{}:{timeMs})};
 })};
}
const firstVisibleTimeOrigins=new WeakMap<Page,number>();
/** Passive init observer: never changes theme, storage, checked controls or CSS. */
export async function observeFirstVisibleTheme(context:BrowserContext){await context.addInitScript(()=>{
 const w=window as unknown as {__lifeosFirstVisible?:{theme?:string;scheme:string;checked:string|null;control:'missing'|'hidden'|'visible';time:number}[]};w.__lifeosFirstVisible=[];
 let seen=false,count=0;const tick=()=>{
  const header=document.querySelector('header'),r=header?.getBoundingClientRect();
  if(header&&r&&r.width>0&&r.height>0&&getComputedStyle(header).visibility!=='hidden'){
   const root=document.documentElement,radio=header.querySelector<HTMLInputElement>('input[type="radio"]'),label=radio?.closest('label'),labelRect=label?.getBoundingClientRect();
   const control=!radio?'missing':label&&labelRect&&labelRect.width>0&&labelRect.height>0&&getComputedStyle(label).visibility!=='hidden'?'visible':'hidden';
   w.__lifeosFirstVisible!.push({theme:root.dataset.lifeosTheme,scheme:getComputedStyle(root).colorScheme,checked:header.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value??null,control,time:performance.now()});seen=true;count++;
  }
  if(!seen||count<3)requestAnimationFrame(tick);
 };requestAnimationFrame(tick);
 });}
export async function checkFirstVisibleTheme(page:Page,theme:'light'|'dark',preference:'light'|'dark'|'system',phase:FirstVisiblePhase){
 await page.waitForFunction(()=>((window as unknown as {__lifeosFirstVisible?:unknown[]}).__lifeosFirstVisible?.length??0)>=3);
 const observation=await page.evaluate(()=>({frames:(window as unknown as {__lifeosFirstVisible:FirstVisibleTheme[]}).__lifeosFirstVisible,timeOrigin:performance.timeOrigin}));
 const previous=firstVisibleTimeOrigins.get(page),timeOrigin=observation.timeOrigin,document=Number.isFinite(previous)&&Number.isFinite(timeOrigin)?previous===timeOrigin?'same':'new':'unknown';
 firstVisibleTimeOrigins.set(page,timeOrigin);try{assertFirstVisibleTheme(observation.frames,theme,preference);}catch(error){if(error instanceof Error&&error.message==='PRIVATE_FIRST_VISIBLE_THEME')console.error('PRIVATE_FIRST_VISIBLE_DIAGNOSTIC '+JSON.stringify(projectFirstVisibleDiagnostic(phase,observation.frames,document)));throw error;}
}
// The text source set is finite and reviewed. AST literals/JSX text are admitted
// exactly, never source prefixes, arbitrary file paths or body-derived expected data.
export const privateCaptureSources=[
 'src/ui-review/workspace.tsx','src/ui-review/task-table.tsx','src/ui-review/task-grid.tsx','src/ui-review/record-grid.tsx','src/ui-review/selectors.ts','src/ui-review/source-summary.tsx','src/ui-review/contract.ts',
 'src/workbench/shell.tsx','src/workbench/navigation.ts','src/workbench/draft-workspace.tsx','src/workbench/draft-contract.ts','src/workbench/domain.tsx','src/workbench/empty-state.tsx','src/workbench/entry-preview.tsx','src/workbench/entry-fields.ts','src/workbench/workflow.tsx','src/workbench/settings.tsx','src/workbench/theme-switch.tsx',
 'src/personal-candidate/workspace.tsx','src/personal-candidate/record-form.tsx','src/personal-candidate/relation-fields.tsx','src/personal-candidate/category-entries.tsx','src/personal-candidate/snapshot-panel.tsx','src/personal-candidate/persistent-views.tsx','src/personal-candidate/apple-source-notice.tsx','src/personal-candidate/task-editor.tsx','src/personal-candidate/connected-workspace.tsx',
 'src/personal-candidate/privacy.tsx','app/layout.tsx','src/personal-candidate/projection.ts',
] as const;
const normalize=(text:string)=>text.replace(/\s+/g,' ').trim();
export function captureSourceText(paths:readonly string[]=privateCaptureSources):Set<string>{
 if(paths.length!==privateCaptureSources.length||paths.some((p,i)=>p!==privateCaptureSources[i]))throw Error('PRIVATE_CAPTURE_SOURCE_DENIED');
 const out=new Set<string>();for(const path of paths){const tree=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,path.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);const visit=(node:ts.Node)=>{if(ts.isStringLiteralLike(node)||ts.isJsxText(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node)){const value=normalize(node.text);if(value)out.add(value);}ts.forEachChild(node,visit);};visit(tree);}return out;
}
async function capturePrivatePage(page:Page,row:typeof privateCaptureCases[number],entries:PrivateFixture['entries']){
 requireFixture();await assertPrivateReceipts(page,entries);
 const facts=await page.evaluate(()=>{
  const forbidden=document.querySelectorAll('input[type="password"],input[name="otp"],input[autocomplete="one-time-code"],input[autocomplete="username"],input[autocomplete="current-password"],input[autocomplete="new-password"],#mfa-setup-key,canvas[aria-label="验证器绑定二维码"],[aria-label="备用恢复码"]').length;
  const texts:string[]=[],walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node:Node|null;
  while((node=walk.nextNode())){const parent=node.parentElement;if(!parent||parent.closest('script,style,noscript,option'))continue;const range=document.createRange();range.selectNode(node);if(!Array.from(range.getClientRects()).some(r=>r.width>0&&r.height>0))continue;const text=node.textContent?.replace(/\s+/g,' ').trim();if(text)texts.push(text);}
  return {forbidden,texts,values:Array.from(document.querySelectorAll<HTMLInputElement>('input,textarea,select')).map(n=>n.value),editable:Array.from(document.querySelectorAll('[contenteditable]:not([contenteditable="false"])')).map(n=>n.textContent??''),recordIds:Array.from(document.querySelectorAll('[data-record-id]')).map(n=>n.getAttribute('data-record-id')??''),heading:document.querySelector('h1')?.textContent??'',width:innerWidth,theme:document.documentElement.dataset.lifeosTheme??'',dialog:document.querySelectorAll('dialog[open],[role="dialog"]').length};
 });
 assertPrivateCaptureScope({...facts,name:row.name,url:page.url()});
 const texts=captureSourceText(),values=new Set(['','on','all','journal','todo','open','in_progress','system','light','dark','all-day','CNY','Asia/Shanghai','input']);
 for(const value of ['0','1','2','3','—','我','本','L','LifeOS','1 项','1 项待办','待办导航','日记导航'])texts.add(value);for(const title of Object.values(draftTitles)){texts.add('新建'+title);texts.add('填写'+title+'草稿');}
 for(const entry of entries){const collect=(value:unknown)=>{if(typeof value==='string'){texts.add(normalize(value));values.add(value);}else if(value&&typeof value==='object')Object.values(value).forEach(collect);};collect(entry);texts.add(JSON.stringify(entry.source.original,null,2).replace(/\s+/g,' ').trim());texts.add('版本 '+entry.revision+' · ID '+entry.id);if('title'in entry.draft){texts.add(entry.draft.title+' · 版本 '+entry.revision);texts.add('打开任务：'+entry.draft.title);}}
 for(const value of texts)values.add(value);assertPrivateCaptureContent(facts,texts,values,entries.map(e=>e.id));
 const directory=resolve(process.env.RUNNER_TEMP!,'owner-personal-browser-screenshots');mkdirSync(directory,{recursive:true,mode:0o700});await page.screenshot({path:join(directory,row.name),fullPage:true});recordSyntheticCapture({name:row.name,url:page.url(),...await page.evaluate(()=>({width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.lifeosTheme??''}))});
}

function watchPrivateTransport(page:Page,{legacy=false}:{legacy?:boolean}={}){
 let forbidden=0,mutations=0,privateResponses=0,rsc=0;const pending:Promise<void>[]=[],fail=()=>{forbidden++;};
 const request=(r:BrowserRequest)=>{try{const u=new URL(r.url());if(u.origin!==privateOrigin){fail();return;}if(!['GET','HEAD'].includes(r.method()))mutations++;if(u.pathname.startsWith('/review/')&&!legacy||u.pathname==='/api/review-version'||/^\/api\/platform\/(?:finance|journal|calendar|search|timeline|ai|capture|import)(?:\/|$)/.test(u.pathname))fail();}catch{fail();}};
 const response=(r:import('@playwright/test').Response)=>{const u=new URL(r.url());if(u.origin!==privateOrigin)return;if(u.pathname==='/personal'||u.pathname.startsWith('/personal/'))pending.push((async()=>{const headers=await r.allHeaders();assert.match(headers['cache-control']??'',/private.*no-store/);privateResponses++;if(headers['content-type']?.includes('text/x-component'))rsc++;})().catch(()=>{forbidden++;}));};
 page.on('request',request);page.on('response',response);
 return {async close(){page.off('request',request);page.off('response',response);await Promise.all(pending);assert.equal(forbidden,0,'private transport boundary');assert.equal(mutations,0,'UI group must not mutate business data');},facts:()=>({privateResponses,rsc})};
}
async function readyHeading(page:Page,heading:string){await expect(page.getByRole('heading',{level:1,name:heading,exact:true})).toBeVisible();if(await page.locator('.lo-shell').count()){if(heading==='设置')await expect(page.getByText('可写入',{exact:true})).toBeVisible();else await expect(page.getByRole('button',{name:'新建待办',exact:true})).toBeEnabled();}}
async function assertSelected(page:Page,id:string,path:string){
 if(path.includes('?page=')||id==='overview'){const name=id==='overview'?'总览':id==='todos'?'待办':id==='settings'?'设置':'收件箱';await expect(page.locator('.lo-header-context')).toHaveText(name);if(id==='settings')await expect(page.locator('.lo-sidebar-bottom button[aria-label="设置"]')).toHaveClass(/is-current/);else if(id!=='inbox')await expect(page.locator('nav [aria-current="page"]').filter({hasText:name})).toHaveCount(1);}
 else if(id!=='journal')await expect(page.locator('aside nav a[aria-current="page"][href="'+path+'"]')).toHaveCount(1);
}
async function navigateDestination(page:Page,id:string,path:string,heading:string,width:number){
 if(await page.locator('.lo-shell,[data-lifeos-surface="personal"]').count())await page.goto(privateOrigin+'/personal/finance',{waitUntil:'domcontentloaded'});
 if(width<800)await page.getByRole('button',{name:'打开导航',exact:true}).click();
 const nav=page.locator('nav[aria-label="工作台导航"]:visible');const link=nav.locator('a[href="'+path+'"]');
 if(!await link.isVisible())await nav.locator('summary').click();
 await link.click();await page.waitForURL(privateOrigin+path);await readyHeading(page,heading);await assertSelected(page,id,path);
 await page.reload({waitUntil:'domcontentloaded'});await readyHeading(page,heading);await assertSelected(page,id,path);
}
export async function verifyPrivateRouteBoundaries(f:PrivateFixture){
 const {page,browser,entries}=f;assert.deepEqual(Object.fromEntries(privateDestinations.map(([id,path])=>[id,path])),privateHrefs);
 const transport=watchPrivateTransport(page);let routes=0;
 try{
  for(const width of [1365,390]){await page.setViewportSize({width,height:width===1365?900:844});await page.goto(privateOrigin+'/personal/finance',{waitUntil:'domcontentloaded'});
   for(const [id,path,heading] of [...privateDestinations.filter(r=>r[0]!=='journal'),privateDestinations.find(r=>r[0]==='journal')!]){await navigateDestination(page,id,path,heading,width);routes++;}
  }
  for(const path of ['/personal/no-such-module','/personal/finance/extra','/personal/login','/personal/reference','/personal/data','/personal/capture','/personal/financ','/personal/%2Ffinance']){const r=await page.goto(privateOrigin+path,{waitUntil:'domcontentloaded'});assert.equal([400,404].includes(r?.status()??0),true);assert.equal(new URL(page.url()).origin,privateOrigin);await expect(page.getByRole('heading',{level:1,name:'财务',exact:true})).toHaveCount(0);}
  for(const [,path,heading] of privateDestinations.filter(([,path])=>!path.includes('?')&&path!=='/personal'))for(const query of ['?mode=synthetic-review','?ownerId=foreign&spaceId=foreign','?next=https%3A%2F%2Fevil.example&module=finance']){await page.goto(privateOrigin+path+query,{waitUntil:'domcontentloaded'});await readyHeading(page,heading);assert.equal(page.url(),privateOrigin+path+query);}
  await page.goto(privateOrigin+'/personal/finance',{waitUntil:'domcontentloaded'});await assertPrivateReceipts(page,entries);
 }finally{await transport.close();console.log('PRIVATE_ROUTES '+JSON.stringify({routes,...transport.facts()}));}
 const anonymous=await browser.newContext({viewport:{width:390,height:844}});try{const p=await anonymous.newPage();p.setDefaultTimeout(5000);for(const [,path] of privateDestinations){await p.goto(privateOrigin+path,{waitUntil:'domcontentloaded'});await p.waitForURL(privateOrigin+'/login');await expect(p.locator('main h2')).toHaveText('登录私人空间');}for(const path of ['/review/admin/reference','/review/admin/articles/workspace']){const denied=await p.goto(privateOrigin+path,{waitUntil:'domcontentloaded'});assert.equal(denied?.status(),404);}}finally{await anonymous.close();}
 const expired=await browser.newContext();try{await expired.addCookies(await f.context.cookies(privateOrigin));const p=await expired.newPage();await p.goto(privateOrigin+'/personal/finance',{waitUntil:'domcontentloaded'});await p.goto(privateOrigin+'/personal/settings/data',{waitUntil:'domcontentloaded'});await expired.clearCookies();await p.goBack({waitUntil:'domcontentloaded'});await p.waitForURL(privateOrigin+'/login');await expect(p.getByRole('heading',{level:1,name:'财务',exact:true})).toHaveCount(0);}finally{await expired.close();}
 const forged=await browser.newContext();try{await forged.addCookies([{name:'__Secure-lifeos-platform-candidate.session_token',value:'synthetic-invalid-signature',domain:'review.example.test',path:'/',secure:true,httpOnly:true,sameSite:'Strict'}]);const p=await forged.newPage();await p.goto(privateOrigin+'/personal/finance',{waitUntil:'domcontentloaded'});await p.waitForURL(privateOrigin+'/login');}finally{await forged.close();}
 // Explicit negative probes are separate from ordinary private navigation.
 const denial=await page.evaluate(async()=>{const paths=['/review/admin/reference','/review/admin/articles/workspace','/review/admin','/review/admin/tools','/review/admin/reference/extra','/review/admin/articles/workspace/extra','/review/admin/data','/api/review-version'];const facts=[];for(const path of paths){const r=await fetch(path,{cache:'no-store'});facts.push(r.status===404);}for(const path of ['/review/admin/reference','/review/admin/articles/workspace'])for(const method of ['POST','PUT','PATCH','DELETE']){const r=await fetch(path,{method,headers:{'content-type':'application/json'},body:'{}'});facts.push(r.status===404);}return facts;});assert.equal(denial.every(Boolean),true);
}
async function radio(page:Page,mode:'light'|'dark'|'system'){await page.locator('header').getByRole('radio',{name:mode==='light'?'浅色':mode==='dark'?'深色':'系统',exact:true}).check();}
async function themeState(page:Page,theme:'light'|'dark',preference:'light'|'dark'|'system'){
 await expect.poll(()=>page.evaluate(()=>({theme:document.documentElement.dataset.lifeosTheme,scheme:getComputedStyle(document.documentElement).colorScheme,checked:document.querySelector<HTMLInputElement>('header input[type="radio"]:checked')?.value}))).toEqual({theme,scheme:theme,checked:preference});
}
export async function verifyPrivateAppearanceAndDrafts(f:PrivateFixture){
 const {page,context,entries}=f,transport=watchPrivateTransport(page);
 try{
  await observeFirstVisibleTheme(context);await page.reload({waitUntil:'domcontentloaded'});await readyHeading(page,'总览');await checkFirstVisibleTheme(page,'light','system','initial-system');
  await radio(page,'dark');await themeState(page,'dark','dark');assert.equal(await page.evaluate(key=>localStorage.getItem(key),themeStorageKey),'dark');
  await page.reload({waitUntil:'domcontentloaded'});await checkFirstVisibleTheme(page,'dark','dark','saved-dark-reload');await themeState(page,'dark','dark');
  // Schedule uses ordinary anchor/document navigation, not a second injected initializer.
  await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('link',{name:'日程',exact:true}).click();await readyHeading(page,'日历与日程');await checkFirstVisibleTheme(page,'dark','dark','saved-dark-navigation');
  await page.emulateMedia({colorScheme:'dark'});await radio(page,'light');await themeState(page,'light','light');await radio(page,'system');await themeState(page,'dark','system');await page.emulateMedia({colorScheme:'light'});await themeState(page,'light','system');
  const sibling=await context.newPage();try{await sibling.goto(privateOrigin+'/personal/finance',{waitUntil:'domcontentloaded'});await radio(sibling,'dark');await themeState(page,'dark','dark');await sibling.evaluate(key=>localStorage.removeItem(key),themeStorageKey);await themeState(page,'light','system');await radio(sibling,'dark');await themeState(page,'dark','dark');await sibling.evaluate(()=>localStorage.clear());await themeState(page,'light','system');}finally{await sibling.close();}
  await page.goto(privateOrigin+'/personal?page=tasks',{waitUntil:'domcontentloaded'});await readyHeading(page,'待办');await page.getByRole('group',{name:'待办视图',exact:true}).getByRole('button',{name:'列表',exact:true}).click();const todo=entries[2],savedTitle='title'in todo.draft?todo.draft.title:'';
  await radio(page,'system');await page.getByRole('button',{name:'编辑待办：'+savedTitle,exact:true}).click();const title=page.getByRole('dialog').getByLabel('标题',{exact:true});await title.fill('合成主题切换草稿');await page.emulateMedia({colorScheme:'dark'});await themeState(page,'dark','system');await expect(title).toHaveValue('合成主题切换草稿');await confirmDiscard(page,false,async()=>{await page.getByRole('button',{name:'关闭待办编辑',exact:true}).click();});await expect(title).toHaveValue('合成主题切换草稿');await confirmDiscard(page,true,async()=>{await page.getByRole('button',{name:'关闭待办编辑',exact:true}).click();});
  await page.getByRole('group',{name:'待办视图',exact:true}).getByRole('button',{name:'表格',exact:true}).click();await requireTaskGrid(page,savedTitle);await taskGridTitleCell(page,savedTitle).dblclick();const cell=taskGridInput(page);await expect(cell).toBeVisible();await cell.fill('合成主题原生草稿');await radio(page,'light');await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});await page.evaluate(()=>{Reflect.deleteProperty(document,'visibilityState');document.dispatchEvent(new Event('visibilitychange'));});await expect(cell).toBeVisible();await expect(cell).toHaveValue('合成主题原生草稿');await cell.fill(savedTitle);await cell.press('Escape');
  await page.goto(privateOrigin+'/personal/edit?type=journal',{waitUntil:'domcontentloaded'});const journal=page.getByLabel('标题',{exact:true});await expect(journal).toBeEnabled();await journal.fill('合成未保存日记');await page.getByLabel(/^说明 \/ 正文/).fill('合成日记主题检查');await radio(page,'dark');await expect(journal).toHaveValue('合成未保存日记');await confirmDiscard(page,false,async()=>{await page.getByRole('link',{name:'返回总览',exact:true}).click();},5000,'beforeunload');await expect(journal).toHaveValue('合成未保存日记');await confirmDiscard(page,true,async()=>{await page.getByRole('link',{name:'返回总览',exact:true}).click();},5000,'beforeunload');await readyHeading(page,'总览');await assertPrivateReceipts(page,entries);
 }finally{await transport.close();}
 // Only this fresh isolated context denies the theme key; sessionStorage remains real.
 for(const denied of ['getItem','setItem','getter'] as const){const c=await f.browser.newContext({colorScheme:'light'});try{await c.addCookies(await context.cookies(privateOrigin));await c.addInitScript(({key,denied})=>{if(denied==='getter'){Object.defineProperty(window,'localStorage',{get(){throw new DOMException('denied','SecurityError');}});return;}const original=Storage.prototype[denied];Storage.prototype[denied]=function(...args:unknown[]){if(this===window.localStorage&&args[0]===key)throw new DOMException('denied','SecurityError');return Reflect.apply(original,this,args);};},{key:themeStorageKey,denied});const p=await c.newPage();await p.goto(privateOrigin+'/personal',{waitUntil:'domcontentloaded'});await radio(p,'dark');await themeState(p,'dark','dark');if(denied!=='getItem')await expect(p.getByRole('status').filter({hasText:'浏览器未允许保存偏好'})).toBeVisible();await p.reload({waitUntil:'domcontentloaded'});await themeState(p,'light','system');await assertPrivateReceipts(p,entries);}finally{await c.close();}}
}

export type PrivatePresentationSurface='workspace'|'standalone-editor';
/** Explicit structures: the standalone journal editor deliberately has no main. */
export function privatePresentationScope(surface:PrivatePresentationSurface,dialog=false){
 if(!['workspace','standalone-editor'].includes(surface)||dialog&&surface!=='workspace')throw Error('PRIVATE_PRESENTATION_STRUCTURE');
 return {content:dialog?'dialog[open],[role="dialog"]':surface==='standalone-editor'?'[data-lifeos-surface="personal"]':'main',header:surface==='standalone-editor'?'[data-lifeos-surface="personal"] header':'header'};
}
type PrivateHeaderGeometry={height:number;display:string;wrap:string;gap:number;contained:boolean;childHeights:number[]};
export function assertPrivateHeaderGeometry(surface:PrivatePresentationSurface,width:number,f:PrivateHeaderGeometry){
 const fail=()=>{throw Error('PRIVATE_HEADER_GEOMETRY');};
 if(surface==='workspace'){if(!(width===1365?f.height===64:f.height>=56))fail();return;}
 // The editor's actual .bar is a wrapping flow Header, rather than the shell's
 // fixed-height row. Require its three real children, 44px minimum and no escape.
 if(surface!=='standalone-editor'||f.display!=='flex'||f.wrap!=='wrap'||f.gap!==12||!f.contained||f.childHeights.length!==3||f.childHeights.some(h=>!Number.isFinite(h)||h<=0)||!Number.isFinite(f.height)||f.height+1<Math.max(44,...f.childHeights)||f.height>f.childHeights.reduce((a,b)=>a+b,0)+f.gap*2+1)fail();
}
async function measurePrivatePresentation(page:Page,width:number,theme:'light'|'dark',dialog=false,surface:PrivatePresentationSurface='workspace'){
 const selectors=privatePresentationScope(surface,dialog);
 await page.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))));
 const facts=await page.evaluate(({width,dialog,selectors})=>{
  const visible=(n:Element)=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const root=document.documentElement,header=document.querySelector(selectors.header),scope=document.querySelector(selectors.content);
  if(!header||!scope)throw Error('PRIVATE_PRESENTATION_STRUCTURE');
  const h=header.getBoundingClientRect(),headerStyle=getComputedStyle(header),children=Array.from(header.children).map(n=>n.getBoundingClientRect());
  const nodes=Array.from(scope.querySelectorAll('p,small,th,td,label,input,textarea,select,h1,h2,h3')).filter(visible),controls=Array.from(header.querySelectorAll('[data-lifeos-theme-control] label')).filter(visible);
  const layers=(n:Element)=>{const result:ContrastLayer[]=[];for(let e:Element|null=n;e;e=e.parentElement){const s=getComputedStyle(e);result.push({backgroundColor:s.backgroundColor,backgroundImage:s.backgroundImage,mixBlendMode:s.mixBlendMode,backgroundBlendMode:s.backgroundBlendMode,opacity:s.opacity,filter:s.filter,backdropFilter:s.backdropFilter});}return result;};
  return {overflow:root.scrollWidth>root.clientWidth,header:{height:h.height,display:headerStyle.display,wrap:headerStyle.flexWrap,gap:parseFloat(headerStyle.rowGap),contained:children.every(r=>r.x>=h.x-1&&r.y>=h.y-1&&r.right<=h.right+1&&r.bottom<=h.bottom+1),childHeights:children.map(r=>r.height)},theme:root.dataset.lifeosTheme,scheme:getComputedStyle(root).colorScheme,heading:parseFloat(getComputedStyle(document.querySelector('h1')!).fontSize),fonts:nodes.map(n=>({size:parseFloat(getComputedStyle(n).fontSize),form:n.matches('input,textarea,select')})),targets:controls.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})),contrasts:nodes.filter(n=>n.textContent?.trim()||n.matches('input,textarea,select')).map(n=>({foreground:getComputedStyle(n).color,layers:layers(n)})),dialog:dialog?{width:scope.getBoundingClientRect().width,height:scope.getBoundingClientRect().height,scroll:scope.scrollHeight>=scope.clientHeight}:null};
 },{width,dialog,selectors});
 assert.equal(facts.overflow,false,'private horizontal overflow');assert.equal(facts.theme,theme);assert.equal(facts.scheme,theme);assertPrivateHeaderGeometry(surface,width,facts.header);assert.equal(facts.heading>= (width===1365?28:24),true,'private title typography');assert.equal(facts.fonts.every(n=>n.size>= (n.form?16:14)),true,'private readable typography');assert.equal(facts.targets.length,3);assert.equal(facts.targets.every(n=>n.width>=44&&n.height>=44),true,'Header radio hit targets');
 for(const c of facts.contrasts){const contrast=renderedContrast(c.foreground,c.layers);assert.equal(contrast.contrast>=4.5,true,'private rendered text contrast');}
 if(facts.dialog){assert.equal(facts.dialog.width<=width,true);assert.equal(facts.dialog.scroll,true);await expect(page.getByRole('button',{name:'返回页面',exact:true})).toBeVisible();}
 if(dialog){const button=page.getByRole('button',{name:'返回页面',exact:true});await button.focus();await expect(button).toBeFocused();return;}
 const focus=page.locator('header input[type="radio"]:checked');await focus.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');assert.equal(await focus.evaluate(n=>{const label=n.closest('label');return document.activeElement===n&&n.matches(':focus-visible')&&!!label&&(getComputedStyle(n).outlineStyle!=='none'||getComputedStyle(label).outlineStyle!=='none'||getComputedStyle(label).boxShadow!=='none'||!!n.nextElementSibling&&getComputedStyle(n.nextElementSibling).outlineStyle!=='none');}),true,'private keyboard focus');
}
async function privateLocalInteractions(page:Page,key:string){
 if(key==='private-finance'){
  const draft=page.getByRole('form',{name:'财务流水未保存草稿'});await draft.getByLabel('草稿：金额（元）',{exact:true}).fill('12.50');await page.getByRole('button',{name:'账户与对账',exact:true}).click();await page.getByRole('button',{name:'流水',exact:true}).click();await expect(draft.getByLabel('草稿：金额（元）',{exact:true})).toHaveValue('12.50');await draft.getByRole('button',{name:'取消草稿'}).click();await expect(draft.getByLabel('草稿：金额（元）',{exact:true})).toHaveValue('');
  await page.getByRole('form',{name:'财务筛选'}).getByRole('button',{name:'检查筛选'}).click();await expect(page.getByRole('status').filter({hasText:'没有执行查询'})).toBeVisible();
 }else if(key==='private-health'){await page.getByRole('button',{name:'添加一组',exact:true}).click();await page.getByLabel('第 1 组 次数',{exact:true}).fill('5');await page.getByRole('button',{name:'移除第 1 组',exact:true}).click();await expect(page.getByLabel('第 1 组 次数',{exact:true})).toHaveCount(0);}
 else if(key==='private-workflows'){await page.getByRole('tab',{name:'设计草稿',exact:true}).click();await page.getByRole('button',{name:'添加步骤',exact:true}).click();await page.getByRole('textbox',{name:'步骤1名称',exact:true}).fill('合成审核步骤');await page.getByRole('button',{name:'移除此步骤',exact:true}).click();await expect(page.getByRole('button',{name:'保存流程 · 待接入',exact:true})).toBeDisabled();}
 else if(key==='private-tools'){const details=page.locator('details').filter({has:page.locator('summary').filter({hasText:'授权与执行要求'})}).first();await details.locator('summary').click();await expect(details).toContainText('需确认来源');await details.locator('summary').click();await expect(page.getByRole('button',{name:'连接 · 未实现',exact:true}).first()).toBeDisabled();}
 else if(key==='private-chat')await expect(page.getByText('AI 聊天尚未接入',{exact:true})).toBeVisible();
 else if(key==='private-data')await expect(page.getByRole('button',{name:'恢复 · 未验证',exact:true})).toBeDisabled();
}
export async function verifyPrivatePresentationMatrix(f:PrivateFixture){
 const {page,entries}=f;await verifyPersonalPresentations(page,entries);
 const transport=watchPrivateTransport(page);let cells=0;
 try{
  for(const row of privateCaptureCases){
   await page.setViewportSize({width:row.width,height:row.width===1365?900:844});await page.emulateMedia({colorScheme:row.theme});await page.goto(privateOrigin+row.path,{waitUntil:'domcontentloaded'});await readyHeading(page,row.heading);await radio(page,'system');await themeState(page,row.theme,'system');await privateLocalInteractions(page,row.key);
   if(row.key==='private-projects'||row.key==='private-areas'){const entry=entries[row.key==='private-projects'?1:0];await expect(page.getByRole('button').filter({hasText:'title'in entry.draft?entry.draft.title:''}).first()).toBeVisible();}
   if(row.key==='private-outputs-dialog'){await page.getByRole('button',{name:'查看录入界面',exact:true}).click();await expect(page.getByRole('dialog',{name:'输出中心录入界面',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'确认保存 · 待接入',exact:true})).toBeDisabled();}
   await measurePrivatePresentation(page,row.width,row.theme,row.dialog===1,row.key==='private-journal'?'standalone-editor':'workspace');await capturePrivatePage(page,row,entries);cells++;
   if(row.dialog){await page.getByRole('button',{name:'关闭录入界面',exact:true}).click();await expect(page.getByRole('button',{name:'查看录入界面',exact:true})).toBeFocused();}
   if(row.width<800&&row.key==='private-finance'){const menu=page.getByRole('button',{name:'打开导航',exact:true});await menu.click();const drawer=page.getByRole('dialog',{name:'手机导航',exact:true});await expect(drawer).toBeVisible();await drawer.getByRole('button',{name:'关闭导航',exact:true}).click();await expect(menu).toBeFocused();}
  }
  // Credential-node pages receive geometry/DOM checks, never capture permission.
  await page.goto(privateOrigin+'/personal/settings/ai',{waitUntil:'domcontentloaded'});await readyHeading(page,'AI 服务设置');await expect(page.getByLabel('API Key · 待安全配置',{exact:true})).toBeDisabled();await measurePrivatePresentation(page,430,'dark');await assertPrivateReceipts(page,entries);
 }finally{await transport.close();console.log('PRIVATE_PRESENTATION '+JSON.stringify({cells,...transport.facts()}));}
}
