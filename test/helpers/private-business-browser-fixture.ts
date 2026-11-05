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
import {confirmDiscard,verifyPersonalPresentations,presentationDensity} from './personal-workspace-browser-fixture.ts';

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
 ['overview','/personal','总览'],['search','/personal/search','统一搜索'],['records','/personal/records','记录'],['inbox','/personal?page=inbox','收件箱'],['todos','/personal?page=tasks','待办'],['finance','/personal/finance','财务'],['health','/personal/health','健康'],['growth','/personal/growth','学习与项目'],['journal','/personal/edit?type=journal','日记'],['articles','/personal/articles','文章'],['albums','/personal/albums','相册'],['schedule','/personal/schedule','日程'],['time','/personal/time','时间分配'],['people','/personal/people','人物'],['files','/personal/files','文件地图'],['reports','/personal/reports','回顾与报告'],['outputs','/personal/outputs','输出中心'],['chat','/personal/chat','AI 聊天'],['knowledge','/personal/knowledge','资料索引'],['rag','/personal/rag','RAG 知识库'],['agents','/personal/agents','Agent'],['workflows','/personal/workflows','固定流程'],['executions','/personal/executions','执行历史'],['approvals','/personal/approvals','待审批'],['tools','/personal/tools','工具与连接'],['settings','/personal?modal=settings&panel=general','设置'],['ai-settings','/personal/settings/ai','AI 服务设置'],['database','/personal/settings/data','数据库与数据'],
] as const;
const families=[
 ['private-home','/personal','总览'],['private-projects','/personal?page=projects','项目'],['private-areas','/personal?page=areas','领域'],['private-journal','/personal/edit?type=journal','日记'],['private-finance','/personal/finance','财务'],['private-health','/personal/health','健康'],['private-workflows','/personal/workflows','固定流程'],['private-tools','/personal/tools','工具与连接'],['private-data','/personal/settings/data','数据库与数据'],['private-chat','/personal/chat','AI 聊天'],['private-settings','/personal?modal=settings&panel=general','总览'],['private-outputs-dialog','/personal/outputs','输出中心'],
] as const;
export const privateCaptureCases=Object.freeze(families.flatMap(([key,path,heading])=>[1365,360,390,430].flatMap(width=>(['light','dark'] as const).map(theme=>Object.freeze({key,path,heading,width,theme,name:`${key}-${width}-${theme}.png`,dialog:key==='private-outputs-dialog'||key==='private-settings'?1:0})))));
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
/** Preserve the Header's first paint independently of control hydration. A control
 * that never appears, or appears with a wrong theme preference, still fails. */
