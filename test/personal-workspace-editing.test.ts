import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {dirname,resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import type {LifeOSWorkspaceProps} from '../src/ui-review/contract.ts';

// Compile local TSX like the recovery-panel tests; real components render without effects.
const nativeRequire=createRequire(import.meta.url),cache=new Map<string,unknown>();
function load(file:string):any {
 const path=resolve(file);if(cache.has(path))return cache.get(path);
 const m={exports:{}};cache.set(path,m.exports);
 const code=ts.transpileModule(readFileSync(path,'utf8'),{fileName:path,compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)((name:string)=>{
  if(name==='./ai-settings')return {AISettings:()=>{throw Error('Private pages must not mount AISettings');}};
  if(name==='../import-preview')return {ImportPreviewPanel:()=>{throw Error('Private pages must not mount import preview');}};
  if(name.endsWith('.css'))return{__esModule:true,default:{}};
  if(!name.startsWith('.'))return nativeRequire(name);
  const base=resolve(dirname(path),name),target=extname(base)?base:[base+'.tsx',base+'.ts',base].find(existsSync);
  assert.ok(target,'local module '+name);return load(target);
 },m,m.exports);cache.set(path,m.exports);return m.exports;
}
const {LifeOSWorkspace}=load('src/ui-review/workspace.tsx');
const {PersonalRecordForm}=load('src/personal-candidate/record-form.tsx');
const {SourceSummary}=load('src/ui-review/source-summary.tsx');
const task={id:'11111111-1111-4111-8111-111111111111',revision:3,title:'Synthetic reminder',notes:'',status:'open' as const,dueOn:null,area:null,project:null,inInbox:null,sourceLabel:'Apple 提醒事项',sourceCapturedAt:'2026-10-25T03:00:00Z'};
function workspace(overrides:Partial<LifeOSWorkspaceProps>={}){
 const props:LifeOSWorkspaceProps={state:{status:'ready',data:{tasks:[task,{...task,id:'22222222-2222-4222-8222-222222222222',sourceCapturedAt:'2026-10-26T04:00:00Z'},{...task,id:'33333333-3333-4333-8333-333333333333',sourceLabel:'手工录入',sourceCapturedAt:null}],areas:[],projects:[],coverage:'complete',today:'2026-10-27',asOf:'2026-10-27T09:00:00Z'}},access:{authenticated:true,writable:true,loginAllowed:true,allowedTypes:['todo','journal','project','domain','topic']},initialPage:'tasks',initialView:'list',onOpenTask:()=>{},onCreateTask:()=>{},...overrides};
 return renderToStaticMarkup(React.createElement(LifeOSWorkspace,props));
}
test('writable task view exposes editing and real category routes without inventing empty category options',()=>{
 const html=workspace();assert.match(html,/管理项目与领域/);assert.doesNotMatch(html,/点击标题|完整编辑表单/);
 for(const type of ['domain','project','topic'])assert.match(html,new RegExp('href="/personal/edit\\?type='+type+'"'));
 assert.doesNotMatch(html,/<option[^>]*>[^<]*(?:示例|默认项目|默认领域)/);
});
test('read-only and unverified workspace never expose category creation and label detail access honestly',()=>{
 for(const access of [{authenticated:true,writable:false,loginAllowed:true},{authenticated:null,writable:null,loginAllowed:null}]){
  const html=workspace({access});assert.doesNotMatch(html,/href="\/personal\/edit\?type=(?:domain|project|topic)"/);assert.doesNotMatch(html,/aria-label="(?:编辑待办|编辑标题)：/);
 }
});
test('source summary keeps total and original Apple timing semantics when rendered',()=>{
 const data={tasks:[task,{...task,id:'22222222-2222-4222-8222-222222222222',sourceCapturedAt:'2026-10-26T04:00:00Z'},{...task,id:'33333333-3333-4333-8333-333333333333',sourceLabel:'手工录入',sourceCapturedAt:null}],areas:[],projects:[],coverage:'complete',today:'2026-10-27',asOf:'2026-10-27T09:00:00Z'};
 const html=renderToStaticMarkup(React.createElement(SourceSummary,{data}));
 assert.match(html,/全部待办[\s\S]*3/);assert.match(html,/Apple 提醒事项[\s\S]*2/);assert.match(html,/手工录入[\s\S]*1/);assert.match(html,/2026-10-25T03:00:00Z/);assert.match(html,/2026-10-26T04:00:00Z/);assert.match(html,/2026-10-27T09:00:00Z/);assert.match(html,/非实时|不是实时/);assert.match(html,/不会.*(?:写回|反写).*Apple/);
 const partial=renderToStaticMarkup(React.createElement(SourceSummary,{data:{...data,tasks:[{...task,sourceCapturedAt:null}],coverage:'partial'}}));
 assert.match(partial,/全部待办[\s\S]*未知/);assert.match(partial,/Apple.*读取时间.*未提供|Apple.*读取.*未知/);
});
test('empty relationship form retains four statuses and only real writable category creation',()=>{
 const props={type:'todo',fields:{title:'Synthetic',text:'',date:'',status:'open'},setFields:()=>{},confirmed:false,setConfirmed:()=>{},options:{domain:[],project:[],topic:[]},allowedTypes:['todo','journal','project','domain','topic'],disabled:false,onSubmit:()=>{},onCancel:()=>{}};
 const html=renderToStaticMarkup(React.createElement(PersonalRecordForm,props));
 for(const status of ['open','in_progress','done','cancelled'])assert.match(html,new RegExp('<option value="'+status+'"'));
 for(const type of ['domain','project','topic'])assert.match(html,new RegExp('href="/personal/edit\\?type='+type+'"'));
 assert.match(html,/不关联/);assert.doesNotMatch(html,/<option value="[^\"]+">[^<]*(?:默认项目|默认领域)/);
 const closed=renderToStaticMarkup(React.createElement(PersonalRecordForm,{...props,disabled:true}));assert.doesNotMatch(closed,/href="\/personal\/edit\?type=/);
});

test('writable workspace hides category creation for restricted or unknown type capabilities',()=>{
 for(const allowedTypes of [undefined,['todo','journal'] as const]){
  const html=workspace({access:{authenticated:true,writable:true,loginAllowed:true,allowedTypes}});
  assert.doesNotMatch(html,/href="\/personal\/edit\?type=(?:domain|project|topic)"/);
 }
 const html=workspace({access:{authenticated:true,writable:true,loginAllowed:true,allowedTypes:['todo','journal','domain']}});
 assert.match(html,/href="\/personal\/edit\?type=domain"/);assert.doesNotMatch(html,/href="\/personal\/edit\?type=(?:project|topic)"/);
});
test('enabled form does not offer category creation without verified type capabilities',()=>{
 const props={type:'todo',fields:{title:'Synthetic',text:'',date:'',status:'open'},setFields:()=>{},confirmed:false,setConfirmed:()=>{},options:{domain:[],project:[],topic:[]},disabled:false,onSubmit:()=>{},onCancel:()=>{}};
 for(const allowedTypes of [undefined,['todo','journal']]){
  const html=renderToStaticMarkup(React.createElement(PersonalRecordForm,{...props,allowedTypes}));
  assert.doesNotMatch(html,/href="\/personal\/edit\?type=(?:domain|project|topic)"/);
 }
});

test('settings centers the page heading and keeps only account actions',()=>{
 const settings=workspace({initialPage:'settings',onLogout:()=>{},settingsContent:React.createElement('a',{href:'/account/api-keys'},'API 密钥')});
 assert.match(settings,/lo-content-settings/);
 assert.match(settings,/API 密钥/);assert.match(settings,/退出登录/);
 assert.doesNotMatch(settings,/登录状态|数据权限|数据与权限|数据管理与导出|分类管理|管理项目与领域|刷新数据/);
 assert.match(workspace(),/管理项目与领域/);
});
test('overview metrics are actionable and unknown metrics are disabled',()=>{
 const html=workspace({initialPage:'overview'});
 for(const label of ['待办','今日到期','已逾期','推进中项目'])assert.match(html,new RegExp('<button[^>]*aria-label="'+label+'：[^" ]+"'));
 const unknown=workspace({initialPage:'overview',state:{status:'unknown'}});
 assert.equal((unknown.match(/<button[^>]*aria-label="(?:待办|今日到期|已逾期|推进中项目)：未知"[^>]*disabled/g)||[]).length,4);
});

test('private Header exposes a single appearance action before opening settings',()=>{
 for(const initialPage of ['overview','tasks','settings'] as const){
  const html=workspace({initialPage}),header=html.match(/<header\b[\s\S]*?<\/header>/)?.[0]??'';
  assert.equal((header.match(/data-slot="theme-toggle"/g)??[]).length,1);
  assert.match(header,/aria-label="切换到深色模式"/);
 }
});

test('personal navigation hides unfinished business and record management',()=>{
 for(const initialPage of ['overview','tasks','settings'] as const){
  const html=workspace({initialPage});
  assert.doesNotMatch(html,/href="\/personal\/(?:schedule|settings\/data|edit\?type=journal)"|更多业务|href="\/review\/admin/);
  assert.match(html,/aria-label="待办"/);
  assert.match(html,/aria-label="帮助"/);
 }
});
function rawComponent(file:string,snapshot:Record<number,unknown>={}){
 let at=0;const hooks={...React,useEffect:()=>{},useMemo:(fn:()=>unknown)=>fn(),useRef:(value:unknown)=>({current:value}),useState:(initial:unknown)=>{const i=at++;return [i in snapshot?snapshot[i]:typeof initial==='function'?(initial as Function)():initial,()=>{}];}};
 const m={exports:{} as any};new Function('require','module','exports',ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText)((name:string)=>{
  if(name==='react')return hooks;if(name.endsWith('.css'))return {__esModule:true,default:{}};if(!name.startsWith('.'))return nativeRequire(name);const base=resolve(dirname(resolve(file)),name),target=extname(base)?base:[base+'.tsx',base+'.ts',base].find(existsSync);return load(target!);
 },m,m.exports);return m.exports;
}
function elements(node:any,match:(node:any)=>boolean):any[]{if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(n=>elements(n,match));return [...(match(node)?[node]:[]),...elements(node.props?.children,match)];}
test('new personal document navigation is locked while a task save or unknown request is pending',()=>{
 for(const flags of [{saving:true},{uncertain:true}]){const {LifeOSWorkspace}=rawComponent('src/ui-review/workspace.tsx'),tree=LifeOSWorkspace({state:{status:'unknown'},access:{authenticated:true,writable:true,loginAllowed:true},...flags});assert.equal(typeof tree.props.onClickCapture,'function');let blocked=0;const target={closest:()=>({getAttribute:()=>'/personal/schedule'})};tree.props.onClickCapture({button:0,target,preventDefault:()=>blocked++,stopPropagation:()=>{}});assert.equal(blocked,1);}
});
test('standalone journal Header and appearance remain inside the original saving and uncertain navigation guard',()=>{
 for(const phase of ['saving','uncertain']){const {PersonalWorkspace}=rawComponent('src/personal-candidate/workspace.tsx',{3:{phase}}),tree=PersonalWorkspace({initialType:'journal',returnHref:'/personal'});assert.equal(tree.props['data-lifeos-surface'],'personal');assert.ok(elements(tree,n=>n.type?.name==='ThemeSwitch').length);assert.ok(elements(tree,n=>n.type==='a'&&n.props.href==='/personal').length);assert.equal(typeof tree.props.onClickCapture,'function');assert.ok(elements(tree,n=>n.type==='h1'&&n.props.children==='日记').length);assert.equal(elements(tree,n=>n.type?.name==='WorkbenchShell').length,0);}
});

test('all reused private business pages render only private navigation including nested empty states',()=>{
 const {privateNavigation,privateHrefs}=load('src/workbench/private-navigation.ts'),{BasicWorkspace}=load('src/workbench/draft-workspace.tsx'),{DomainPage}=load('src/workbench/domain.tsx');
 for(const module of privateNavigation){if(['overview','todos','inbox','settings','journal','database','ai-settings'].includes(module.id))continue;const basic=['records','search','schedule','finance','growth','articles','knowledge','health'].includes(module.id);const html=renderToStaticMarkup(React.createElement(basic?BasicWorkspace:DomainPage,basic?{module:module.id,homeHref:privateHrefs.overview,dataHref:privateHrefs.database,recordsHref:privateHrefs.records}:{module,settingsHref:privateHrefs.settings,surface:'personal'}));assert.doesNotMatch(html,/href="\/review\/admin/,module.id);assert.doesNotMatch(html,/本人账号和真实来源尚未接入|本人账号和服务未就绪/,module.id);assert.match(html,/未接入|尚未配置|尚未连接/,module.id);}
});
test('personal data settings acknowledge records and bounded export without mounting test import or claiming full backup',()=>{
 const {DataSettings,PersonalSettings}=load('src/workbench/settings.tsx');const html=renderToStaticMarkup(React.createElement(DataSettings,{surface:'personal',syntheticReview:true}));assert.match(html,/已有个人手工记录/);assert.match(html,/100/);assert.match(html,/不是完整备份/);assert.match(html,/恢复尚未/);assert.match(html,/href="\/personal\/edit\?type=journal"/);assert.doesNotMatch(html,/href="\/review\/admin|隔离评审数据库|个人数据未接入|未导入/);
 const settings=renderToStaticMarkup(React.createElement(PersonalSettings,{dataHref:'/personal/settings/data',aiHref:'/personal/settings/ai'}));assert.doesNotMatch(settings,/href="\/review\/admin/);
});
