import test from 'node:test';
import {EventEmitter} from 'node:events';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve,extname} from 'node:path';
import vm from 'node:vm';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {expect,type Dialog} from '@playwright/test';
import assert from 'node:assert/strict';
import {assertPersonalCapture,personalCaptureAllowedValues,confirmDiscard,installReadonlyPersonalReads,nativeTableRendered,recordFieldLabel,personalBrowserFailureKind,projectPersonalHistoryDiagnostic,type PersonalCapture} from './helpers/personal-workspace-browser-fixture.ts';

// A missing fixture, auth node, foreign record, or arbitrary output path must
// prevent capture, even when the browser otherwise contains synthetic text.
const clean:PersonalCapture={platform:'linux',ci:'true',actions:'true',fresh:'approved-isolated-fixture',database:'postgresql://lifeos_platform_candidate_runtime:fixture-ci-runtime-never-live@127.0.0.1:55432/lifeos_platform_test_local',runnerTemp:'/tmp/fixture',name:'workspace-360-dark.png',url:'https://review.example.test/personal?page=tasks',surface:true,forbidden:0,syntheticVisible:true,values:[''],allowedValues:personalCaptureAllowedValues,recordIds:['synthetic-domain','synthetic-project','synthetic-todo'],expectedIds:['synthetic-domain','synthetic-project','synthetic-todo'],editorId:'synthetic-todo',snapshotComplete:true};
test('personal capture accepts only the synthetic personal presentation',()=>assert.doesNotThrow(()=>assertPersonalCapture(clean)));
test('personal capture rejects authentication, foreign content and arbitrary destinations',()=>{
 for(const changed of [{platform:'darwin'},{ci:'false'},{actions:'false'},{fresh:''},{database:'postgresql://production/real'},{runnerTemp:''},{name:'../workspace-360-dark.png'},{name:'login-desktop.png'},{url:'https://review.example.test/account/mfa'},{url:'https://evil.test/personal'},{url:'https://review.example.test/personal?private=1'},{surface:false},{forbidden:1},{syntheticVisible:false},{values:['private text']},{recordIds:['synthetic-domain','foreign-private']},{recordIds:['synthetic-domain','synthetic-project','synthetic-todo','synthetic-todo']},{snapshotComplete:false}])assert.throws(()=>assertPersonalCapture({...clean,...changed}),/PERSONAL_SCREENSHOT_DENIED/);
});
test('personal editor capture binds the exact original todo ID and fixed dimensions',()=>{
 const editor={...clean,name:'editor-390-light.png',url:'https://review.example.test/personal/edit?type=todo&id=synthetic-todo'};
 assert.doesNotThrow(()=>assertPersonalCapture(editor));
 for(const changed of [{name:'workspace-390-light.png'},{name:'editor-999-light.png'},{url:'https://review.example.test/personal/edit?type=todo&id=foreign-private'},{url:editor.url+'&otp=123456'},{url:editor.url+'#secret'}])assert.throws(()=>assertPersonalCapture({...editor,...changed}),/PERSONAL_SCREENSHOT_DENIED/);
});

