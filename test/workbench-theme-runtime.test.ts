import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import ts from 'typescript';

type Node={type:any;props:Record<string,any>};
function nodes(node:any,predicate:(n:Node)=>boolean):Node[]{if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(n=>nodes(n,predicate));return [...(predicate(node)?[node]:[]),...nodes(node.props?.children,predicate)];}
/** Runs real switch/store/runtime; only React's hook scheduler and browser host are simulated. */
function harness({saved='system',palette='slate-indigo',dark=false,denied=false,missingMedia=false,deferRuntime=false}={}){
 const listeners=new Map<string,Set<Function>>(),mediaListeners=new Set<Function>(),writes:string[][]=[];
 const root={dataset:{} as Record<string,string>,style:{} as Record<string,string>};
 const media={matches:dark,addEventListener:(_:string,fn:Function)=>mediaListeners.add(fn),removeEventListener:(_:string,fn:Function)=>mediaListeners.delete(fn)};
 const storage={getItem:(key:string)=>{if(denied)throw Error('denied');return key==='lifeos-ui-palette'?palette:saved;},setItem:(key:string,value:string)=>{if(denied)throw Error('denied');if(key==='lifeos-ui-palette')palette=value;else saved=value;writes.push([key,value]);}};
 const window={matchMedia:()=>{if(missingMedia)throw Error('unavailable');return media;},get localStorage(){if(denied)throw Error('denied');return storage;},addEventListener:(name:string,fn:Function)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(fn);},removeEventListener:(name:string,fn:Function)=>listeners.get(name)?.delete(fn)};
 let current:any;function hooks(){let at=0,notifications=0;const values:any[]=[],effects:(()=>void|(()=>void))[]=[],cleanups:Function[]=[];return {notifications:()=>notifications,reset(){at=0;},react:{useRef:(v:any)=>{const i=at++;return values[i]??(values[i]={current:v});},useState:(v:any)=>{const i=at++;if(!(i in values))values[i]=typeof v==='function'?v():v;return[values[i],(n:any)=>values[i]=typeof n==='function'?n(values[i]):n];},useEffect:(fn:()=>void|(()=>void))=>effects.push(fn),useSyncExternalStore:(subscribe:(fn:()=>void)=>()=>void,get:()=>any)=>{const i=at++;if(!(i in values)){values[i]=true;effects.push(()=>subscribe(()=>{notifications++;}));}return get();},useId:()=>'theme-'+at++},mount(){for(const fn of effects){const cleanup=fn();if(cleanup)cleanups.push(cleanup);}effects.length=0;},dispose(){cleanups.forEach(fn=>fn());}};}
 const jsx={jsx:(type:any,props:any)=>({type,props}),jsxs:(type:any,props:any)=>({type,props}),Fragment:'fragment'},cache=new Map<string,any>();
 function load(path:string):any{const file=resolve(path);if(cache.has(file))return cache.get(file);const module={exports:{} as any};cache.set(file,module.exports);const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports','window','document','localStorage',code)((key:string)=>{if(key==='react')return new Proxy({},{get:(_,name)=>current.react[name]});if(key==='react/jsx-runtime')return jsx;if(key==='lucide-react')return {Moon:'moon-icon',Sun:'sun-icon'};if(key.endsWith('.css'))return {default:{}};assert.ok(key.startsWith('.'),key);const base=resolve(dirname(file),key);return load([base,base+'.ts',base+'.tsx'].find(existsSync)!);},module,module.exports,window,{documentElement:root},storage);return module.exports;}
 const switchModule=load('src/workbench/theme-switch.tsx');const runtime=existsSync('src/workbench/theme-runtime.tsx')?load('src/workbench/theme-runtime.tsx'):null;const runtimeHooks=hooks();if(runtime){current=runtimeHooks;runtime.ThemeRuntime();if(!deferRuntime)runtimeHooks.mount();}
 function control(){
  const state=hooks();
  function render(){current=state;state.reset();return switchModule.ThemeSwitch();}
  const buttons=()=>nodes(render(),node=>node.type==='button');
  render();state.mount();
  return{render,buttons,notifications:state.notifications,click(){const [button]=buttons();assert.ok(button&&!button.props.disabled);button.props.onClick();},preference:()=>buttons()[0]?.props['data-theme-preference'],dispose:()=>state.dispose()};
 }
 return{appearance(){current=hooks();return switchModule.AppearanceSettings();},setPalette:(value:string)=>load('src/workbench/theme-store.ts').themeStore.setPalette(value),snapshot:()=>load('src/workbench/theme-store.ts').themeStore.getSnapshot(),control,root,writes,listeners,mediaListeners,hasRuntime:!!runtime,start:()=>runtimeHooks.mount(),system(value:boolean){media.matches=value;mediaListeners.forEach(fn=>fn({matches:value}));},storage(value:string|null,key:string|null='lifeos-ui-theme'){if(key==='lifeos-ui-palette')palette=value??'slate-indigo';else saved=value??'system';listeners.get('storage')?.forEach(fn=>fn({key,newValue:value,storageArea:storage}));},dispose:()=>runtimeHooks.dispose()};
}
test('a saved preference is never presented as system while the root store is still uninitialized',()=>{
 const h=harness({saved:'dark',deferRuntime:true}),control=h.control();
 const [pending]=control.buttons();
 assert.equal(control.buttons().length,1);
 assert.equal(pending.props.disabled,true);assert.equal(pending.props['aria-hidden'],true);
 assert.equal(pending.props['data-theme-preference'],undefined);
 assert.equal(h.mediaListeners.size,0);assert.equal(control.notifications(),0);
 h.start();assert.equal(h.root.dataset.lifeosTheme,'dark');assert.equal(control.preference(),'dark');
 assert.equal(control.buttons()[0].props.disabled,false);
 assert.equal(control.notifications(),1);control.dispose();h.dispose();
});
test('initial system/light values still publish readiness and reveal the control exactly once',()=>{
 const h=harness({deferRuntime:true}),control=h.control();
 assert.equal(control.buttons()[0].props.disabled,true);
 h.start();assert.equal(control.notifications(),1);assert.equal(control.preference(),'system');
 assert.equal(control.buttons()[0].props.disabled,false);
 h.system(false);assert.equal(control.notifications(),1);control.dispose();h.dispose();
});
test('one icon button exposes the opposite effective appearance and uses native button semantics',()=>{
 const h=harness({dark:true}),control=h.control();
 assert.equal(control.buttons().length,1);
 assert.equal(control.buttons()[0].props.type,'button');
 assert.equal(control.buttons()[0].props['aria-label'],'切换到浅色模式');
 assert.equal(control.buttons()[0].props.children.type,'sun-icon');
 control.click();assert.equal(h.root.dataset.lifeosTheme,'light');
 assert.equal(control.buttons()[0].props['aria-label'],'切换到深色模式');
 assert.equal(control.buttons()[0].props.children.type,'moon-icon');
 assert.deepEqual(h.writes,[['lifeos-ui-theme','light']]);control.dispose();h.dispose();
});
test('two real appearance controls synchronize in the same document without a storage event',()=>{const h=harness(),a=h.control(),b=h.control();a.click();assert.equal(h.root.dataset.lifeosTheme,'dark');assert.equal(b.preference(),'dark');assert.deepEqual(h.writes,[['lifeos-ui-theme','dark']]);assert.equal(h.mediaListeners.size,1);assert.equal(h.listeners.get('storage')?.size,1);a.dispose();b.dispose();h.system(false);assert.equal(h.root.dataset.lifeosTheme,'dark');h.dispose();});
test('root follows system and cross-tab preference changes without a Header or settings mounted',()=>{const h=harness();assert.ok(h.hasRuntime,'root theme runtime is missing');h.system(true);assert.equal(h.root.dataset.lifeosTheme,'dark');h.storage('light');h.system(true);assert.equal(h.root.dataset.lifeosTheme,'light');h.storage(null,null);assert.equal(h.root.dataset.lifeosTheme,'dark');assert.equal(h.listeners.get('storage')?.size,1);assert.equal(h.mediaListeners.size,1);h.dispose();assert.equal(h.mediaListeners.size,0);assert.equal(h.listeners.get('storage')?.size,0);});
test('storage denial applies the chosen mode, reports persistence failure and shares that notice',()=>{const h=harness({denied:true}),a=h.control(),b=h.control();a.click();assert.equal(h.root.style.colorScheme,'dark');assert.equal(b.preference(),'dark');assert.ok(nodes(b.render(),n=>n.props.role==='status').some(n=>String(n.props.children).includes('未允许保存')));h.system(false);assert.equal(h.root.dataset.lifeosTheme,'dark');h.dispose();});
test('unavailable matchMedia still permits explicit appearance choices',()=>{const h=harness({missingMedia:true}),a=h.control();a.click();assert.equal(h.root.dataset.lifeosTheme,'dark');a.click();assert.equal(h.root.dataset.lifeosTheme,'light');h.dispose();});


