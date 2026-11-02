import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as clientModule from '../src/record-window-workbench/client.ts';
import * as timelineModule from '../src/timeline-workbench/client.ts';
import * as recordModule from '../src/records-candidate/contracts.ts';
import * as fieldsModule from '../src/records-workbench/fields.ts';
type Node={type:unknown;props:Record<string,any>};
function text(node:any):string{if(node===null||node===undefined||typeof node==='boolean')return '';if(Array.isArray(node))return node.map(text).join('');if(typeof node!=='object')return String(node);if(typeof node.type==='function')return text(node.type(node.props));return text(node.props?.children);}
function find(node:any,predicate:(node:Node)=>boolean):Node|undefined{if(!node||typeof node!=='object')return;if(Array.isArray(node)){for(const child of node){const found=find(child,predicate);if(found)return found;}return;}if(predicate(node))return node;return find(node.props?.children,predicate);}
/** Runs the actual TSX and actual client with deterministic hooks and event handlers; no DOM/browser. */
function harness(){let cursor=0;const values:any[]=[],effects=new Map<number,{run:()=>void|(()=>void);deps:any[];cleanup?:()=>void;pending:boolean}>();
 const react={useRef(value:any){const at=cursor++;return values[at]??(values[at]={current:value});},useState(initial:any){const at=cursor++;if(!(at in values))values[at]=typeof initial==='function'?initial():initial;return[values[at],(next:any)=>{values[at]=typeof next==='function'?next(values[at]):next;}];},useEffect(run:()=>void|(()=>void),deps:any[]){const at=cursor++,prior=effects.get(at);if(!prior||deps.some((value,index)=>value!==prior.deps[index]))effects.set(at,{run,deps,cleanup:prior?.cleanup,pending:true});}};
 const jsx={jsx:(type:unknown,props:Record<string,any>)=>({type,props}),jsxs:(type:unknown,props:Record<string,any>)=>({type,props}),Fragment:'fragment'},module={exports:{} as Record<string,(props:any)=>Node>};
 const source=readFileSync(new URL('../src/record-window-workbench/index.tsx',import.meta.url),'utf8'),code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const imports:Record<string,unknown>={react,'react/jsx-runtime':jsx,'./client':clientModule,'../timeline-workbench/client':timelineModule,'../records-candidate/contracts':recordModule,'../records-workbench/fields':fieldsModule,'./styles.module.css':{default:{}}};
 const listeners=new Map<string,Set<()=>void>>(),window={addEventListener(type:string,fn:()=>void){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type)!.add(fn);},removeEventListener(type:string,fn:()=>void){listeners.get(type)?.delete(fn);}},document={...window,visibilityState:'visible'};
 new Function('require','module','exports','window','document',code)((path:string)=>{if(!(path in imports))throw Error('Unexpected import '+path);return imports[path];},module,module.exports,window,document);
 return{document,fire(type:string){for(const listener of listeners.get(type)??[])listener();},render(props:any){cursor=0;const tree=module.exports.RecordWindowWorkbench(props);for(const effect of effects.values())if(effect.pending){effect.cleanup?.();effect.cleanup=effect.run()||undefined;effect.pending=false;}return tree;},strictReplay(){for(const effect of effects.values())effect.cleanup?.();for(const effect of effects.values())effect.cleanup=effect.run()||undefined;},dispose(){for(const effect of effects.values())effect.cleanup?.();}};
}
const owner='synthetic-window-ui-owner',id='11111111-1111-4111-8111-111111111111',sourceId='22222222-2222-4222-8222-222222222222',stamp='2027-01-01T00:00:00.000Z';
const hit={id,sourceId,kind:'todo',type:'todo',revision:1,title:'Synthetic first page sentinel',date:'2027-01-01',sourceSystem:'website',snippet:'Synthetic first page summary'};
const row={eventKey:'recorded:todo:'+id,id,sourceId,kind:'todo',type:'todo',revision:1,currentRevision:1,title:hit.title,summary:hit.snippet,date:hit.date,at:stamp,dateKind:'instant',sourceTimeZone:'UTC',timeRole:'recorded',status:'open',isHistorical:false};
function source(){const original={...hit,fields:[{label:'备注',value:'Synthetic selected full text'}]},current={...original,revision:2,title:'Synthetic newer current',fields:[{label:'备注',value:'Synthetic current full text'}]};return{current,original,history:[current,original],historyLimit:20,historyTruncated:false,dataStatus:'isolated-test-drafts',syntheticIncluded:true};}
function payload(path:string,empty=false){const url=new URL(path,'https://synthetic.invalid'),p=url.searchParams,mode=url.pathname.includes('/timeline/')?'timeline':'search',cursor=p.get('cursor'),limit=Number(p.get('limit'));
 const query={...(mode==='search'?{q:p.get('q')??''}:{axis:p.get('axis'),timeZone:p.get('timeZone')}),...(p.get('from')?{from:p.get('from')}:{}),...(p.get('to')?{to:p.get('to')}:{}),...(p.get('type')?{type:p.get('type')}:{}),includeSynthetic:true,limit};
 const item=mode==='search'?{...hit,title:cursor?'Synthetic next page sentinel':hit.title}:row;
 return{mode,query,items:empty?[]:[item],observedAt:stamp,syntheticIncluded:true,dataStatus:'isolated-test-drafts',page:{cursorUsed:cursor,nextCursor:cursor?null:'opaque_second_page',hasMore:!cursor,scanned:cursor?1:limit,returned:empty?0:1,limit,ordering:'record-createdAt-desc-id-desc',consistency:'per-page-read-not-snapshot',compatibilityScope:'scanned-versions-and-originals',filtering:'bounded-window-post-filter',totalMatches:null,calendarIncluded:false,newerRecordsRequireRestart:true,revisionsMayChange:true,backdatedInsertionsMayBeMissed:true}};
}
function fixture(){let account:string|null=owner,empty=false,failNext=false;const calls:string[]=[];
 const transport:typeof fetch=async input=>{const path=String(input);calls.push(path);if(path.endsWith('/auth/get-session'))return Response.json(account?{user:{id:account},session:{userId:account}}:null);if(path.includes('/source/'))return Response.json(source());if(failNext&&path.includes('cursor='))return Response.json({error:{message:'PRIVATE_SENTINEL'}},{status:503});return Response.json(payload(path,empty));};
 return{calls,transport,props:{mode:'search' as 'search'|'timeline',client:new clientModule.RecordWindowClient(transport)},setAccount(next:string|null){account=next;},setEmpty(value:boolean){empty=value;},setFailNext(value:boolean){failNext=value;}};
}
const flush=async()=>{for(let at=0;at<8;at++)await new Promise<void>(resolve=>setImmediate(resolve));};
type Harness=ReturnType<typeof harness>;
const button=(h:Harness,props:any,label:string)=>find(h.render(props),node=>node.type==='button'&&text(node)===label);
function click(h:Harness,props:any,label:string){const node=button(h,props,label);assert.ok(node,'Missing button '+label);assert.ok(!node.props.disabled,'Disabled button '+label);node.props.onClick();}
function change(h:Harness,props:any,label:string,value:string|boolean){const node=find(h.render(props),node=>node.props?.['aria-label']===label);assert.ok(node);node.props.onChange({target:{value,checked:value}});}
function submit(h:Harness,props:any){find(h.render(props),node=>node.type==='form')!.props.onSubmit({preventDefault(){}});}
function start(h:Harness,props:any){change(h,props,'窗口合成评审确认',true);submit(h,props);}
const pages=(f:ReturnType<typeof fixture>)=>f.calls.filter(path=>path.includes('/page?'));

