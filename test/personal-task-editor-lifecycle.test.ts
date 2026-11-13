import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {makePersonalCommand} from '../src/personal-candidate/client.ts';
import{TaskCellDraftMemory}from'../src/personal-candidate/task-cell-draft.ts';
import {PersonalWorkspaceController} from '../src/personal-candidate/workspace-controller.ts';
import * as editorModule from '../src/personal-candidate/editor.ts';
import * as stateModule from '../src/personal-candidate/task-editor-state.ts';
import * as themeModule from '../src/workbench/theme.ts';

type Node={type:unknown;props:Record<string,any>;key?:unknown};
function find(node:any,predicate:(node:Node)=>boolean):Node|undefined{if(!node||typeof node!=='object')return;if(Array.isArray(node)){for(const child of node){const result=find(child,predicate);if(result)return result;}return;}return predicate(node)?node:find(node.props?.children,predicate);}
function text(node:any):string{if(node==null||typeof node==='boolean')return '';if(Array.isArray(node))return node.map(text).join('');if(typeof node!=='object')return String(node);return String(node.props?.value??'')+text(node.props?.children);}
const flush=async()=>{for(let i=0;i<8;i++)await new Promise<void>(r=>setImmediate(r));};
function fixture(writable=true){
 const id='11111111-1111-4111-8111-111111111111';let owner='fixture-owner',space='fixture-space',revision=3,title='Original title',notes='Original notes',gate:Promise<void>|null=null,release:(()=>void)|null=null,retained:any=null,loseTask=false,deleted=false;let personal:any=undefined;const extras:any[]=[];const taskReceipts=new Map<string,any>(),taskRequests:any[]=[];const storage=new Map<string,string>(),writes:string[]=[],reads:string[]=[];
 const fetcher:typeof fetch=async(input,init)=>{const path=String(input);reads.push(path);if(path.endsWith('/availability'))return Response.json({configured:true,loginAllowed:true,https:true});if(path.endsWith('/status')){if(gate)await gate;return Response.json({scope:'personal-manual-candidate',ownerId:owner,spaceId:space,storageVerified:true,writable,allowedTypes:['todo','journal']});}if(path.includes('/overview')){const today=new URL(path,'https://fixture.invalid').searchParams.get('today');return Response.json({items:[...(deleted?[]:[{id,kind:'todo',draft:{title,notes,dueOn:null,status:'open',...(personal?{personal}:{})},source:{id:'22222222-2222-4222-8222-222222222222',system:'website',externalId:id,version:1,asOf:'2026-10-27T00:00:00Z',original:{marker:'personal-manual-v1',spaceId:space,type:'todo',input:{}}},revision,syncState:'draft',externalStatus:null}]),...extras],total:(deleted?0:1)+extras.length,scope:'full-current-snapshot',truncated:false,today,observedAt:'2026-10-27T00:00:00Z'});}if(path==='/api/platform/personal/todo/'+id&&init?.method==='PATCH'){const key=new Headers(init.headers).get('idempotency-key')!,body=JSON.parse(String(init.body));taskRequests.push({key,body});writes.push(path);const duplicate=taskReceipts.has(key);if(!duplicate){revision=body.expectedRevision+1;title=body.fields.title;notes=body.fields.notes;taskReceipts.set(key,{id,kind:'todo',draft:body.fields,source:{id:'22222222-2222-4222-8222-222222222222',system:'website',externalId:id,version:1,asOf:'2026-10-27T00:00:00Z',original:{marker:'personal-manual-v1',spaceId:space,type:'todo',input:{}}},revision,syncState:'draft',externalStatus:null});}if(loseTask){loseTask=false;throw Error('lost after commit');}return Response.json({entry:taskReceipts.get(key),duplicate});}if(retained&&path==='/api/platform/personal/journal'){assert.equal(new Headers(init?.headers).get('idempotency-key'),retained.command.key);assert.deepEqual(JSON.parse(String(init?.body)),retained.command.body);writes.push(path);return Response.json({entry:retained.entry,duplicate:true},{status:201});}writes.push(path);throw Error('unexpected mutation '+path);};
 return{id,fetcher,writes,storage,taskRequests,withTopics(){const available={id:'33333333-3333-4333-8333-333333333333',sourceId:'44444444-4444-4444-8444-444444444444',revision:2},missing={id:'55555555-5555-4555-8555-555555555555',sourceId:'66666666-6666-4666-8666-666666666666',revision:7};personal={domain:null,project:null,topics:[missing,available]};extras.push({id:available.id,kind:'inbox',draft:{title:'Available synthetic topic',text:'',occurredOn:null,disposition:'reference',personal:{type:'topic'}},source:{id:available.sourceId,system:'website',externalId:available.id,version:1,asOf:'2026-10-27T00:00:00Z',original:{marker:'personal-manual-v1',spaceId:space,type:'topic',input:{}}},revision:available.revision,syncState:'draft',externalStatus:null});return{available,missing};},loseTaskResponse(){loseTask=true;},pendingJournal(){const command=makePersonalCommand({ownerId:owner,spaceId:space},'journal',null,{title:'Retained journal',text:'Journal pending text',occurredOn:null},'retained-journal-ui',true);const recordId='99999999-9999-4999-8999-999999999999';retained={command,entry:{id:recordId,kind:'inbox',draft:{...command.body.fields,disposition:'reference'},source:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',system:'website',externalId:recordId,version:1,asOf:'2026-10-27T00:00:00Z',original:{marker:'personal-manual-v1',spaceId:space,type:'journal',input:command.body}},revision:1,syncState:'draft',externalStatus:null}};storage.set('lifeos.personal.pending.v1:'+owner+':'+space,JSON.stringify(command));},holdIdentity(){gate=new Promise<void>(r=>release=r);},releaseIdentity(){gate=null;release?.();},changeBinding(mode:'owner'|'space'){if(mode==='owner')owner='other-owner';else space='other-space';title='Other binding title';notes='Other binding notes';},remoteEdit(){revision++;title='Remote updated title';notes='Remote updated notes';},remoteDelete(){deleted=true;}};
}
/** Runs the real host, controller and editor with separate hook lifecycles; only React/DOM and Radix boundaries are stubbed. */
function harness(f:ReturnType<typeof fixture>,storageAvailable=true){
 let changed=false,actions:any,editorMounted=false,allowDiscard=false,confirms=0;type Effect={run:()=>void|(()=>void);deps:any[];cleanup?:()=>void;pending:boolean};
 function hooks(){let cursor=0;const values:any[]=[],effects=new Map<number,Effect>();return{reset(){cursor=0;},react:{useRef(value:any){const at=cursor++;return values[at]??(values[at]={current:value});},useState(initial:any){const at=cursor++;if(!(at in values))values[at]=typeof initial==='function'?initial():initial;return[values[at],(next:any)=>{values[at]=typeof next==='function'?next(values[at]):next;changed=true;}];},useEffect(run:Effect['run'],deps:any[]){const at=cursor++,old=effects.get(at);if(!old||deps.some((v,i)=>v!==old.deps[i]))effects.set(at,{run,deps,cleanup:old?.cleanup,pending:true});}},effects(){for(const effect of effects.values())if(effect.pending){effect.pending=false;effect.cleanup?.();effect.cleanup=effect.run()||undefined;}},dispose(){for(const effect of effects.values())effect.cleanup?.();effects.clear();values.length=0;}};}
 const hostHooks=hooks(),editorHooks=hooks(),listeners=new Map<string,Set<Function>>();
 const listen={addEventListener(name:string,fn:Function){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(fn);},removeEventListener(name:string,fn:Function){listeners.get(name)?.delete(fn);}};
 const document={...listen,activeElement:null,visibilityState:'visible',documentElement:{dataset:{} as Record<string,string>,style:{} as Record<string,string>}},window={...listen,matchMedia:()=>({matches:false}),localStorage:{setItem:(key:string,value:string)=>f.storage.set(key,value)},location:{origin:'https://fixture.invalid',assign:()=>assert.fail('unexpected navigation')},sessionStorage:{getItem:(k:string)=>f.storage.get(k)??null,setItem:(k:string,v:string)=>f.storage.set(k,v),removeItem:(k:string)=>f.storage.delete(k)},confirm:()=>{confirms++;return allowDiscard;}};
 if(!storageAvailable)Object.defineProperty(window,'sessionStorage',{get(){throw Error('Synthetic storage denied');}});
 const jsx={jsx:(type:unknown,props:Record<string,any>,key?:unknown)=>({type,props,key}),jsxs:(type:unknown,props:Record<string,any>,key?:unknown)=>({type,props,key}),Fragment:'fragment'};
 function load(path:string,imports:Record<string,unknown>){const module={exports:{} as Record<string,any>},code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports','window','document','fetch',code)((key:string)=>{assert.ok(key in imports,'unexpected import '+key);return imports[key];},module,module.exports,window,document,f.fetcher);return module.exports;}
 const themeStore=load('../src/workbench/theme-store.ts',{'./theme':themeModule}).createThemeStore();
 const planning=load('../src/personal-candidate/planning-inputs.tsx',{'react/jsx-runtime':jsx});
 const editor=load('../src/personal-candidate/task-editor.tsx',{'react/jsx-runtime':jsx,react:editorHooks.react,'../ui-review/ui/dialog':{Dialog:'dialog-root',DialogContent:'dialog-content',DialogTitle:'h2',DialogDescription:'p'},'./planning-inputs':planning,'./editor':editorModule,'./task-editor-state':stateModule,'./task-editor.module.css':{default:{}}});
 const host=load('../src/personal-candidate/connected-workspace.tsx',{'react/jsx-runtime':jsx,react:hostHooks.react,'./workspace-controller':{PersonalWorkspaceController},'./task-editor':editor,'./task-batch-editor':{TaskBatchEditor:()=>null},'./task-editor.module.css':{default:{}},'./editor':editorModule,'./task-editor-state':stateModule,'./task-cell-draft':{TaskCellDraftMemory},'react-dom':{flushSync:(fn:()=>void)=>fn()}});
 let tree:any;
 function render(){for(let iteration=0;iteration<10;iteration++){changed=false;hostHooks.reset();const hostTree=host.ConnectedPersonalWorkspace({children:(props:any)=>{actions=props;return {type:'workspace',props:{children:[props.state.status==='ready'?props.state.data.tasks.map((t:any)=>t.title):props.state.status,props.inlineTask?.content]}};}});const node=find(hostTree,n=>n.type===editor.TaskEditor);if(node){editorMounted=true;editorHooks.reset();const editorTree=editor.TaskEditor(node.props);tree=[hostTree.props.children[0],editorTree];editorHooks.effects();}else{if(editorMounted)editorHooks.dispose();editorMounted=false;tree=hostTree;}hostHooks.effects();if(!changed)return tree;}throw Error('render loop did not settle');}
 return{render,unload(){let prevented=0;for(const fn of listeners.get('beforeunload')??[])fn({preventDefault(){prevented++;},returnValue:''});return prevented;},allowDiscard:(value:boolean)=>{allowDiscard=value;},confirms:()=>confirms,appearance:(mode:string)=>themeStore.setPreference(mode),theme:()=>document.documentElement.dataset.lifeosTheme,actions:()=>actions,hidden(){document.visibilityState='hidden';for(const fn of listeners.get('visibilitychange')??[])fn();return render();},visible(){document.visibilityState='visible';for(const fn of listeners.get('visibilitychange')??[])fn();return render();},dispose(){hostHooks.dispose();editorHooks.dispose();}};
}
function enterEdit(h:ReturnType<typeof harness>){
 const detail=h.render();
 assert.match(text(detail),/待办详情/);
 assert.ok(find(detail,node=>node.type==='form'));
 assert.equal(find(detail,node=>node.type==='button'&&text(node)==='编辑待办'),undefined);
 return detail;
}
function dirty(h:ReturnType<typeof harness>,id:string){h.actions().onOpenTask({id,revision:3});let tree=enterEdit(h);find(tree,n=>n.type==='input'&&n.props.maxLength===240)!.props.onChange({target:{value:'Unsaved title'}});tree=h.render();find(tree,n=>n.type==='textarea')!.props.onChange({target:{value:'Unsaved private notes'}});return h.render();}

test('detail uses the refreshed same-binding revision and hides a removed task',async()=>{
 const f=fixture(),h=harness(f);
 try{
  h.render();await flush();h.render();
  h.actions().onOpenTask({id:f.id,revision:3});
  assert.equal(find(h.render(),node=>node.type==='input'&&node.props.maxLength===240)?.props.value,'Original title');
  h.hidden();f.remoteEdit();h.visible();await flush();
  assert.equal(find(h.render(),node=>node.type==='input'&&node.props.maxLength===240)?.props.value,'Remote updated title');
  let editor=enterEdit(h);
  assert.equal(find(editor,node=>node.type==='textarea')?.props.value,'Remote updated notes');
  find(editor,node=>node.type==='textarea')!.props.onChange({target:{value:'New local note'}});
  editor=h.render();
  await find(editor,node=>node.type==='form')!.props.onSubmit({preventDefault(){}});
  assert.equal(f.taskRequests[0].body.expectedRevision,4);

  h.render();h.actions().onOpenTask({id:f.id,revision:5});h.render();
  h.hidden();f.remoteDelete();h.visible();await flush();
  const removed=h.render();
  assert.match(text(removed),/待办不可用/);
  assert.doesNotMatch(text(removed),/Remote updated title|New local note/);
  assert.equal(find(removed,node=>node.type==='form'),undefined);
 }finally{h.dispose();}
});
test('dirty editor conceals on hidden and restores its memory fields only after fresh same-binding verification',async()=>{
 const f=fixture(),h=harness(f);h.render();await flush();h.render();assert.match(text(dirty(h,f.id)),/Unsaved title/);assert.doesNotMatch(text(h.hidden()),/Unsaved title|Unsaved private notes|Original title/);
 f.holdIdentity();assert.doesNotMatch(text(h.visible()),/Unsaved title|Unsaved private notes|Original title/);await flush();assert.doesNotMatch(text(h.render()),/Unsaved title|Unsaved private notes/);f.releaseIdentity();await flush();const restored=h.render();assert.equal(find(restored,n=>n.type==='input'&&n.props.maxLength===240)?.props.value,'Unsaved title');assert.equal(find(restored,n=>n.type==='textarea')?.props.value,'Unsaved private notes');assert.equal(f.writes.length,0);assert.equal(f.storage.size,0);h.dispose();
});
test('owner or space changes discard concealed drafts without exposing old inputs in the new binding',async()=>{
 for(const mode of ['owner','space'] as const){const f=fixture(),h=harness(f);h.render();await flush();h.render();dirty(h,f.id);h.hidden();f.changeBinding(mode);h.visible();await flush();const tree=h.render();assert.doesNotMatch(text(tree),/Unsaved title|Unsaved private notes|Original title/);assert.equal(find(tree,n=>n.type==='textarea'),undefined);h.actions().onOpenTask({id:f.id,revision:3});const fresh=h.render();assert.equal(find(fresh,n=>n.type==='input'&&n.props.maxLength===240)?.props.value,'Other binding title');assert.match(text(fresh),/Other binding notes/);assert.ok(find(fresh,n=>n.type==='form'));assert.equal(f.storage.size,0);h.dispose();}
});
test('a newer same-binding entry never replaces a dirty draft and old-revision saving retains it for correction',async()=>{
 const f=fixture(),h=harness(f);h.render();await flush();h.render();dirty(h,f.id);h.hidden();f.remoteEdit();h.visible();await flush();let tree=h.render();assert.equal(find(tree,n=>n.type==='textarea')?.props.value,'Unsaved private notes');await find(tree,n=>n.type==='form')!.props.onSubmit({preventDefault(){}});tree=h.render();assert.equal(find(tree,n=>n.type==='textarea')?.props.value,'Unsaved private notes');assert.match(text(tree),/版本/);assert.equal(f.writes.length,0);h.dispose();
});

test('recovering an unrelated shared command keeps the concealed task draft and restores its edit controls',async()=>{
 const f=fixture(),h=harness(f);h.render();await flush();h.render();dirty(h,f.id);h.hidden();f.pendingJournal();h.visible();await flush();let tree=h.render();assert.equal(find(tree,n=>n.type==='textarea')?.props.value,'Unsaved private notes');assert.equal(h.actions().uncertain,true);
 await find(tree,n=>n.type==='button'&&text(n)==='重试同一请求')!.props.onClick();tree=h.render();assert.equal(h.actions().uncertain,false);assert.equal(f.storage.size,0);assert.equal(find(tree,n=>n.type==='input'&&n.props.maxLength===240)?.props.value,'Unsaved title');assert.equal(find(tree,n=>n.type==='textarea')?.props.value,'Unsaved private notes');assert.equal(find(tree,n=>n.type==='fieldset')?.props.disabled,false);assert.deepEqual(f.writes,['/api/platform/personal/journal']);h.dispose();
});

test('the detail editor closes only after its own submitted fields are confirmed on retry',async()=>{
 const f=fixture(),h=harness(f);
 try{
  h.render();await flush();h.render();dirty(h,f.id);f.loseTaskResponse();
  await find(h.render(),n=>n.type==='form')!.props.onSubmit({preventDefault(){}});
  let tree=h.render();assert.equal(h.actions().uncertain,true);
  assert.equal(find(tree,n=>n.type==='textarea')?.props.value,'Unsaved private notes');
  assert.equal(h.actions().onBeforeNavigate(),false);
  h.hidden();h.visible();await flush();
  await find(h.render(),n=>n.type==='button'&&text(n)==='重试同一请求')!.props.onClick();
  tree=h.render();assert.equal(h.actions().uncertain,false);
  assert.equal(find(tree,n=>n.type==='textarea'),undefined);assert.equal(f.storage.size,0);
  assert.equal(f.taskRequests.length,2);assert.deepEqual(f.taskRequests[0],f.taskRequests[1]);
  assert.equal(h.actions().state.data.tasks[0].revision,4);
 }finally{h.dispose();}
});

// Catches a controller cancellation that clears saving but leaves the editor awaiting preflight.
test('stopping a held preflight unlocks the same form and retains its draft before the response arrives',async()=>{
 const f=fixture(),h=harness(f);h.render();await flush();h.render();let tree=dirty(h,f.id);f.holdIdentity();let settled=false;const submission=find(tree,n=>n.type==='form')!.props.onSubmit({preventDefault(){}}).then(()=>{settled=true;});tree=h.render();assert.equal(find(tree,n=>n.type==='fieldset')?.props.disabled,true);find(tree,n=>n.type==='button'&&text(n)==='停止等待并保留请求')!.props.onClick();await flush();
 try{tree=h.render();assert.equal(settled,true,'Form submission must settle while preflight is still held');assert.equal(find(tree,n=>n.type==='fieldset')?.props.disabled,false);assert.equal(find(tree,n=>n.type==='input'&&n.props.maxLength===240)?.props.value,'Unsaved title');assert.equal(find(tree,n=>n.type==='textarea')?.props.value,'Unsaved private notes');assert.equal(f.writes.length,0);assert.equal(f.storage.size,0);}finally{f.releaseIdentity();await submission;await flush();h.dispose();}assert.equal(f.writes.length,0);
});

// Catches selected references disappearing from the editor simply because option rows are unavailable.
test('an unavailable selected topic is anonymous and removable while saving preserves remaining stable references',async()=>{
 const f=fixture(),refs=f.withTopics(),h=harness(f);h.render();await flush();h.render();h.actions().onOpenTask({id:f.id,revision:3});let tree=enterEdit(h);
 try{assert.doesNotMatch(text(tree),new RegExp(refs.missing.id+'|'+refs.missing.sourceId));const unavailable=find(tree,n=>n.type==='label'&&text(n).includes('不可用标签'));assert.ok(unavailable,'Selected unavailable topic must have a removal control');const checkbox=find(unavailable,n=>n.type==='input'&&n.props.type==='checkbox')!;assert.equal(checkbox.props.checked,true);await find(tree,n=>n.type==='form')!.props.onSubmit({preventDefault(){}});assert.equal(f.writes.length,0,'Unresolved references must still fail existing checks');tree=h.render();find(find(tree,n=>n.type==='label'&&text(n).includes('不可用标签')),n=>n.type==='input')!.props.onChange({target:{checked:false}});tree=h.render();assert.doesNotMatch(text(tree),/不可用标签/);assert.equal(find(tree,n=>n.type==='input'&&n.props.type==='checkbox')?.props.checked,true);await find(tree,n=>n.type==='form')!.props.onSubmit({preventDefault(){}});tree=h.render();assert.equal(f.writes.length,1);assert.deepEqual(f.taskRequests[0].body.fields.personal,{domain:null,project:null,topics:[refs.available]});assert.equal(f.taskRequests[0].body.expectedRevision,3);assert.equal(find(tree,n=>n.type==='textarea'),undefined);}finally{h.dispose();}
});


test('changing shared appearance while the real task editor is dirty preserves its input and save identity',async()=>{
 const f=fixture(),h=harness(f);h.render();await flush();h.render();dirty(h,f.id);
 for(const mode of ['dark','light','system']){h.appearance(mode);const tree=h.render();assert.equal(find(tree,n=>n.type==='input'&&n.props.maxLength===240)?.props.value,'Unsaved title');assert.equal(find(tree,n=>n.type==='textarea')?.props.value,'Unsaved private notes');assert.equal(h.theme(),mode==='system'?'light':mode);}
 assert.equal(f.writes.length,0);assert.deepEqual([...f.storage], [['lifeos-ui-theme','system']]);
 await find(h.render(),n=>n.type==='form')!.props.onSubmit({preventDefault(){}});await flush();h.render();
 assert.equal(f.taskRequests.length,1);assert.equal(f.taskRequests[0].body.expectedRevision,3);assert.equal(f.taskRequests[0].body.fields.title,'Unsaved title');assert.equal(f.taskRequests[0].body.fields.notes,'Unsaved private notes');h.dispose();
});

test('navigation cancellation keeps the active detail fields and accepted discard closes once',async()=>{
 const f=fixture(),h=harness(f);
 try{
  h.render();await flush();h.render();dirty(h,f.id);
  assert.equal(h.actions().onBeforeNavigate(),false);
  assert.equal(find(h.render(),n=>n.type==='textarea')?.props.value,'Unsaved private notes');
  const before=h.confirms();h.allowDiscard(true);
  assert.equal(h.actions().onBeforeNavigate(),true);
  assert.equal(h.confirms(),before+1);
  assert.equal(h.unload(),0,'Approved navigation must not trigger a second native unload prompt');
  assert.equal(find(h.render(),n=>n.type==='form'),undefined);
  assert.equal(f.writes.length,0);
 }finally{h.dispose();}
});

test('a stale navigation callback reads the synchronous pending mutation state',async()=>{
 const f=fixture(),h=harness(f);
 try{
  h.render();await flush();h.render();dirty(h,f.id);
  const stale=h.actions().onBeforeNavigate;f.holdIdentity();
  const pending=find(h.render(),n=>n.type==='form')!.props.onSubmit({preventDefault(){}});
  assert.equal(stale(),false);
  f.releaseIdentity();await pending;
 }finally{h.dispose();}
});

test('field drafts use the same navigation guard and retain their original revision when cancelled',async()=>{
 const f=fixture(),h=harness(f);
 try{
  h.render();await flush();h.render();
  const memory=h.actions().taskCellDraftMemory;
  memory.claim({id:f.id,revision:3},'title',()=>true)({task:{id:f.id,revision:3},fields:{title:'Original title',text:'Original notes',date:'',status:'open'},field:'title',value:'Unsubmitted title'});
  assert.equal(h.actions().onBeforeNavigate(),false);
  assert.equal(memory.read().value,'Unsubmitted title');
  assert.equal(h.actions().onOpenTask({id:f.id,revision:3}),false);
  h.allowDiscard(true);
  assert.equal(h.actions().onOpenTask({id:f.id,revision:3}),true);
  assert.equal(memory.read(),null);
  assert.ok(find(h.render(),n=>n.type==='form'));
  assert.equal(f.writes.length,0);
 }finally{h.dispose();}
});

test('read-only detail opens without an editing step or write controls',async()=>{
 const f=fixture(false),h=harness(f);
 try{
  h.render();await flush();h.render();
  h.actions().onOpenTask({id:f.id,revision:3});
  const tree=h.render();assert.match(text(tree),/Original notes/);
  assert.equal(find(tree,n=>n.type==='form'),undefined);
  assert.equal(find(tree,n=>n.type==='button'&&text(n)==='编辑待办'),undefined);
  assert.equal(f.writes.length,0);
 }finally{h.dispose();}
});

test('denied command storage blocks direct save and status callbacks even when the server is writable',async()=>{
 const f=fixture(),h=harness(f,false);
 try{
  h.render();await flush();h.render();
  assert.equal(h.actions().access.writable,false);
  h.actions().onSetTaskStatus({id:f.id,revision:3},'done');
  assert.equal(await h.actions().onSaveTask({id:f.id,revision:3},{title:'New title',text:'Notes',date:'',status:'open'}),null);
  assert.equal(f.writes.length,0);
 }finally{h.dispose();}
});

test('new task exposes optional project and domain directly and hides business label editing',async()=>{
 const f=fixture(),h=harness(f);try{h.render();await flush();h.render();h.actions().onCreateTask();const tree=h.render();
 assert.ok(find(tree,n=>n.type==='label'&&text(n).startsWith('领域')&&!!find(n,x=>x.type==='select')));
 assert.ok(find(tree,n=>n.type==='label'&&text(n).startsWith('项目')&&!!find(n,x=>x.type==='select')));
 assert.equal(find(tree,n=>n.type==='details'),undefined);assert.equal(find(tree,n=>n.type==='legend'&&text(n)==='主题'),undefined);
 }finally{h.dispose();}
});
