import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
import {makeSupportCommand} from '../src/requirement-support-candidate/client.ts';
import {readReleaseNotice} from '../src/ui-review/owner-modules.ts';
const jsx={jsx:(type:unknown,props:Record<string,unknown>)=>({type,props}),jsxs:(type:unknown,props:Record<string,unknown>)=>({type,props}),Fragment:'fragment'};
function nodes(tree:any,match:(node:any)=>boolean):any[]{if(!tree||typeof tree!=='object')return[];if(Array.isArray(tree))return tree.flatMap(n=>nodes(n,match));return[...(match(tree)?[tree]:[]),...nodes(tree.props?.children,match)];}
function render(phase:'uncertain'|'rejected',withNotice=false,foreign=false){
 const calls:string[]=[],module={exports:{} as any},notice=withNotice?{sourceSha:'a'.repeat(40),records:[]}:null;let state=0;
 const imports:Record<string,unknown>={'react/jsx-runtime':jsx,react:{useEffect:()=>{},useRef:(x:unknown)=>({current:x}),useState:()=>[[notice,withNotice,false,''][state++],()=>{}]},'./ui/dialog':{Dialog:'dialog',DialogContent:'content',DialogTitle:'title',DialogDescription:'description'},'./ui/button':{Button:'button'},'./requirement-support-hooks':{useSupportOwner:()=>({owner:{ownerId:'owner',spaceId:'space',writable:true,requirementsEnabled:true,requirementSupportEnabled:true},session:{retry:()=>calls.push('retry')},mutation:{phase,pending:{kind:'read',body:{sourceSha:'a'.repeat(40)}},observed:null,error:''},refresh:()=>calls.push('refresh')})},'../requirement-support-candidate/client':{makeSupportCommand},'./owner-modules':{readReleaseNotice},'./owner-release-notice.module.css':{default:{}}};
 const code=ts.transpileModule(readFileSync(new URL('../src/ui-review/owner-release-notice.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','module','exports',code)((name:string)=>{assert.ok(name in imports);return imports[name];},module,module.exports);
 return{calls,tree:module.exports.OwnerReleaseNotice({scope:JSON.stringify([foreign?'other':'owner','space']),blocked:false,container:null})};
}
test('unknown reminder command stays recoverable outside the automatic notice and is hidden across owner scope',()=>{
 const {tree,calls}=render('uncertain');const recovery=nodes(tree,n=>n.props?.role==='status')[0];assert.ok(recovery);const button=nodes(recovery,n=>n.type==='button')[0];button.props.onClick();assert.deepEqual(calls,['retry']);assert.equal(nodes(recovery,n=>n.props?.href==='/personal/requirements/updates').length,1);
 assert.equal(nodes(render('uncertain',false,true).tree,n=>n.props?.role==='status').length,0);
});
test('known rejected reminder offers a fresh owner/version check without discarding an unknown request',()=>{
 const {tree,calls}=render('rejected',true);const refresh=nodes(tree,n=>n.type==='button'&&n.props.children==='刷新更新记录')[0];assert.ok(refresh);refresh.props.onClick();assert.deepEqual(calls,['refresh']);
 assert.equal(nodes(render('uncertain',true).tree,n=>n.type==='button'&&n.props.children==='刷新更新记录').length,0);
});

test('existing support tabs also hide their gated routes when status is closed',()=>{
 const source=readFileSync(new URL('../src/ui-review/requirement-support-nav.tsx',import.meta.url),'utf8');
 for(const enabled of [false,true]){
  const module={exports:{} as any},imports:Record<string,unknown>={'react/jsx-runtime':jsx,'next/link':{default:'a'},'./requirement-support.module.css':{default:{}},'./owner-module-navigation':{useOwnerModules:()=>({links:enabled?['roadmap','feedback','updates'].map(id=>({id})):[]})}};
  new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)((name:string)=>{assert.ok(name in imports);return imports[name];},module,module.exports);
  const hrefs=nodes(module.exports.RequirementSupportNav({current:'updates'}),n=>!!n.props?.href).map(n=>n.props.href);assert.equal(hrefs.length,enabled?4:1);assert.equal(hrefs[0],'/personal?page=requirements');
 }
});
