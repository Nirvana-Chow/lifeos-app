import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createRequire} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {requirements,selectRequirements,validateRequirementBaseline} from '../src/platform/requirements.ts';
const native=createRequire(import.meta.url);

// Execute real React and the real baseline; CSS is the only loader replacement.
function renderPage(file='requirements-page.tsx',exportName='RequirementsPage',props:Record<string,unknown>={}){
 const cache=new Map<string,any>();
 function load(file:string):any{
  if(cache.has(file))return cache.get(file);
  if(file.endsWith('.json'))return JSON.parse(readFileSync(file,'utf8'));
  const module={exports:{}};cache.set(file,module.exports);
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',code)((key:string)=>{
   if(key.endsWith('.css'))return{__esModule:true,default:new Proxy({},{get:(_,name)=>String(name)})};
   if(!key.startsWith('.'))return native(key);
   const path=resolve(dirname(file),key),found=[path,path+'.tsx',path+'.ts'].find(p=>existsSync(p));
   if(!found)throw Error('Missing component dependency '+key);return load(found);
  },module,module.exports);return module.exports;
 }
 const Page=load(resolve('src/ui-review',file))[exportName];
 return renderToStaticMarkup(React.createElement(Page,props));
}

test('requirement pool renders a compact shared ReUI table and three reachable views without inline long evidence',()=>{
 const html=renderPage();
 assert.match(html,/当前阶段/);assert.match(html,/下一步/);
 assert.match(html,/<input[^>]*type="search"/);
 for(const id of ['phase','priority','implementation','acceptance'])assert.match(html,new RegExp('<label[^>]*for="requirements-'+id+'"'));
 assert.match(html,/data-requirements-grid="reui"/);
 for(const label of ['表格','看板','甘特'])assert.match(html,new RegExp('aria-label="'+label+'视图"'));
 assert.match(html,/LO-TASK-001/);assert.match(html,/LO-PROJECT-001/);
 assert.doesNotMatch(html,/验收条件|来源与源码依据/);
 assert.doesNotMatch(html,/<h1\b|<main\b|javascript:/);
 assert.match(html,/本人验收/);
});


test('board retains legacy undated requirements without optional roadmap metadata',()=>{
 const item={id:'LO-LEGACY-001',version:1,title:'保留旧基线需求',description:'原始描述',status:'not_started',delivery:'backlog',sourceRefs:['README.md'],acceptanceCriteria:['保留稳定 ID'],evidence:[],blockedBy:[]};
 const html=renderPage('requirements-views.tsx','RequirementsBoard',{rows:[item],phases:[],onOpen:()=>{}});
 assert.match(html,/待核验/);
 assert.match(html,/data-requirement-id="LO-LEGACY-001"/);
 assert.match(html,/查看需求 LO-LEGACY-001 保留旧基线需求/);
});

test('requirement filters are disclosed on demand and native table keeps phase groups',()=>{
 const html=renderPage();assert.match(html,/<details[^>]*data-requirements-filters/);assert.match(html,/<summary[^>]*>更多筛选/);
 assert.match(html,/data-requirements-phase=/);assert.match(html,/<option[^>]*>P3/);
});

test('P3 can be validated and filtered without changing other public requirement metadata',()=>{
 const baseline=structuredClone(requirements());baseline.requirements[0].roadmap!.priority='P3';
 assert.equal(validateRequirementBaseline(baseline).requirements[0].roadmap!.priority,'P3');
 assert.deepEqual(selectRequirements(baseline,{priority:'P3'}).map(item=>item.id),[baseline.requirements[0].id]);
});

