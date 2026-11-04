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

async function readyEditor(page:Page,value?:string){
 await expect(title(page)).toBeEnabled();
 if(value!==undefined)await expect(title(page)).toHaveValue(value);
 await expect(page.getByText('正在读取完整快照…',{exact:true})).toHaveCount(0);
}
async function readyTaskDetail(page:Page,value:string){
 const detail=page.getByRole('dialog',{name:'待办详情',exact:true});
 await expect(detail.getByRole('heading',{name:value,exact:true})).toBeVisible();
 await expect(detail.locator('form')).toHaveCount(0);
 return detail;
}
async function editTask(page:Page,value:string){
 const detail=await readyTaskDetail(page,value);
 await detail.getByRole('button',{name:'编辑待办',exact:true}).click();
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
 await expect(page.getByText('版本 '+entry.revision+' · ID '+entry.id,{exact:true})).toBeVisible();
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
  return {noOverflow:root.scrollWidth<=root.clientWidth,centerDelta:Math.abs(c.x+c.width/2-(kind==='workspace'?m.x+m.width/2:root.clientWidth/2)),left:style.textAlign==='left'||style.textAlign==='start',paper:surface.backgroundColor,ink:surface.color,scheme:getComputedStyle(root).colorScheme,dialogWidth:c.width,dialogHeight:c.height,viewportHeight:innerHeight,inputSize:kind==='editor'?parseFloat(getComputedStyle(content.querySelector('input')!).fontSize):16,text:colors(document.body),control:control?colors(control):null};
 },{kind,width});
 diagnostic('text-measure');const text=renderedContrast(facts.text.foreground,facts.text.layers);
 diagnostic('text',{contrast:text.contrast,alpha:text.foregroundAlpha});assert.equal(text.contrast>=4.5,true,'personal rendered text contrast');
 if(facts.control){diagnostic('control-measure');const control=renderedContrast(facts.control.foreground,facts.control.layers);diagnostic('control',{contrast:control.contrast,alpha:control.foregroundAlpha});assert.equal(control.contrast>=4.5,true,'personal rendered input contrast');}
 diagnostic('overflow',{match:facts.noOverflow});assert.equal(facts.noOverflow,true,'personal document overflow');
 diagnostic('center',{width,centerDelta:facts.centerDelta});assert.equal(width!==1365||facts.centerDelta<=1,true,'personal container center');
 diagnostic('left',{match:facts.left});assert.equal(facts.left,true,'personal text alignment');
 diagnostic('paper',{match:facts.paper===(theme==='dark'?'rgb(31, 31, 31)':'rgb(255, 255, 255)')});assert.equal(facts.paper,theme==='dark'?'rgb(31, 31, 31)':'rgb(255, 255, 255)','personal themed surface');
 diagnostic('ink',{match:facts.ink===(theme==='dark'?'rgb(204, 204, 204)':'rgb(31, 31, 31)')});assert.equal(facts.ink,theme==='dark'?'rgb(204, 204, 204)':'rgb(31, 31, 31)','personal themed ink');
 diagnostic('scheme',{match:facts.scheme===theme});assert.equal(facts.scheme,theme,'personal theme scheme');
 if(kind==='editor'){
  diagnostic('input-size',{match:facts.inputSize>=16});assert.equal(facts.inputSize>=16,true,'editor readable inputs');
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
async function taskRelations(page:Page){const details=form(page).locator('details');if(!await details.evaluate(node=>(node as HTMLDetailsElement).open))await details.locator('summary').click();}
type LatencyPhase='tasks-table-ready'|'native-input-visible'|'editor-form-ready'|'body-next-frame';
// Synthetic fixture only: fixed labels and elapsed numbers, never data or request details.
function latency(phase:LatencyPhase,start:number){const elapsedMs=performance.now()-start;assert.equal(Number.isFinite(elapsedMs)&&elapsedMs>=0,true);console.log('PERSONAL_LATENCY',JSON.stringify({phase,elapsedMs:Math.round(elapsedMs*100)/100}));}
/** Runs once inside the existing authenticated MFA lifecycle; no extra login. */
export async function verifyPersonalWorkspace(page:Page){
 let phase='empty-workspace-ready';
 let presentationFailure:{reason:PresentationReason;metadata:SafeMetadata}={reason:'not-started',metadata:{}};
 const diagnostic:PresentationDiagnostic=(reason,metadata={})=>{presentationFailure={reason,metadata:Object.fromEntries(Object.entries(metadata).filter(([,value])=>typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value))))};};
 try{
 await workspaceReady(page);const initial=await overview(page);assert.equal(initial.total,0);assert.deepEqual(initial.items,[]);
 phase='workspace-capabilities';const access=await json(page,'/api/platform/personal/status');assert.equal(access.writable,true);assert.deepEqual(access.allowedTypes,['todo','journal','project','domain','topic']);
 phase='cancel-empty';await page.getByRole('button',{name:'新建待办',exact:true}).click();await readyEditor(page,'');await taskRelations(page);
 for(const label of ['项目','领域']){await expect(recordField(page,label)).toHaveValue('');await expect(recordField(page,label).locator('option')).toHaveCount(1);}
 await page.getByRole('button',{name:'关闭待办编辑',exact:true}).click();assert.equal((await overview(page)).total,0);
 phase='create-domain';await page.getByRole('button',{name:'待办',exact:true}).click();await page.getByText('分类管理',{exact:true}).click();await page.locator('[aria-label="分类管理"]').getByRole('link',{name:'新建 / 管理领域',exact:true}).click();await readyEditor(page,'');
 await title(page).fill(synthetic.domain);await recordField(page,'说明 / 正文').fill('隔离合成领域说明');const domain=await save(page,'domain');
 await page.getByRole('link',{name:'返回总览',exact:true}).click();await workspaceReady(page);await page.getByRole('button',{name:'待办',exact:true}).click();await page.getByText('分类管理',{exact:true}).click();
 await page.locator('[aria-label="分类管理"]').getByRole('link',{name:'新建 / 管理项目',exact:true}).click();await readyEditor(page,'');
 phase='create-project';await title(page).fill(synthetic.project);await recordField(page,'目标').fill('隔离合成项目目标');await selectReference(page,'所属领域',domain);const project=await save(page,'project');assert.deepEqual((project.draft as {personal:{domain:unknown}}).personal.domain,reference(domain));
 await page.getByRole('link',{name:'返回总览',exact:true}).click();await workspaceReady(page);await page.getByRole('button',{name:'待办',exact:true}).click();await page.getByRole('button',{name:'新建待办',exact:true}).click();await readyEditor(page,'');
 phase='create-todo';await title(page).fill(synthetic.initial);await recordField(page,'正文').fill(synthetic.notes);await recordField(page,'到期日').fill(synthetic.date);let todo=await saveTask(page);assert.equal('status'in todo.draft?todo.draft.status:null,'open');
 await page.getByRole('group',{name:'待办视图',exact:true}).getByRole('button',{name:'列表',exact:true}).click();
 const trigger=page.getByRole('button',{name:'查看待办：'+synthetic.initial,exact:true});const editorStart=performance.now();await trigger.click();await editTask(page,synthetic.initial);latency('editor-form-ready',editorStart);
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
 const undoReceipt=page.waitForResponse(r=>r.url()===origin+'/api/platform/personal/todo/'+todo.id&&r.request().method()==='PATCH');await page.getByRole('button',{name:'撤销',exact:true}).click();todo=(await(await undoReceipt).json()).entry;assert.equal('status'in todo.draft?todo.draft.status:null,'in_progress');await readTodo(page,todo,[domain,project,todo]);
 phase='native-table-view';await page.getByRole('group',{name:'待办视图',exact:true}).getByRole('button',{name:'表格',exact:true}).click();phase='native-paint-ready';await requireNativeTable(page);
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
 phase='overview-inline-edit';await page.getByRole('button',{name:'总览',exact:true}).click();
 const inlineTitle=page.getByRole('button',{name:'就地编辑：'+synthetic.title,exact:true});
 await inlineTitle.dblclick();
 const inline=page.getByRole('region',{name:'编辑待办',exact:true});
 await expect(inline).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);
 const inputTitle=inline.getByLabel('标题',{exact:true});await expect(inputTitle).toBeFocused();
 await inputTitle.fill('合成未保存总览草稿');await confirmDiscard(page,false,async()=>{await page.getByRole('button',{name:'设置',exact:true}).click();});
 await expect(inputTitle).toHaveValue('合成未保存总览草稿');
 await inputTitle.fill(synthetic.title);await recordField(page,'正文').fill('合成总览编辑回读');
 todo=await saveTask(page,todo);await expect(inline).toHaveCount(0);await expect(inlineTitle).toBeFocused();
 await readTodo(page,todo,[domain,project,todo]);
 await page.getByRole('button',{name:'展开详情：'+synthetic.title,exact:true}).click();
 const expanded=await readyTaskDetail(page,synthetic.title);await expect(expanded.getByText('合成总览编辑回读',{exact:true})).toBeVisible();
 await expanded.getByRole('button',{name:'编辑待办',exact:true}).click();
 await recordField(page,'正文').fill(synthetic.editedNotes);todo=await saveTask(page,todo);
 phase='settings-actions';await page.getByRole('button',{name:'设置',exact:true}).click();
 await expect(page.getByRole('link',{name:'修改密码',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'退出登录',exact:true})).toBeVisible();
 await expect(page.getByText(/登录状态|数据权限|数据管理与导出|分类管理/)).toHaveCount(0);
 const records=[domain,project,todo];
 phase='readonly-ui';const cleanupReadonly=await installReadonlyPersonalReads(page);let mutations=0;const count=(request:import('@playwright/test').Request)=>{if(['POST','PATCH'].includes(request.method()))mutations++;};page.on('request',count);
 try{await page.goto(tasksURL,{waitUntil:'domcontentloaded'});await expect(page.getByRole('button',{name:'新建待办',exact:true})).toBeDisabled();await page.getByRole('group',{name:'待办视图',exact:true}).getByRole('button',{name:'列表',exact:true}).click();await expect(page.getByRole('button',{name:'查看待办：'+synthetic.title,exact:true})).toBeVisible();const complete=page.getByRole('button',{name:'完成：'+synthetic.title,exact:true});await expect(complete).toBeDisabled();await complete.evaluate((node:HTMLElement)=>node.click());await expect(page.getByText('分类管理',{exact:true})).toBeVisible();await page.getByText('分类管理',{exact:true}).click();await expect(page.locator('[aria-label="分类管理"] a')).toHaveCount(0);
 await page.goto(editorURL,{waitUntil:'domcontentloaded'});
 const detail=await readyTaskDetail(page,synthetic.title);
 await expect(detail.getByRole('status').filter({hasText:'当前为只读'})).toBeVisible();
 await expect(detail.getByText(synthetic.editedNotes,{exact:true})).toBeVisible();
 await expect(detail.getByText(synthetic.editedDate,{exact:true})).toBeVisible();
 await expect(detail.getByRole('button',{name:'编辑待办',exact:true})).toHaveCount(0);
 assert.equal(mutations,0,'readonly UI attempted mutations');
 }finally{await cleanupReadonly();page.off('request',count);assert.equal((await json(page,'/api/platform/personal/status')).writable,true);assert.equal((await json(page,'/api/platform/personal/availability')).writable,true);await page.goto(editorURL,{waitUntil:'domcontentloaded'});await verifyFields();}
 phase='restore-personal';await page.setViewportSize({width:1365,height:900});await page.emulateMedia({colorScheme:'light'});await page.goto(origin+'/personal',{waitUntil:'domcontentloaded'});await workspaceReady(page);await readTodo(page,todo,records);return {verifyPersisted:async()=>{await workspaceReady(page);await readTodo(page,todo,records);},entries:[domain,project,todo] as const};
 }catch(error){console.log('PERSONAL_BROWSER_PHASE '+phase);console.log('PERSONAL_BROWSER_FAILURE '+personalBrowserFailureKind(error));console.log('PERSONAL_BROWSER_PRESENTATION '+JSON.stringify(presentationFailure));throw Error('PERSONAL_BROWSER_FAILED');}
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
