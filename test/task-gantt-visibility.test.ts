import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createRequire} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const native=createRequire(import.meta.url);
// Same real React/TS loader used by the existing requirement view tests; only CSS is replaced.
function render(rows:Record<string,unknown>[],label='待办',partial=false){
 const load=(file:string):any=>{
  const module={exports:{}};
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',code)((key:string)=>{
   if(key.endsWith('.css'))return{__esModule:true,default:new Proxy({},{get:(_,name)=>String(name)})};
   if(!key.startsWith('.'))return native(key);
   const path=resolve(dirname(file),key),found=[path,path+'.tsx',path+'.ts'].find(p=>existsSync(p));
   if(!found)throw Error('Missing dependency '+key);return load(found);
  },module,module.exports);return module.exports;
 };
 const {TaskProjectGantt}=load(resolve('src/ui-review/task-project-gantt.tsx'));
 return renderToStaticMarkup(React.createElement(TaskProjectGantt,{label,rows,partial,onShowTable:()=>{},renderTitle:(row:{id:string;title:string})=>React.createElement('button',{'data-open-id':row.id},row.title)}));
}
test('a deadline-only todo stays visible as one dated milestone without an invented duration',()=>{
 const html=render([{id:'due',title:'Deadline only',dueOn:'2030-11-05',createdAt:'2020-01-01',sourceCapturedAt:'2021-01-01'}]);
 assert.match(html,/data-gantt-milestone/);assert.doesNotMatch(html,/data-gantt-bar/);
 assert.match(html,/aria-label="截止 2030-11-05"/);assert.match(html,/dateTime="2030-11-05"/);assert.match(html,/data-open-id="due"/);
 assert.doesNotMatch(html,/2020-01-01|2021-01-01/);
});
test('undated and one-ended todos keep individual detail actions without interval bars',()=>{
 const html=render([{id:'none',title:'Undated'},{id:'start',title:'Start only',plannedStartOn:'2030-11-04'},{id:'end',title:'End only',plannedEndOn:'2030-11-07'}]);
 for(const id of ['none','start','end'])assert.match(html,new RegExp('data-open-id="'+id+'"'));
 assert.match(html,/2030-11-04/);assert.match(html,/2030-11-07/);assert.doesNotMatch(html,/data-gantt-bar|data-gantt-milestone/);
});
test('complete saved intervals remain the only bars and due-only records do not distort their scale',()=>{
 const html=render([{id:'range',title:'Planned',plannedStartOn:'2030-11-06',plannedEndOn:'2030-11-10'},{id:'due',title:'Due',dueOn:'2031-04-01'}]);
 assert.equal((html.match(/data-gantt-bar=/g)??[]).length,1);assert.equal((html.match(/data-gantt-milestone=/g)??[]).length,1);
 assert.match(html,/aria-label="计划 2030-11-06 至 2030-11-10"/);
});
test('invalid deadline and reversed plan never invent a dated mark, while the todo remains accessible',()=>{
 const html=render([{id:'bad',title:'Invalid dates',dueOn:'2030-02-30',plannedStartOn:'2030-11-10',plannedEndOn:'2030-11-01'}]);
 assert.match(html,/data-open-id="bad"/);assert.doesNotMatch(html,/data-gantt-bar|data-gantt-milestone|<time/);
});
test('partial coverage stays explicit and untrusted titles stay escaped in visible records',()=>{
 const html=render([{id:'one',title:'<img src=x onerror=alert(1)>'}],'待办',true);
 assert.match(html,/当前仅显示已读取范围/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);
});
test('project Gantt keeps the existing count-only incomplete behavior and ignores arbitrary due metadata',()=>{
 const html=render([{id:'project',title:'Project',dueOn:'2030-11-05'}],'项目');
 assert.match(html,/1 项项目未完整排期/);assert.doesNotMatch(html,/data-open-id|data-gantt-milestone|<time/);
});