test('explicit submit is required; StrictMode replay and focus cannot perform initial reads',async()=>{
 const f=fixture(),h=harness();h.render(f.props);h.strictReplay();h.fire('focus');await flush();assert.equal(f.calls.length,0);assert.equal(button(h,f.props,'开始查询')!.props.disabled,true);change(h,f.props,'窗口合成评审确认',true);assert.equal(f.calls.length,0);submit(h,f.props);await flush();const view=text(h.render(f.props));assert.match(view,/Synthetic first page sentinel/);assert.match(view,/本页扫描 30 条，返回 1 条/);assert.match(view,/总量未知/);assert.match(view,/回填较早创建时间的插入可能遗漏/);assert.doesNotMatch(view,/共 1 条/);assert.equal(pages(f).length,1);assert.ok(!find(h.render(f.props),node=>node.type==='option'&&node.props.value==='calendar'));h.dispose();
});

test('next page replaces stored items and cursor, then stops at the actual end',async()=>{
 const f=fixture(),h=harness();h.render(f.props);start(h,f.props);await flush();click(h,f.props,'读取下一页');await flush();const view=text(h.render(f.props));assert.match(view,/Synthetic next page sentinel/);assert.doesNotMatch(view,/Synthetic first page sentinel/);assert.match(view,/已到当前扫描末尾/);assert.equal(pages(f).length,2);assert.match(pages(f)[1],/cursor=opaque_second_page/);assert.equal(button(h,f.props,'读取下一页'),undefined);h.dispose();
});