function dialogFixture(type='confirm',message='当前修改尚未保存，离开会丢弃这些修改。确定继续吗？'){
 const events=new EventEmitter();let action='',close!:()=>void;
 const closed=new Promise<void>(resolve=>{close=resolve;});
 const finish=()=>{events.emit('dialogclosed',dialog);close();};
 const dialog={type:()=>type,message:()=>message,accept:async()=>{action='accept';finish();},dismiss:async()=>{action='dismiss';finish();}} as Dialog;
 return {events,dialog,closed,action:()=>action};
}
async function watchdog<T>(pending:Promise<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([pending,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('TEST_WATCHDOG')),150);})]);}finally{clearTimeout(timer);}}
function nativeAbort(signal:AbortSignal){return Object.assign(new Error('synthetic native cancellation'),{name:'AbortError',cause:signal.reason});}
function untilAborted(signal:AbortSignal):Promise<void>{return new Promise((_,reject)=>{
 if(signal.aborted){reject(nativeAbort(signal));return;}
 signal.addEventListener('abort',()=>reject(nativeAbort(signal)),{once:true});
});}
function noDialogListeners(events:EventEmitter){assert.equal(events.listenerCount('dialog'),0);assert.equal(events.listenerCount('dialogclosed'),0);}
test('missing discard dialog rejects within its bound and removes its listener',async()=>{
 const f=dialogFixture();await assert.rejects(watchdog(confirmDiscard(f.events as never,false,async()=>{},20)),/PERSONAL_DIALOG_TIMEOUT/);assert.equal(f.events.listenerCount('dialog'),0);
});
test('unexpected discard dialogs close before click finishes and listeners are removed',async()=>{
 for(const [type,message] of [['alert','wrong type'],['confirm','wrong message']]){
  const f=dialogFixture(type,message);const click=async()=>{f.events.emit('dialog',f.dialog);await f.closed;};
  await assert.rejects(watchdog(confirmDiscard(f.events as never,false,click,20)),/PERSONAL_DIALOG_UNEXPECTED/);assert.equal(f.action(),'dismiss');assert.equal(f.events.listenerCount('dialog'),0);
 }
});
test('correct discard dialogs accept or dismiss and clean up before the next operation',async()=>{
 for(const accept of [true,false]){const f=dialogFixture();await confirmDiscard(f.events as never,accept,async()=>{f.events.emit('dialog',f.dialog);await f.closed;},20);assert.equal(f.action(),accept?'accept':'dismiss');assert.equal(f.events.listenerCount('dialog'),0);}
});
test('a received modal is dismissed on click failure or the lifecycle deadline',async()=>{
 for(const failClick of [true,false]){
  const f=dialogFixture();f.dialog.accept=()=>new Promise<void>(()=>{});
  const click=async()=>{f.events.emit('dialog',f.dialog);if(failClick)throw Error('CLICK_FAILED');await f.closed;};
  await assert.rejects(watchdog(confirmDiscard(f.events as never,true,click,20)),failClick?/CLICK_FAILED/:/PERSONAL_DIALOG_TIMEOUT/);
  assert.equal(f.action(),'dismiss');assert.equal(f.events.listenerCount('dialog'),0);
 }
});
test('failed native table engines cannot pass through the keyboard fallback',()=>{
 assert.equal(nativeTableRendered({busy:'false',failures:1,canvases:0,painted:false}),false);
 assert.equal(nativeTableRendered({busy:'false',failures:1,canvases:1,painted:true}),false);
});
test('native table requires a painted canvas after successful initialization',()=>{
 assert.equal(nativeTableRendered({busy:'false',failures:0,canvases:1,painted:true}),true);
 for(const facts of [{busy:'true',failures:0,canvases:1,painted:true},{busy:'false',failures:0,canvases:0,painted:false},{busy:'false',failures:0,canvases:1,painted:false}])assert.equal(nativeTableRendered(facts),false);
});

