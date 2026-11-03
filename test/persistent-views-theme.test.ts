import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as themeModule from '../src/workbench/theme.ts';
import * as projectionModule from '../src/personal-candidate/projection.ts';
import * as resourceModule from '../src/component-review/resources.ts';

type Effect={run:()=>void|(()=>void);deps:unknown[];cleanup?:()=>void;pending:boolean};
/** Executes the actual chart effects and root theme runtime/store. React scheduling,
 * DOM observation and the external ECharts drawing boundary are represented here;
 * rendered chart colors and browser MutationObserver delivery remain browser gates. */
function harness({computedColor=''}={}){
 let changed=false,color=computedColor,dark=false;
 function hooks(){
  let cursor=0;const values:any[]=[],effects=new Map<number,Effect>();
  const same=(a:unknown[],b:unknown[])=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  return {
   reset(){cursor=0;},
   react:{
    useRef(value:any){return values[cursor++]??= {current:value};},
    useState(initial:any){const at=cursor++;if(!(at in values))values[at]=initial;return [values[at],(next:any)=>{const value=typeof next==='function'?next(values[at]):next;if(!Object.is(value,values[at])){values[at]=value;changed=true;}}];},
    useMemo(fn:()=>unknown,deps:unknown[]){const at=cursor++;if(!values[at]||!same(deps,values[at].deps))values[at]={deps,value:fn()};return values[at].value;},
    useEffect(run:Effect['run'],deps:unknown[]){const at=cursor++,old=effects.get(at);if(!old||!same(deps,old.deps))effects.set(at,{run,deps,cleanup:old?.cleanup,pending:true});},
   },
   effects(){for(const effect of effects.values())if(effect.pending){effect.pending=false;effect.cleanup?.();effect.cleanup=effect.run()||undefined;}},
   dispose(){for(const effect of effects.values())effect.cleanup?.();effects.clear();},
  };
 }
 const chartHooks=hooks(),runtimeHooks=hooks(),mutations=new Set<MutationObserverHost>(),resizes=new Set<ResizeObserverHost>();
 const root={dataset:{} as Record<string,string>,style:{} as Record<string,string>};
 class MutationObserverHost{
  target:unknown;options:{attributes?:boolean;attributeFilter?:string[]}={};active=false;
  readonly callback:()=>void;
  constructor(callback:()=>void){this.callback=callback;}
  observe(target:unknown,options:MutationObserverHost['options']){this.target=target;this.options=options;this.active=true;mutations.add(this);}
  disconnect(){this.active=false;mutations.delete(this);}
 }
 class ResizeObserverHost{
  observe(){resizes.add(this);}
  disconnect(){resizes.delete(this);}
 }
 root.dataset=new Proxy({}, {set(target:Record<string,string>,key:string,value:string){
  target[key]=value;const attribute='data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
  for(const observer of mutations)if(observer.target===root&&observer.options.attributes&&(!observer.options.attributeFilter||observer.options.attributeFilter.includes(attribute)))queueMicrotask(()=>{if(observer.active)observer.callback();});
  return true;
 }});
 const mediaListeners=new Set<()=>void>(),storageListeners=new Set<()=>void>();
 const media={get matches(){return dark;},addEventListener(_:string,fn:()=>void){mediaListeners.add(fn);},removeEventListener(_:string,fn:()=>void){mediaListeners.delete(fn);}};
 const window={matchMedia:()=>media,localStorage:{getItem:()=> 'light',setItem(){}},addEventListener(_:string,fn:()=>void){storageListeners.add(fn);},removeEventListener(_:string,fn:()=>void){storageListeners.delete(fn);}};
 const document={documentElement:root},chartNode={},graphs:{theme:unknown;disposed:boolean}[]=[];
 const core={use(){},init(_:unknown,theme:unknown){const graph={theme,disposed:false};graphs.push(graph);return {setOption(){},resize(){},dispose(){graph.disposed=true;}};}};
 const jsx={jsx:(type:unknown,props:any)=>({type,props}),jsxs:(type:unknown,props:any)=>({type,props})};
 function load(file:string,imports:Record<string,unknown>){
  const module={exports:{} as any},code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports','window','document','MutationObserver','ResizeObserver','getComputedStyle',code)((key:string)=>{assert.ok(key in imports,'unexpected import '+key);return imports[key];},module,module.exports,window,document,MutationObserverHost,ResizeObserverHost,()=>({color}));
  return module.exports;
 }
 const store=load('src/workbench/theme-store.ts',{'./theme':themeModule}).themeStore;
 const runtime=load('src/workbench/theme-runtime.tsx',{react:runtimeHooks.react,'./theme-store':{themeStore:store}});
 const views=load('src/personal-candidate/persistent-views.tsx',{
  react:chartHooks.react,'react/jsx-runtime':jsx,'next/link':{default:'a'},'./projection':projectionModule,'../component-review/resources':resourceModule,
  '../ui-review/record-grid':{RecordGrid:'record-grid'},'../component-review/workspace.module.css':{default:{}},
  'echarts/core':core,'echarts/charts':{PieChart:{}},'echarts/components':{TooltipComponent:{},LegendComponent:{},AriaComponent:{}},'echarts/renderers':{SVGRenderer:{}},
 });
 function attach(node:any){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(attach);return;}if(node.props?.ref)node.props.ref.current=chartNode;attach(node.props?.children);}
 function render(){for(let i=0;i<5;i++){changed=false;chartHooks.reset();attach(views.PersistentViews({entries:[],spaceId:'synthetic-space'}));chartHooks.effects();if(!changed)return;}throw Error('chart render did not settle');}
 async function settle(){for(let i=0;i<4;i++){await new Promise<void>(resolve=>setImmediate(resolve));render();}}
 runtime.ThemeRuntime();runtimeHooks.effects();render();
 return {root,graphs,mutations,resizes,mediaListeners,storageListeners,settle,
  preference(value:string){store.setPreference(value);},
  system(value:boolean){dark=value;mediaListeners.forEach(fn=>fn());},
  color(value:string){color=value;},
  dispose(){chartHooks.dispose();runtimeHooks.dispose();},
 };
}

