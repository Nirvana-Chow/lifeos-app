import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createRequire} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const native=createRequire(import.meta.url);

// Execute real React and the real baseline; CSS is the only loader replacement.
function renderPage(){
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
 const Page=load(resolve('src/ui-review/requirements-page.tsx')).RequirementsPage;
 return renderToStaticMarkup(React.createElement(Page));
}

test('requirement pool renders a compact shared ReUI table and three reachable views without inline long evidence',()=>{
 const html=renderPage();
 assert.match(html,/当前阶段/);assert.match(html,/下一步/);
 assert.match(html,/<input[^>]*type="search"/);
 for(const id of ['phase','priority','implementation','acceptance'])assert.match(html,new RegExp('<label[^>]*for="requirements-'+id+'"'));
 assert.match(html,/data-requirements-grid="reui"/);
 for(const label of ['表格','看板','甘特'])assert.match(html,new RegExp('aria-label="'+label+'视图"'));
 assert.match(html,/LO-TASK-001/);assert.match(html,/LO-PROJECT-001/);
 assert.doesNotMatch(html,/<details|验收条件|来源与源码依据/);
 assert.doesNotMatch(html,/<h1\b|<main\b|javascript:/);
 assert.match(html,/本人验收/);
});
