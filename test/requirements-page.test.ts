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

test('requirement pool renders the ordered route, searchable status table and expandable evidence from the real baseline',()=>{
 assert.ok(existsSync('src/ui-review/requirements-page.tsx'),'The private workspace needs its requirement pool renderer');
 const html=renderPage();
 assert.match(html,/项目目标/);assert.match(html,/当前阶段/);assert.match(html,/下一步/);
 assert.match(html,/<ol[^>]*aria-label="开发路径"/);
 assert.match(html,/<input[^>]*type="search"/);
 assert.match(html,/<label[^>]*for="requirements-implementation"/);
 assert.match(html,/<table[\s\S]*<caption[^>]*>需求清单/);
 assert.match(html,/<details[\s\S]*<summary[^>]*>验收与依据/);
 assert.match(html,/LO-TASK-001/);assert.match(html,/LO-PROJECT-001/);
 assert.match(html,/href="https:\/\/github.com\/Nirvana-Chow\/lifeos-app\/issues\/5"/);
 assert.match(html,/href="https:\/\/github.com\/Nirvana-Chow\/lifeos-app\/pull\/2"/);
 assert.match(html,/API.*capability discovery.*Skill/);
 assert.match(html,/当前 Agent API 仅支持待办/);
 assert.match(html,/本人验收/);assert.doesNotMatch(html,/>已验收</);
 assert.doesNotMatch(html,/<h1\b/,'The host already owns the page heading');
 assert.doesNotMatch(html,/\d+%|javascript:|<main\b/);
});