// A wrong attribute filter leaves the old graph alive after the real store changes
// the root. A wrong dataset fallback rebuilds it with the previous light theme.
test('persistent chart follows the actual root theme lifecycle and releases replaced graphs and observers',async()=>{
 const h=harness();
 try{
  await h.settle();assert.deepEqual(h.graphs.map(g=>g.theme),[undefined]);
  h.preference('dark');await h.settle();
  assert.equal(h.root.dataset.lifeosTheme,'dark');
  assert.deepEqual(h.graphs.map(g=>g.theme),[undefined,'dark']);
  assert.equal(h.graphs[0].disposed,true);assert.equal(h.resizes.size,1);
  h.preference('system');await h.settle();
  assert.equal(h.root.dataset.lifeosTheme,'light');
  assert.deepEqual(h.graphs.map(g=>g.theme),[undefined,'dark',undefined]);
  h.system(true);await h.settle();
  assert.deepEqual(h.graphs.map(g=>g.theme),[undefined,'dark',undefined,'dark']);
  h.root.dataset.unrelated='synthetic';await h.settle();assert.equal(h.graphs.length,4);
  assert.equal(h.graphs.filter(g=>!g.disposed).length,1);
 }finally{h.dispose();}
 assert.ok(h.graphs.every(g=>g.disposed));assert.equal(h.mutations.size,0);assert.equal(h.resizes.size,0);
 assert.equal(h.mediaListeners.size,0);assert.equal(h.storageListeners.size,0);
});

test('persistent chart retains computed text color as its primary theme signal across root updates',async()=>{
 const h=harness({computedColor:'rgb(250, 250, 250)'});
 try{
  await h.settle();assert.equal(h.root.dataset.lifeosTheme,'light');assert.deepEqual(h.graphs.map(g=>g.theme),['dark']);
  h.color('rgb(24, 24, 27)');h.preference('dark');await h.settle();
  assert.equal(h.root.dataset.lifeosTheme,'dark');
  assert.deepEqual(h.graphs.map(g=>g.theme),['dark',undefined]);
  h.color('rgb(250, 250, 250)');h.preference('light');await h.settle();
  assert.deepEqual(h.graphs.map(g=>g.theme),['dark',undefined,'dark']);
 }finally{h.dispose();}
});
