import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import{TaskCellDraftMemory}from'../src/personal-candidate/task-cell-draft.ts';
import{resolveTaskTarget}from'../src/personal-candidate/task-editor-state.ts';
import{editorFromEntry}from'../src/personal-candidate/editor.ts';
import {validateId} from '../src/platform/domain.ts';
import * as privateNavigation from '../src/workbench/private-navigation.ts';
import * as workspaceSelectors from '../src/ui-review/selectors.ts';

type Node = {type:unknown;props:Record<string,any>};
const jsx={jsx:(type:unknown,props:Record<string,any>)=>({type,props}),jsxs:(type:unknown,props:Record<string,any>)=>({type,props}),Fragment:'fragment'};
const react={useRef:(value:any)=>({current:value}),useState:(value:any)=>[value,()=>{}],useEffect:()=>{},useMemo:(fn:()=>unknown)=>fn()};
function load(path:string,imports:Record<string,unknown>,browser:Record<string,any>={location:{assign:(url:string)=>destinations.push(url)}}){const module={exports:{} as Record<string,any>};const source=readFileSync(new URL(path,import.meta.url),'utf8');const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports','window','Element','document',code)((key:string)=>{assert.ok(key in imports,`unexpected import ${key}`);return imports[key];},module,module.exports,browser,browser.Element,browser.document??{activeElement:null});return module.exports;}
function find(node:any,predicate:(n:Node)=>boolean):Node|undefined{if(!node||typeof node!=='object')return;if(Array.isArray(node)){for(const item of node){const found=find(item,predicate);if(found)return found;}return;}return predicate(node)?node:find(node.props?.children,predicate);}
const destinations:string[]=[];
const id='11111111-1111-4111-8111-111111111111';
test('public editor redirects anonymous and failed identity checks before rendering private workspace',async()=>{for(const principal of [null,Error('identity unavailable')]){const page=load('../app/personal/edit/page.tsx',{'react/jsx-runtime':jsx,'next/headers':{headers:async()=>new Headers()},'next/navigation':{redirect:(url:string)=>{throw Error('redirect:'+url);}},'../../../src/platform/runtime':{readPlatformPagePrincipal:async()=>{if(principal instanceof Error)throw principal;return principal;}},'../../../src/personal-candidate/workspace':{PersonalWorkspace:'private-workspace'},'../../../src/personal-candidate/live-workspace':{LivePersonalWorkspace:'task-workspace'},'../../../src/platform/domain':{validateId}});await assert.rejects(page.default({searchParams:Promise.resolve({type:'todo',id})}),/redirect:\/login/);}});
test('authenticated public editor validates type and id before opening the workspace',async()=>{const page=load('../app/personal/edit/page.tsx',{'react/jsx-runtime':jsx,'next/headers':{headers:async()=>new Headers()},'next/navigation':{redirect:()=>{throw Error('unexpected redirect');}},'../../../src/platform/runtime':{readPlatformPagePrincipal:async()=>({id:'synthetic-owner'})},'../../../src/personal-candidate/workspace':{PersonalWorkspace:'private-workspace'},'../../../src/personal-candidate/live-workspace':{LivePersonalWorkspace:'task-workspace'},'../../../src/platform/domain':{validateId}});for(const [query,expectedType,expectedId] of [[{type:'project',id},'project',id],[{type:'invalid',id:'bad'},'todo','bad'],[{},'todo',undefined]] as const){const result=await page.default({searchParams:Promise.resolve(query)});if(expectedType==='todo'){assert.equal(result.type,'task-workspace');assert.equal(result.props.initialPage,'tasks');assert.equal(result.props.initialTaskId,expectedId);assert.equal(result.props.initialCreateTask,expectedId===undefined);}else{assert.equal(result.type,'private-workspace');assert.equal(result.props.initialType,expectedType);assert.equal(result.props.initialId,expectedId);}}});
test('personal task actions open explicit local create/edit targets without document navigation',()=>{
 destinations.length=0;let target:any=null;const TaskEditor=()=>null;
 const localController={getEditorBinding:()=>({ownerId:'fixture-owner',spaceId:'fixture-space'}),getTaskEntry:()=>null,getRelationOptions:()=>({})};
 const hooks={...react,useRef:(initial:any)=>({current:initial===null?localController:initial}),useState:(initial:any)=>initial?.state?[{...initial,state:{status:'ready',data:{tasks:[]}}},()=>{}]:[target,(next:any)=>{target=next;} ]};
 const module=load('../src/personal-candidate/connected-workspace.tsx',{'react/jsx-runtime':jsx,'react-dom':{flushSync:(fn:()=>void)=>fn()},react:hooks,'./workspace-controller':{PersonalWorkspaceController:class {}},'./task-editor':{TaskEditor},'./task-editor.module.css':{default:{}},'./editor':{editorFromEntry},'./task-editor-state':{resolveTaskTarget},'./task-cell-draft':{TaskCellDraftMemory}});
 let actions:any;const render=()=>module.ConnectedPersonalWorkspace({children:(value:any)=>{actions=value;return null;}});
 render();actions.onCreateTask();let tree=render();assert.deepEqual(find(tree,n=>n.type===TaskEditor)?.props.target,{mode:'create'});
 actions.onOpenTask({id:'a/b',revision:3});tree=render();assert.deepEqual(find(tree,n=>n.type===TaskEditor)?.props.target,{mode:'edit',task:{id:'a/b',revision:3}});assert.deepEqual(destinations,[]);
});
test('personal overview and record cards link to public editor',()=>{const common={'react/jsx-runtime':jsx,react,'next/link':{default:'a'}};const overview=load('../src/personal-candidate/home-overview.tsx',{...common,'./persistent-views':{PersistentViews:'views'}});assert.ok(find(overview.PersonalHomeOverview(),n=>n.props?.href==='/personal/edit'));const rows=[{id,recordType:'project',title:'Synthetic project',domain:'D',kind:'项目',status:'open',revision:1}];const views=load('../src/personal-candidate/persistent-views.tsx',{...common,'./projection':{projectRows:()=>rows,taskStats:()=>({done:0,open:1,cancelled:0,overdue:0,total:1})},'../ui-review/record-grid':{RecordGrid:'readonly-grid'},'../component-review/resources':{resources:()=>({})},'../component-review/workspace.module.css':{default:{}}});assert.ok(find(views.PersistentViews({entries:[],spaceId:'synthetic'}),n=>n.props?.href==='/personal/edit?type=project&id='+id));assert.equal(find(views.PersistentViews({entries:[],spaceId:'synthetic',navigationLocked:true}),n=>n.props?.href?.includes('/personal/edit')),undefined);});
test('editor return link goes to personal home on public route and preserves review default',async()=>{const page=load('../app/personal/edit/page.tsx',{'react/jsx-runtime':jsx,'next/headers':{headers:async()=>new Headers()},'next/navigation':{redirect:()=>{throw Error('unexpected redirect');}},'../../../src/platform/runtime':{readPlatformPagePrincipal:async()=>({id:'synthetic-owner'})},'../../../src/personal-candidate/workspace':{PersonalWorkspace:'private-workspace'},'../../../src/personal-candidate/live-workspace':{LivePersonalWorkspace:'task-workspace'},'../../../src/platform/domain':{validateId}});const publicProps=(await page.default({searchParams:Promise.resolve({type:'journal'})})).props;const workspace=load('../src/personal-candidate/workspace.tsx',{'react/jsx-runtime':jsx,react,'next/link':{default:'a'},'./client':{},'./editor':{},'../workbench/theme-switch':{ThemeSwitch:'appearance-control'},'./workspace.module.css':{default:{}},'./detail-navigation':{requestedDetailKey:()=>null},'./apple-source-notice':{},'./business':{},'./record-form':{},'./snapshot-panel':{}});assert.ok(find(workspace.PersonalWorkspace(publicProps),n=>n.props?.href==='/personal'));assert.ok(find(workspace.PersonalWorkspace({}),n=>n.props?.href==='/review/admin'));});

// Distinguish the installed Next Link from a standard document anchor. A Link
// would keep A/B in the App Router document, bypassing native unload on history.
test('private editor record and return navigation use document links while overview keeps Next navigation',()=>{
 const NextLink=createRequire(import.meta.url)('next/link').default,common={'react/jsx-runtime':jsx,react,'next/link':{__esModule:true,default:NextLink}};
 const rows=[{id,recordType:'project',title:'Synthetic project',domain:'D',kind:'项目',status:'open',revision:1}];
 const views=load('../src/personal-candidate/persistent-views.tsx',{...common,'./projection':{projectRows:()=>rows,taskStats:()=>({done:0,open:1,cancelled:0,overdue:0,total:1})},'../ui-review/record-grid':{RecordGrid:'readonly-grid'},'../component-review/resources':{resources:()=>({})},'../component-review/workspace.module.css':{default:{}}});
 const panel=load('../src/personal-candidate/snapshot-panel.tsx',{'react/jsx-runtime':jsx,'./persistent-views':views});
 const states:any[]=[],refs:any[]=[];let cursor=0,refCursor=0;const effects:Function[]=[];
 const hooks={...react,useState:(initial:any)=>{const at=cursor++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return[states[at],(value:any)=>{states[at]=value;}];},useRef:(initial:any)=>{const at=refCursor++;return refs[at]??(refs[at]={current:initial});},useEffect:(effect:Function)=>{effects.push(effect);}};
 const listeners=new Map<string,Function>();let confirms=0;
 class NativeElement{anchor:any;constructor(anchor:any){this.anchor=anchor;}closest(){return this.anchor;}}
 const browser={Element:NativeElement,confirm:()=>{confirms++;return false;},addEventListener:(name:string,fn:Function)=>listeners.set(name,fn),removeEventListener:(name:string,fn:Function)=>{if(listeners.get(name)===fn)listeners.delete(name);},location:{protocol:'https:'}};
 const workspace=load('../src/personal-candidate/workspace.tsx',{'react/jsx-runtime':jsx,react:hooks,'next/link':{__esModule:true,default:NextLink},'./client':{},'./editor':{},'../workbench/theme-switch':{ThemeSwitch:'appearance-control'},'./workspace.module.css':{default:{}},'./detail-navigation':{requestedDetailKey:()=>null},'./apple-source-notice':{},'./business':{},'./record-form':{PersonalRecordForm:'form'},'./snapshot-panel':{SnapshotPanel:panel.SnapshotPanel}},browser);
 const render=()=>{cursor=0;refCursor=0;effects.length=0;return workspace.PersonalWorkspace({initialType:'todo',initialId:id,returnHref:'/personal'});};
 // Existing useState slots: status=0, mutation snapshot=3, full records=13.
 render();states[0]={ownerId:'synthetic-owner',spaceId:'synthetic-space',writable:true,allowedTypes:['todo']};states[13]=[];
 let tree=render();const recordForm=find(tree,n=>n.type==='form')!;
 recordForm.props.setFields({...recordForm.props.fields,title:'Unsaved B'});tree=render();
 const snapshot=find(tree,n=>n.type===panel.SnapshotPanel)!;
 const cards=views.PersistentViews(panel.SnapshotPanel(snapshot.props).props);
 assert.equal(find(cards,n=>n.props?.href==='/personal/edit?type=project&id='+id)?.type,'a','editor A→B must create a document history entry');
 assert.equal(find(tree,n=>n.props?.href==='/personal')?.type,'a','return must leave through the same unload boundary');
 assert.equal(find(views.PersistentViews({entries:[],spaceId:'synthetic'}),n=>n.props?.href?.includes('/personal/edit'))?.type,NextLink,'other surfaces retain their navigation');
 const cleanup=effects[0]();let prevented=0;const unload={preventDefault:()=>{prevented++;},returnValue:undefined};listeners.get('beforeunload')!(unload);
 assert.equal(prevented,1);assert.equal(unload.returnValue,'');assert.equal(confirms,0,'document leave uses only native confirmation');
 const capture=tree.props.onClickCapture;
 const click=(extra:any={})=>{let blocked=0;capture({target:new NativeElement({getAttribute:()=>'',hasAttribute:()=>false}),button:0,preventDefault:()=>blocked++,stopPropagation:()=>{},...extra});return blocked;};
 assert.equal(click(),0);assert.equal(confirms,0);assert.equal(find(tree,n=>n.type==='form')?.props.fields.title,'Unsaved B');
 cleanup();assert.equal(listeners.size,0);
 for(const phase of ['saving','uncertain']){
  states[3]={phase};tree=render();const lockedCapture=tree.props.onClickCapture;
  for(const extra of [{},{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{target:new NativeElement({getAttribute:()=>'_blank',hasAttribute:()=>false})}]){
   let blocked=0;lockedCapture({target:new NativeElement({getAttribute:()=>'',hasAttribute:()=>false}),button:0,preventDefault:()=>blocked++,stopPropagation:()=>{},...extra});assert.equal(blocked,Object.keys(extra).length?0:1,'only current-document offered navigation is locked');
  }
 }
});

test('legacy journal manager sends todo to the canonical shell after dirty and retained-request guards',()=>{
 const states:any[]=[],refs:any[]=[];let cursor=0,refCursor=0,allow=false,confirms=0;const visited:string[]=[],effects:Function[]=[],listeners=new Map<string,Function>();
 const hooks={...react,useEffect:(fn:Function)=>{effects.push(fn);},useState:(initial:any)=>{const at=cursor++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return[states[at],(value:any)=>{states[at]=value;}];},useRef:(initial:any)=>{const at=refCursor++;return refs[at]??(refs[at]={current:initial});}};
 const workspace=load('../src/personal-candidate/workspace.tsx',{'react/jsx-runtime':jsx,react:hooks,'./client':{},'./editor':{},'../workbench/theme-switch':{ThemeSwitch:'appearance-control'},'./workspace.module.css':{default:{}},'./detail-navigation':{requestedDetailKey:()=>null},'./apple-source-notice':{},'./business':{},'./record-form':{PersonalRecordForm:'record-form'},'./snapshot-panel':{}},{location:{assign:(url:string)=>visited.push(url)},confirm:()=>{confirms++;return allow;},addEventListener:(name:string,fn:Function)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name)});
 const render=()=>{cursor=0;refCursor=0;effects.length=0;return workspace.PersonalWorkspace({initialType:'journal'});};
 const todo=()=>find(render(),n=>n.type==='button'&&n.props.children==='待办')!;
 render();states[0]={ownerId:'synthetic-owner',spaceId:'synthetic-space',writable:true,allowedTypes:['todo','journal','project']};states[13]=[];
 // Clean navigation never switches the legacy form to a second todo writer.
 todo().props.onClick();assert.deepEqual(visited,['/personal?page=tasks']);assert.equal(find(render(),n=>n.type==='record-form')?.props.type,'journal');visited.length=0;
 const form=find(render(),n=>n.type==='record-form')!;form.props.setFields({...form.props.fields,title:'Synthetic journal draft'});
 todo().props.onClick();assert.equal(confirms,1);assert.deepEqual(visited,[]);assert.equal(find(render(),n=>n.type==='record-form')?.props.fields.title,'Synthetic journal draft');
 for(const phase of ['saving','uncertain']){states[3]={phase};const button=todo();assert.equal(button.props.disabled,true);button.props.onClick();assert.deepEqual(visited,[]);assert.equal(states[3].phase,phase);}
 states[3]=null;allow=true;todo().props.onClick();assert.equal(confirms,2);assert.deepEqual(visited,['/personal?page=tasks']);assert.equal(find(render(),n=>n.type==='record-form')?.props.type,'journal');assert.equal(find(render(),n=>n.type==='record-form')?.props.fields.title,'Synthetic journal draft');
 const cleanup=effects[0]();let prompts=0;const unload={preventDefault:()=>prompts++,returnValue:undefined};listeners.get('beforeunload')!(unload);assert.equal(prompts,0,'already confirmed document leave has no second prompt');listeners.get('beforeunload')!(unload);assert.equal(prompts,1,'approval is one-use, not a global removal');cleanup();
});

test('collapsed personal navigation keeps journal and schedule link names and tooltips',()=>{
 const states:any[]=[];let cursor=0;const hooks={...react,useState:(initial:any)=>{const at=cursor++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return[states[at],(value:any)=>{states[at]=value;}];}};
 const nativeRequire=createRequire(import.meta.url),workspace=load('../src/ui-review/workspace.tsx',{'react/jsx-runtime':jsx,react:hooks,'lucide-react':nativeRequire('lucide-react'),'./ui/button':{Button:'button'},'./ui/input':{Input:'input'},'./ui/badge':{Badge:'badge'},'./ui/dialog':{Dialog:'dialog',DialogContent:'dialog-content',DialogTitle:'dialog-title',DialogDescription:'dialog-description'},'./selectors':workspaceSelectors,'./task-table':{},'./overview-chart':{},'./review.css':{},'../workbench/private-navigation':privateNavigation,'../workbench/theme-switch':{ThemeSwitch:'appearance-control'},'../personal-candidate/category-entries':{},'./source-summary':{},'../personal-candidate/task-editor.module.css':{default:{}}});
 const render=()=>{cursor=0;return workspace.LifeOSWorkspace({state:{status:'unknown'},access:{authenticated:null,writable:null,loginAllowed:null}});};
 let tree=render();for(const [label,path] of [['日程','schedule'],['日记','journal']]){const link=find(tree,n=>n.type==='a'&&n.props.href===privateNavigation.privateHrefs[path as 'schedule'|'journal'])!;assert.equal(link.props['aria-label'],label);}
 find(tree,n=>n.props['aria-label']==='收起侧栏')!.props.onClick();tree=render();
 for(const [label,path] of [['日程','schedule'],['日记','journal']]){const link=find(tree,n=>n.type==='a'&&n.props.href===privateNavigation.privateHrefs[path as 'schedule'|'journal'])!;assert.equal(link.props['aria-label'],label);assert.equal(link.props.title,label);}
});
