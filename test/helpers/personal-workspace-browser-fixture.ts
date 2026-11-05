import {recordSyntheticCapture} from '../../scripts/synthetic-rendered-qualification.ts';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {expect,type Page,type Route,type Dialog} from '@playwright/test';
import {renderedContrast,type ContrastLayer} from './personal-contrast.ts';
import {assertPublicLayout} from './owner-recovery-browser-fixture.ts';
import type {PublicEntry} from '../../src/platform/contracts.ts';
import {themeStorageKey} from '../../src/workbench/theme.ts';
import {requireTaskGrid,taskGridRoot,taskGridInput,taskGridTitleCell,taskGridViewport} from './task-grid-browser-driver.ts';

/** Approved density roles; standalone journal forms retain their explicit16px style. */
export function presentationDensity(width:number,finePointer:boolean,surface:'workspace'|'standalone-editor'='workspace'){
 const compact=width>=1024&&finePointer;
 return {compact,title:compact?22:width>=1024?28:24,body:14,metadata:compact?12:14,form:compact&&surface==='workspace'?14:16,hit:compact?32:44};
}
const origin='https://review.example.test';
const target='postgresql://lifeos_platform_candidate_runtime:fixture-ci-runtime-never-live@127.0.0.1:55432/lifeos_platform_test_local';
const synthetic={domain:'合成浏览器领域',project:'合成浏览器项目',initial:'合成浏览器待办',title:'合成浏览器待办更正',notes:'仅用于隔离浏览器的合成补充内容',editedNotes:'仅用于隔离浏览器的合成更正内容',date:'2030-11-02',editedDate:'2030-11-03'};
export const personalCaptureAllowedValues:readonly string[]=Object.freeze(['','on',synthetic.title,synthetic.editedNotes,synthetic.editedDate,'light','dark','system']);
export type PersonalCapture={platform:string;ci?:string;actions?:string;fresh?:string;database?:string;runnerTemp?:string;name:string;url:string;surface:boolean;forbidden:number;syntheticVisible:boolean;values:string[];allowedValues:readonly string[];recordIds:string[];expectedIds:string[];editorId:string;snapshotComplete:boolean};
/** Separate from the public auth screenshot helper: only exact synthetic routes/files. */
export function assertPersonalCapture(f:PersonalCapture):void{
 const deny=()=>{throw Error('PERSONAL_SCREENSHOT_DENIED');};
 if(f.platform!=='linux'||f.ci!=='true'||f.actions!=='true'||f.fresh!=='approved-isolated-fixture'||f.database!==target||!f.runnerTemp||!f.surface||f.forbidden!==0||!f.syntheticVisible||!f.snapshotComplete)return deny();
 const match=/^(workspace|editor)-(1365|360|390|430)-(light|dark)\.png$/.exec(f.name);if(!match)return deny();
 let u:URL;try{u=new URL(f.url);}catch{return deny();}
 if(u.origin!==origin||u.username||u.password||u.hash)return deny();
 if(match[1]==='workspace'?(u.pathname!=='/personal'||u.search!=='?page=tasks'):(u.pathname!=='/personal/edit'||u.search!=='?type=todo&id='+encodeURIComponent(f.editorId)))return deny();
 if(f.recordIds.length!==3||new Set(f.recordIds).size!==3||f.expectedIds.length!==3||new Set(f.expectedIds).size!==3||!f.recordIds.every(id=>f.expectedIds.includes(id))||!f.expectedIds.includes(f.editorId)||!f.values.every(v=>f.allowedValues.includes(v)))return deny();
}
/** Bound the whole click/dialog lifecycle, including a missing modal. */
export async function confirmDiscard(page:Pick<Page,'on'|'off'>,accept:boolean,click:(signal:AbortSignal)=>Promise<void>,timeoutMs=5000,expectedType:'confirm'|'beforeunload'='confirm'):Promise<void>{
 const controller=new AbortController(),cancelReason={},cleanupReason={};
 let received:Dialog|undefined,closed=false,dialogHandled=false,dismissedExpected=false,actionSettled=false,active=true,timer:ReturnType<typeof setTimeout>|undefined;
 let resolveClosed!:()=>void;
 const modalClosed=new Promise<void>(resolve=>{resolveClosed=resolve;});
 let resolveDialog!:()=>void,rejectDialog!:(error:unknown)=>void;
 const handled=new Promise<void>((resolve,reject)=>{resolveDialog=resolve;rejectDialog=reject;});
 const closedListener=(dialog:Dialog)=>{if(dialog===received){closed=true;resolveClosed();}};
 const listener=(dialog:Dialog)=>{
  if(received){rejectDialog(Error('PERSONAL_DIALOG_UNEXPECTED'));return;}
  received=dialog;
  void (async()=>{
   try{
    const expected=dialog.type()===expectedType&&(expectedType==='beforeunload'||['当前修改尚未保存，离开会丢弃这些修改。确定继续吗？','放弃尚未保存的修改？'].includes(dialog.message()));
    // Close an unexpected modal before rejecting: click may wait for closure.
    if(expected&&accept)await dialog.accept();else await dialog.dismiss();dialogHandled=true;
    if(!expected)throw Error('PERSONAL_DIALOG_UNEXPECTED');
    await modalClosed;
    if(active&&!accept&&expectedType==='beforeunload'){
     dismissedExpected=true;controller.abort(cancelReason);
    }
    resolveDialog();
   }catch(error){rejectDialog(error);}
  })();
 };
 page.on('dialog',listener);page.on('dialogclosed',closedListener);
 // Observe both outcomes immediately: cleanup must drain this exact action,
 // and a later abort must never replace an earlier real navigation failure.
 const action=Promise.resolve().then(()=>click(controller.signal)).then(
  ()=>{actionSettled=true;return {ok:true} as const;},
  (error:unknown)=>{actionSettled=true;return {ok:false,error} as const;},
 );
 try{
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('PERSONAL_DIALOG_TIMEOUT')),timeoutMs);});
  const navigation=action.then(async result=>{
   if(result.ok)return;
   const error=result.error;
   const ownAbort=error instanceof Error&&error.name==='AbortError'&&error.cause===cancelReason;
   const legacyAbort=error instanceof Error&&error.name!=='AbortError'&&/^page\.go(?:Back|Forward): net::ERR_ABORTED\b/.test(error.message);
   if(!accept&&expectedType==='beforeunload'&&received?.type()==='beforeunload'&&(ownAbort||legacyAbort)){
    await handled;
    if(dismissedExpected&&closed&&controller.signal.aborted&&controller.signal.reason===cancelReason)return;
   }
   throw error;
  });
  await Promise.race([Promise.all([navigation,handled]),deadline]);
 }finally{
  active=false;clearTimeout(timer);page.off('dialog',listener);
  if(!actionSettled)controller.abort(cleanupReason);
  let cleanupTimer:ReturnType<typeof setTimeout>|undefined;
  try{
   const cleanup=async()=>{
    if(received&&!dialogHandled&&!closed){await received.dismiss();await modalClosed;}
    await action;
   };
   await Promise.race([cleanup(),new Promise<never>((_,reject)=>{cleanupTimer=setTimeout(()=>reject(Error('PERSONAL_DIALOG_CLEANUP_TIMEOUT')),Math.min(timeoutMs,1000));})]);
  }finally{clearTimeout(cleanupTimer);page.off('dialogclosed',closedListener);}
 }
}
export type NativeTablePresentation={busy:string|null;failures:number;canvases:number;painted:boolean};
export function nativeTableRendered(f:NativeTablePresentation):boolean{return f.busy==='false'&&f.failures===0&&f.canvases>0&&f.painted===true;}
// VTable's pure painted-canvas oracle above remains available for the fixed A source.
// B always requires the selected renderer's own native DOM, never its text fallback.
const requireNativeTable = (page:Page) => requireTaskGrid(page,synthetic.title);
const form=(page:Page)=>page.locator('form').filter({has:page.getByLabel('标题',{exact:true})});
const title=(page:Page)=>form(page).getByLabel('标题',{exact:true});
export function recordFieldLabel(label:string):RegExp{return new RegExp('^'+label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));}
// Wrapping labels include SELECT options and populated TEXTAREA child text.
const recordField=(page:Page,label:string)=>form(page).getByLabel(recordFieldLabel(label));
export function personalBrowserFailureKind(error:unknown):'assertion'|'expectation'|'timeout'|'other'{
 if(error instanceof assert.AssertionError)return 'assertion';
 if(error instanceof Error&&error.name==='TimeoutError')return 'timeout';
 if(error instanceof Error&&'matcherResult'in error)return 'expectation';
 return 'other';
}