// Use the locked Playwright engine functions, rather than duplicating its label
// rules. The minimal DOM below implements only the native nodes they traverse.
function vendorLabels(){
 const nativeRequire=createRequire(import.meta.url),root=dirname(nativeRequire.resolve('playwright-core/package.json'));
 const bundle=readFileSync(resolve(root,'lib/coreBundle.js'),'utf8'),literal=bundle.match(/source5 = ('(?:\\.|[^'\\])*');/)?.[1];assert.ok(literal,'installed injected engine source');
 const source=vm.runInNewContext(literal) as string,context=vm.createContext({Node:{TEXT_NODE:3,ELEMENT_NODE:1,COMMENT_NODE:8},HTMLInputElement:class{},normalizedWhitespaceCache:undefined});
 for(const name of ['normalizeWhiteSpace','shouldSkipForTextMatching','elementText','getAriaLabelledByElements','getElementLabels','createTextMatcher']){
  const at=source.indexOf('function '+name+'(');assert.ok(at>=0,'installed engine function '+name);vm.runInContext(source.slice(at,source.indexOf('\n}',at)+2),context);
 }
 return (control:unknown,selector:string)=>{context.control=control;context.selector=selector;return vm.runInContext('getElementLabels(new Map(),control).some(createTextMatcher(selector,true).matcher)',context) as boolean;};
}
function loadProductModule(file:string){
 // Run real product components and their local dependencies; only CSS is omitted.
 const nativeRequire=createRequire(import.meta.url),cache=new Map<string,unknown>();
 function load(file:string):any{
  const path=resolve(file);if(cache.has(path))return cache.get(path);const m={exports:{}};cache.set(path,m.exports);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',code)((name:string)=>{
   if(name.endsWith('.css'))return {__esModule:true,default:{}};if(!name.startsWith('.'))return nativeRequire(name);
   const base=resolve(dirname(path),name),target=extname(base)?base:[base+'.tsx',base+'.ts',base].find(existsSync);assert.ok(target);return load(target);
  },m,m.exports);cache.set(path,m.exports);return m.exports;
 }
 return load(file);
}
function renderRecordForm(type:'todo'|'project'|'domain'){
 const {PersonalRecordForm}=loadProductModule('src/personal-candidate/record-form.tsx');
 return renderToStaticMarkup(React.createElement(PersonalRecordForm,{type,fields:{title:'合成标题',text:'合成已保存正文',date:'',status:'open',personal:type==='project'?{type:'project',stage:'idea',purpose:null,nextStep:'合成下一步',domain:null,topics:[]}:undefined},setFields:()=>{},confirmed:false,setConfirmed:()=>{},options:{domain:[],project:[],topic:[]},allowedTypes:['todo','journal','project','domain','topic'],disabled:false,onSubmit:()=>{},onCancel:()=>{}}));
}
test('actual ThemeSwitch contributes no form values to a synthetic screenshot',()=>{
 const {ThemeSwitch}=loadProductModule('src/workbench/theme-switch.tsx');
 const html=renderToStaticMarkup(React.createElement(ThemeSwitch));
 const values=Array.from(html.matchAll(/<input\b[^>]*\bvalue="([^"]*)"/g),match=>match[1]);
 assert.deepEqual(values,[]);
 assert.match(html,/data-slot="theme-toggle"/);
 assert.doesNotThrow(()=>assertPersonalCapture({...clean,values}));
 assert.throws(()=>assertPersonalCapture({...clean,values:[...values,'foreign-private-input']}),/PERSONAL_SCREENSHOT_DENIED/);
});

function wrappedControls(html:string){
 type NativeNode={nodeName?:string;nodeType:number;nodeValue?:string;firstChild?:NativeNode|null;nextSibling:NativeNode|null;ownerDocument?:{head:null};shadowRoot?:null;getAttribute?:(name:string)=>null;labels?:NativeNode[]};
 const doc={head:null},text=(value:string):NativeNode=>({nodeType:3,nodeValue:value,nextSibling:null});
 function element(name:string,children:NativeNode[]):NativeNode{children.forEach((node,i)=>node.nextSibling=children[i+1]??null);return {nodeName:name,nodeType:1,ownerDocument:doc,firstChild:children[0]??null,nextSibling:null,shadowRoot:null,getAttribute:()=>null};}
 return Array.from(html.matchAll(/<label[^>]*>([^<]*)<(select|textarea)(?:\s[^>]*)?>([\s\S]*?)<\/\2><\/label>/g)).map(([,label,tag,body])=>{
  const children=tag==='select'?Array.from(body.matchAll(/<option[^>]*>([^<]*)<\/option>/g),([,value])=>element('OPTION',[text(value)])):[text(body)];
  const control=element(tag.toUpperCase(),children),wrapper=element('LABEL',[text(label),control]);control.labels=[wrapper];return {label,control};
 });
}
test('actual record form selects and populated textareas match through installed Playwright labels',()=>{
 const matches=vendorLabels();
 for(const type of ['todo','project','domain'] as const){
  const controls=wrappedControls(renderRecordForm(type));assert.ok(controls.length>0);
  for(const {label,control} of controls){
   assert.equal(matches(control,JSON.stringify(label)+'s'),false,'exact matching includes option/textarea descendants');
   assert.deepEqual(controls.filter(row=>matches(row.control,recordFieldLabel(label).toString())).map(row=>row.label),[label]);
  }
  assert.deepEqual(controls.filter(row=>matches(row.control,recordFieldLabel('项目').toString())),[],'field matching must begin with the literal label');
 }
 const literal=wrappedControls('<label>合成.[目标]<textarea>合成正文</textarea></label><label>合成x目标<textarea>合成正文</textarea></label>');
 assert.deepEqual(literal.filter(row=>matches(row.control,recordFieldLabel('合成.[目标]').toString())).map(row=>row.label),['合成.[目标]'],'regex metacharacters in labels remain literal');
});