test('saved owner workflow shows a compact summary and owner next step without changing engineering or acceptance labels',()=>{
 const baseline=requirements(),item=baseline.requirements[0],workflow=new Map([[item.id,{state:'done',purpose:'私人用途 <script> 数据',nextStep:'下一步原始业务内容'}]]);
 const html=renderPage('requirements-views.tsx','RequirementsTable',{rows:[item],phases:baseline.roadmap!.phases,onOpen:()=>{},workflow});
 assert.match(html,/推进：开发完成/);assert.match(html,/私人用途 &lt;script&gt; 数据/);assert.match(html,/下一步原始业务内容/);assert.doesNotMatch(html,/<script/);assert.match(html,/本人验收|未验收|尚未验收|已验收/);
 const untouched=renderPage('requirements-views.tsx','RequirementsBoard',{rows:[item],phases:baseline.roadmap!.phases,onOpen:()=>{}});assert.doesNotMatch(untouched,/data-requirement-workflow/);
});


test('board uses source development progress and keeps business workflow separate from acceptance',()=>{
 const baseline=requirements(),original=baseline.requirements[0];
 const rows=[
  {...original,id:'LO-TEST-001',title:'尚未开始样例',status:'not_started',roadmap:{...original.roadmap,implementation:'not_started'}},
  {...original,id:'LO-TEST-002',title:'部分实现样例',status:'in_progress',roadmap:{...original.roadmap,implementation:'partial'}},
  {...original,id:'LO-TEST-003',title:'源码实现样例',status:'in_progress',roadmap:{...original.roadmap,implementation:'implemented'}},
  {...original,id:'LO-TEST-004',title:'待审查样例',status:'awaiting_acceptance',roadmap:{...original.roadmap,implementation:'implemented'}},
 ];
 const workflow=new Map([[rows[0].id,{state:'done',purpose:'业务推进标记',nextStep:'核对源码'}]]);
 const html=renderPage('requirements-views.tsx','RequirementsBoard',{rows,phases:baseline.roadmap!.phases,onOpen:()=>{},workflow});
 assert.match(html,/aria-label="按开发进度查看需求"/);
 for(const [state,title] of [['not_started','尚未开始样例'],['in_progress','部分实现样例'],['implemented','源码实现样例'],['awaiting_acceptance','待审查样例']]){const column=html.match(new RegExp('<section[^>]*data-requirements-progress="'+state+'"[^]*?</section>'))?.[0]??'';assert.match(column,new RegExp(title));for(const item of rows.filter(row=>row.title!==title))assert.ok(!column.includes(item.title),'each requirement belongs to its evidence-backed development column');}
 assert.match(html,/推进：开发完成/);assert.doesNotMatch(html,/data-requirements-progress="accepted"/);
});

test('requirements table grouping is optional and reuses the native grouped row model',()=>{
 const baseline=requirements(),rows=baseline.requirements;
 for(const grouping of ['phase','implementation','priority','acceptance']){
  const html=renderPage('requirements-views.tsx','RequirementsTable',{rows,phases:baseline.roadmap!.phases,onOpen:()=>{},grouping});
  assert.match(html,new RegExp('data-requirements-group="'+grouping+'"'));
 }
 const plain=renderPage('requirements-views.tsx','RequirementsTable',{rows,phases:baseline.roadmap!.phases,onOpen:()=>{},grouping:'none'});
 assert.doesNotMatch(plain,/data-requirements-group=/);
 assert.match(renderPage(),/aria-label="表格分组"/);
});


test('workflow board groups only saved workflow and leaves partial source evidence unrecorded',()=>{
 const baseline=requirements(),rows=baseline.requirements.slice(0,2),workflow=new Map([[rows[0].id,{state:'done',purpose:'已交付标记',nextStep:'后续反馈关联原ID'}]]);
 const html=renderPage('requirements-views.tsx','RequirementsBoard',{rows,phases:baseline.roadmap!.phases,onOpen:()=>{},workflow,progressMode:'workflow'});
 assert.match(html,/data-requirements-progress="done"/);assert.match(html,/data-requirements-progress="unrecorded"/);assert.match(html,/下一步：后续反馈关联原ID/);assert.doesNotMatch(html,/data-requirements-progress="accepted"/);
});
