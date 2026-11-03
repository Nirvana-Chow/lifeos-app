import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import ts from 'typescript';
import * as navigation from '../src/workbench/navigation.ts';

type N={type:any;props:any};
function all(node:any,p:(n:N)=>boolean):N[]{if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(n=>all(n,p));return [...(p(node)?[node]:[]),...all(node.props?.children,p)];}
const jsx={jsx:(type:any,props:any)=>({type,props}),jsxs:(type:any,props:any)=>({type,props}),Fragment:'fragment'};
function compile(path:string,imports:Record<string,any>,fetcher:(...args:any[])=>any=()=>{throw Error('Unexpected request');}){const m={exports:{} as any};new Function('require','module','exports','fetch',ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)((name:string)=>{assert.ok(name in imports,'Unexpected dependency '+name);return imports[name];},m,m.exports,fetcher);return m.exports;}
function privateMap(){assert.ok(existsSync('src/workbench/private-navigation.ts'),'Exact private navigation is missing');return compile('src/workbench/private-navigation.ts',{'./navigation.ts':navigation});}
function shell(surface='personal'){
 const refs:any[]=[],requests:string[]=[];let at=0;const styles=new Proxy({},{get:(_,key)=>String(key)});
 const imports:any={react:{useState:(v:any)=>[v,()=>{}],useEffect:()=>{},useRef:(v:any)=>{const ref={current:v};refs[at++]=ref;return ref;}},'react/jsx-runtime':jsx,'next/link':{default:'a'},'next/navigation':{usePathname:()=>surface==='personal'?'/personal/schedule':'/review/admin/schedule'},'../personal-candidate/privacy':{PrivacyBoundary:'privacy',LogoutButton:'logout'},'../admin-preview/icons':{Icon:'icon'},'./theme-switch':{ThemeSwitch:'theme'},'./navigation':navigation,'./private-navigation':existsSync('src/workbench/private-navigation.ts')?privateMap():{},'./status':{WorkspaceStatusProvider:'provider'},'./styles.module.css':{default:styles}};
 const mod=compile('src/workbench/shell.tsx',imports,(url:any)=>{requests.push(url);return Promise.resolve({ok:false}) as any;});
 const tree=mod.WorkbenchShell({surface,children:'module'});return{tree,requests,async help(){await all(tree,n=>n.type==='button'&&n.props['aria-label']==='帮助与版本')[0].props.onClick();}};
}
test('all 28 business destinations have immutable private hrefs and exact segment matching',()=>{
 const m=privateMap();assert.equal(navigation.workbenchNavigation.length,28);assert.ok(Object.isFrozen(m.privateHrefs));assert.ok(Object.isFrozen(m.privateNavigation));
 for(const item of navigation.workbenchNavigation){const href=m.privateHrefs[item.id];assert.ok(href.startsWith('/personal'),item.id);if(!href.includes('?')&&href!=='/personal')assert.equal(m.resolvePrivateModule(href.slice('/personal/'.length).split('/'))?.id,item.id);}
 assert.equal(m.privateHrefs.journal,'/personal/edit?type=journal');assert.equal(m.privateHrefs.todos,'/personal?page=tasks');assert.equal(m.workspaceHref('inbox'),'/personal?page=inbox');
 for(const segments of [[],['unknown'],['schedule','extra'],['settings','data','extra'],['login'],['reference'],['capture'],['data'],['edit'],['%73chedule'],['schedule/'],['schedule?mode=synthetic-review'],['settings/data']])assert.equal(m.resolvePrivateModule(segments),null,JSON.stringify(segments));
 for(const value of ['tasks','inbox','areas','projects','settings','overview'])assert.equal(m.readWorkspacePage(value),value);
 for(const value of ['prototype','toString','tasks&mode=synthetic-review','/settings'])assert.equal(m.readWorkspacePage(value),'overview');
});
test('personal shell keeps every brand/nav/header/help link private and help makes no version request',async()=>{
 const h=shell();for(const link of all(h.tree,n=>!!n.props.href))assert.ok(link.props.href.startsWith('/personal')||link.props.href.startsWith('#'),link.props.href);
 await h.help();assert.deepEqual(h.requests,[]);assert.equal(all(h.tree,n=>n.type==='details'&&String(n.props.className)==='help').length,0);
 const map=privateMap();for(const area of ['主导航侧栏','手机导航']){const host=all(h.tree,n=>n.props['aria-label']===area)[0];for(const item of navigation.workbenchNavigation)assert.ok(all(host,n=>n.props.href===map.privateHrefs[item.id]).length,item.id+' '+area);}
});
test('review shell retains developer links and its previous help version request',async()=>{const h=shell('review');await h.help();assert.deepEqual(h.requests,['/api/review-version']);assert.ok(all(h.tree,n=>n.props.href==='/review/admin/reference').length);});

test('private module route gates content, rejects extra/unknown paths, and ignores synthetic query',async()=>{
 const path='app/personal/[...section]/page.tsx';assert.ok(existsSync(path),'Private module page is missing');const map=privateMap();let reads=0;let principal:any={ownerId:'synthetic-owner'};
 const imports:any={'react/jsx-runtime':jsx,'next/headers':{headers:async()=>new Headers()},'next/navigation':{redirect:(url:string)=>{throw Error('REDIRECT '+url);},notFound:()=>{throw Error('NOT_FOUND');}},'../../../src/platform/runtime':{readPlatformPagePrincipal:async()=>{reads++;if(principal instanceof Error)throw principal;return principal;}},'../../../src/workbench/private-navigation':map,'../../../src/workbench/shell':{WorkbenchShell:'shell'},'../../../src/workbench/draft-workspace':{BasicWorkspace:'basic',DraftEditor:'draft'},'../../../src/workbench/domain':{DomainPage:'domain'},'../../../src/workbench/settings':{DataSettings:'data'}};
 const route=compile(path,imports).default;
 const aliases=map.privateNavigation.filter((n:any)=>!n.href.includes('?')&&n.href!=='/personal');
 for(const item of aliases){const props={params:Promise.resolve({section:item.href.slice(10).split('/')}),searchParams:Promise.resolve({mode:'synthetic-review'})};for(const denied of [null,Error('reader failed')]){principal=denied;await assert.rejects(route(props),/REDIRECT \/login/);}principal={ownerId:'synthetic-owner'};const tree=await route(props);assert.equal(tree.type,'shell');assert.equal(tree.props.surface,'personal');assert.equal(all(tree,n=>n.props.syntheticReview).length,0);if(item.id==='ai-settings')assert.equal(all(tree,n=>n.type==='draft'&&n.props.kind==='ai').length,1);if(item.id==='chat')assert.equal(all(tree,n=>n.type==='domain').length,1);}
 for(const section of [['schedule','extra'],['login'],['data'],['reference'],['settings','data','extra']])await assert.rejects(route({params:Promise.resolve({section})}),/NOT_FOUND/);assert.ok(reads>=aliases.length*3);
});