/** Public failure logs contain finite state only, never URLs, values or history scopes. */
export function projectPersonalHistoryDiagnostic(value:unknown,writes:unknown){
 const facts=value&&typeof value==='object'?value as Record<string,unknown>:{};
 const number=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=100000?n:null;
 const boolean=(v:unknown)=>typeof v==='boolean'?v:null;
 return {route:['overview','tasks','settings'].includes(facts.route as string)?facts.route:'other',markerIndex:number(facts.markerIndex),nativeIndex:number(facts.nativeIndex),inputCount:number(facts.inputCount),canaryMatches:boolean(facts.canaryMatches),focused:boolean(facts.focused),writeAttempts:number(writes)};
}
async function personalHistoryDiagnostic(page:Page,canary:'known'|'legacy'|'accepted',writes:number){
 let facts:unknown;
 try{facts=await page.evaluate(kind=>{
  const url=new URL(location.href),inputs=Array.from(document.querySelectorAll<HTMLInputElement>('[data-task-grid="reui"] input[aria-label="编辑待办"]'));
  const expected={known:'合成后退保留草稿',legacy:'合成旧历史保留草稿',accepted:'合成已接收旧历史草稿'}[kind];
  const navigation=(window as Window&{navigation?:{currentEntry?:{index:number}|null}}).navigation;
  return {route:url.pathname==='/personal'?(url.searchParams.get('page')??'overview'):'other',markerIndex:history.state?.__lifeosWorkspace?.index,nativeIndex:navigation?.currentEntry?.index,inputCount:inputs.length,canaryMatches:inputs.some(input=>input.value===expected),focused:inputs.some(input=>input===document.activeElement)};
 },canary);}catch{/* An unavailable/closed frame yields only null finite facts. */}
 return projectPersonalHistoryDiagnostic(facts,writes);
}