test('empty matching page explicitly offers continuation',async()=>{
 const f=fixture(),h=harness();f.setEmpty(true);h.render(f.props);start(h,f.props);await flush();assert.match(text(h.render(f.props)),/本页扫描范围内没有匹配项，仍可读取下一页/);click(h,f.props,'读取下一页');await flush();assert.match(text(h.render(f.props)),/当前扫描已到末尾/);h.dispose();
});

test('failed next page retries the exact attempted cursor without repeating first page',async()=>{
 const f=fixture(),h=harness();h.render(f.props);start(h,f.props);await flush();f.setFailNext(true);click(h,f.props,'读取下一页');await flush();assert.match(text(h.render(f.props)),/暂不可用/);assert.doesNotMatch(text(h.render(f.props)),/PRIVATE_SENTINEL/);f.setFailNext(false);click(h,f.props,'重试同一页');await flush();assert.equal(pages(f).length,3);assert.equal(pages(f)[1],pages(f)[2]);assert.equal(pages(f).filter(path=>!path.includes('cursor=')).length,1);assert.match(text(h.render(f.props)),/Synthetic next page sentinel/);h.dispose();
});

test('cancel next page aborts signal; retry preserves the attempted position after late success',async()=>{
 const f=fixture();let finish!:(value:Response)=>void,signal:AbortSignal|null|undefined,blocked=true;const props={...f.props,client:new clientModule.RecordWindowClient(async(input,init)=>{if(blocked&&String(input).includes('cursor=')){signal=init?.signal;return new Promise<Response>(resolve=>{finish=resolve;});}return f.transport(input,init);})},h=harness();h.render(props);start(h,props);await flush();click(h,props,'读取下一页');await flush();click(h,props,'取消读取');assert.equal(signal?.aborted,true);finish(Response.json(payload('/api/platform/search/page?includeSynthetic=true&limit=30&cursor=opaque_second_page')));await flush();assert.doesNotMatch(text(h.render(props)),/Synthetic next page sentinel/);blocked=false;click(h,props,'重试同一页');await flush();assert.match(pages(f).at(-1)!,/cursor=opaque_second_page/);assert.equal(pages(f).filter(path=>!path.includes('cursor=')).length,1);h.dispose();
});

test('source shows selected and newer current full text and returns to same stored page without reread',async()=>{
 const f=fixture(),h=harness();h.render(f.props);start(h,f.props);await flush();find(h.render(f.props),node=>node.type==='button'&&text(node).includes(hit.title))!.props.onClick();await flush();let view=text(h.render(f.props));assert.match(view,/所选修订内容 · 修订 1/);assert.match(view,/Synthetic selected full text/);assert.match(view,/当前内容 · 修订 2/);assert.match(view,/Synthetic current full text/);assert.match(view,/来源已有新修订/);click(h,f.props,'返回同一查询和当前页');view=text(h.render(f.props));assert.match(view,/Synthetic first page sentinel/);assert.doesNotMatch(view,/Synthetic selected full text/);assert.equal(pages(f).length,1);assert.equal(f.calls.filter(path=>path.includes('/search/source/')).length,1);h.dispose();
});

test('unavailable selected historical revision stays explicit despite same-revision original input',async()=>{
 const f=fixture(),value=source();value.historyTruncated=true;value.history=value.history.filter(doc=>doc.revision!==1);value.original.fields=[{label:'备注',value:'Synthetic raw original body'}];const props={...f.props,client:new clientModule.RecordWindowClient(async(input,init)=>String(input).includes('/source/')?Response.json(value):f.transport(input,init))},h=harness();h.render(props);start(h,props);await flush();find(h.render(props),node=>node.type==='button'&&text(node).includes(hit.title))!.props.onClick();await flush();const view=text(h.render(props));assert.match(view,/所选修订 1 不在本次返回的历史范围内/);assert.doesNotMatch(view,/所选修订内容 · 修订 1/);assert.match(view,/首次原始输入 · 修订 1/);assert.match(view,/Synthetic raw original body/);assert.match(view,/当前内容 · 修订 2/);h.dispose();
});