test('browser failure classification emits only fixed kinds without error details',()=>{
 assert.equal(personalBrowserFailureKind(new assert.AssertionError({message:'synthetic hidden body'})),'assertion');
 assert.equal(personalBrowserFailureKind(Object.assign(new Error('synthetic hidden body'),{name:'TimeoutError'})),'timeout');
 try{expect('synthetic actual').toBe('synthetic expected');assert.fail('expected a Playwright assertion');}catch(error){assert.equal(personalBrowserFailureKind(error),'expectation');}
 for(const error of [new Error('synthetic hidden body'),{message:'synthetic hidden body'},null])assert.equal(personalBrowserFailureKind(error),'other');
});


test('native unload accept and cancel close their modal and clean up listeners',async()=>{
 for(const accept of [true,false]){const f=dialogFixture('beforeunload','');await confirmDiscard(f.events as never,accept,async()=>{f.events.emit('dialog',f.dialog);await f.closed;},20,'beforeunload');assert.equal(f.action(),accept?'accept':'dismiss');assert.equal(f.events.listenerCount('dialog'),0);}
});
test('native cancellation drains a pending history wait before an independent accepted traversal',async()=>{
 const f=dialogFixture('beforeunload','');let settled=false,firstSignal:AbortSignal|undefined;
 await confirmDiscard(f.events as never,false,async(signal:AbortSignal)=>{
  firstSignal=signal;
  const pending=new Promise<void>((resolve,reject)=>{
   // The fallback only drains the old helper's missing-signal RED path.
   if(!signal){setTimeout(resolve,80);return;}
   signal.addEventListener('abort',()=>{settled=true;reject(Object.assign(new Error('synthetic native cancellation'),{name:'AbortError',cause:signal.reason}));},{once:true});
  });
  f.events.emit('dialog',f.dialog);await pending;
 },20,'beforeunload');
 assert.equal(settled,true,'the helper must await its own navigation settlement');assert.equal(firstSignal?.aborted,true);
 let accepted=false;
 await confirmDiscard(f.events as never,true,async(signal:AbortSignal)=>{assert.notEqual(signal,firstSignal);assert.equal(signal.aborted,false);f.events.emit('dialog',f.dialog);await f.closed;accepted=true;},20,'beforeunload');
 assert.equal(accepted,true);assert.equal(f.events.listenerCount('dialog'),0);assert.equal(f.events.listenerCount('dialogclosed'),0);
});
test('native history cancellation accepts only its known aborted traversal after dismissing the modal',async()=>{
 for(const direction of ['Back','Forward']){
  const f=dialogFixture('beforeunload','');await confirmDiscard(f.events as never,false,async()=>{f.events.emit('dialog',f.dialog);await f.closed;throw Error('page.go'+direction+': net::ERR_ABORTED at https://review.example.test/personal/edit');},20,'beforeunload');assert.equal(f.action(),'dismiss');assert.equal(f.events.listenerCount('dialog'),0);
 }
 for(const [accept,message] of [[false,'page.goBack: net::ERR_FAILED'],[true,'page.goBack: net::ERR_ABORTED'],[false,'page.goto: net::ERR_ABORTED']] as const){
  const f=dialogFixture('beforeunload','');await assert.rejects(confirmDiscard(f.events as never,accept,async()=>{f.events.emit('dialog',f.dialog);await f.closed;throw Error(message);},20,'beforeunload'),error=>error instanceof Error&&error.message===message);assert.equal(f.events.listenerCount('dialog'),0);
 }
 const absent=dialogFixture('beforeunload','');await assert.rejects(confirmDiscard(absent.events as never,false,async()=>{throw Error('page.goBack: net::ERR_ABORTED');},20,'beforeunload'),/ERR_ABORTED/);assert.equal(absent.events.listenerCount('dialog'),0);
});
test('native dialog lifecycle bounds missing, unexpected and unfinished modals',async()=>{
 const missing=dialogFixture();await assert.rejects(watchdog(confirmDiscard(missing.events as never,false,async()=>{},20,'beforeunload')),/PERSONAL_DIALOG_TIMEOUT/);assert.equal(missing.events.listenerCount('dialog'),0);
 const wrong=dialogFixture();await assert.rejects(watchdog(confirmDiscard(wrong.events as never,true,async()=>{wrong.events.emit('dialog',wrong.dialog);await wrong.closed;},20,'beforeunload')),/PERSONAL_DIALOG_UNEXPECTED/);assert.equal(wrong.action(),'dismiss');assert.equal(wrong.events.listenerCount('dialog'),0);
 const stalled=dialogFixture('beforeunload','');stalled.dialog.accept=()=>new Promise<void>(()=>{});await assert.rejects(watchdog(confirmDiscard(stalled.events as never,true,async()=>{stalled.events.emit('dialog',stalled.dialog);await stalled.closed;},20,'beforeunload')),/PERSONAL_DIALOG_TIMEOUT/);assert.equal(stalled.action(),'dismiss');assert.equal(stalled.events.listenerCount('dialog'),0);
});

