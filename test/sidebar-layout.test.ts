import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import ts from'typescript';import{workbenchNavigation,findModule}from'../src/workbench/navigation.ts';
type N={type:unknown;props:Record<string,any>};
function find(n:any,p:(n:N)=>boolean):N|undefined{if(!n||typeof n!=='object')return;if(Array.isArray(n)){for(const c of n){const r=find(c,p);if(r)return r;}return;}return p(n)?n:find(n.props?.children,p);}
function all(n:any,p:(n:N)=>boolean,out:N[]=[]):N[]{if(!n||typeof n!=='object')return out;if(Array.isArray(n)){for(const c of n)all(c,p,out);return out;}if(p(n))out.push(n);all(n.props?.children,p,out);return out;}
function harness(){let cursor=0;const states:any[]=[],refs:any[]=[],effects:Function[]=[];const react={useState:(initial:any)=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],(next:any)=>{states[i]=typeof next==='function'?next(states[i]):next;}];},useRef:(value:any)=>{const i=cursor++;return refs[i]??(refs[i]={current:value});},useEffect:(fn:Function)=>{effects.push(fn);}};
 const jsx={jsx:(type:unknown,props:any)=>({type,props}),jsxs:(type:unknown,props:any)=>({type,props})},module={exports:{}as any},styles=new Proxy({},{get:(_,key)=>String(key)}),imports:any={react,'../personal-candidate/privacy':{PrivacyBoundary:'privacy-boundary',LogoutButton:'logout-button'},'react/jsx-runtime':jsx,'next/link':{default:'a'},'next/navigation':{usePathname:()=>'/review/admin/journal'},'../admin-preview/icons':{Icon:'icon'},'./theme-switch':{ThemeSwitch:'theme'},'./navigation':{workbenchNavigation,findModule},'./status':{WorkspaceStatusProvider:'provider'},'./styles.module.css':{default:styles}};
 new Function('require','module','exports','fetch',ts.transpileModule(readFileSync(new URL('../src/workbench/shell.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)((p:string)=>{assert.ok(p in imports,p);return imports[p];},module,module.exports,()=>{throw Error('collapse must not make a request');});
 return{render(){cursor=0;return module.exports.WorkbenchShell({children:'synthetic child'});}};
}
test('sidebar collapses and expands in place with accessible link names and active page retained',()=>{
 const h=harness();let tree=h.render();let button=find(tree,n=>n.props['aria-label']==='折叠侧栏');assert.ok(button,'Desktop sidebar toggle is missing');assert.equal(button.props['aria-expanded'],true);assert.equal(button.props['aria-controls'],'workbench-sidebar');
 button.props.onClick();tree=h.render();button=find(tree,n=>n.props['aria-label']==='展开侧栏');assert.ok(button);assert.equal(button.props['aria-expanded'],false);assert.ok(find(tree,n=>n.props['data-sidebar']==='collapsed'));
 const aside=find(tree,n=>n.type==='aside')!;for(const item of workbenchNavigation){const link=find(aside,n=>n.props.href===item.href&&n.props['aria-label']===item.title);assert.ok(link,item.title);assert.equal(link.props.title,item.title);if(item.id==='journal')assert.equal(link.props['aria-current'],'page');}
 button.props.onClick();assert.ok(find(h.render(),n=>n.props['data-sidebar']==='expanded'));
});
test('mobile drawer keeps full navigation labels independent of desktop collapse',()=>{
 const h=harness();const toggle=find(h.render(),n=>n.props['aria-label']==='折叠侧栏');assert.ok(toggle);toggle.props.onClick();const tree=h.render(),drawer=find(tree,n=>n.props['aria-label']==='手机导航');assert.ok(drawer);for(const item of workbenchNavigation){const matches=all(drawer,n=>n.props['aria-label']===item.title&&n.props.href===item.href);assert.equal(matches.length,1,item.title);}assert.ok(find(tree,n=>n.props['aria-label']==='打开导航'));
});
test('dropdown arrow is boxed with reserved text padding, theme colors and forced-color fallback',()=>{
 const css=readFileSync(new URL('../src/workbench/styles.module.css',import.meta.url),'utf8');
 assert.match(css,/select:not\(\[multiple\]\):not\(\[size\]\)/,'Single-select arrow scope is missing');
 assert.match(css,/appearance:none/);assert.match(css,/padding-inline-end:40px/);assert.match(css,/background-position:right 12px center/);assert.match(css,/background-size:16px 16px/);assert.match(css,/forced-colors:active/);assert.match(css,/data-lifeos-theme=dark/);
 for(const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){if(!/(?:clip-path|display:none|visibility:hidden)/.test(rule[2]))continue;for(const selector of rule[1].split(',')){if(/shellCollapsed/.test(selector)&&/navLabel|brandLabel|groupTitle/.test(selector))assert.ok(selector.includes('.shellCollapsed>.sidebar '),'Label hiding escapes desktop aside: '+selector);}}
});