test('query edits and consent withdrawal clear page/cursor and abort pending source',async()=>{
 const f=fixture();let finish!:(value:Response)=>void,signal:AbortSignal|null|undefined;const props={...f.props,client:new clientModule.RecordWindowClient(async(input,init)=>String(input).includes('/source/')?(signal=init?.signal,new Promise<Response>(resolve=>{finish=resolve;})):f.transport(input,init))},h=harness();h.render(props);start(h,props);await flush();find(h.render(props),node=>node.type==='button'&&text(node).includes(hit.title))!.props.onClick();await flush();change(h,props,'窗口合成评审确认',false);assert.equal(signal?.aborted,true);finish(Response.json(source()));await flush();assert.doesNotMatch(text(h.render(props)),/Synthetic first page sentinel|Synthetic selected full text/);assert.equal(button(h,props,'重试同一来源'),undefined);change(h,props,'窗口合成评审确认',true);submit(h,props);await flush();change(h,props,'窗口关键词','changed');assert.doesNotMatch(text(h.render(props)),/Synthetic first page sentinel/);assert.equal(button(h,props,'读取下一页'),undefined);h.dispose();
});

test('blur hides page and cursor; focus rechecks owner without automatically loading data',async()=>{
 const f=fixture(),h=harness();h.render(f.props);start(h,f.props);await flush();h.fire('blur');assert.doesNotMatch(text(h.render(f.props)),/Synthetic first page sentinel/);assert.equal(button(h,f.props,'读取下一页'),undefined);const before=pages(f).length;h.fire('focus');await flush();assert.equal(pages(f).length,before);assert.doesNotMatch(text(h.render(f.props)),/Synthetic first page sentinel/);f.setAccount('other');submit(h,f.props);await flush();assert.match(text(h.render(f.props)),/账号已变化/);assert.equal(button(h,f.props,'开始查询')!.props.disabled,true);assert.equal(button(h,f.props,'重试同一页'),undefined);h.dispose();
});

test('identity change on failed next page clears all content and prevents retry',async()=>{
 const f=fixture();const props={...f.props,client:new clientModule.RecordWindowClient(async(input,init)=>{if(String(input).includes('cursor=')){f.setAccount('foreign');return new Response('PRIVATE_UPSTREAM',{status:503});}return f.transport(input,init);})},h=harness();h.render(props);start(h,props);await flush();click(h,props,'读取下一页');await flush();const view=text(h.render(props));assert.match(view,/账号已变化/);assert.doesNotMatch(view,/Synthetic first page sentinel|PRIVATE_UPSTREAM/);assert.equal(button(h,props,'重试同一页'),undefined);h.dispose();
});

test('late forbidden response from cancelled earlier page hides a newer visible page',async()=>{
 const f=fixture();let first=true,finish!:(response:Response)=>void;const props={...f.props,client:new clientModule.RecordWindowClient(async(input,init)=>{if(first&&String(input).includes('/page?')){first=false;return new Promise<Response>(resolve=>{finish=resolve;});}return f.transport(input,init);})},h=harness();h.render(props);start(h,props);await flush();click(h,props,'取消读取');click(h,props,'重试同一页');await flush();assert.match(text(h.render(props)),/Synthetic first page sentinel/);finish(new Response('PRIVATE_RAW_SENTINEL',{status:403}));await flush();assert.doesNotMatch(text(h.render(props)),/Synthetic first page sentinel|PRIVATE_RAW_SENTINEL/);assert.match(text(h.render(props)),/当前账号不能查看此范围/);h.dispose();
});

test('timeline defaults to Beijing; mode change clears scope and unmount aborts an identity read',async()=>{
 const f=fixture(),h=harness();f.props.mode='timeline';h.render(f.props);assert.equal(find(h.render(f.props),node=>node.props?.['aria-label']==='窗口时区')!.props.value,'Asia/Shanghai');change(h,f.props,'窗口时间依据','recorded');start(h,f.props);await flush();assert.match(text(h.render(f.props)),/录入时间：2027-01-01 08:00:00/);f.props.mode='search';h.render(f.props);assert.doesNotMatch(text(h.render(f.props)),/Synthetic first page sentinel/);assert.equal(button(h,f.props,'开始查询')!.props.disabled,true);h.dispose();
 let signal:AbortSignal|null|undefined,finish!:(response:Response)=>void;const props={mode:'search',client:new clientModule.RecordWindowClient(async(_input,init)=>{signal=init?.signal;return new Promise<Response>(resolve=>{finish=resolve;});})},unmounted=harness();unmounted.render(props);start(unmounted,props);await flush();unmounted.dispose();assert.equal(signal?.aborted,true);finish(Response.json({user:{id:owner},session:{userId:owner}}));await flush();assert.doesNotMatch(text(unmounted.render(props)),/Synthetic first page sentinel/);
});