test('native cancellation waits for both dismiss fulfillment and the same modal closure',async()=>{
 const f=dialogFixture('beforeunload',''),foreign=dialogFixture('beforeunload','');let settled=false;
 await confirmDiscard(f.events as never,false,async signal=>{
  const pending=untilAborted(signal).finally(()=>{settled=true;});
  f.dialog.dismiss=async()=>{
   f.events.emit('dialogclosed',foreign.dialog);await Promise.resolve();assert.equal(signal.aborted,false);
   f.events.emit('dialogclosed',f.dialog);await Promise.resolve();assert.equal(signal.aborted,false,'closure alone cannot prove dismiss succeeded');
  };
  f.events.emit('dialog',f.dialog);await pending;
 },20,'beforeunload');
 assert.equal(settled,true);noDialogListeners(f.events);
});
test('fulfilled dismiss without the same closed modal cannot cancel successfully',async()=>{
 for(const foreignClosure of [false,true]){
  const f=dialogFixture('beforeunload',''),foreign=dialogFixture('beforeunload','');let drained=false;
  f.dialog.dismiss=async()=>{if(foreignClosure)f.events.emit('dialogclosed',foreign.dialog);};
  await assert.rejects(watchdog(confirmDiscard(f.events as never,false,async signal=>{
   const pending=untilAborted(signal).finally(()=>{drained=true;});f.events.emit('dialog',f.dialog);await pending;
  },20,'beforeunload')),/PERSONAL_DIALOG_TIMEOUT/);
  assert.equal(drained,true);noDialogListeners(f.events);
 }
});
test('failed or indefinitely pending dismiss never verifies a native cancellation',async()=>{
 for(const stalls of [false,true]){
  const f=dialogFixture('beforeunload','');let drained=false;
  f.dialog.dismiss=stalls?()=>new Promise<void>(()=>{}):async()=>{throw Error('DISMISS_FAILED');};
  await assert.rejects(watchdog(confirmDiscard(f.events as never,false,async signal=>{
   const pending=untilAborted(signal).finally(()=>{drained=true;});f.events.emit('dialog',f.dialog);await pending;
  },20,'beforeunload')),stalls?/PERSONAL_DIALOG_CLEANUP_TIMEOUT/:/DISMISS_FAILED/);
  assert.equal(drained,true);noDialogListeners(f.events);
 }
});
test('wrong native modal cannot turn a pending action cleanup into success',async()=>{
 for(const [type,message,expectedType] of [['alert','','beforeunload'],['confirm','wrong message','confirm']] as const){
  const f=dialogFixture(type,message);let drained=false;
  await assert.rejects(watchdog(confirmDiscard(f.events as never,false,async signal=>{
   const pending=untilAborted(signal).finally(()=>{drained=true;});f.events.emit('dialog',f.dialog);await pending;
  },20,expectedType)),/PERSONAL_DIALOG_UNEXPECTED/);
  assert.equal(drained,true);noDialogListeners(f.events);
 }
});
test('native cancellation preserves real errors and rejects forged AbortError causes',async()=>{
 const foreign=new AbortController();foreign.abort({});
 const errors:unknown[]=[new Error('NETWORK_FAILED'),Object.assign(new Error('navigation timeout'),{name:'TimeoutError'}),new Error('page.goBack: net::ERR_FAILED'),Object.assign(new Error('abort missing cause'),{name:'AbortError'}),Object.assign(new Error('abort string cause'),{name:'AbortError',cause:'synthetic native cancellation'}),Object.assign(new Error('abort foreign cause'),{name:'AbortError',cause:foreign.signal.reason}),Object.assign(new Error('page.goBack: net::ERR_ABORTED'),{name:'AbortError',cause:{}}),{name:'AbortError',cause:{}}];
 for(const error of errors)for(const beforeModal of [true,false]){
  const f=dialogFixture('beforeunload','');
  await assert.rejects(confirmDiscard(f.events as never,false,async()=>{
   if(!beforeModal){f.events.emit('dialog',f.dialog);await f.closed;}throw error;
  },20,'beforeunload'),actual=>actual===error);
  noDialogListeners(f.events);
 }
});
test('throwing the local abort reason itself cannot impersonate the native AbortError',async()=>{
 const f=dialogFixture('beforeunload','');let reason:unknown;
 await assert.rejects(confirmDiscard(f.events as never,false,async signal=>{
  const pending=untilAborted(signal).catch(()=>{reason=signal.reason;throw reason;});f.events.emit('dialog',f.dialog);await pending;
 },20,'beforeunload'),actual=>actual===reason);
 noDialogListeners(f.events);
});
test('a previous invocation cancellation reason cannot authorize another navigation error',async()=>{
 const f=dialogFixture('beforeunload','');let previousReason:unknown;
 await confirmDiscard(f.events as never,false,async signal=>{
  const pending=untilAborted(signal).finally(()=>{previousReason=signal.reason;});f.events.emit('dialog',f.dialog);await pending;
 },20,'beforeunload');
 const forged=Object.assign(new Error('previous invocation'),{name:'AbortError',cause:previousReason});
 await assert.rejects(confirmDiscard(f.events as never,false,async()=>{f.events.emit('dialog',f.dialog);await f.closed;throw forged;},20,'beforeunload'),actual=>actual===forged);
 noDialogListeners(f.events);
});
test('missing modal deadline drains its action with cleanup abort and remains a failure',async()=>{
 const f=dialogFixture('beforeunload','');let drained=false,reason:unknown;
 await assert.rejects(watchdog(confirmDiscard(f.events as never,false,async signal=>{
  try{await untilAborted(signal);}finally{reason=signal.reason;drained=true;}
 },20,'beforeunload')),/PERSONAL_DIALOG_TIMEOUT/);
 assert.equal(drained,true);assert.ok(reason);noDialogListeners(f.events);
 // Cleanup must not leave an old listener to handle the next accepted modal.
 await confirmDiscard(f.events as never,true,async signal=>{assert.equal(signal.aborted,false);f.events.emit('dialog',f.dialog);await f.closed;},20,'beforeunload');noDialogListeners(f.events);
});
test('uncooperative pending action fails bounded cleanup and stops subsequent work',async()=>{
 const f=dialogFixture('beforeunload','');let next=false;
 await assert.rejects(watchdog((async()=>{
  await confirmDiscard(f.events as never,false,async()=>{await new Promise<void>(()=>{});},20,'beforeunload');next=true;
 })()),/PERSONAL_DIALOG_CLEANUP_TIMEOUT/);
 assert.equal(next,false);noDialogListeners(f.events);
});
test('accepted traversal must actually settle and cannot use cancellation errors as success',async()=>{
 const f=dialogFixture('beforeunload','');let finish!:()=>void,returned=false,signalUsed:AbortSignal|undefined;
 const navigating=new Promise<void>(resolve=>{finish=resolve;});
 const pending=confirmDiscard(f.events as never,true,async signal=>{signalUsed=signal;f.events.emit('dialog',f.dialog);await navigating;},100,'beforeunload').then(()=>{returned=true;});
 await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(returned,false);assert.equal(signalUsed?.aborted,false);finish();await pending;noDialogListeners(f.events);
 const error=Object.assign(new Error('unrelated abort'),{name:'AbortError',cause:{}});
 await assert.rejects(confirmDiscard(f.events as never,true,async()=>{f.events.emit('dialog',f.dialog);await f.closed;throw error;},20,'beforeunload'),actual=>actual===error);
 let drained=false;
 await assert.rejects(watchdog(confirmDiscard(f.events as never,true,async signal=>{
  const action=untilAborted(signal).finally(()=>{drained=true;});f.events.emit('dialog',f.dialog);await action;
 },20,'beforeunload')),/PERSONAL_DIALOG_TIMEOUT/);
 assert.equal(drained,true);noDialogListeners(f.events);
});


