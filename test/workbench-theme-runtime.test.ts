import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import ts from 'typescript';

type Node={type:any;props:Record<string,any>};
function nodes(node:any,predicate:(n:Node)=>boolean):Node[]{if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(n=>nodes(n,predicate));return [...(predicate(node)?[node]:[]),...nodes(node.props?.children,predicate)];}
/** Runs real switch/store/runtime; only React's hook scheduler and browser host are simulated. */
function harness({saved='system',dark=false,denied=false,missingMedia=false}={}){
 const listeners=new Map<string,Set<Function>>(),mediaListeners=new Set<Function>(),writes:string[][]=[];
 const root={dataset:{} as Record<string,string>,style:{} as Record<string,string>};
 const media={matches:dark,addEventListener:(_:string,fn:Function)=>mediaListeners.add(fn),removeEventListener:(_:string,fn:Function)=>mediaListeners.delete(fn)};
 const storage={getItem:()=>{if(denied)throw Error('denied');return saved;},setItem:(key:string,value:string)=>{if(denied)throw Error('denied');saved=value;writes.push([key,value]);}};
 const window={matchMedia:()=>{if(missingMedia)throw Error('unavailable');return media;},get localStorage(){if(denied)throw Error('denied');return storage;},addEventListener:(name:string,fn:Function)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(fn);},removeEventListener:(name:string,fn:Function)=>listeners.get(name)?.delete(fn)};
 let current:any;function hooks(){let at=0,notifications=0;const values:any[]=[],effects:(()=>void|(()=>void))[]=[],cleanups:Function[]=[];return {notifications:()=>notifications,reset(){at=0;},react:{useRef:(v:any)=>{const i=at++;return values[i]??(values[i]={current:v});},useState:(v:any)=>{const i=at++;if(!(i in values))values[i]=typeof v==='function'?v():v;return[values[i],(n:any)=>values[i]=typeof n==='function'?n(values[i]):n];},useEffect:(fn:()=>void|(()=>void))=>effects.push(fn),useSyncExternalStore:(subscribe:(fn:()=>void)=>()=>void,get:()=>any)=>{const i=at++;if(!(i in values)){values[i]=true;effects.push(()=>subscribe(()=>{notifications++;}));}return get();},useId:()=>'theme-'+at++},mount(){for(const fn of effects){const cleanup=fn();if(cleanup)cleanups.push(cleanup);}effects.length=0;},dispose(){cleanups.forEach(fn=>fn());}};}
 const jsx={jsx:(type:any,props:any)=>({type,props}),jsxs:(type:any,props:any)=>({type,props}),Fragment:'fragment'},cache=new Map<string,any>();
 function load(path:string):any{const file=resolve(path);if(cache.has(file))return cache.get(file);const module={exports:{} as any};cache.set(file,module.exports);const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports','window','document','localStorage',code)((key:string)=>{if(key==='react')return new Proxy({},{get:(_,name)=>current.react[name]});if(key==='react/jsx-runtime')return jsx;if(key.endsWith('.css'))return {default:{}};assert.ok(key.startsWith('.'),key);const base=resolve(dirname(file),key);return load([base,base+'.ts',base+'.tsx'].find(existsSync)!);},module,module.exports,window,{documentElement:root},storage);return module.exports;}
 const switchModule=load('src/workbench/theme-switch.tsx');const runtime=existsSync('src/workbench/theme-runtime.tsx')?load('src/workbench/theme-runtime.tsx'):null;const runtimeHooks=hooks();if(runtime){current=runtimeHooks;runtime.ThemeRuntime();runtimeHooks.mount();}
 function control(){const state=hooks();function render(){current=state;state.reset();return switchModule.ThemeSwitch();}let tree=render();state.mount();tree=render();return{render,notifications:state.notifications,select(mode:string){tree=render();const radio=nodes(tree,n=>n.type==='input'&&n.props.value===mode)[0];if(radio)radio.props.onChange({target:{value:mode}});else nodes(tree,n=>n.type==='select')[0].props.onChange({target:{value:mode}});return render();},preference(){tree=render();return nodes(tree,n=>n.type==='input'&&n.props.checked)[0]?.props.value??nodes(tree,n=>n.type==='select')[0]?.props.value;},dispose:()=>state.dispose()};}
 return{control,root,writes,listeners,mediaListeners,hasRuntime:!!runtime,system(value:boolean){media.matches=value;mediaListeners.forEach(fn=>fn({matches:value}));},storage(value:string|null,key:string|null='lifeos-ui-theme'){saved=value??'system';listeners.get('storage')?.forEach(fn=>fn({key,newValue:value,storageArea:storage}));},dispose:()=>runtimeHooks.dispose()};
}
test('two real appearance controls synchronize in the same document without a storage event',()=>{const h=harness(),a=h.control(),b=h.control();a.select('dark');assert.equal(h.root.dataset.lifeosTheme,'dark');assert.equal(b.preference(),'dark');assert.deepEqual(h.writes,[['lifeos-ui-theme','dark']]);assert.equal(h.mediaListeners.size,1);assert.equal(h.listeners.get('storage')?.size,1);a.dispose();b.dispose();h.system(false);assert.equal(h.root.dataset.lifeosTheme,'dark');h.dispose();});
test('root follows system and cross-tab preference changes without a Header or settings mounted',()=>{const h=harness();assert.ok(h.hasRuntime,'root theme runtime is missing');h.system(true);assert.equal(h.root.dataset.lifeosTheme,'dark');h.storage('light');h.system(true);assert.equal(h.root.dataset.lifeosTheme,'light');h.storage(null,null);assert.equal(h.root.dataset.lifeosTheme,'dark');assert.equal(h.listeners.get('storage')?.size,1);assert.equal(h.mediaListeners.size,1);h.dispose();assert.equal(h.mediaListeners.size,0);assert.equal(h.listeners.get('storage')?.size,0);});
test('storage denial applies the chosen mode, reports persistence failure and shares that notice',()=>{const h=harness({denied:true}),a=h.control(),b=h.control();a.select('dark');assert.equal(h.root.style.colorScheme,'dark');assert.equal(b.preference(),'dark');assert.ok(nodes(b.render(),n=>n.props.role==='status').some(n=>String(n.props.children).includes('未允许保存')));h.system(false);assert.equal(h.root.dataset.lifeosTheme,'dark');h.dispose();});
test('unavailable matchMedia still permits explicit appearance choices',()=>{const h=harness({missingMedia:true}),a=h.control();a.select('dark');assert.equal(h.root.dataset.lifeosTheme,'dark');a.select('light');assert.equal(h.root.dataset.lifeosTheme,'light');h.dispose();});


test('mounted appearance controls receive real store notifications and unsubscribe when disposed',()=>{
 const h=harness(),a=h.control(),b=h.control();
 assert.equal(a.notifications(),0);assert.equal(b.notifications(),0);
 a.select('dark');assert.equal(a.notifications(),1);assert.equal(b.notifications(),1);
 b.dispose();a.select('light');assert.equal(a.notifications(),2);assert.equal(b.notifications(),1,'disposed control must no longer be notified');
 h.storage('system');assert.equal(a.notifications(),3);assert.equal(b.notifications(),1);
 a.dispose();h.system(true);assert.equal(a.notifications(),3);assert.equal(h.root.dataset.lifeosTheme,'dark');h.dispose();
});