async function readyEditor(page:Page,value?:string){
 await expect(title(page)).toBeEnabled();
 if(value!==undefined)await expect(title(page)).toHaveValue(value);
 await expect(page.getByText('正在读取完整快照…',{exact:true})).toHaveCount(0);
}
async function readyTaskDetail(page:Page,value:string,readonly=false){
 const detail=page.getByRole('dialog',{name:'待办详情',exact:true});
 if(readonly){
  await expect(detail.getByRole('heading',{name:value,exact:true})).toBeVisible();
  await expect(detail.locator('form')).toHaveCount(0);
 }else{
  await expect(detail.getByLabel('标题',{exact:true})).toHaveValue(value);
  await expect(detail.locator('form')).toBeVisible();
 }
 await expect(detail.getByRole('button',{name:'编辑待办',exact:true})).toHaveCount(0);
 return detail;
}
async function editTask(page:Page,value:string){
 await readyTaskDetail(page,value);
 await readyEditor(page,value);
}
async function workspaceReady(page:Page){await expect(page.getByRole('button',{name:'新建待办',exact:true})).toBeEnabled();await expect(page.locator('.lo-shell')).toBeVisible();}
async function json(page:Pick<Page,'evaluate'>,path:string){
 const result=await page.evaluate(async path=>{const r=await fetch(path,{credentials:'same-origin',cache:'no-store'});return {ok:r.ok,body:await r.json()};},path);
 assert.equal(result.ok,true,'personal authenticated readback');return result.body;
}
/** Readonly UI fixture only; authentic server policy is tested separately. */
export async function installReadonlyPersonalReads(page:Pick<Page,'evaluate'|'route'|'unroute'>):Promise<()=>Promise<void>>{
 const paths=[origin+'/api/platform/personal/status',origin+'/api/platform/personal/availability'];
 // APIRequestContext/route.fetch does not inherit Chromium's host mapping.
 // Read through the authenticated browser HTTPS transport before intercepting.
 const bodies=await Promise.all(paths.map(path=>json(page,path)));
 for(const body of bodies)assert.equal(body.writable,true,'authentic writable mode before readonly UI fixture');
 const readonly=async(route:Route)=>{
  const request=route.request(),index=paths.indexOf(request.url());
  if(request.method()!=='GET'||index<0){await route.continue();return;}
  await route.fulfill({json:{...bodies[index],writable:false}});
 };
 const installed:string[]=[];
 const cleanup=async()=>{for(const path of installed)await page.unroute(path,readonly);};
 try{for(const path of paths){await page.route(path,readonly);installed.push(path);}}catch(error){await cleanup();throw error;}
 return cleanup;
}
async function overview(page:Page){return await json(page,'/api/platform/personal/overview?today=2030-11-02');}
function reference(entry:PublicEntry){return {id:entry.id,sourceId:entry.source.id,revision:entry.revision};}
async function selectReference(page:Page,label:string,entry:PublicEntry){
 await recordField(page,label).selectOption({label:('title'in entry.draft?entry.draft.title:'')+' · 版本 '+entry.revision});
 assert.deepEqual(JSON.parse(await recordField(page,label).inputValue()),reference(entry));
}
async function save(page:Page,type:'domain'|'project'|'todo',previous?:PublicEntry):Promise<PublicEntry>{
 const active=form(page),button=active.getByRole('button',{name:'确认保存',exact:true});
 await expect(button).toBeDisabled();await active.getByLabel('我已核对这一条内容，确认保存到本人空间。',{exact:true}).check();await expect(button).toBeEnabled();
 const path='/api/platform/personal/'+type+(previous?'/'+previous.id:''),method=previous?'PATCH':'POST';
 const receipt=page.waitForResponse(r=>r.url()===origin+path&&r.request().method()===method);
 await button.click();const response=await receipt;assert.equal(response.status(),previous?200:201);
 const result=await response.json() as {entry:PublicEntry;duplicate:boolean};assert.equal(result.duplicate,false);
 const entry=result.entry;assert.equal(entry.revision,previous?previous.revision+1:1);
 assert.equal((entry.source.original as {marker:string}).marker,'personal-manual-v1');
 if(previous){assert.equal(entry.id,previous.id);assert.equal(entry.source.id,previous.source.id);assert.deepEqual(entry.source.original,previous.source.original);}
 await expect(page.getByRole('status').filter({hasText:'已收到服务器保存回执。'})).toBeVisible();
 await readyEditor(page,'title'in entry.draft?entry.draft.title:'');
 const history=page.locator('section').filter({has:page.getByRole('heading',{name:'原文与更正历史',exact:true})});
 await expect(history.locator('p').filter({hasText:new RegExp('^版本 '+entry.revision+'$')})).toBeVisible();
 await expect(history.getByText(entry.id)).toHaveCount(0);
 assert.deepEqual((await json(page,previous?path:path+'/'+entry.id)).entry,entry);
 return entry;
}
async function readTodo(page:Page,expected:PublicEntry,records:PublicEntry[]){
 assert.deepEqual((await json(page,'/api/platform/personal/todo/'+expected.id)).entry,expected);
 const current=await overview(page);assert.equal(current.scope,'full-current-snapshot');assert.equal(current.truncated,false);assert.equal(current.total,3);
 assert.deepEqual(current.items.map((e:PublicEntry)=>e.id).sort(),records.map(e=>e.id).sort());
 assert.deepEqual(current.items.find((e:PublicEntry)=>e.id===expected.id),expected);
}
type PresentationReason='not-started'|'viewport'|'theme-init'|'ready'|'theme-resolved'|'native-paint'|'fonts'|'layout-measure'|'text-measure'|'control-measure'|'text'|'control'|'overflow'|'center'|'left'|'paper'|'ink'|'scheme'|'input-size'|'editor-width'|'editor-height'|'save-viewport'|'snapshot-read'|'snapshot-match'|'capture-facts'|'capture-guard'|'screenshot';
type SafeMetadata=Partial<Record<'contrast'|'alpha'|'width'|'centerDelta',number>&Record<'countmatch'|'match',boolean>>;
type PresentationDiagnostic=(reason:PresentationReason,metadata?:SafeMetadata)=>void;
async function screenshot(page:Page,name:string,records:PublicEntry[],todo:PublicEntry,diagnostic:PresentationDiagnostic){
 diagnostic('snapshot-read');const snapshot=await overview(page);
 // Entire records must equal the three receipts captured in this fixture, so
 // an extra/private draft field cannot be admitted by a title-prefix check.
 for(const entry of snapshot.items){diagnostic('snapshot-match',{countmatch:snapshot.items.length===records.length});assert.deepEqual(entry,records.find(e=>e.id===entry.id));}
 diagnostic('capture-facts');const facts=await page.evaluate(({expectedTitle})=>({surface:!!document.querySelector('[data-lifeos-surface="personal"]'),forbidden:document.querySelectorAll('input[type="password"],input[name="otp"],input[autocomplete="one-time-code"],input[autocomplete="username"],input[autocomplete="current-password"],input[autocomplete="new-password"],#mfa-setup-key,canvas[aria-label="验证器绑定二维码"],[aria-label="备用恢复码"]').length,syntheticVisible:document.body.innerText.includes(expectedTitle),values:Array.from(document.querySelectorAll('input,textarea')).map(node=>(node as HTMLInputElement).value)}),{expectedTitle:synthetic.title});
 diagnostic('capture-guard');assertPersonalCapture({...facts,platform:process.platform,ci:process.env.CI,actions:process.env.GITHUB_ACTIONS,fresh:process.env.LIFEOS_FIXTURE_FRESH,database:process.env.LIFEOS_PLATFORM_TEST_DATABASE_URL,runnerTemp:process.env.RUNNER_TEMP,name,url:page.url(),recordIds:snapshot.items.map((e:PublicEntry)=>e.id),expectedIds:records.map(e=>e.id),editorId:todo.id,snapshotComplete:snapshot.scope==='full-current-snapshot'&&snapshot.truncated===false&&snapshot.total===3,allowedValues:personalCaptureAllowedValues});
 diagnostic('screenshot');const dir=resolve(process.env.RUNNER_TEMP!,'owner-personal-browser-screenshots');mkdirSync(dir,{recursive:true,mode:0o700});await page.screenshot({path:join(dir,name),fullPage:true});recordSyntheticCapture({name,url:page.url(),...await page.evaluate(()=>({width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.lifeosTheme??''}))});
}
async function presentation(page:Page,kind:'workspace'|'editor',width:number,theme:'light'|'dark',records:PublicEntry[],todo:PublicEntry,diagnostic:PresentationDiagnostic){
 diagnostic('viewport',{width});await page.setViewportSize({width,height:width===1365?900:844});await page.emulateMedia({colorScheme:theme});
 diagnostic('theme-init');await page.evaluate(key=>localStorage.removeItem(key),themeStorageKey);await page.reload({waitUntil:'domcontentloaded'});
 diagnostic('ready');if(kind==='workspace')await workspaceReady(page);else await editTask(page,synthetic.title);
 diagnostic('theme-resolved');await page.waitForFunction(t=>document.documentElement.dataset.lifeosTheme===t&&matchMedia('(prefers-color-scheme: '+t+')').matches,theme);
 diagnostic('native-paint');if(kind==='workspace')await requireNativeTable(page);
 diagnostic('fonts');await page.evaluate(()=>document.fonts.ready.then(()=>undefined));
 if(kind==='workspace')await assertPublicLayout(page);
 diagnostic('layout-measure');const facts=await page.evaluate(({kind,width})=>{
  const root=document.documentElement,content=document.querySelector(kind==='workspace'?'.lo-content':'[role="dialog"]'),main=kind==='workspace'?document.querySelector('.lo-main'):root;
  if(!content||!main)throw Error('PERSONAL_LAYOUT_MISSING');
  const colors=(element:Element)=>{
   const layers:ContrastLayer[]=[];
   for(let node:Element|null=element;node;node=node.parentElement){const style=getComputedStyle(node);layers.push({backgroundColor:style.backgroundColor,backgroundImage:style.backgroundImage,mixBlendMode:style.mixBlendMode,backgroundBlendMode:style.backgroundBlendMode,opacity:style.opacity,filter:style.filter,backdropFilter:style.backdropFilter});}
   return {foreground:getComputedStyle(element).color,layers};
  };
  const control=content.querySelector('input'),c=content.getBoundingClientRect(),m=main.getBoundingClientRect(),style=getComputedStyle(content),surface=getComputedStyle(document.body);
  return {finePointer:matchMedia('(pointer:fine)').matches,noOverflow:root.scrollWidth<=root.clientWidth,centerDelta:Math.abs(c.x+c.width/2-(kind==='workspace'?m.x+m.width/2:root.clientWidth/2)),left:style.textAlign==='left'||style.textAlign==='start',paper:surface.backgroundColor,ink:surface.color,scheme:getComputedStyle(root).colorScheme,dialogWidth:c.width,dialogHeight:c.height,viewportHeight:innerHeight,inputSize:kind==='editor'?parseFloat(getComputedStyle(content.querySelector('input')!).fontSize):16,text:colors(document.body),control:control?colors(control):null};
 },{kind,width});
 diagnostic('text-measure');const text=renderedContrast(facts.text.foreground,facts.text.layers);
 diagnostic('text',{contrast:text.contrast,alpha:text.foregroundAlpha});assert.equal(text.contrast>=4.5,true,'personal rendered text contrast');
 if(facts.control){diagnostic('control-measure');const control=renderedContrast(facts.control.foreground,facts.control.layers);diagnostic('control',{contrast:control.contrast,alpha:control.foregroundAlpha});assert.equal(control.contrast>=4.5,true,'personal rendered input contrast');}
 diagnostic('overflow',{match:facts.noOverflow});assert.equal(facts.noOverflow,true,'personal document overflow');
 diagnostic('center',{width,centerDelta:facts.centerDelta});assert.equal(width!==1365||facts.centerDelta<=1,true,'personal container center');
 diagnostic('left',{match:facts.left});assert.equal(facts.left,true,'personal text alignment');
 diagnostic('paper',{match:facts.paper===(theme==='dark'?'rgb(17, 17, 19)':'rgb(252, 252, 253)')});assert.equal(facts.paper,theme==='dark'?'rgb(17, 17, 19)':'rgb(252, 252, 253)','personal themed surface');
 diagnostic('ink',{match:facts.ink===(theme==='dark'?'rgb(237, 238, 240)':'rgb(28, 32, 36)')});assert.equal(facts.ink,theme==='dark'?'rgb(237, 238, 240)':'rgb(28, 32, 36)','personal themed ink');
 diagnostic('scheme',{match:facts.scheme===theme});assert.equal(facts.scheme,theme,'personal theme scheme');
 if(kind==='editor'){
  const minimum=presentationDensity(width,facts.finePointer).form;
  diagnostic('input-size',{match:facts.inputSize>=minimum});assert.equal(facts.inputSize>=minimum,true,'editor readable inputs');
  diagnostic('editor-width',{width:facts.dialogWidth});assert.equal(width===1365?facts.dialogWidth<=680:Math.abs(facts.dialogWidth-width)<=1,true,'editor adaptive width');
  if(width!==1365){diagnostic('editor-height',{match:Math.abs(facts.dialogHeight-facts.viewportHeight)<=1});assert.equal(Math.abs(facts.dialogHeight-facts.viewportHeight)<=1,true,'editor mobile fullscreen');}
  diagnostic('save-viewport');await expect(form(page).getByRole('button',{name:'保存待办',exact:true})).toBeInViewport();
 }
 await screenshot(page,kind+'-'+width+'-'+theme+'.png',records,todo,diagnostic);
}
/** Same receipt checks as the legacy category form, applied to the shared task modal. */
async function saveTask(page:Page,previous?:PublicEntry):Promise<PublicEntry>{
 const path='/api/platform/personal/todo'+(previous?'/'+previous.id:''),method=previous?'PATCH':'POST';
 const receipt=page.waitForResponse(r=>r.url()===origin+path&&r.request().method()===method);
 await form(page).getByRole('button',{name:'保存待办',exact:true}).click();const response=await receipt;assert.equal(response.status(),previous?200:201);
 const result=await response.json();assert.equal(result.duplicate,false);const entry=result.entry as PublicEntry;
 assert.equal(entry.revision,previous?previous.revision+1:1);assert.equal((entry.source.original as {marker:string}).marker,'personal-manual-v1');
 if(previous){assert.equal(entry.id,previous.id);assert.equal(entry.source.id,previous.source.id);assert.deepEqual(entry.source.original,previous.source.original);}
 await expect(page.getByRole('dialog')).toHaveCount(0);assert.deepEqual((await json(page,path+(previous?'':'/'+entry.id))).entry,entry);return entry;
}
export async function taskRelations(page:Page){const details=form(page).locator('details');if(await details.count()&&!await details.evaluate(node=>(node as HTMLDetailsElement).open))await details.locator('summary').click();}
type LatencyPhase='tasks-table-ready'|'native-input-visible'|'editor-form-ready'|'body-next-frame';
// Synthetic fixture only: fixed labels and elapsed numbers, never data or request details.
function latency(phase:LatencyPhase,start:number){const elapsedMs=performance.now()-start;assert.equal(Number.isFinite(elapsedMs)&&elapsedMs>=0,true);console.log('PERSONAL_LATENCY',JSON.stringify({phase,elapsedMs:Math.round(elapsedMs*100)/100}));}