export function assertFirstVisibleAppearance(palette:FirstVisibleTheme[],controls:FirstVisibleTheme[],theme:'light'|'dark',preference:'light'|'dark'|'system'){
 if(palette.length!==3||controls.length!==3||palette.some(frame=>frame.theme!==theme||frame.scheme!==theme||!Number.isFinite(frame.time)||frame.time<0)||controls.some(frame=>frame.control!=='visible'))throw Error('PRIVATE_FIRST_VISIBLE_THEME');
 assertFirstVisibleTheme(controls,theme,preference);
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
/** Passive init observer: never changes theme, storage, theme controls or CSS. */
export async function observeFirstVisibleTheme(context:BrowserContext){await context.addInitScript(()=>{
 type Frame={theme?:string;scheme:string;checked:string|null;control:'missing'|'hidden'|'visible';time:number};
 const w=window as unknown as {__lifeosFirstVisible?:Frame[];__lifeosFirstVisibleControls?:Frame[]};w.__lifeosFirstVisible=[];w.__lifeosFirstVisibleControls=[];
 const tick=()=>{
  const header=document.querySelector('header'),r=header?.getBoundingClientRect();
  if(header&&r&&r.width>0&&r.height>0&&getComputedStyle(header).visibility!=='hidden'){
   const root=document.documentElement,button=header.querySelector<HTMLButtonElement>('[data-slot="theme-toggle"]'),bounds=button?.getBoundingClientRect();
   const control:Frame['control']=!button?'missing':bounds&&bounds.width>0&&bounds.height>0&&getComputedStyle(button).visibility!=='hidden'?'visible':'hidden';
   const frame={theme:root.dataset.lifeosTheme,scheme:getComputedStyle(root).colorScheme,checked:button?.dataset.themePreference??null,control,time:performance.now()};
   if(w.__lifeosFirstVisible!.length<3)w.__lifeosFirstVisible!.push(frame);
   if(control==='visible'&&w.__lifeosFirstVisibleControls!.length<3)w.__lifeosFirstVisibleControls!.push(frame);
  }
  if(w.__lifeosFirstVisible!.length<3||w.__lifeosFirstVisibleControls!.length<3)requestAnimationFrame(tick);
 };requestAnimationFrame(tick);
 });}
export async function checkFirstVisibleTheme(page:Page,theme:'light'|'dark',preference:'light'|'dark'|'system',phase:FirstVisiblePhase){
 await page.waitForFunction(()=>{const w=window as unknown as {__lifeosFirstVisible?:unknown[];__lifeosFirstVisibleControls?:unknown[]};return w.__lifeosFirstVisible?.length===3&&w.__lifeosFirstVisibleControls?.length===3;});
 const observation=await page.evaluate(()=>{const w=window as unknown as {__lifeosFirstVisible:FirstVisibleTheme[];__lifeosFirstVisibleControls:FirstVisibleTheme[]};return{frames:w.__lifeosFirstVisible,controls:w.__lifeosFirstVisibleControls,timeOrigin:performance.timeOrigin};});
 const previous=firstVisibleTimeOrigins.get(page),timeOrigin=observation.timeOrigin,document=Number.isFinite(previous)&&Number.isFinite(timeOrigin)?previous===timeOrigin?'same':'new':'unknown';
 firstVisibleTimeOrigins.set(page,timeOrigin);try{assertFirstVisibleAppearance(observation.frames,observation.controls,theme,preference);}catch(error){if(error instanceof Error&&error.message==='PRIVATE_FIRST_VISIBLE_THEME')console.error('PRIVATE_FIRST_VISIBLE_DIAGNOSTIC '+JSON.stringify({...projectFirstVisibleDiagnostic(phase,observation.frames,document),controls:projectFirstVisibleDiagnostic(phase,observation.controls,document).frames}));throw error;}
}
type PrivateAppearancePhase='initial-system'|'dark-selection'|'dark-storage-readback'|'dark-reload'|'dark-navigation'|'os-media'|'cross-tab'|'todo-list'|'todo-dialog'|'todo-grid'|'journal'|'receipt-readback'|'denied-getItem'|'denied-setItem'|'denied-getter';
type PrivateAppearanceErrorKind='Error'|'TypeError'|'TimeoutError'|'AssertionError'|'other';
export function projectPrivateAppearanceFailure(phase:unknown,error:unknown){
 const phases:readonly PrivateAppearancePhase[]=['initial-system','dark-selection','dark-storage-readback','dark-reload','dark-navigation','os-media','cross-tab','todo-list','todo-dialog','todo-grid','journal','receipt-readback','denied-getItem','denied-setItem','denied-getter'];
 const fixedPhase=phases.includes(phase as PrivateAppearancePhase)?phase as PrivateAppearancePhase:'other';
 let errorKind:PrivateAppearanceErrorKind='other';
 try{
  if(error instanceof TypeError)errorKind='TypeError';
  else if(error instanceof Error){const name=error.name;if(name==='TimeoutError')errorKind='TimeoutError';else if(name==='AssertionError')errorKind='AssertionError';else errorKind='Error';}
 }catch{errorKind='other';}
 return {phase:fixedPhase,errorKind};
}
// The text source set is finite and reviewed. AST literals/JSX text are admitted
// exactly, never source prefixes, arbitrary file paths or body-derived expected data.
export const privateCaptureSources=[
 'src/ui-review/workspace.tsx','src/ui-review/task-table.tsx','src/ui-review/task-grid.tsx','src/ui-review/record-grid.tsx','src/ui-review/category-grid.tsx','src/ui-review/selectors.ts','src/ui-review/source-summary.tsx','src/ui-review/contract.ts',
 'src/workbench/shell.tsx','src/workbench/navigation.ts','src/workbench/draft-workspace.tsx','src/workbench/draft-contract.ts','src/workbench/domain.tsx','src/workbench/empty-state.tsx','src/workbench/entry-preview.tsx','src/workbench/entry-fields.ts','src/workbench/workflow.tsx','src/workbench/settings.tsx','src/workbench/theme-switch.tsx',
 'src/personal-candidate/workspace.tsx','src/personal-candidate/record-form.tsx','src/personal-candidate/relation-fields.tsx','src/personal-candidate/category-entries.tsx','src/personal-candidate/snapshot-panel.tsx','src/personal-candidate/persistent-views.tsx','src/personal-candidate/apple-source-notice.tsx','src/personal-candidate/task-editor.tsx','src/personal-candidate/connected-workspace.tsx',
 'src/personal-candidate/privacy.tsx','src/personal-candidate/live-workspace.tsx','app/layout.tsx','app/personal/[...section]/page.tsx',
] as const;
const normalize=(text:string)=>text.replace(/\s+/g,' ').trim();
export function captureSourceText(paths:readonly string[]=privateCaptureSources):Set<string>{
 if(paths.length!==privateCaptureSources.length||paths.some((p,i)=>p!==privateCaptureSources[i]))throw Error('PRIVATE_CAPTURE_SOURCE_DENIED');
 const out=new Set<string>();for(const path of paths){const tree=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,path.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);const visit=(node:ts.Node)=>{if(ts.isStringLiteralLike(node)||ts.isJsxText(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node)){const value=normalize(node.text);if(value)out.add(value);}ts.forEachChild(node,visit);};visit(tree);}return out;
}
async function capturePrivatePage(page:Page,row:typeof privateCaptureCases[number],entries:PrivateFixture['entries'],mark:PresentationMark){
 mark('capture-receipts');requireFixture();await assertPrivateReceipts(page,entries);
 mark('capture-dom');const facts=await page.evaluate(()=>{
  const forbidden=document.querySelectorAll('input[type="password"],input[name="otp"],input[autocomplete="one-time-code"],input[autocomplete="username"],input[autocomplete="current-password"],input[autocomplete="new-password"],#mfa-setup-key,canvas[aria-label="验证器绑定二维码"],[aria-label="备用恢复码"]').length;
  const texts:string[]=[],walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node:Node|null;
  while((node=walk.nextNode())){const parent=node.parentElement;if(!parent||parent.closest('script,style,noscript,option'))continue;const range=document.createRange();range.selectNode(node);if(!Array.from(range.getClientRects()).some(r=>r.width>0&&r.height>0))continue;const text=node.textContent?.replace(/\s+/g,' ').trim();if(text)texts.push(text);}
  return {forbidden,texts,values:Array.from(document.querySelectorAll<HTMLInputElement>('input,textarea,select')).map(n=>n.value),editable:Array.from(document.querySelectorAll('[contenteditable]:not([contenteditable="false"])')).map(n=>n.textContent??''),recordIds:Array.from(document.querySelectorAll('[data-record-id]')).map(n=>n.getAttribute('data-record-id')??''),heading:document.querySelector('h1')?.textContent??'',width:innerWidth,theme:document.documentElement.dataset.lifeosTheme??'',dialog:document.querySelectorAll('dialog[open],[role="dialog"]').length};
 });
 mark('capture-scope');assertPrivateCaptureScope({...facts,name:row.name,url:page.url()});
 mark('capture-content');const texts=captureSourceText(),values=new Set(['','on','all','journal','todo','open','in_progress','system','light','dark','all-day','CNY','Asia/Shanghai','input']);
 for(const value of ['0','1','2','3','—','我','本','L','LifeOS','1 项','1 项待办','待办导航','日记导航'])texts.add(value);for(const title of Object.values(draftTitles)){texts.add('新建'+title);texts.add('填写'+title+'草稿');}
 for(const entry of entries){const collect=(value:unknown)=>{if(typeof value==='string'){texts.add(normalize(value));values.add(value);}else if(value&&typeof value==='object')Object.values(value).forEach(collect);};collect(entry);texts.add(JSON.stringify(entry.source.original,null,2).replace(/\s+/g,' ').trim());texts.add('版本 '+entry.revision+' · ID '+entry.id);if('title'in entry.draft){texts.add(entry.draft.title+' · 版本 '+entry.revision);texts.add('打开任务：'+entry.draft.title);}}
 for(const value of texts)values.add(value);
 if(row.key==='private-journal'){
  texts.add('记录日期（可留空）');
  for(const entry of entries)if('title'in entry.draft)assert.ok(!facts.texts.includes(entry.draft.title),'other record titles are absent from Journal');
 }
 assertPrivateCaptureContent(facts,texts,values,row.key==='private-journal'?[]:entries.map(e=>e.id));
 mark('capture-image');const directory=resolve(process.env.RUNNER_TEMP!,'owner-personal-browser-screenshots');mkdirSync(directory,{recursive:true,mode:0o700});await page.screenshot({path:join(directory,row.name),fullPage:true});mark('capture-manifest');recordSyntheticCapture({name:row.name,url:page.url(),...await page.evaluate(()=>({width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.lifeosTheme??''}))});
}

