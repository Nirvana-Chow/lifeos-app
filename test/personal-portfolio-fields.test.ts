import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {emptyPortfolioPersonal,normalizePortfolioPersonalFields} from '../src/personal-portfolio/model.ts';
const require=createRequire(import.meta.url);
function load(file:string):any{
 assert.ok(existsSync(file),'portfolio component is not implemented');
 const module={exports:{} as any};
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','module','exports',code)((name:string)=>name.endsWith('.module.css')?new Proxy({},{get:(_target,key)=>String(key)}):name==='../personal-candidate/relation-fields'?load('src/personal-candidate/relation-fields.tsx'):name==='./model'?require('../src/personal-portfolio/model.ts'):name==='./projection'?require('../src/personal-portfolio/projection.ts'):require(name),module,module.exports);
 return module.exports;
}
test('portfolio editor labels manual money, dates and missing values without inventing balances',()=>{
 const {PortfolioFields}=load('src/personal-portfolio/fields.tsx');
 const html=renderToStaticMarkup(React.createElement(PortfolioFields,{value:emptyPortfolioPersonal('investment'),onChange:()=>{},options:{},disabled:true}));
 assert.match(html,/<fieldset[^>]*disabled=""/);assert.match(html,/持有数量/);assert.match(html,/手工估值/);assert.match(html,/截至日期/);assert.match(html,/所属账户/);assert.match(html,/关联资产/);assert.match(html,/留空表示未知/);
 assert.doesNotMatch(html,/实时行情|预期收益|自动同步/);
});
test('portfolio overview renders missing values and currency-specific amounts from actual supplied records',()=>{
 const {PortfolioOverview}=load('src/personal-portfolio/overview.tsx');
 const fields=normalizePortfolioPersonalFields({title:'手工账户',text:'',occurredOn:null,personal:{...emptyPortfolioPersonal('account'),balanceMinor:'123',asOf:'2026-11-05'}});
 const html=renderToStaticMarkup(React.createElement(PortfolioOverview,{records:[{id:'one',sourceId:'source',revision:1,fields}],onOpenRecord:()=>{}}));
 assert.match(html,/CNY/);assert.match(html,/1\.23/);assert.match(html,/手工账户/);assert.match(html,/2026-11-05/);assert.match(html,/role="tablist"/);assert.doesNotMatch(html,/总资产|收益率/);
});