/** Actual Undo notice and body-portal modal, using only a temporary synthetic filing footer. */
export async function verifyUndoFooterPresentation(page:Page):Promise<void>{
 const viewport=page.viewportSize();
 assert.ok(viewport);
 const undo=page.locator('.lo-undo-notice');
 await expect(undo).toBeVisible();
 await expect(page.locator('body > .lifeos-filing-footer')).toHaveCount(0);
 const start=performance.now();
 const previousPointer=await undo.evaluate(node=>(node as HTMLElement).style.pointerEvents);
 const modal=page.getByRole('dialog',{name:'新建待办',exact:true});
 try{
  await page.evaluate(()=>{
   const footer=document.createElement('footer');
   footer.className='lifeos-filing-footer';
   footer.dataset.syntheticUndoFooter='true';
   for(const label of ['合成页脚链接 A','合成页脚链接 B']){
    const link=document.createElement('a');
    link.href='#synthetic-undo-footer';
    link.textContent=label;
    footer.append(link);
   }
   document.body.append(footer);
  });
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
  await expect.poll(()=>page.evaluate(()=>{
   const footer=document.querySelector<HTMLElement>('[data-synthetic-undo-footer="true"]');
   const shell=document.querySelector<HTMLElement>('.lo-shell');
   return !!footer&&!!shell&&Math.abs(parseFloat(shell.style.getPropertyValue('--lo-filing-footer-space'))-footer.getBoundingClientRect().height)<=1;
  }),{timeout:1000}).toBe(true);
  const geometry=await undo.evaluate(node=>{
   const toast=node.getBoundingClientRect();
   const footer=document.querySelector<HTMLElement>('[data-synthetic-undo-footer="true"]')!.getBoundingClientRect();
   return {gap:footer.top-toast.bottom,footerHeight:footer.height};
  });
  console.log('PERSONAL_UNDO_FOOTER_GEOMETRY',JSON.stringify(geometry));
  assert.equal(geometry.gap>=16,true,'The actual Undo notice must clear the filing footer by at least 16px');
  await page.getByRole('button',{name:'新建待办',exact:true}).click();
  await expect(modal).toBeVisible();
  await expect(modal.getByLabel('标题',{exact:true})).toHaveValue('');
  const hit=await undo.evaluate(node=>{
   (node as HTMLElement).style.pointerEvents='auto';
   const rect=node.getBoundingClientRect(),target=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
   return {
    bodyPortal:!!target?.closest('[data-slot="dialog-content"],[data-slot="dialog-overlay"]')&&!target?.closest('.lo-shell'),
    toast:!!target?.closest('.lo-undo-notice'),
   };
  });
  console.log('PERSONAL_UNDO_MODAL_HIT',JSON.stringify({...hit,elapsedMs:Math.round(performance.now()-start)}));
  assert.equal(hit.bodyPortal,true,'A body-portal dialog or overlay must cover the Undo notice');
  assert.equal(hit.toast,false);
 }finally{
  if(await undo.count())await undo.evaluate((node,value)=>{(node as HTMLElement).style.pointerEvents=value;},previousPointer);
  await page.setViewportSize(viewport);
  await page.evaluate(()=>{
   document.querySelector('[data-synthetic-undo-footer="true"]')?.remove();
   window.dispatchEvent(new Event('resize'));
  });
  if(await modal.count())await modal.getByRole('button',{name:'关闭待办编辑',exact:true}).click();
 }
 await expect(page.getByRole('button',{name:'撤销',exact:true})).toBeVisible();
}