test('readonly UI captures authentic browser GET bodies before routing and never uses Node route.fetch',async()=>{
 const paths=['https://review.example.test/api/platform/personal/status','https://review.example.test/api/platform/personal/availability'];
 const original=[{scope:'personal-manual-candidate',writable:true,allowedTypes:['todo'],nested:{unchanged:true}},{configured:true,https:true,writable:true,loginAllowed:true}];
 const captured=structuredClone(original),routes=new Map<string,Function>();const events:string[]=[];
 const page={evaluate:async(fn:Function,path:string)=>vm.runInNewContext('('+fn.toString()+')(path)',{path,fetch:async(url:string,init:any)=>{
  assert.deepEqual(JSON.parse(JSON.stringify(init)),{credentials:'same-origin',cache:'no-store'});assert.equal(routes.size,0,'capture must precede all route installation');events.push('read:'+url);return new Response(JSON.stringify(original[paths.indexOf(url)]),{status:200});
 }}),route:async(url:string,handler:Function)=>{events.push('route:'+url);routes.set(url,handler);},unroute:async(url:string,handler:Function)=>{assert.equal(routes.get(url),handler);routes.delete(url);}};
 const cleanup=await installReadonlyPersonalReads(page as never);
 assert.deepEqual(events.slice(0,2).sort(),paths.map(url=>'read:'+url).sort());assert.equal(routes.size,2);
 for(const [index,path] of paths.entries()){
  let fulfilled:any,continued=0;
  const route={request:()=>({url:()=>path,method:()=> 'GET'}),fetch:()=>{throw Error('NODE_DNS_CHANNEL_FORBIDDEN');},fulfill:async(value:any)=>{fulfilled=value;},continue:async()=>{continued++;}};
  await routes.get(path)!(route);assert.deepEqual(JSON.parse(JSON.stringify(fulfilled.json)),{...original[index],writable:false});assert.equal(continued,0);
  fulfilled=undefined;await routes.get(path)!({...route,request:()=>({url:()=>path,method:()=> 'POST'})});assert.equal(fulfilled,undefined);assert.equal(continued,1,'never intercept a mutation');
  await routes.get(path)!({...route,request:()=>({url:()=>path+'?other=1',method:()=> 'GET'})});assert.equal(continued,2,'never intercept a different URL');
 }
 assert.deepEqual(original,captured,'capture and fulfill must not mutate authentic bodies');await cleanup();assert.equal(routes.size,0);
});

