import {keyManagementFlag} from '../src/agent-api/key-management-config.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import{readWorkspacePage}from'../src/workbench/private-navigation.ts';
function page(path:string,authenticated=true){
 const module={exports:{} as {default:(props?:unknown)=>Promise<React.ReactNode>}};
 const source=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',source)((name:string)=>{
  if(name==='react/jsx-runtime')return {jsx:React.createElement,jsxs:React.createElement};
  if(name.endsWith('/key-management-config'))return {keyManagementFlag};
  if(name.endsWith('/private-navigation'))return {readWorkspacePage};
  if(name==='next/headers')return {headers:async()=>new Headers()};
  if(name==='next/navigation')return {redirect:(url:string)=>{throw Error('REDIRECT '+url);}};
  if(name.endsWith('/runtime'))return {readPlatformPagePrincipal:async()=>authenticated?{ownerId:'synthetic-owner'}:null};
  if(name.endsWith('/live-workspace'))return {LivePersonalWorkspace:(props:Record<string,unknown>)=>React.createElement('div',{'data-page':props.initialPage,'data-id':props.initialTaskId,'data-create':String(props.initialCreateTask??false)})};
  if(name.endsWith('/workspace'))return {PersonalWorkspace:()=>React.createElement('div',{'data-legacy':'true'})};
  if(name.endsWith('/domain'))return {validateId:(id:string)=>id};
  if(name.endsWith('/workbench/navigation'))return {findModule:()=>({id:'todos'})};
  if(name.endsWith('/workbench/settings'))return {};
  if(name.endsWith('/connected-modules'))return {ConnectedModule:()=>null};
  throw Error('Unexpected route dependency '+name);
 },module,module.exports);return module.exports.default;
}
test('personal root defaults to overview while task and explicit create use the same shell',async()=>{
 const route=page('app/personal/page.tsx');
 assert.match(renderToStaticMarkup(await route({searchParams:Promise.resolve({})})),/data-page="overview"/);
 const tasks=renderToStaticMarkup(await route({searchParams:Promise.resolve({page:'tasks',create:'todo'})}));assert.match(tasks,/data-page="tasks"/);assert.match(tasks,/data-create="true"/);
});
test('todo deep link retains malformed or empty IDs and only absent ID creates',async()=>{
 const route=page('app/personal/edit/page.tsx');
 for(const id of ['','invalid-id','11111111-1111-4111-8111-111111111111']){
  const html=renderToStaticMarkup(await route({searchParams:Promise.resolve({type:'todo',id})}));assert.match(html,/data-page="tasks"/);assert.match(html,/data-create="false"/);assert.ok(html.includes('data-id="'+id+'"'));
 }
 assert.match(renderToStaticMarkup(await route({searchParams:Promise.resolve({type:'todo'})})),/data-create="true"/);
 assert.match(renderToStaticMarkup(await route({searchParams:Promise.resolve({type:'journal'})})),/data-legacy="true"/);
});
test('both personal entries deny anonymous before constructing any workspace',async()=>{
 for(const path of ['app/personal/page.tsx','app/personal/edit/page.tsx'])await assert.rejects(page(path,false)({searchParams:Promise.resolve({type:'todo'})}),/REDIRECT \/login/);
});

test('legacy todo navigation redirects to the single shell while synthetic review remains separate',async()=>{
 const section=page('app/review/admin/[...section]/page.tsx');
 await assert.rejects(section({params:Promise.resolve({section:['todos']}),searchParams:Promise.resolve({})}),/REDIRECT \/personal\?page=tasks/);
 await assert.doesNotReject(section({params:Promise.resolve({section:['todos']}),searchParams:Promise.resolve({mode:'synthetic-review'})}));
 const legacy=page('app/review/admin/personal/page.tsx');
 await assert.rejects(legacy({searchParams:Promise.resolve({type:'todo',id:'bad/id'})}),/REDIRECT \/personal\/edit\?type=todo&id=bad%2Fid/);
});

test('canonical finite page queries reach the existing controller without arbitrary routes',async()=>{const route=page('app/personal/page.tsx');for(const name of ['inbox','areas','projects','settings'])assert.match(renderToStaticMarkup(await route({searchParams:Promise.resolve({page:name})})),new RegExp('data-page="'+name+'"'));for(const name of ['constructor','unknown','settings/data'])assert.match(renderToStaticMarkup(await route({searchParams:Promise.resolve({page:name})})),/data-page="overview"/);});
