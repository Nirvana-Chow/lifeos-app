import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {emptyCareerPersonal,type CareerKind} from '../src/personal-career/domain.ts';
const nativeRequire=createRequire(import.meta.url);
function load(file:string):any{
 const path=resolve('src/personal-career',file);assert.ok(existsSync(path),'career component is not implemented');
 const module={exports:{} as any};
 const compiled=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',compiled)((name:string)=>{
  if(name.endsWith('.module.css'))return{default:{}};
  if(name.startsWith('.')){
   const target=resolve(dirname(path),name);for(const suffix of ['','.ts','.tsx'])if(existsSync(target+suffix))return name.endsWith('.tsx')||existsSync(target+'.tsx')?load((target+suffix).split('/personal-career/')[1]):nativeRequire(target+suffix);
  }
  return nativeRequire(name);
 },module,module.exports);return module.exports;
}
function find(node:any,name:string):any{if(!React.isValidElement(node))return null;const e=node as React.ReactElement<any>;if(e.props.name===name)return e;for(const child of React.Children.toArray(e.props.children)){const found=find(child,name);if(found)return found;}return null;}
const pin={id:'11111111-1111-4111-8111-111111111111',sourceId:'22222222-2222-4222-8222-222222222222',revision:1};
const record=(kind:CareerKind='employment',patch={})=>({...pin,fields:{title:'内部合成事实',text:'原始叙述 <script>alert(1)</script>',occurredOn:null,personal:{...emptyCareerPersonal(kind),...patch}}});
test('career controlled fields expose honest unknowns, full sources and pinned relations',()=>{
 const {CareerFields}=load('CareerFields.tsx');const value=emptyCareerPersonal('education');
 const html=renderToStaticMarkup(React.createElement(CareerFields,{value,onChange:()=>{},disabled:true,options:{}}));
 assert.match(html,/<fieldset[^>]*disabled/);assert.match(html,/学校/);assert.match(html,/未知/);assert.match(html,/来源链接/);assert.match(html,/所属项目/);
 assert.doesNotMatch(html,/主导|精通|2020-01-01/);
});
test('career kind changes preserve common sources/relations while removing stale variant data',()=>{
 const {CareerFields}=load('CareerFields.tsx');let changed:any;
 const value={...emptyCareerPersonal('education'),organization:'原学校',source:{kind:'manual',label:'原件',url:null},links:{project:pin,domain:null,topics:[]}};
 const tree=CareerFields({value,options:{},onChange:(v:any)=>changed=v});
 find(tree,'careerKind').props.onChange({target:{value:'opportunity'}});
 assert.equal(changed.careerKind,'opportunity');assert.equal(changed.applicationState,'saved');assert.deepEqual(changed.links,value.links);assert.equal(changed.source.label,'原件');assert.equal('organization' in changed,false);
});
test('board moves express only the requested state and remain disabled while a write is pending',()=>{
 const {CareerBoard}=load('CareerBoard.tsx');const row=record('opportunity',{company:'内部公司',role:'内部岗位'});let moved:any;
 const tree=CareerBoard({records:[row],onOpenRecord:()=>{},onMoveRecord:(r:any,s:any)=>moved={id:r.id,state:s}});
 find(tree,'careerState-'+row.id).props.onChange({target:{value:'preparing'}});
 assert.deepEqual(moved,{id:pin.id,state:'preparing'});
 const html=renderToStaticMarkup(React.createElement(CareerBoard,{records:[row],onOpenRecord:()=>{},onMoveRecord:()=>{},disabled:true}));
 assert.match(html,/已收藏/);assert.match(html,/<select[^>]*disabled/);assert.doesNotMatch(html,/自动投递|匹配率/);
});
test('resume preview prints only explicitly pinned facts and escapes untrusted text',()=>{
 const {ResumePreview}=load('ResumePreview.tsx');const fact=record(),resume=record('resume',{facts:[pin],targetRole:'内部方向'});
 resume.fields.text='本人填写的简历简介';
 const html=renderToStaticMarkup(React.createElement(ResumePreview,{records:[fact],selected:resume}));
 assert.match(html,/内部合成事实/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|姓名：|电话：|匹配率/);
 const stale=renderToStaticMarkup(React.createElement(ResumePreview,{records:[{...fact,revision:2}],selected:resume}));assert.match(stale,/1 条事实引用/);assert.doesNotMatch(stale,/原始叙述/);
 const empty=renderToStaticMarkup(React.createElement(ResumePreview,{records:[]}));assert.match(empty,/暂无简历版本/);
});
test('JD evidence view separates original requirement, linked facts and owner-entered gaps/actions',()=>{
 const {CareerMatch}=load('CareerMatch.tsx');const fact=record();const opportunity=record('opportunity',{requirements:[{requirement:'原岗位要求',facts:[pin],gap:'缺口待核实',nextAction:'查原报告'}]});
 const html=renderToStaticMarkup(React.createElement(CareerMatch,{record:opportunity,records:[fact]}));
 assert.match(html,/原岗位要求/);assert.match(html,/内部合成事实/);assert.match(html,/缺口待核实/);assert.match(html,/查原报告/);assert.doesNotMatch(html,/\d+%|推荐录用|已核实/);
});
