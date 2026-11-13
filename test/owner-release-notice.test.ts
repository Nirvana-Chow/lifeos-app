import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
import {makeSupportCommand} from '../src/requirement-support-candidate/client.ts';
import {ownerModules,readReleaseNotice,verifiedModuleScope} from '../src/ui-review/owner-modules.ts';
import * as selectors from '../src/ui-review/selectors.ts';
import * as privateNavigation from '../src/workbench/private-navigation.ts';
import * as workspaceHierarchy from '../src/ui-review/workspace-hierarchy.ts';
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

test('workspace settings navigation hides support routes until owner scope and both capabilities are verified',()=>{
 const source=readFileSync(new URL('../src/ui-review/workspace.tsx',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const scope=JSON.stringify(['owner','space']);
 const status={scope:'personal-manual-candidate',storageVerified:true,ownerId:'owner',spaceId:'space',requirementsEnabled:true,requirementSupportEnabled:true};
 const jsxOnly=new Set(['lucide-react','./ui/button','./ui/input','./ui/badge','./ui/dialog','./task-table','./task-project-gantt','./task-board','./task-grid','./overview-chart','../workbench/theme-switch','./category-grid','./owner-release-notice','./requirements-page']);
 const components=new Proxy({},{get:(_target,name)=>String(name)});
 function settings(value:unknown,preferenceScope=scope){
  const navigated:string[]=[],module={exports:{} as any};
  const imports:Record<string,unknown>={
   'react/jsx-runtime':jsx,
   react:{useEffect:()=>{},useLayoutEffect:()=>{},useMemo:(fn:()=>unknown)=>fn(),useRef:(value:unknown)=>({current:value}),useState:(value:unknown)=>[value,()=>{}]},
   './selectors':selectors,'./workspace-hierarchy':workspaceHierarchy,'../workbench/private-navigation':privateNavigation,
   './owner-module-navigation':{useOwnerModules:(enabled:boolean,currentScope:string|null)=>({links:enabled?ownerModules(value,currentScope):[],scope:verifiedModuleScope(value),path:'/personal/requirements/updates'}),OwnerModuleLinks:'owner-links'},
  };
  // Inspect the real workspace tree and capability mapper. JSX-only children
  // need no browser, data reads or independent implementations of their UI.
  new Function('require','module','exports',code)((name:string)=>{
   if(name in imports)return imports[name];
   if(name.endsWith('.css'))return {default:{}};
   assert.ok(jsxOnly.has(name),'unexpected workspace dependency '+name);return components;
  },module,module.exports);
  const tree=module.exports.LifeOSWorkspace({state:{status:'unknown'},access:{authenticated:true,writable:false,loginAllowed:true},initialPage:'settings',viewPreferenceScope:preferenceScope,onNavigatePage:(page:string)=>navigated.push(page)});
  const navigation=nodes(tree,node=>node.type==='nav'&&node.props?.['aria-label']==='设置分类');assert.equal(navigation.length,1);
  const pool=nodes(navigation[0],node=>node.props?.children==='需求池'&&typeof node.props?.onClick==='function');assert.equal(pool.length,1);
  pool[0].props.onClick();assert.deepEqual(navigated,['requirements'],'the pool keeps its existing finite workspace destination');
  return nodes(navigation[0],node=>!!node.props?.href).map(node=>node.props.href);
 }
 for(const closed of [null,{}, {...status,storageVerified:false},{...status,requirementsEnabled:false},{...status,requirementSupportEnabled:false}])assert.deepEqual(settings(closed),[]);
 assert.deepEqual(settings(status,JSON.stringify(['foreign-owner','space'])),[]);
 assert.deepEqual(settings(status),['/personal/requirements/roadmap','/personal/requirements/feedback','/personal/requirements/updates']);
});