/** Runs once inside the existing authenticated MFA lifecycle; no extra login. */
export async function verifyPersonalWorkspace(page:Page){
 let phase='empty-workspace-ready';
 let historyWrites=0,historyCanary:'known'|'legacy'|'accepted'='known';
 let presentationFailure:{reason:PresentationReason;metadata:SafeMetadata}={reason:'not-started',metadata:{}};
 const diagnostic:PresentationDiagnostic=(reason,metadata={})=>{presentationFailure={reason,metadata:Object.fromEntries(Object.entries(metadata).filter(([,value])=>typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value))))};};
 try{
 await workspaceReady(page);const initial=await overview(page);assert.equal(initial.total,0);assert.deepEqual(initial.items,[]);
 phase='workspace-capabilities';const access=await json(page,'/api/platform/personal/status');assert.equal(access.writable,true);assert.deepEqual(access.allowedTypes,['todo','journal','project','domain','topic']);
 phase='cancel-empty';await page.getByRole('button',{name:'新建待办',exact:true}).click();await readyEditor(page,'');await taskRelations(page);
 for(const label of ['项目','领域']){await expect(recordField(page,label)).toHaveValue('');await expect(recordField(page,label).locator('option')).toHaveCount(1);}
 await page.getByRole('button',{name:'关闭待办编辑',exact:true}).click();assert.equal((await overview(page)).total,0);
 phase='create-domain';await page.getByRole('button',{name:'事项',exact:true}).click();await page.getByRole('button',{name:'领域分类视图',exact:true}).click();await page.getByRole('link',{name:'新建领域',exact:true}).click();await readyEditor(page,'');
 await title(page).fill(synthetic.domain);await recordField(page,'说明 / 正文').fill('隔离合成领域说明');const domain=await save(page,'domain');
 await page.getByRole('link',{name:'返回总览',exact:true}).click();await workspaceReady(page);await page.getByRole('button',{name:'事项',exact:true}).click();await page.getByRole('button',{name:'项目分类视图',exact:true}).click();
 await page.getByRole('link',{name:'新建项目',exact:true}).click();await readyEditor(page,'');
 phase='create-project';await title(page).fill(synthetic.project);await recordField(page,'目标').fill('隔离合成项目目标');await selectReference(page,'所属领域',domain);const project=await save(page,'project');assert.deepEqual((project.draft as {personal:{domain:unknown}}).personal.domain,reference(domain));
 await page.getByRole('link',{name:'返回总览',exact:true}).click();await workspaceReady(page);await page.getByRole('button',{name:'事项',exact:true}).click();await page.getByRole('button',{name:'新建待办',exact:true}).click();await readyEditor(page,'');
 phase='create-todo';await title(page).fill(synthetic.initial);await recordField(page,'正文').fill(synthetic.notes);await recordField(page,'到期日').fill(synthetic.date);let todo=await saveTask(page);assert.equal('status'in todo.draft?todo.draft.status:null,'open');
 await page.getByRole('group',{name:'待办视图',exact:true}).getByRole('button',{name:'列表',exact:true}).click();
 const trigger=page.getByRole('button',{name:'展开详情：'+synthetic.initial,exact:true});const editorStart=performance.now();await trigger.click();await editTask(page,synthetic.initial);latency('editor-form-ready',editorStart);
 phase='edit-and-readback';await title(page).fill(synthetic.title);const bodyStart=performance.now();await recordField(page,'正文').fill(synthetic.editedNotes);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));latency('body-next-frame',bodyStart);await recordField(page,'到期日').fill(synthetic.editedDate);await recordField(page,'状态').selectOption('in_progress');await taskRelations(page);await recordField(page,'项目').selectOption(project.id);await recordField(page,'领域').selectOption(domain.id);todo=await saveTask(page,todo);
 assert.deepEqual(todo.draft,{title:synthetic.title,notes:synthetic.editedNotes,dueOn:synthetic.editedDate,status:'in_progress',personal:{project:reference(project),domain:reference(domain),topics:[]}});
 const editorURL=origin+'/personal/edit?type=todo&id='+encodeURIComponent(todo.id),tasksURL=origin+'/personal?page=tasks';
 const verifyFields=async()=>{await editTask(page,synthetic.title);await expect(recordField(page,'正文')).toHaveValue(synthetic.editedNotes);await expect(recordField(page,'到期日')).toHaveValue(synthetic.editedDate);await expect(recordField(page,'状态')).toHaveValue('status'in todo.draft?todo.draft.status:'');await taskRelations(page);await expect(recordField(page,'项目')).toHaveValue(project.id);await expect(recordField(page,'领域')).toHaveValue(domain.id);};
 await page.goto(editorURL,{waitUntil:'domcontentloaded'});await page.reload({waitUntil:'domcontentloaded'});await verifyFields();await readTodo(page,todo,[domain,project,todo]);
 phase='four-states';for(const status of ['done','cancelled','in_progress'] as const){await recordField(page,'状态').selectOption(status);todo=await saveTask(page,todo);assert.equal('status'in todo.draft?todo.draft.status:null,status);await page.reload({waitUntil:'domcontentloaded'});await verifyFields();await readTodo(page,todo,[domain,project,todo]);}
 phase='unsaved-modal-cancel';await title(page).fill('合成未保存草稿');await confirmDiscard(page,false,async()=>{await page.getByRole('button',{name:'取消',exact:true}).click();});await expect(title(page)).toHaveValue('合成未保存草稿');await confirmDiscard(page,true,async()=>{await page.getByRole('button',{name:'取消',exact:true}).click();});await expect(page.getByRole('dialog')).toHaveCount(0);await readTodo(page,todo,[domain,project,todo]);
 // Keep native document history coverage in both directions, using existing category and todo routes.
 phase='history-back-cancel-accept';await page.goto(editorURL,{waitUntil:'domcontentloaded'});await verifyFields();const projectURL=origin+'/personal/edit?type=project&id='+encodeURIComponent(project.id);await page.goto(projectURL,{waitUntil:'domcontentloaded'});await readyEditor(page,synthetic.project);await title(page).fill('合成未保存项目草稿');await recordField(page,'目标').fill('合成未保存项目目标');
 const traverse=(direction:'Back'|'Forward')=>async(signal:AbortSignal)=>{if(direction==='Back')await page.goBack({waitUntil:'domcontentloaded',signal});else await page.goForward({waitUntil:'domcontentloaded',signal});};
 const discard=(accept:boolean,click:(signal:AbortSignal)=>Promise<void>)=>confirmDiscard(page,accept,click,5000,'beforeunload');
 await discard(false,traverse('Back'));assert.equal(page.url(),projectURL);await expect(title(page)).toHaveValue('合成未保存项目草稿');await expect(recordField(page,'目标')).toHaveValue('合成未保存项目目标');
 await discard(true,traverse('Back'));await page.waitForURL(editorURL);await verifyFields();
 phase='history-forward-cancel-accept';await title(page).fill('合成未保存待办前进草稿');await recordField(page,'正文').fill('合成未保存待办前进正文');
 await discard(false,traverse('Forward'));assert.equal(page.url(),editorURL);await expect(title(page)).toHaveValue('合成未保存待办前进草稿');await expect(recordField(page,'正文')).toHaveValue('合成未保存待办前进正文');
 await discard(true,traverse('Forward'));await page.waitForURL(projectURL);await readyEditor(page,synthetic.project);await expect(recordField(page,'目标')).toHaveValue('隔离合成项目目标');
 phase='status-undo';const tasksStart=performance.now();await page.goto(tasksURL,{waitUntil:'domcontentloaded'});await workspaceReady(page);await requireNativeTable(page);latency('tasks-table-ready',tasksStart);await page.getByRole('group',{name:'待办视图',exact:true}).getByRole('button',{name:'列表',exact:true}).click();
 const statusReceipt=page.waitForResponse(r=>r.url()===origin+'/api/platform/personal/todo/'+todo.id&&r.request().method()==='PATCH');await page.getByRole('button',{name:'完成：'+synthetic.title,exact:true}).click();todo=(await(await statusReceipt).json()).entry;assert.equal('status'in todo.draft?todo.draft.status:null,'done');
 phase='status-undo-footer';await verifyUndoFooterPresentation(page);
 const undoReceipt=page.waitForResponse(r=>r.url()===origin+'/api/platform/personal/todo/'+todo.id&&r.request().method()==='PATCH');await page.getByRole('button',{name:'撤销',exact:true}).click();todo=(await(await undoReceipt).json()).entry;assert.equal('status'in todo.draft?todo.draft.status:null,'in_progress');await readTodo(page,todo,[domain,project,todo]);
 phase='native-table-view';await page.getByRole('group',{name:'待办视图',exact:true}).getByRole('button',{name:'表格',exact:true}).click();phase='native-paint-ready';await requireNativeTable(page);
 phase='native-column-resize';
 const titleHeader=taskGridRoot(page).getByRole('columnheader',{name:/待办/}).first();
 const originalWidth=(await titleHeader.boundingBox())!.width;
 const handle=titleHeader.locator('[data-slot="data-grid-table-resize-handle"]');
 const handleBox=await handle.boundingBox();assert.ok(handleBox);
 let resizeWrites=0;const countResize=(request:import('@playwright/test').Request)=>{if(['POST','PATCH'].includes(request.method()))resizeWrites++;};
 page.on('request',countResize);
 try{
  await page.mouse.move(handleBox.x+handleBox.width/2,handleBox.y+handleBox.height/2);await page.mouse.down();
  await page.mouse.move(handleBox.x+handleBox.width/2-48,handleBox.y+handleBox.height/2,{steps:4});await page.mouse.up();
  await expect.poll(async()=>(await titleHeader.boundingBox())!.width).toBeLessThan(originalWidth-20);
  assert.equal(resizeWrites,0);
 }finally{page.off('request',countResize);}
 phase='native-table-completion';
 const tableDoneReceipt=page.waitForResponse(r=>r.url()===origin+'/api/platform/personal/todo/'+todo.id&&r.request().method()==='PATCH');
 await taskGridRoot(page).getByRole('button',{name:'完成：'+synthetic.title,exact:true}).click();
 todo=(await(await tableDoneReceipt).json()).entry;assert.equal('status'in todo.draft?todo.draft.status:null,'done');
 const tableUndoReceipt=page.waitForResponse(r=>r.url()===origin+'/api/platform/personal/todo/'+todo.id&&r.request().method()==='PATCH');
 await page.getByRole('button',{name:'撤销',exact:true}).click();todo=(await(await tableUndoReceipt).json()).entry;
 assert.equal('status'in todo.draft?todo.draft.status:null,'in_progress');await requireNativeTable(page);

 phase='native-title-open';const nativeStart=performance.now();await taskGridTitleCell(page,synthetic.title).dblclick();const input=taskGridInput(page);phase='native-title-input-identity';await expect(input).toHaveCount(1);phase='native-title-input-visible';await expect(input).toBeVisible();await expect(input).toBeEditable();latency('native-input-visible',nativeStart);
 phase='native-title-invalid-retained';await input.fill(' ');await input.press('Enter');await expect(input).toHaveValue(' ');await expect(input).toBeVisible();await readTodo(page,todo,[domain,project,todo]);
 phase='native-title-draft-fill';await input.fill(synthetic.title+'（表格）');let hiddenMutations=0;const countHidden=(request:import('@playwright/test').Request)=>{if(['POST','PATCH'].includes(request.method()))hiddenMutations++;};page.on('request',countHidden);
 try{phase='native-draft-conceal';await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});await expect(input).toHaveCount(0);
  phase='native-draft-verify-restore';await page.evaluate(()=>{Reflect.deleteProperty(document,'visibilityState');document.dispatchEvent(new Event('visibilitychange'));});await workspaceReady(page);await expect(input).toHaveCount(1);await expect(input).toBeVisible();await expect(input).toBeEditable();await expect(input).toHaveValue(synthetic.title+'（表格）');assert.equal(hiddenMutations,0);
 }finally{page.off('request',countHidden);await page.evaluate(()=>Reflect.deleteProperty(document,'visibilityState'));}
 const cellReceipt=page.waitForResponse(r=>r.url()===origin+'/api/platform/personal/todo/'+todo.id&&r.request().method()==='PATCH');phase='native-title-submit';await input.press('Enter');phase='native-title-receipt';todo=(await(await cellReceipt).json()).entry;assert.equal('title'in todo.draft?todo.draft.title:null,synthetic.title+'（表格）');phase='native-title-projection';await expect(page.getByRole('button',{name:'打开任务：'+synthetic.title+'（表格）',exact:true})).toBeAttached();phase='native-title-input-closed';await expect(input).toBeHidden();
 phase='native-title-restore-open';await taskGridTitleCell(page,synthetic.title+'（表格）').dblclick();phase='native-title-restore-visible';await expect(input).toHaveCount(1);await expect(input).toBeVisible();await expect(input).toBeEditable();await input.fill(synthetic.title);const restoreReceipt=page.waitForResponse(r=>r.url()===origin+'/api/platform/personal/todo/'+todo.id&&r.request().method()==='PATCH');phase='native-title-restore-submit';await input.press('Enter');phase='native-title-restore-receipt';todo=(await(await restoreReceipt).json()).entry;phase='native-title-restore-projection';await expect(page.getByRole('button',{name:'打开任务：'+synthetic.title,exact:true})).toBeAttached();phase='native-title-restore-closed';await expect(input).toBeHidden();phase='native-title-final-readback';await readTodo(page,todo,[domain,project,todo]);
 const saveNativeField=async(column:'status'|'due',label:string,value:string,field:'status'|'dueOn')=>{
  const cell=taskGridRoot(page).locator('tr[data-row-id="'+todo.id+'"] td[data-col-id="'+column+'"]');
  phase='native-'+field+'-cell';
  await expect(cell).toHaveCount(1);
  phase='native-'+field+'-focus';
  await workspaceReady(page);
  await cell.click();
  await expect(cell).toHaveAttribute('data-cell-focused',/.*/);
  phase='native-'+field+'-keyboard-open';
  await page.keyboard.press('F2');
  phase='native-'+field+'-editor';
  const editor=taskGridRoot(page).getByLabel(label,{exact:true});
  await expect(editor).toBeVisible();
  if(field==='status')await editor.selectOption({label:value==='open'?'未完成':'进行中'});else await editor.fill(value);
  const previous=todo;
  const receipt=page.waitForResponse(r=>r.url()===origin+'/api/platform/personal/todo/'+previous.id&&r.request().method()==='PATCH');
  phase='native-'+field+'-receipt';
  await editor.press('Enter');
  const response=await receipt;
  assert.equal(response.status(),200);
  const saved=await response.json() as {entry:PublicEntry;duplicate:boolean};
  assert.equal(saved.duplicate,false);
  todo=saved.entry;
  assert.equal(todo.id,previous.id);
  assert.equal(todo.source.id,previous.source.id);
  assert.equal(todo.revision,previous.revision+1);
  assert.equal((todo.draft as Record<string,unknown>)[field],value);
  await expect(editor).toBeHidden();
  await readTodo(page,todo,[domain,project,todo]);
 };
 await saveNativeField('status','编辑状态','open','status');
 await saveNativeField('status','编辑状态','in_progress','status');
 await saveNativeField('due','编辑到期日','2030-11-04','dueOn');
 await saveNativeField('due','编辑到期日',synthetic.editedDate,'dueOn');
 phase='native-keyboard-cancel';
 const titleCell=taskGridTitleCell(page,synthetic.title);
 let cancelledWrites=0;
 const trackCancelledWrite=(request:import('@playwright/test').Request)=>{
  if(request.method()==='PATCH'&&request.url()===origin+'/api/platform/personal/todo/'+todo.id)cancelledWrites++;
 };
 page.on('request',trackCancelledWrite);
 try{
  await titleCell.click();
  await page.keyboard.press('a');
  await expect(input).toHaveValue('a');
  await expect(input).toBeFocused();
  await input.fill('合成未提交表格草稿');
  await input.press('Escape');
  await expect(input).toBeHidden();
  await expect(titleCell).toBeVisible();
  await readTodo(page,todo,[domain,project,todo]);
  assert.equal(cancelledWrites,0);
 }finally{page.off('request',trackCancelledWrite);}
 phase='overview-title-open';await page.getByRole('button',{name:'总览',exact:true}).click();
 const overviewTitle=()=>page.getByRole('button',{name:'编辑标题：'+synthetic.title,exact:true});
 await overviewTitle().dblclick();
 const overviewInput=page.getByRole('textbox',{name:'编辑待办',exact:true});
 await expect(overviewInput).toBeFocused();await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.locator('form')).toHaveCount(0);
 phase='overview-title-draft';await overviewInput.fill('合成未保存总览草稿');
 const overviewNode=await overviewInput.elementHandle();let overviewWrites=0,overviewNativeDialogs=0;
 const trackOverviewWrite=(request:import('@playwright/test').Request)=>{if(['POST','PATCH'].includes(request.method()))overviewWrites++;};
 const unexpectedOverviewDialog=(dialog:Dialog)=>{overviewNativeDialogs++;void dialog.dismiss();};
 page.on('request',trackOverviewWrite);page.on('dialog',unexpectedOverviewDialog);
 try{
  phase='overview-settings-open';await page.getByRole('button',{name:'设置',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'设置',exact:true});
  phase='overview-settings-visible';await expect(settings).toBeVisible();
  assert.equal(overviewNativeDialogs,0,'Settings overlays the draft without native discard confirmation');assert.equal(overviewWrites,0);
  phase='overview-settings-close';await settings.getByRole('button',{name:'关闭',exact:true}).click();
  phase='overview-settings-draft-restored';await expect(settings).toHaveCount(0);await expect(page).toHaveURL(origin+'/personal');
  await expect(overviewInput).toHaveValue('合成未保存总览草稿');assert.equal(await overviewNode!.evaluate(node=>node.isConnected),true,'the overview editor remains mounted');
  await expect(page.getByRole('button',{name:'设置',exact:true})).toBeFocused();assert.equal(overviewNativeDialogs,0);assert.equal(overviewWrites,0);
  page.off('dialog',unexpectedOverviewDialog);
  phase='overview-matters-discard-refused';await confirmDiscard(page,false,async()=>{await page.getByRole('button',{name:'事项',exact:true}).click();});
  phase='overview-matters-draft-retained';await expect(page).toHaveURL(origin+'/personal');await expect(overviewInput).toHaveValue('合成未保存总览草稿');assert.equal(overviewWrites,0);
 }finally{page.off('request',trackOverviewWrite);page.off('dialog',unexpectedOverviewDialog);}
 phase='overview-title-save';await overviewInput.fill(synthetic.title+'（总览）');
 const overviewReceipt=page.waitForResponse(r=>r.url()===origin+'/api/platform/personal/todo/'+todo.id&&r.request().method()==='PATCH');
 await overviewInput.press('Enter');todo=(await(await overviewReceipt).json()).entry;
 assert.equal('notes'in todo.draft?todo.draft.notes:null,synthetic.editedNotes);
 const changedTitle=page.getByRole('button',{name:'编辑标题：'+synthetic.title+'（总览）',exact:true});
 await expect(overviewInput).toHaveCount(0);await expect(changedTitle).toBeFocused();
 await readTodo(page,todo,[domain,project,todo]);
 await changedTitle.dblclick();await overviewInput.fill(synthetic.title);
 const overviewRestore=page.waitForResponse(r=>r.url()===origin+'/api/platform/personal/todo/'+todo.id&&r.request().method()==='PATCH');
 await overviewInput.press('Enter');todo=(await(await overviewRestore).json()).entry;
 await expect(overviewTitle()).toBeFocused();
 await page.getByRole('button',{name:'展开详情：'+synthetic.title,exact:true}).click();
 const expanded=await readyTaskDetail(page,synthetic.title);
 await expect(expanded.getByLabel(recordFieldLabel('正文'))).toHaveValue(synthetic.editedNotes);
 await recordField(page,'正文').fill('合成详情直接编辑');todo=await saveTask(page,todo);
 await page.getByRole('button',{name:'展开详情：'+synthetic.title,exact:true}).click();
 await readyTaskDetail(page,synthetic.title);
 await recordField(page,'正文').fill(synthetic.editedNotes);todo=await saveTask(page,todo);
 phase='settings-actions';await page.getByRole('button',{name:'设置',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'设置',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'安全与密码',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'退出登录',exact:true})).toBeVisible();
 await expect(page.getByText(/登录状态|数据权限|数据管理与导出|分类管理|管理项目与领域/)).toHaveCount(0);
 const records=[domain,project,todo];
 phase='readonly-ui';const cleanupReadonly=await installReadonlyPersonalReads(page);let mutations=0;const count=(request:import('@playwright/test').Request)=>{if(['POST','PATCH'].includes(request.method()))mutations++;};page.on('request',count);
 let readonlyFailurePhase:string|null=null;
 try{
  phase='readonly-load';await page.goto(tasksURL,{waitUntil:'domcontentloaded'});
  phase='readonly-create-disabled';await expect(page.getByRole('button',{name:'新建待办',exact:true})).toBeDisabled();
  phase='readonly-list';await page.getByRole('group',{name:'待办视图',exact:true}).getByRole('button',{name:'列表',exact:true}).click();
  phase='readonly-title-visible';await expect(page.getByRole('button',{name:'查看待办：'+synthetic.title,exact:true})).toBeVisible();
  const complete=page.getByRole('button',{name:'完成：'+synthetic.title,exact:true});
  phase='readonly-completion-disabled';await expect(complete).toBeDisabled();
  phase='readonly-completion-noop';await complete.evaluate((node:HTMLElement)=>node.click());
  phase='readonly-management-hidden';await expect(page.getByText('管理项目与领域',{exact:true})).toHaveCount(0);
  phase='readonly-areas';await page.getByRole('button',{name:'领域分类视图',exact:true}).click();
  phase='readonly-area-create-hidden';await expect(page.getByRole('link',{name:'新建领域',exact:true})).toHaveCount(0);
  phase='readonly-area-edit-hidden';await expect(page.getByRole('link',{name:/编辑领域/})).toHaveCount(0);
  phase='readonly-detail-load';await page.goto(editorURL,{waitUntil:'domcontentloaded'});
  phase='readonly-detail-structure';const detail=await readyTaskDetail(page,synthetic.title,true);
  phase='readonly-detail-status';await expect(detail.getByRole('status').filter({hasText:'当前为只读'})).toBeVisible();
  phase='readonly-detail-text';await expect(detail.getByText(synthetic.editedNotes,{exact:true})).toBeVisible();
  phase='readonly-detail-date';await expect(detail.getByText(synthetic.editedDate,{exact:true})).toBeVisible();
  phase='readonly-edit-hidden';await expect(detail.getByRole('button',{name:'编辑待办',exact:true})).toHaveCount(0);
  phase='readonly-write-count';assert.equal(mutations,0,'readonly UI attempted mutations');
 }catch(error){readonlyFailurePhase=phase;throw error;}
 finally{try{
  phase='readonly-restore-routes';await cleanupReadonly();page.off('request',count);
  phase='readonly-restore-status';assert.equal((await json(page,'/api/platform/personal/status')).writable,true);
  phase='readonly-restore-availability';assert.equal((await json(page,'/api/platform/personal/availability')).writable,true);
  phase='readonly-restore-load';await page.goto(editorURL,{waitUntil:'domcontentloaded'});
  phase='readonly-restore-fields';await verifyFields();
 }finally{if(readonlyFailurePhase!==null)phase=readonlyFailurePhase;}}
 phase='workspace-history-url';
 await page.setViewportSize({width:1365,height:900});await page.emulateMedia({colorScheme:'light'});
 await page.goto(origin+'/personal',{waitUntil:'domcontentloaded'});await workspaceReady(page);
 await page.getByRole('button',{name:'事项',exact:true}).click();await expect(page).toHaveURL(tasksURL);await requireNativeTable(page);
 await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page).toHaveURL(tasksURL+'&modal=settings&panel=general');
 await page.goBack();await expect(page).toHaveURL(tasksURL);await requireNativeTable(page);
 await page.goForward();await expect(page).toHaveURL(tasksURL+'&modal=settings&panel=general');await expect(page.getByRole('heading',{name:'设置',exact:true})).toBeVisible();
 await page.goBack();await expect(page).toHaveURL(tasksURL);await requireNativeTable(page);
 await page.reload({waitUntil:'domcontentloaded'});await expect(page).toHaveURL(tasksURL);await requireNativeTable(page);
 phase='workspace-history-draft-refusal';
 await taskGridTitleCell(page,synthetic.title).dblclick();const historyField=taskGridInput(page);
 await historyField.fill('合成后退保留草稿');
 const countHistory=(request:import('@playwright/test').Request)=>{if(['POST','PATCH'].includes(request.method()))historyWrites++;};
 page.on('request',countHistory);
 try{
  await confirmDiscard(page,false,async()=>{await page.goBack();});
  await expect(page).toHaveURL(tasksURL);await expect(historyField).toHaveValue('合成后退保留草稿');
  assert.equal(historyWrites,0);await historyField.press('Escape');await expect(historyField).toHaveCount(0);
  await page.goForward();await expect(page).toHaveURL(tasksURL+'&modal=settings&panel=general');
  await expect(page.getByRole('heading',{name:'设置',exact:true})).toBeVisible();assert.equal(historyWrites,0);
  // Simulate an older real page departure, preserving Next.js router state. Overlay traversal retains drafts; actual page departure still confirms.
  phase='workspace-history-legacy-mark';historyCanary='legacy';
  await page.evaluate(()=>{const state={...history.state};delete state.__lifeosWorkspace;history.replaceState(state,'','/personal?page=requirements');});
  phase='workspace-history-legacy-back-navigation';await page.goBack();
  phase='workspace-history-legacy-back-url';await expect(page).toHaveURL(tasksURL);
  phase='workspace-history-legacy-back-grid';await requireNativeTable(page);
  phase='workspace-history-legacy-input';await taskGridTitleCell(page,synthetic.title).dblclick();const legacyField=taskGridInput(page);await legacyField.fill('合成旧历史保留草稿');
  phase='workspace-history-legacy-refusal-confirm';await confirmDiscard(page,false,async()=>{await page.goForward();});
  phase='workspace-history-legacy-refusal-url';await expect(page).toHaveURL(tasksURL);
  phase='workspace-history-legacy-refusal-draft';await expect(legacyField).toHaveValue('合成旧历史保留草稿');assert.equal(historyWrites,0);
  phase='workspace-history-legacy-escape';await legacyField.press('Escape');
  phase='workspace-history-legacy-accept-navigation';await page.goForward();
  phase='workspace-history-legacy-accept-url';await expect(page).toHaveURL(origin+'/personal?page=requirements');
  phase='workspace-history-legacy-accept-heading';await expect(page.getByRole('heading',{name:'需求池',exact:true})).toBeVisible();
  phase='workspace-history-accepted-legacy-back-navigation';historyCanary='accepted';await page.goBack();
  phase='workspace-history-accepted-legacy-back-url';await expect(page).toHaveURL(tasksURL);
  phase='workspace-history-accepted-legacy-back-grid';await requireNativeTable(page);
  phase='workspace-history-accepted-legacy-input';await taskGridTitleCell(page,synthetic.title).dblclick();const acceptedLegacyField=taskGridInput(page);await acceptedLegacyField.fill('合成已接收旧历史草稿');
  phase='workspace-history-accepted-legacy-refusal-confirm';await confirmDiscard(page,false,async()=>{await page.goForward();});
  phase='workspace-history-accepted-legacy-refusal-url';await expect(page).toHaveURL(tasksURL);
  phase='workspace-history-accepted-legacy-refusal-draft';await expect(acceptedLegacyField).toHaveValue('合成已接收旧历史草稿');
  phase='workspace-history-accepted-legacy-escape';await acceptedLegacyField.press('Escape');assert.equal(historyWrites,0);
 }finally{page.off('request',countHistory);}
 phase='workspace-history-missing-task';
 const missingTaskURL=origin+'/personal/edit?type=todo&id=ffffffff-ffff-4fff-8fff-ffffffffffff&create=todo';
 await page.goto(missingTaskURL,{waitUntil:'domcontentloaded'});await expect(page.getByRole('dialog',{name:'待办不可用',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'关闭待办详情',exact:true}).click();await page.getByRole('button',{name:'总览',exact:true}).click();
 await page.goBack();await expect(page).toHaveURL(missingTaskURL);await expect(page.getByRole('dialog',{name:'待办不可用',exact:true})).toBeVisible();
 await expect(page.getByRole('dialog',{name:'新建待办',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'关闭待办详情',exact:true}).click();
 phase='restore-personal';await page.setViewportSize({width:1365,height:900});await page.emulateMedia({colorScheme:'light'});await page.goto(origin+'/personal',{waitUntil:'domcontentloaded'});await workspaceReady(page);await readTodo(page,todo,records);return {verifyPersisted:async()=>{await workspaceReady(page);await readTodo(page,todo,records);},entries:[domain,project,todo] as const};
 }catch(error){console.log('PERSONAL_BROWSER_PHASE '+phase);console.log('PERSONAL_BROWSER_FAILURE '+personalBrowserFailureKind(error));console.log('PERSONAL_BROWSER_PRESENTATION '+JSON.stringify(presentationFailure));if(phase.startsWith('workspace-history'))console.log('PERSONAL_HISTORY_DIAGNOSTIC '+JSON.stringify(await personalHistoryDiagnostic(page,historyCanary,historyWrites)));throw Error('PERSONAL_BROWSER_FAILED');}
}