test('readonly fixture installs nothing for unverified bodies and cleans up a partial route installation',async()=>{
 for(const failure of ['auth','mode','install']){
  const routes=new Map<string,Function>();let installs=0;
  const page={evaluate:async()=>({ok:failure!=='auth',body:{writable:failure!=='mode'}}),route:async(path:string,handler:Function)=>{if(++installs===2&&failure==='install')throw Error('ROUTE_INSTALL_FAILED');routes.set(path,handler);},unroute:async(path:string)=>{routes.delete(path);}};
  await assert.rejects(installReadonlyPersonalReads(page as never));assert.equal(routes.size,0);if(failure!=='install')assert.equal(installs,0);
 }
});


test('history diagnostic projects finite facts and never emits private values or URLs',()=>{
 const secret='private-history-value';
 assert.deepEqual(projectPersonalHistoryDiagnostic({route:'tasks',markerIndex:1,nativeIndex:2,inputCount:1,canaryMatches:true,focused:false,url:secret,scope:secret,value:secret},0),{route:'tasks',markerIndex:1,nativeIndex:2,inputCount:1,canaryMatches:true,focused:false,writeAttempts:0});
 const result=projectPersonalHistoryDiagnostic({route:secret,markerIndex:secret,nativeIndex:Number.NaN,inputCount:100001,canaryMatches:secret,focused:secret,cookie:secret},-1);
 assert.deepEqual(result,{route:'other',markerIndex:null,nativeIndex:null,inputCount:null,canaryMatches:null,focused:null,writeAttempts:null});
 assert.equal(JSON.stringify(result).includes(secret),false);
 assert.deepEqual(projectPersonalHistoryDiagnostic(null,0),{route:'other',markerIndex:null,nativeIndex:null,inputCount:null,canaryMatches:null,focused:null,writeAttempts:0});
});