test('mounted appearance controls receive real store notifications and unsubscribe when disposed',()=>{
 const h=harness(),a=h.control(),b=h.control();
 assert.equal(a.notifications(),0);assert.equal(b.notifications(),0);
 a.click();assert.equal(a.notifications(),1);assert.equal(b.notifications(),1);
 b.dispose();a.click();assert.equal(a.notifications(),2);assert.equal(b.notifications(),1,'disposed control must no longer be notified');
 h.storage('system');assert.equal(a.notifications(),3);assert.equal(b.notifications(),1);
 a.dispose();h.system(true);assert.equal(a.notifications(),3);assert.equal(h.root.dataset.lifeosTheme,'dark');h.dispose();
});

// Changing the palette must share the existing first-paint/document lifecycle, not fork a second theme writer.
test('paired palettes restore and synchronize without changing the light/dark preference',()=>{
 const h=harness({saved:'dark',palette:'sage-teal'});assert.equal(h.root.dataset.lifeosPalette,'sage-teal');
 h.setPalette('mauve-violet');assert.equal(h.root.dataset.lifeosPalette,'mauve-violet');assert.equal(h.root.dataset.lifeosTheme,'dark');
 assert.deepEqual(h.writes,[['lifeos-ui-palette','mauve-violet']]);
 h.storage('slate-indigo','lifeos-ui-palette');assert.equal(h.root.dataset.lifeosPalette,'slate-indigo');assert.equal(h.root.dataset.lifeosTheme,'dark');
 h.storage('untrusted','lifeos-ui-palette');assert.equal(h.root.dataset.lifeosPalette,'slate-indigo');h.dispose();
});
test('storage-denied palette choice remains visible with an honest shared notice',()=>{
 const h=harness({denied:true});h.setPalette('sage-teal');assert.equal(h.root.dataset.lifeosPalette,'sage-teal');
 assert.match(h.snapshot().notice,/未允许保存/);h.system(true);assert.equal(h.root.dataset.lifeosPalette,'sage-teal');h.dispose();
});

test('visible native palette presets share the existing preference writer and restore the selected radio',()=>{
 const h=harness({palette:'sage-teal',saved:'dark'});
 const radios=()=>nodes(h.appearance(),n=>n.type==='input'&&n.props.type==='radio');
 assert.equal(radios().length,3);assert.deepEqual(radios().filter(n=>n.props.checked).map(n=>n.props.value),['sage-teal']);
 radios().find(n=>n.props.value==='mauve-violet')!.props.onChange();
 assert.deepEqual(radios().filter(n=>n.props.checked).map(n=>n.props.value),['mauve-violet']);
 assert.deepEqual(h.writes,[['lifeos-ui-palette','mauve-violet']]);assert.equal(h.root.dataset.lifeosTheme,'dark');h.dispose();
});
