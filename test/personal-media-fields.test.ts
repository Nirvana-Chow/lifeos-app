import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import * as React from 'react';
import ts from 'typescript';
import * as domain from '../src/personal-media/domain.ts';
import * as projection from '../src/personal-media/projection.ts';
import type {MediaKind,MediaPersonal} from '../src/personal-media/domain.ts';

const nativeRequire=createRequire(import.meta.url);
function component(file:string):Record<string,any>{
 const path=new URL(file,import.meta.url),module={exports:{} as Record<string,any>};
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',code)((key:string)=>{
  if(key.endsWith('.module.css'))return{default:{}};
  if(key==='./domain')return domain;
  if(key==='./projection')return projection;
  if(key==='../personal-candidate/relation-fields')return component('../src/personal-candidate/relation-fields.tsx');
  return nativeRequire(key);
 },module,module.exports);
 return module.exports;
}
function findKind(node:unknown):React.ReactElement<any>|null{
 if(!React.isValidElement(node))return null;
 const element=node as React.ReactElement<any>;
 if(element.type==='select'&&element.props.name==='mediaKind')return element;
 for(const child of React.Children.toArray(element.props.children)){const found=findKind(child);if(found)return found;}
 return null;
}
const {MediaFields}=component('../src/personal-media/fields.tsx');
function changeKind(value:MediaPersonal,kind:MediaKind):MediaPersonal{
 let changed:MediaPersonal|null=null;
 const tree=MediaFields({value,onChange:(next:MediaPersonal)=>{changed=next;},options:{}}),selector=findKind(tree);
 assert.ok(selector,'the real MediaFields kind selector is available');
 selector.props.onChange({target:{value:kind}});
 assert.ok(changed,'the real MediaFields onChange emits the edited personal fields');
 return changed;
}

test('MediaFields clears Douban platform links when crossing book and film/series kinds while retaining personal history',()=>{
 for(const [from,to] of [['book','film'],['book','series'],['film','book'],['series','book']] as const){
  const value:MediaPersonal={...domain.emptyMediaPersonal(from),state:'paused',startedOn:'2026-10-01',finishedOn:'2026-10-15',rating:0,creators:['内部合成创作者'],isbn:from==='book'?'9780140328721':null,external:{provider:'douban',id:'123',url:`https://${from==='book'?'book':'movie'}.douban.com/subject/123/`},progress:from==='book'?{unit:'page',current:50,total:200}:from==='series'?{unit:'episode',current:2,total:10}:{unit:'percent',current:25,total:100}};
  const before=structuredClone(value);domain.validateMediaPersonal(value);
  const changed=changeKind(value,to);
  assert.deepEqual(changed.external,{provider:'manual',id:null,url:null},`${from} to ${to} must discard the old platform work association`);
  assert.doesNotThrow(()=>domain.validateMediaPersonal(changed));
  assert.equal(changed.mediaKind,to);assert.equal(changed.state,'paused');assert.equal(changed.startedOn,'2026-10-01');assert.equal(changed.finishedOn,'2026-10-15');assert.equal(changed.rating,0);assert.deepEqual(changed.creators,['内部合成创作者']);assert.deepEqual(changed.links,before.links);
  assert.deepEqual(changed.progress,from==='film'?{unit:'percent',current:25,total:100}:{unit:null,current:null,total:null});assert.equal(changed.isbn,null);assert.deepEqual(value,before);
 }
});

test('MediaFields keeps inert manual source references when a work kind changes',()=>{
 const value:MediaPersonal={...domain.emptyMediaPersonal('book'),external:{provider:'manual',id:'owner-note',url:'https://example.invalid/owner-reference'}};
 const changed=changeKind(value,'film');assert.deepEqual(changed.external,value.external);assert.doesNotThrow(()=>domain.validateMediaPersonal(changed));
});