/** Original eight-cell assertions and captures, after recovery and full cleanup. */
export async function verifyPersonalPresentations(page:Page,entries:readonly [PublicEntry,PublicEntry,PublicEntry]):Promise<void>{
 const [domain,project,todo]=entries,records=[domain,project,todo],tasksURL=origin+'/personal?page=tasks',editorURL=origin+'/personal/edit?type=todo&id='+encodeURIComponent(todo.id);
 let phase='matrix',presentationFailure:{reason:PresentationReason;metadata:SafeMetadata}={reason:'not-started',metadata:{}};
 const diagnostic:PresentationDiagnostic=(reason,metadata={})=>{presentationFailure={reason,metadata};};
 try{
 for(const theme of ['light','dark'] as const)for(const width of [1365,360,390,430]){
  phase='workspace-'+width+'-'+theme;await page.goto(tasksURL,{waitUntil:'domcontentloaded'});await presentation(page,'workspace',width,theme,records,todo,diagnostic);
  const keyboardEntry=page.getByRole('button',{name:'打开任务：'+synthetic.title,exact:true});await keyboardEntry.focus();await expect(keyboardEntry).toBeFocused();await expect(keyboardEntry).toBeVisible();const scroll=await taskGridViewport(page).evaluate(node=>{const el=node as HTMLElement;el.scrollLeft=el.scrollWidth;return {internal:['auto','scroll'].includes(getComputedStyle(el).overflowX),overflow:el.scrollWidth>el.clientWidth,moved:el.scrollLeft>0};});assert.equal(scroll.internal,true);if(scroll.overflow)assert.equal(scroll.moved,true);
  await keyboardEntry.press('Enter');const detail=await readyTaskDetail(page,synthetic.title);await detail.getByRole('button',{name:'关闭待办详情',exact:true}).click();await expect(keyboardEntry).toBeFocused();
  phase='editor-'+width+'-'+theme;await page.goto(editorURL,{waitUntil:'domcontentloaded'});await presentation(page,'editor',width,theme,records,todo,diagnostic);
 }

 }catch(error){console.log('PERSONAL_BROWSER_PHASE '+phase);console.log('PERSONAL_BROWSER_FAILURE '+personalBrowserFailureKind(error));console.log('PERSONAL_BROWSER_PRESENTATION '+JSON.stringify(presentationFailure));throw Error('PERSONAL_BROWSER_FAILED');}
}