function watchPrivateTransport(page:Page,{legacy=false}:{legacy?:boolean}={}){
 let forbidden=0,mutations=0,privateResponses=0,rsc=0;const pending:Promise<void>[]=[],fail=()=>{forbidden++;};
 const request=(r:BrowserRequest)=>{try{const u=new URL(r.url());if(u.origin!==privateOrigin){fail();return;}if(!['GET','HEAD'].includes(r.method()))mutations++;if(u.pathname.startsWith('/review/')&&!legacy||u.pathname==='/api/review-version'||/^\/api\/platform\/(?:finance|journal|calendar|search|timeline|ai|capture|import)(?:\/|$)/.test(u.pathname))fail();}catch{fail();}};
 const response=(r:import('@playwright/test').Response)=>{const u=new URL(r.url());if(u.origin!==privateOrigin)return;if(u.pathname==='/personal'||u.pathname.startsWith('/personal/'))pending.push((async()=>{const headers=await r.allHeaders();assert.match(headers['cache-control']??'',/private.*no-store/);privateResponses++;if(headers['content-type']?.includes('text/x-component'))rsc++;})().catch(()=>{forbidden++;}));};
 page.on('request',request);page.on('response',response);
 return {async close(){page.off('request',request);page.off('response',response);await Promise.all(pending);if(forbidden||mutations)console.error('PRIVATE_TRANSPORT_FAILURE '+JSON.stringify({forbidden:Math.min(forbidden,1000000),mutations:Math.min(mutations,1000000)}));assert.equal(forbidden,0,'private transport boundary');assert.equal(mutations,0,'UI group must not mutate business data');},facts:()=>({privateResponses,rsc})};
}
export async function readyHeading(page:Page,heading:string){
 if(heading==='设置'){await expect(page.getByRole('dialog',{name:'设置',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'安全与密码',exact:true})).toBeVisible();return;}
 await expect(page.getByRole('heading',{level:1,name:heading,exact:true})).toBeVisible();
 if(heading==='数据库与数据')await expect(page.locator('.lo-unavailable')).toBeVisible();
 else if(['健康','人物','财务','日程'].includes(heading)){
  // These modules are deliberately closed in the recovery fixture. Their real
  // content pages replace the former placeholders; a task action is unrelated.
  await expect(page.getByRole('button',{name:'新建待办',exact:true})).toHaveCount(0);
  if(heading==='健康'||heading==='人物'){
   await expect(page.locator('[data-personal-record-module]').getByRole('alert')).toHaveText('此模块尚未开放。');
   await expect(page.getByRole('button',{name:'新增'+heading,exact:true})).toBeDisabled();
  }else if(heading==='财务'){
   await expect(page.getByRole('heading',{level:3,name:'财务记录尚未开放',exact:true})).toBeVisible();
   await expect(page.getByRole('button',{name:'记一笔',exact:true})).toBeDisabled();
  }else{
   await expect(page.getByRole('heading',{level:2,name:'个人日程尚未开放',exact:true})).toBeVisible();
   await expect(page.getByRole('button',{name:'新建日程',exact:true})).toBeDisabled();
  }
 }
 else if(heading==='项目'||heading==='领域'){
  const create=page.locator('[data-category-grid="reui"]').getByRole('link',{name:'新建'+heading,exact:true});
  await expect(create).toBeVisible();
  await expect(create).toHaveAttribute('href','/personal/edit?type='+(heading==='项目'?'project':'domain'));
  await expect(page.getByRole('button',{name:'新建待办',exact:true})).toHaveCount(0);
 }
 else if(await page.locator('.lo-shell').count())await expect(page.getByRole('button',{name:'新建待办',exact:true})).toBeEnabled();
}
async function navigateDestination(page:Page,id:string,path:string,heading:string){
 await page.goto(privateOrigin+path,{waitUntil:'domcontentloaded'});await readyHeading(page,heading);
 await page.reload({waitUntil:'domcontentloaded'});await readyHeading(page,heading);
 if(['overview','todos','settings'].includes(id)){
  const name=id==='todos'?'事项':'总览';
  await expect(page.locator('aside [aria-current="page"][aria-label="'+name+'"]')).toHaveCount(1);
  if(id==='settings')await expect(page.locator('aside button[aria-label="设置"]')).toHaveAttribute('aria-expanded','true');
 }
 if(id==='journal'){
  await expect(page.getByLabel('标题',{exact:true})).toBeEnabled();
  await expect(page.getByText(/项目与行动总项|导出记录窗口/)).toHaveCount(0);
 }
}
export async function assertPrivateFixtureNavigation(page:Page){
 const navigation=page.getByRole('navigation',{name:'主导航',exact:true});
 await expect(navigation.getByRole('button')).toHaveText(['总览','事项','需求池']);
 await expect(navigation.getByRole('link')).toHaveText(['日记']);
 await expect(navigation.getByRole('link',{name:'日记',exact:true})).toHaveAttribute('href','/personal/journal');
 await expect(navigation.locator('summary')).toHaveCount(0);
 return navigation;
}
export async function verifyPrivateRouteBoundaries(f:PrivateFixture){
 const {page,browser,entries}=f;assert.deepEqual(Object.fromEntries(privateDestinations.map(([id,path])=>[id,path])),privateHrefs);
 const transport=watchPrivateTransport(page);let routes=0;
 try{
  for(const width of [1365,390]){await page.setViewportSize({width,height:width===1365?900:844});await page.goto(privateOrigin+'/personal',{waitUntil:'domcontentloaded'});
   await readyHeading(page,'总览');
   if(width===390)await page.getByRole('button',{name:'打开导航',exact:true}).click();
   const navigation=await assertPrivateFixtureNavigation(page);
   await navigation.getByRole('button',{name:'事项',exact:true}).click();await readyHeading(page,'待办');
   for(const [id,path,heading] of [...privateDestinations.filter(r=>r[0]!=='journal'),privateDestinations.find(r=>r[0]==='journal')!]){await navigateDestination(page,id,path,heading);routes++;}
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
const themeButtonSelector='header [data-slot="theme-toggle"]';
async function switchTheme(page:Page,mode:'light'|'dark'){
 await page.locator('header').getByRole('button',{name:mode==='light'?'切换到浅色模式':'切换到深色模式',exact:true}).click();
}
async function themeState(page:Page,theme:'light'|'dark',preference:'light'|'dark'|'system'){
 await expect.poll(()=>page.evaluate(()=>({theme:document.documentElement.dataset.lifeosTheme,scheme:getComputedStyle(document.documentElement).colorScheme,checked:document.querySelector<HTMLButtonElement>('header [data-slot="theme-toggle"]')?.dataset.themePreference}))).toEqual({theme,scheme:theme,checked:preference});
}
async function verifyPrivateAppearanceAndDraftsBody(f:PrivateFixture,setPhase:(phase:PrivateAppearancePhase)=>void){
 const {page,context,entries}=f,transport=watchPrivateTransport(page);
 try{
  setPhase('initial-system');await observeFirstVisibleTheme(context);await page.reload({waitUntil:'domcontentloaded'});await readyHeading(page,'总览');await checkFirstVisibleTheme(page,'light','system','initial-system');
  // Exercise both native keyboard activations on the actual Header control.
  const toggle=page.locator(themeButtonSelector);await toggle.focus();await expect(toggle).toBeFocused();await page.keyboard.press('Enter');await themeState(page,'dark','dark');assert.equal(await page.evaluate(key=>localStorage.getItem(key),themeStorageKey),'dark');
  await toggle.focus();await expect(toggle).toBeFocused();await page.keyboard.press('Space');await themeState(page,'light','light');assert.equal(await page.evaluate(key=>localStorage.getItem(key),themeStorageKey),'light');
  setPhase('dark-selection');await switchTheme(page,'dark');await themeState(page,'dark','dark');setPhase('dark-storage-readback');assert.equal(await page.evaluate(key=>localStorage.getItem(key),themeStorageKey),'dark');
  setPhase('dark-reload');await page.reload({waitUntil:'domcontentloaded'});await checkFirstVisibleTheme(page,'dark','dark','saved-dark-reload');await themeState(page,'dark','dark');
  // The retained Schedule bookmark tests first paint on a new document.
  setPhase('dark-navigation');await expect(page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('link',{name:'日程',exact:true})).toHaveCount(0);await page.goto(privateOrigin+'/personal/schedule',{waitUntil:'domcontentloaded'});await readyHeading(page,'日程');await checkFirstVisibleTheme(page,'dark','dark','saved-dark-navigation');
  setPhase('os-media');await page.emulateMedia({colorScheme:'dark'});await switchTheme(page,'light');await themeState(page,'light','light');await page.evaluate(key=>localStorage.removeItem(key),themeStorageKey);await page.reload({waitUntil:'domcontentloaded'});await themeState(page,'dark','system');await page.emulateMedia({colorScheme:'light'});await themeState(page,'light','system');
  // Storage events reach the other window only. The source is still dark after removeItem.
  setPhase('cross-tab');const sibling=await context.newPage();try{await sibling.goto(privateOrigin+'/personal/finance',{waitUntil:'domcontentloaded'});await switchTheme(sibling,'dark');await themeState(page,'dark','dark');await sibling.evaluate(key=>localStorage.removeItem(key),themeStorageKey);await themeState(page,'light','system');await switchTheme(sibling,'light');await switchTheme(sibling,'dark');await themeState(page,'dark','dark');await sibling.evaluate(()=>localStorage.clear());await themeState(page,'light','system');}finally{await sibling.close();}
  setPhase('todo-list');await page.goto(privateOrigin+'/personal?page=tasks',{waitUntil:'domcontentloaded'});await readyHeading(page,'待办');await page.getByRole('group',{name:'待办视图',exact:true}).getByRole('button',{name:'列表',exact:true}).click();const todo=entries[2],savedTitle='title'in todo.draft?todo.draft.title:'';
  setPhase('todo-dialog');await page.getByRole('button',{name:'展开详情：'+savedTitle,exact:true}).click();const detail=page.getByRole('dialog',{name:'待办详情',exact:true});await expect(detail.getByRole('heading',{name:'待办详情',exact:true})).toBeVisible();await expect(detail.locator('form')).toHaveCount(1);await expect(detail.getByRole('button',{name:'编辑待办',exact:true})).toHaveCount(0);const title=page.getByRole('dialog').getByLabel('标题',{exact:true});await title.fill('合成主题切换草稿');await page.emulateMedia({colorScheme:'dark'});await themeState(page,'dark','system');await expect(title).toHaveValue('合成主题切换草稿');await confirmDiscard(page,false,async()=>{await page.getByRole('button',{name:'关闭待办详情',exact:true}).click();});await expect(title).toHaveValue('合成主题切换草稿');await confirmDiscard(page,true,async()=>{await page.getByRole('button',{name:'关闭待办详情',exact:true}).click();});
  // Keep the dirty input focused: using the header theme button would deliberately blur-save.
  setPhase('todo-grid');await themeState(page,'dark','system');await page.getByRole('group',{name:'待办视图',exact:true}).getByRole('button',{name:'表格',exact:true}).click();await requireTaskGrid(page,savedTitle);await taskGridTitleCell(page,savedTitle).dblclick();const cell=taskGridInput(page);await expect(cell).toBeVisible();await cell.fill('合成主题原生草稿');await page.emulateMedia({colorScheme:'light'});await themeState(page,'light','system');await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});await page.evaluate(()=>{Reflect.deleteProperty(document,'visibilityState');document.dispatchEvent(new Event('visibilitychange'));});await expect(cell).toBeVisible();await expect(cell).toHaveValue('合成主题原生草稿');await cell.fill(savedTitle);await cell.press('Escape');
  setPhase('journal');await page.goto(privateOrigin+'/personal/edit?type=journal',{waitUntil:'domcontentloaded'});const journal=page.getByLabel('标题',{exact:true});await expect(journal).toBeEnabled();await journal.fill('合成未保存日记');await page.getByLabel(/^说明 \/ 正文/).fill('合成日记主题检查');await switchTheme(page,'dark');await expect(journal).toHaveValue('合成未保存日记');await confirmDiscard(page,false,async()=>{await page.getByRole('link',{name:'返回总览',exact:true}).click();},5000,'beforeunload');await expect(journal).toHaveValue('合成未保存日记');await confirmDiscard(page,true,async()=>{await page.getByRole('link',{name:'返回总览',exact:true}).click();},5000,'beforeunload');await readyHeading(page,'总览');setPhase('receipt-readback');await assertPrivateReceipts(page,entries);
 }finally{await transport.close();}
 // Only this fresh isolated context denies the theme key; sessionStorage remains real.
 for(const denied of ['getItem','setItem','getter'] as const){setPhase(denied==='getter'?'denied-getter':denied==='getItem'?'denied-getItem':'denied-setItem');const c=await f.browser.newContext({colorScheme:'light'});try{await c.addCookies(await context.cookies(privateOrigin));await c.addInitScript(({key,denied})=>{if(denied==='getter'){Object.defineProperty(window,'localStorage',{get(){throw new DOMException('denied','SecurityError');}});return;}const original=Storage.prototype[denied];Storage.prototype[denied]=function(...args:unknown[]){if(this===window.localStorage&&args[0]===key)throw new DOMException('denied','SecurityError');return Reflect.apply(original,this,args);};},{key:themeStorageKey,denied});const p=await c.newPage();await p.goto(privateOrigin+'/personal',{waitUntil:'domcontentloaded'});await switchTheme(p,'dark');await themeState(p,'dark','dark');if(denied!=='getItem')await expect(p.getByRole('status').filter({hasText:'浏览器未允许保存偏好'})).toBeVisible();await p.reload({waitUntil:'domcontentloaded'});await themeState(p,'light','system');await assertPrivateReceipts(p,entries);}finally{await c.close();}}
}
export async function verifyPrivateAppearanceAndDrafts(f:PrivateFixture){
 let phase:unknown='initial-system';
 try{return await verifyPrivateAppearanceAndDraftsBody(f,value=>{phase=value;});}
 catch(error){try{console.error('PRIVATE_APPEARANCE_FAILURE '+JSON.stringify(projectPrivateAppearanceFailure(phase,error)));}catch{}throw error;}
}

export type PrivatePresentationSurface='workspace'|'standalone-editor';
/** Explicit structures: the standalone journal editor deliberately has no main. */
export function privatePresentationScope(surface:PrivatePresentationSurface,dialog=false){
 if(!['workspace','standalone-editor'].includes(surface)||dialog&&surface!=='workspace')throw Error('PRIVATE_PRESENTATION_STRUCTURE');
 return {content:dialog?'dialog[open],[role="dialog"]':surface==='standalone-editor'?'[data-lifeos-surface="personal"]':'main',header:surface==='standalone-editor'?'[data-lifeos-surface="personal"] header':'header'};
}
type PrivateHeaderGeometry={height:number;display:string;wrap:string;gap:number;contained:boolean;childHeights:number[]};
export function assertPrivateHeaderGeometry(surface:PrivatePresentationSurface,width:number,f:PrivateHeaderGeometry,finePointer=true){
 const fail=()=>{throw Error('PRIVATE_HEADER_GEOMETRY');};
 if(surface==='workspace'){if(!(width>=1024?f.height===(finePointer?52:64):f.height>=56))fail();return;}
 // The editor's actual .bar is a wrapping flow Header, rather than the shell's
 // fixed-height row. Require its three real children, 44px minimum and no escape.
 if(surface!=='standalone-editor'||f.display!=='flex'||f.wrap!=='wrap'||f.gap!==12||!f.contained||f.childHeights.length!==3||f.childHeights.some(h=>!Number.isFinite(h)||h<=0)||!Number.isFinite(f.height)||f.height+1<Math.max(44,...f.childHeights)||f.height>f.childHeights.reduce((a,b)=>a+b,0)+f.gap*2+1)fail();
}
async function measurePrivatePresentation(page:Page,width:number,theme:'light'|'dark',mark:PresentationMark,dialog=false,surface:PrivatePresentationSurface='workspace'){
 mark('measure-ready');const selectors=privatePresentationScope(surface,dialog);
 await page.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))));
 // The workbench paints this fixed icon entirely inside the native select's
 // trailing padding. It is outside the area where the selected text is drawn.
 const chevronStroke=theme==='dark'?'a1a1aa':'52525b';
 const chevronImage=`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23${chevronStroke}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;
 mark('measure-dom');const facts=await page.evaluate(({dialog,selectors,chevronImage})=>{
  const visible=(n:Element)=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const root=document.documentElement,header=document.querySelector(selectors.header),scope=document.querySelector(selectors.content);
  if(!header||!scope)throw Error('PRIVATE_PRESENTATION_STRUCTURE');
  const h=header.getBoundingClientRect(),headerStyle=getComputedStyle(header),children=Array.from(header.children).map(n=>n.getBoundingClientRect());
  const nodes=Array.from(scope.querySelectorAll('p,small,th,td,label,input,textarea,select,h1,h2,h3')).filter(visible),controls=Array.from(header.querySelectorAll('[data-slot="theme-toggle"]')).filter(visible);
  const layers=(n:Element)=>{
   const result:ContrastLayer[]=[];
   for(let e:Element|null=n;e;e=e.parentElement){
    const s=getComputedStyle(e);
    const separateChevron=e===n&&e.matches('select:not([multiple]):not([size])')
      &&s.backgroundImage===chevronImage&&s.appearance==='none'
      &&s.backgroundOrigin==='padding-box'&&s.backgroundAttachment==='scroll'&&s.backgroundRepeat==='no-repeat'
      &&s.backgroundPosition==='calc(100% - 12px) 50%'&&s.backgroundSize==='16px 16px'
      &&s.direction==='ltr'&&s.writingMode==='horizontal-tb'&&parseFloat(s.paddingRight)>=40;
    result.push({backgroundColor:s.backgroundColor,backgroundImage:separateChevron?'none':s.backgroundImage,mixBlendMode:s.mixBlendMode,backgroundBlendMode:s.backgroundBlendMode,opacity:s.opacity,filter:s.filter,backdropFilter:s.backdropFilter});
   }
   return result;
  };
  // Transparent native choices have no text ink; retain their labels, hit targets and keyboard checks.
  return {finePointer:matchMedia('(pointer:fine)').matches,settings:scope.matches('.lo-settings-dialog'),overflow:root.scrollWidth>root.clientWidth,header:{height:h.height,display:headerStyle.display,wrap:headerStyle.flexWrap,gap:parseFloat(headerStyle.rowGap),contained:children.every(r=>r.x>=h.x-1&&r.y>=h.y-1&&r.right<=h.right+1&&r.bottom<=h.bottom+1),childHeights:children.map(r=>r.height)},theme:root.dataset.lifeosTheme,scheme:getComputedStyle(root).colorScheme,heading:parseFloat(getComputedStyle(document.querySelector('h1')!).fontSize),fonts:nodes.map(n=>({size:parseFloat(getComputedStyle(n).fontSize),form:n.matches('input,textarea,select'),shell:!!n.closest('.lo-shell'),metadata:n.matches('small,td:has([data-slot="data-grid-table-empty"]),.lo-result-count,.lo-source-summary,.lo-nav-count,.lo-task-date,.lo-task-project,.lo-board-view-note,.lo-board-move')})),targets:controls.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})),contrasts:nodes.filter(n=>(n.textContent?.trim()||n.matches('input,textarea,select'))&&!(n.matches('input[type="radio"],input[type="checkbox"]')&&getComputedStyle(n).opacity==='0')).map(n=>({foreground:getComputedStyle(n).color,layers:layers(n)})),dialog:dialog?{width:scope.getBoundingClientRect().width,height:scope.getBoundingClientRect().height,scroll:scope.scrollHeight>=scope.clientHeight}:null};
 },{dialog,selectors,chevronImage});
 mark('overflow');assert.equal(facts.overflow,false,'private horizontal overflow');mark('palette');assert.equal(facts.theme,theme);assert.equal(facts.scheme,theme);mark('header',[facts.header.height,facts.header.gap,facts.header.childHeights.length,...facts.header.childHeights.slice(0,3),Number(facts.header.contained),Number(facts.header.display==='flex'),Number(facts.header.wrap==='wrap')]);assertPrivateHeaderGeometry(surface,width,facts.header,facts.finePointer);const density=presentationDensity(width,facts.finePointer,surface);const fontMinimum=(n:typeof facts.fonts[number])=>n.form?(n.shell?density.form:16):n.metadata?density.metadata:density.body;mark('title',[facts.heading]);assert.equal(facts.heading>=density.title,true,'private title typography');mark('typography',[facts.fonts.filter(n=>n.size<fontMinimum(n)).length]);assert.equal(facts.fonts.every(n=>n.size>=fontMinimum(n)),true,'private readable typography');mark('hit-targets',[facts.targets.length,...facts.targets.slice(0,3).flatMap(n=>[n.width,n.height])]);assert.equal(facts.targets.length,1);assert.equal(facts.targets.every(n=>n.width>=density.hit&&n.height>=density.hit),true,'Header theme button hit target');
 for(const [index,c] of facts.contrasts.entries()){mark('contrast',[index,Number(c.layers.some(l=>Number(l.opacity??'1')!==1)),Number(c.layers.some(l=>(l.backgroundImage??'none')!=='none')),Number(c.layers.some(l=>(l.filter??'none')!=='none'||(l.backdropFilter??'none')!=='none')),Number(c.layers.some(l=>(l.mixBlendMode??'normal')!=='normal'||(l.backgroundBlendMode??'normal')!=='normal'))]);const contrast=renderedContrast(c.foreground,c.layers);mark('contrast',[index,contrast.contrast]);assert.equal(contrast.contrast>=4.5,true,'private rendered text contrast');}
 mark('dialog');
 if(facts.dialog){
  assert.equal(facts.dialog.width<=width,true);assert.equal(facts.dialog.scroll,true);
  const bounds=await page.getByRole('dialog').evaluate(dialog=>{
   const {left,right,top,bottom}=dialog.getBoundingClientRect();
   return {left,rightGap:innerWidth-right,top,bottomGap:innerHeight-bottom};
  });
  assert.ok(bounds.left>=(facts.settings&&width<640?0:15)&&bounds.rightGap>=(facts.settings&&width<640?0:15)&&bounds.top>=0&&bounds.bottomGap>=0,'dialog stays inside viewport margins');
  assert.ok(Math.abs(bounds.left-bounds.rightGap)<=2&&(facts.settings&&width<640||Math.abs(bounds.top-bounds.bottomGap)<=2),'dialog centers in viewport');
  await expect(page.getByRole('button',{name:facts.settings?'关闭':'返回页面',exact:true})).toBeVisible();
 }
 if(dialog){const button=page.getByRole('button',{name:facts.settings?'关闭':'返回页面',exact:true});await button.focus();await expect(button).toBeFocused();return;}
 mark('keyboard');const focus=page.locator(themeButtonSelector);await focus.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');assert.equal(await focus.evaluate(n=>document.activeElement===n&&n.matches(':focus-visible')&&getComputedStyle(n).outlineStyle!=='none'),true,'private keyboard focus');
}
async function privateLocalInteractions(page:Page,key:string){
 if(key==='private-finance'){
  const draft=page.getByRole('form',{name:'财务流水未保存草稿'});await draft.getByLabel('草稿：金额（元）',{exact:true}).fill('12.50');await page.getByRole('button',{name:'账户与对账',exact:true}).click();await page.getByRole('button',{name:'流水',exact:true}).click();await expect(draft.getByLabel('草稿：金额（元）',{exact:true})).toHaveValue('12.50');await draft.getByRole('button',{name:'取消草稿'}).click();await expect(draft.getByLabel('草稿：金额（元）',{exact:true})).toHaveValue('');
  await page.getByRole('form',{name:'财务筛选'}).getByRole('button',{name:'检查筛选'}).click();await expect(page.getByRole('status').filter({hasText:'没有执行查询'})).toBeVisible();
 }else if(key==='private-health'){await page.getByRole('button',{name:'添加一组',exact:true}).click();await page.getByLabel('第 1 组 次数',{exact:true}).fill('5');await page.getByRole('button',{name:'移除第 1 组',exact:true}).click();await expect(page.getByLabel('第 1 组 次数',{exact:true})).toHaveCount(0);}
 else if(key==='private-workflows'){await page.getByRole('tab',{name:'设计草稿',exact:true}).click();await page.getByRole('button',{name:'添加步骤',exact:true}).click();await page.getByRole('textbox',{name:'步骤1名称',exact:true}).fill('合成审核步骤');await page.getByRole('button',{name:'移除此步骤',exact:true}).click();await expect(page.getByRole('button',{name:'保存流程 · 待接入',exact:true})).toBeDisabled();}
 else if(key==='private-tools'){const details=page.locator('details').filter({has:page.locator('summary').filter({hasText:'授权与执行要求'})}).first();await details.locator('summary').click();await expect(details).toContainText('需确认来源');await details.locator('summary').click();await expect(page.getByRole('button',{name:'连接 · 未实现',exact:true}).first()).toBeDisabled();}
 else if(key==='private-chat')await expect(page.locator('main').getByRole('heading',{level:2,name:'AI 聊天尚未接入',exact:true})).toBeVisible();
 else if(key==='private-data'){
  await expect(page.getByRole('status')).toHaveText('数据管理入口已收起。');
  await expect(page.getByRole('link',{name:/管理|导出/})).toHaveCount(0);
 }else if(key==='private-settings'){
  await expect(page.getByRole('button',{name:'退出登录',exact:true})).toBeVisible();
  await expect(page.getByText(/登录状态|数据权限|数据管理与导出|分类管理|管理项目与领域/)).toHaveCount(0);
  const settings=page.getByRole('dialog',{name:'设置',exact:true}),bounds=await settings.boundingBox();
  assert.ok(bounds&&Math.abs(bounds.x+bounds.width/2-(await page.evaluate(()=>innerWidth))/2)<=1,'settings are centered in the viewport');
 }
 if(key==='private-finance'||key==='private-health'){
  const notice=page.getByText('本模块来源尚未连接，当前没有查询结果。',{exact:true});
  await expect(notice).toBeVisible();
  const fits=await notice.evaluate(element=>{
   const range=document.createRange();
   range.selectNodeContents(element);
   const lines=Array.from(range.getClientRects());
   return lines.length>0&&lines.every(rect=>{
    if(rect.left<0||rect.right>document.documentElement.clientWidth)return false;
    for(let parent=element.parentElement;parent;parent=parent.parentElement){
     if(getComputedStyle(parent).overflowX==='visible')continue;
     const left=parent.getBoundingClientRect().left+parent.clientLeft;
     if(rect.left<left-1||rect.right>left+parent.clientWidth+1)return false;
    }
    return true;
   });
  });
  assert.equal(fits,true,'empty state text fits the visible content width');
 }
}
// Bind the visible timestamp to the exact snapshot that this navigation fetched.
async function openPrivateSettings(page:Page,path:string,entries:PrivateFixture['entries']):Promise<string>{
 const [response]=await Promise.all([
  page.waitForResponse(response=>{
   const url=new URL(response.url());
   return url.origin===privateOrigin&&url.pathname==='/api/platform/personal/overview'
     &&/^\?today=\d{4}-\d{2}-\d{2}$/.test(url.search)&&response.request().method()==='GET'
     &&response.frame()===page.mainFrame();
  }),
  page.goto(privateOrigin+path,{waitUntil:'domcontentloaded'}),
 ]);
 assert.equal(response.ok(),true);
 assert.match((await response.allHeaders())['cache-control']??'',/private.*no-store/);
 const snapshot=await response.json();
 assertPrivateSnapshot(snapshot,entries);
 const {observedAt}=snapshot;
 if(typeof observedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(observedAt)
   ||!Number.isFinite(Date.parse(observedAt))||new Date(observedAt).toISOString()!==observedAt)throw Error('PRIVATE_SNAPSHOT_DENIED');
 return observedAt;
}
type PresentationStage='personal'|'navigation'|'heading'|'theme'|'interaction'|'measure-ready'|'measure-dom'|'overflow'|'palette'|'header'|'title'|'typography'|'hit-targets'|'contrast'|'dialog'|'keyboard'|'capture-receipts'|'capture-dom'|'capture-scope'|'capture-content'|'capture-image'|'capture-manifest'|'close-dialog'|'mobile-navigation'|'settings'|'receipts';
type PresentationMark=(stage:PresentationStage,metrics?:readonly number[])=>void;
const presentationCodes=['PRIVATE_PRESENTATION_STRUCTURE','PRIVATE_HEADER_GEOMETRY','CONTRAST_UNSUPPORTED_COLOR','CONTRAST_UNSUPPORTED_EFFECT','CONTRAST_BACKGROUND_UNRESOLVED','PRIVATE_CAPTURE_DENIED','PRIVATE_CAPTURE_SOURCE_DENIED','PRIVATE_SNAPSHOT_DENIED','SYNTHETIC_CAPTURE_DENIED'] as const;
// A same-shape synthetic filing footer exercises private overlay geometry without
// copying filing identity or adding personal content to public screenshot artifacts.
async function verifyWorkspaceViewport(f:PrivateFixture){
 const {page,entries}=f;
 for(const width of [1365,360,390,430])for(const theme of ['light','dark'] as const){
  await page.setViewportSize({width,height:width===1365?900:844});
  await page.emulateMedia({colorScheme:theme});
  await page.goto(privateOrigin+'/personal?page=tasks',{waitUntil:'domcontentloaded'});
  await readyHeading(page,'待办');
  await themeState(page,theme,'system');
  await page.getByRole('group',{name:'待办视图',exact:true}).getByRole('button',{name:'列表',exact:true}).click();
  await page.evaluate(()=>{
   if(document.querySelector('.lifeos-filing-footer'))throw Error('UNEXPECTED_FIXTURE_FOOTER');
   const footer=document.createElement('footer');footer.className='lifeos-filing-footer';footer.dataset.syntheticFilingProbe='';
   const link=document.createElement('a');link.href='#synthetic-filing';link.textContent='合成备案页脚';footer.append(link);document.body.append(footer);
   const probe=document.createElement('div');probe.dataset.syntheticScrollProbe='';
   const spacer=document.createElement('div');spacer.style.height='1600px';spacer.setAttribute('aria-hidden','true');
   const end=document.createElement('button');end.type='button';end.textContent='合成末端操作';probe.append(spacer,end);document.querySelector('.lo-main')!.append(probe);
   window.dispatchEvent(new Event('resize'));
  });
  const geometry=()=>page.evaluate(()=>{
   const rect=(selector:string)=>document.querySelector(selector)!.getBoundingClientRect().toJSON();
   const main=document.querySelector('.lo-main')!;
   return {height:innerHeight,document:document.documentElement.scrollHeight,overflowX:document.documentElement.scrollWidth>document.documentElement.clientWidth,scrollY,
    mainClient:main.clientHeight,mainScroll:main.scrollHeight,footer:rect('.lifeos-filing-footer'),bottom:rect('.lo-sidebar-bottom'),sidebar:rect('.lo-sidebar')};
  });
  try{
   await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
   const start=await geometry();assert.equal(start.document,start.height);assert.equal(start.overflowX,false);assert.ok(start.mainScroll>start.mainClient);
   await page.locator('.lo-main').evaluate(main=>{main.scrollTop=main.scrollHeight;window.scrollTo(0,999);});
   const end=await geometry();assert.equal(end.scrollY,0);assert.equal(end.document,end.height);assert.ok(Math.abs(end.footer.bottom-end.height)<=1);
   const last=await page.getByRole('button',{name:'合成末端操作',exact:true}).boundingBox();assert.ok(last&&last.y+last.height<=end.footer.top-8,'footer leaves content controls reachable');
   if(width===1365){
    assert.deepEqual(end.bottom,start.bottom,'content scroll does not move sidebar actions');assert.ok(end.bottom.bottom<=end.height);assert.ok(Math.abs(end.sidebar.right-end.footer.left)<=1);
    await page.getByRole('button',{name:'收起侧栏',exact:true}).click();const collapsed=await geometry();assert.equal(collapsed.sidebar.width,72);assert.ok(Math.abs(collapsed.footer.left-collapsed.sidebar.right)<=1);
    await page.getByRole('button',{name:'展开侧栏',exact:true}).click();
    for(const height of [300,240]){await page.setViewportSize({width,height});const short=await geometry();assert.equal(short.document,height);assert.ok(short.bottom.bottom<=height,'short viewport retains settings and collapse');}
   }else{
    assert.equal(end.footer.left,0);await page.getByRole('button',{name:'打开导航',exact:true}).click();const drawer=page.locator('.lo-mobile-sidebar');await expect(drawer).toBeVisible();await expect(drawer).toHaveCSS('pointer-events','auto');
    const settings=drawer.getByRole('button',{name:'设置',exact:true});
    const settingsAboveFooter=await settings.evaluate(button=>{
     const footer=document.querySelector<HTMLElement>('.lifeos-filing-footer')!;
     const previous=footer.style.pointerEvents;
     // Radix disables body pointer events. Temporarily let the footer receive
     // hit tests so a visually covering but click-through footer cannot pass.
     footer.style.pointerEvents='auto';
     try{const rect=button.getBoundingClientRect();return button.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));}
     finally{footer.style.pointerEvents=previous;}
    });
    assert.equal(settingsAboveFooter,true,'mobile settings paint above the filing footer');
    await settings.click();await expect(page).toHaveURL(privateOrigin+'/personal?page=tasks&modal=settings&panel=general');await expect(page.getByRole('dialog',{name:'设置',exact:true})).toBeVisible();
   }
   await expect(page.getByRole('button',{name:'帮助',exact:true,includeHidden:true})).toHaveCount(0);
   // The owner removed Help. Exercise the same live footer/overlay contract on
   // Settings; mobile already entered it through its navigation drawer above.
   if(width===1365)await page.getByRole('button',{name:'设置',exact:true}).click();
   const settingsDialog=page.getByRole('dialog',{name:'设置',exact:true});
   await expect(settingsDialog).toBeVisible();
   await expect(settingsDialog).toHaveCSS('pointer-events','auto');
   const overlayAboveFooter=await page.evaluate(()=>{
    const footer=document.querySelector<HTMLElement>('.lifeos-filing-footer')!,previous=footer.style.pointerEvents;
    footer.style.pointerEvents='auto';
    try{const rect=footer.getBoundingClientRect();return document.elementFromPoint(innerWidth-8,rect.y+rect.height/2)?.matches('[data-slot="dialog-overlay"]')??false;}
    finally{footer.style.pointerEvents=previous;}
   });
   assert.equal(overlayAboveFooter,true,'settings backdrop paints above the filing footer');
   await page.keyboard.press('Escape');await expect(settingsDialog).toHaveCount(0);await expect(page.locator('body')).toHaveCSS('pointer-events','auto');
  }finally{
   await page.evaluate(()=>{document.querySelector('[data-synthetic-filing-probe]')?.remove();document.querySelector('[data-synthetic-scroll-probe]')?.remove();window.dispatchEvent(new Event('resize'));});
  }
 }
 await page.setViewportSize({width:1365,height:900});await assertPrivateReceipts(page,entries);
}
export async function verifyPrivatePresentationMatrix(f:PrivateFixture){
 const {page,entries}=f;
 let row:typeof privateCaptureCases[number]|undefined,stage:PresentationStage='personal';
 let metrics:readonly number[]|undefined;
 const mark:PresentationMark=(value,numbers)=>{stage=value;metrics=numbers;};
 try{
 await verifyPersonalPresentations(page,entries);
 await verifyWorkspaceViewport(f);
 const transport=watchPrivateTransport(page);let cells=0;
 try{
  for(const item of privateCaptureCases){
   row=item;mark('navigation');
   await page.setViewportSize({width:row.width,height:row.width===1365?900:844});await page.emulateMedia({colorScheme:row.theme});
   if(row.key==='private-settings')await openPrivateSettings(page,row.path,entries);
   else await page.goto(privateOrigin+row.path,{waitUntil:'domcontentloaded'});
   mark('heading');await readyHeading(page,row.key==='private-settings'?'设置':row.heading);mark('theme');await themeState(page,row.theme,'system');mark('interaction');await privateLocalInteractions(page,row.key);
   if(row.key==='private-projects'||row.key==='private-areas'){const entry=entries[row.key==='private-projects'?1:0];await expect(page.locator('[data-category-grid="reui"]').getByText('title'in entry.draft?entry.draft.title:'',{exact:true})).toBeVisible();}
   if(row.key==='private-outputs-dialog'){await page.getByRole('button',{name:'查看录入界面',exact:true}).click();await expect(page.getByRole('dialog',{name:'输出中心录入界面',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'确认保存 · 待接入',exact:true})).toBeDisabled();}
   await measurePrivatePresentation(page,row.width,row.theme,mark,row.dialog===1,row.key==='private-journal'?'standalone-editor':'workspace');await capturePrivatePage(page,row,entries,mark);cells++;
   mark('close-dialog');if(row.key==='private-settings'){await page.getByRole('dialog',{name:'设置',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();}else if(row.dialog){await page.getByRole('button',{name:'关闭录入界面',exact:true}).click();await expect(page.getByRole('button',{name:'查看录入界面',exact:true})).toBeFocused();}
   mark('mobile-navigation');if(row.width<800&&row.key==='private-finance'){const menu=page.getByRole('button',{name:'打开导航',exact:true});await menu.click();const drawer=page.getByRole('dialog',{name:'手机导航',exact:true});await expect(drawer).toBeVisible();await drawer.getByRole('button',{name:'关闭导航',exact:true}).click();await expect(menu).toBeFocused();}
  }
  // Credential-node pages receive geometry/DOM checks, never capture permission.
  row=undefined;mark('settings');await page.goto(privateOrigin+'/personal/settings/ai',{waitUntil:'domcontentloaded'});await readyHeading(page,'AI 服务设置');await expect(page.getByLabel('API Key · 待安全配置',{exact:true})).toBeDisabled();await measurePrivatePresentation(page,430,'dark',mark);mark('receipts');await assertPrivateReceipts(page,entries);
 }finally{await transport.close();console.log('PRIVATE_PRESENTATION '+JSON.stringify({cells,...transport.facts()}));}
 }catch(error){
  try{
   const message=error instanceof Error?error.message:undefined;
   const reason=presentationCodes.find(code=>code===message)??projectPrivateAppearanceFailure(undefined,error).errorKind;
   console.error('PRIVATE_PRESENTATION_FAILURE '+JSON.stringify({family:row?.key??null,width:row?.width??null,theme:row?.theme??null,stage,reason,metrics:metrics?.slice(0,9).map(n=>Number.isFinite(n)?Math.round(Math.max(0,Math.min(n,1000000))*100)/100:null)}));
  }catch{}
  throw error;
 }
}
