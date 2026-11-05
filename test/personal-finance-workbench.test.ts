import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as client from '../src/personal-finance/client.ts';
import * as domain from '../src/personal-finance/domain.ts';
import {PersonalFinanceService} from '../src/personal-finance/service.ts';
import {handlePersonalFinance} from '../src/personal-finance/http.ts';
import {MemoryPort} from './helpers/platform.ts';
import type {FinanceDraft} from '../src/platform/domain.ts';

type Node={type:unknown;props:Record<string,any>};
function find(node:any,predicate:(node:Node)=>boolean):Node|undefined{if(!node||typeof node!=='object')return;if(Array.isArray(node)){for(const child of node){const result=find(child,predicate);if(result)return result;}return;}return predicate(node)?node:find(node.props?.children,predicate);}
function text(node:any):string{if(node==null||typeof node==='boolean')return'';if(Array.isArray(node))return node.map(text).join('');if(typeof node!=='object')return String(node);return String(node.props?.value??'')+text(node.props?.children);}
const settle=async()=>{for(let index=0;index<15;index++)await new Promise<void>(resolve=>setImmediate(resolve));};
function fixture(){
 const repo=new MemoryPort();repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(row=>row.ownerId===owner));
 let owner='finance-ui-fixture-owner',lost=false,failReadback=false,forcedRejection:{status:number;code:string}|null=null,fixtureKey=0,detailGate:Promise<void>|null=null,releaseDetail=()=>{};const spaceId='finance-ui-fixture-space',baseURL='https://finance.example.test',writes:{key:string;body:any}[]=[],values=new Map<string,string>();
 const store={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
 const fetcher=(async(input:RequestInfo|URL,init:RequestInit={})=>{
  const headers={host:'finance.example.test',origin:baseURL,...Object.fromEntries(new Headers(init.headers))},service=new PersonalFinanceService(repo,{ownerId:owner,spaceId,enabled:true,writable:true});
  if(init.method)writes.push({key:new Headers(init.headers).get('idempotency-key')!,body:JSON.parse(String(init.body))});
  if(init.method&&forcedRejection)return Response.json({error:{code:forcedRejection.code,message:'Explicit synthetic rejection'}},{status:forcedRejection.status});
  if(!init.method&&failReadback&&/\/[a-f0-9-]{36}$/.test(String(input)))return Response.json({error:{code:'UNAVAILABLE',message:'Explicit synthetic unavailable readback'}},{status:503});
  let response:Response;try{response=(await handlePersonalFinance(new Request(baseURL+String(input),{...init,headers}),{ownerId:owner,baseURL,service,assertOwner:async()=>{},guard:async()=>{}}))!;}catch(error:any){return Response.json({error:{code:error.code,message:error.message}},{status:error.status??503});}
  if(!init.method&&/\/[a-f0-9-]{36}$/.test(String(input))&&detailGate)await detailGate;
  if(init.method&&lost){lost=false;throw Error('synthetic committed response lost');}return response;
 }) as typeof fetch;
 const service=()=>new PersonalFinanceService(repo,{ownerId:owner,spaceId,enabled:true,writable:true});
 return{repo,writes,values,store,fetcher,lose(){lost=true;},failReadback(){failReadback=true;},reject(status:number,code:string){forcedRejection={status,code};},holdDetail(){detailGate=new Promise<void>(resolve=>{releaseDetail=resolve;});},releaseDetail(){detailGate=null;releaseDetail();},switchOwner(){owner='finance-ui-new-owner';},async seed(fields:Partial<FinanceDraft>={}){return service().create(owner,{spaceId,confirmed:true,fields:{kind:'expense',amountMinor:8000,currency:'CNY',occurredOn:'2030-11-05',category:null,fromAccountRef:null,toAccountRef:null,originalEntryId:null,notes:'Explicit seeded finance fixture',...fields}},'finance-ui-seed-'+ ++fixtureKey);},async change(id:string,fields:Partial<FinanceDraft>){const row=repo.rows.get(id)!;return service().update(owner,id,{spaceId,confirmed:true,fields:{...row.draft,...fields},expectedRevision:row.revision},'finance-ui-change-'+ ++fixtureKey);},async remoteEdit(){const row=[...repo.rows.values()][0];await service().update(owner,row.id,{spaceId,confirmed:true,fields:{...row.draft,notes:'Remote revision'},expectedRevision:row.revision},'finance-ui-remote-edit');}};
}
/** Real component, client, validation and transactional service; React/DOM and ReUI rendering are ports. */
function harness(f:ReturnType<typeof fixture>){
 let cursor=0,changed=false,tree:any,tableOptions:any;const values:any[]=[],effects=new Map<number,{run:()=>void|(()=>void);deps:any[];cleanup?:()=>void;pending:boolean}>(),listeners=new Map<string,Set<Function>>();
 const same=(a:any[],b:any[])=>a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const react={useState(initial:any){const index=cursor++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return[values[index],(next:any)=>{const value=typeof next==='function'?next(values[index]):next;if(!Object.is(value,values[index])){values[index]=value;changed=true;}}];},useRef(initial:any){return values[cursor]??(values[cursor++]={current:initial});},useMemo(fn:()=>unknown,deps:any[]){const index=cursor++;if(!values[index]||!same(values[index].deps,deps))values[index]={value:fn(),deps};return values[index].value;},useEffect(run:()=>void|(()=>void),deps:any[]){const index=cursor++,old=effects.get(index);if(!old||!same(old.deps,deps))effects.set(index,{run,deps,cleanup:old?.cleanup,pending:true});}};
 // A ref occupies its slot on every render, including after initialization.
 react.useRef=(initial:any)=>{const index=cursor++;return values[index]??(values[index]={current:initial});};
 const listen={addEventListener(name:string,fn:Function){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(fn);},removeEventListener(name:string,fn:Function){listeners.get(name)?.delete(fn);}};
 const window={...listen,confirm:()=>false,matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})},document={...listen,visibilityState:'visible'};
 const jsx={jsx:(type:unknown,props:any)=>({type,props}),jsxs:(type:unknown,props:any)=>({type,props}),Fragment:'fragment'},module={exports:{} as any};
 const imports:Record<string,unknown>={'react/jsx-runtime':jsx,react,'@tanstack/react-table':{useTable:(options:any)=>{tableOptions=options;return{};}},'../ui-review/reui/data-grid':{DataGrid:'grid',DataGridContainer:'grid-container',dataGridFeatures:{}},'../ui-review/reui/data-grid-table-virtual':{DataGridTableVirtual:'virtual'},'../ui-review/ui/button':{Button:'button'},'../ui-review/ui/dialog':{Dialog:'dialog',DialogContent:'dialog-content',DialogTitle:'h2',DialogDescription:'p'},'./domain':domain,'./client':client,'./workbench.module.css':{default:{}}};
 const code=ts.transpileModule(readFileSync(new URL('../src/personal-finance/workbench.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports','window','document','fetch','sessionStorage',code)((key:string)=>{assert.ok(key in imports,'unexpected import '+key);return imports[key];},module,module.exports,window,document,f.fetcher,f.store);
 const guard:{current:(()=>boolean)|null}={current:null};
 function render(){for(let index=0;index<12;index++){cursor=0;changed=false;tree=module.exports.PersonalFinanceWorkbench({navigationGuard:guard});for(const effect of effects.values())if(effect.pending){effect.pending=false;effect.cleanup?.();effect.cleanup=effect.run()||undefined;}if(!changed)return tree;}throw Error('finance render loop');}
 return{render,guard,button(label:string){const button=find(render(),node=>node.type==='button'&&text(node)===label);assert.ok(button,'missing button '+label);return button;},input(label:string){const tree=render(),form=find(tree,node=>node.type==='form'),node=find(form??tree,node=>node.type==='label'&&Array.isArray(node.props.children)&&node.props.children[0]===label);assert.ok(node,'missing label '+label);const input=find(node,child=>['input','select','textarea'].includes(String(child.type)));assert.ok(input);return input;},row(){const column=tableOptions.columns.find((column:any)=>column.id==='notes');return column.cell({row:{original:tableOptions.data[0]}}) as Node;},hide(){document.visibilityState='hidden';for(const fn of listeners.get('visibilitychange')??[])fn();return render();},show(){document.visibilityState='visible';for(const fn of listeners.get('visibilitychange')??[])fn();return render();},dispose(){for(const effect of effects.values())effect.cleanup?.();}};
}
async function start(h:ReturnType<typeof harness>){h.render();await settle();return h.render();}
async function enter(h:ReturnType<typeof harness>,amount='29.01'){h.button('记一笔').props.onClick();h.input('金额（元 · CNY）').props.onChange({target:{value:amount}});h.input('摘要 / 备注').props.onChange({target:{value:'Private finance fixture'}});h.render();}
test('finance empty state records exact cents and reopens the separately read record/history through its real component',async()=>{
 const f=fixture(),h=harness(f);try{assert.match(text(await start(h)),/还没有个人流水/);await enter(h);assert.equal(h.guard.current?.(),false);find(h.render(),node=>node.type==='form')!.props.onSubmit({preventDefault(){}});await settle();const saved=h.render();assert.match(text(saved),/流水已保存并独立读回/);assert.equal(f.repo.rows.size,1);assert.equal(f.writes[0].body.fields.amountMinor,2901);
 h.row().props.onClick();await settle();assert.equal(h.input('金额（元 · CNY）').props.value,'29.01');assert.match(text(h.render()),/已读回全部版本/);assert.match(text(h.render()),/版本 1/);
 }finally{h.dispose();}
});
test('finance uncertain save keeps input locked and retries only the same key before refreshing the real list',async()=>{
 const f=fixture(),h=harness(f);try{await start(h);await enter(h);f.lose();find(h.render(),node=>node.type==='form')!.props.onSubmit({preventDefault(){}});await settle();assert.match(text(h.render()),/有一笔保存等待确认/);assert.equal(h.guard.current?.(),false);assert.equal(f.repo.rows.size,1);
 h.button('重试原请求').props.onClick();await settle();assert.equal(f.writes.length,2);assert.deepEqual(f.writes[1],f.writes[0]);assert.equal(f.repo.rows.size,1);assert.equal(f.values.size,0);assert.match(text(h.render()),/流水已保存并独立读回/);
 }finally{h.dispose();}
});
test('finance conceals dirty input while hidden and drops it after current owner changes',async()=>{
 const f=fixture(),h=harness(f);try{await start(h);await enter(h);assert.match(text(h.render()),/Private finance fixture/);assert.doesNotMatch(text(h.hide()),/Private finance fixture/);f.switchOwner();h.show();await settle();assert.doesNotMatch(text(h.render()),/Private finance fixture/);assert.match(text(h.render()),/还没有个人流水/);assert.equal(f.writes.length,0);
 }finally{h.dispose();}
});
test('finance stale CAS retains input and requires explicit read-and-recheck before writing the latest revision',async()=>{
 const f=fixture(),h=harness(f);try{await start(h);await enter(h);find(h.render(),node=>node.type==='form')!.props.onSubmit({preventDefault(){}});await settle();h.render();h.row().props.onClick();await settle();h.input('摘要 / 备注').props.onChange({target:{value:'Local finance edit'}});h.render();await f.remoteEdit();find(h.render(),node=>node.type==='form')!.props.onSubmit({preventDefault(){}});await settle();assert.equal(f.writes.at(-1)!.body.expectedRevision,1);assert.match(text(h.render()),/Local finance edit/);
 h.button('读取最新版本，保留输入').props.onClick();await settle();assert.equal(h.input('摘要 / 备注').props.value,'Local finance edit');find(h.render(),node=>node.type==='form')!.props.onSubmit({preventDefault(){}});await settle();assert.equal(f.writes.at(-1)!.body.expectedRevision,2);assert.equal([...f.repo.rows.values()][0].revision,3);
 }finally{h.dispose();}
});
test('finance hidden detail read cannot leave the freshly verified view permanently busy',async()=>{
 const f=fixture(),h=harness(f);try{await start(h);await enter(h);find(h.render(),node=>node.type==='form')!.props.onSubmit({preventDefault(){}});await settle();h.render();f.holdDetail();h.row().props.onClick();await settle();h.hide();h.show();await settle();f.releaseDetail();await settle();assert.equal(h.button('记一笔').props.disabled,false);assert.equal(h.button('刷新').props.disabled,false);
 }finally{f.releaseDetail();h.dispose();}
});
async function rejectStaleRefund(f:ReturnType<typeof fixture>,h:ReturnType<typeof harness>){const original=await f.seed();await start(h);await enter(h);h.input('流水类型').props.onChange({target:{value:'refund'}});h.input('关联原支出').props.onChange({target:{value:original.entry.id}});await f.change(original.entry.id,{kind:'income'});find(h.render(),node=>node.type==='form')!.props.onSubmit({preventDefault(){}});await settle();return original.entry.id;}
test('a definite refund-source rejection resumes editable preserved input and a corrected save gets a new key',async()=>{
 const f=fixture(),h=harness(f);try{await rejectStaleRefund(f,h);assert.equal(f.repo.rows.size,1);assert.match(text(h.render()),/退款需要关联同币种支出/);h.button('继续编辑').props.onClick();await settle();assert.equal(find(h.render(),node=>node.type==='fieldset')!.props.disabled,false);assert.equal(h.input('摘要 / 备注').props.value,'Private finance fixture');assert.equal(h.input('金额（元 · CNY）').props.value,'29.01');assert.equal(f.values.size,0);
 h.input('流水类型').props.onChange({target:{value:'expense'}});find(h.render(),node=>node.type==='form')!.props.onSubmit({preventDefault(){}});await settle();assert.equal(f.repo.rows.size,2);assert.equal(f.writes.length,2);assert.notEqual(f.writes[0].key,f.writes[1].key);assert.match(text(h.render()),/流水已保存并独立读回/);
 }finally{h.dispose();}
});
test('a definite rejected create can be abandoned after recovery without disabling the workspace',async()=>{
 const f=fixture(),first=harness(f);let h=first;try{await rejectStaleRefund(f,h);h.dispose();h=harness(f);await start(h);h.button('放弃本次保存').props.onClick();await settle();assert.equal(find(h.render(),node=>node.type==='form'),undefined);assert.equal(h.button('刷新').props.disabled,false);assert.equal(h.button('记一笔').props.disabled,false);assert.equal(f.values.size,0);assert.equal(f.repo.rows.size,1);assert.equal(f.writes.length,1);
 }finally{h.dispose();}
});
test('a definite linked-refund rejection permits explicit latest-version editing while keeping the rejected inputs',async()=>{
 const f=fixture(),h=harness(f);try{const original=await f.seed();await start(h);h.row().props.onClick();await settle();h.input('流水类型').props.onChange({target:{value:'income'}});h.input('摘要 / 备注').props.onChange({target:{value:'Preserve rejected edit'}});await f.seed({kind:'refund',originalEntryId:original.entry.id});find(h.render(),node=>node.type==='form')!.props.onSubmit({preventDefault(){}});await settle();assert.match(text(h.render()),/已有退款关联此支出/);h.button('读取最新版本，保留输入').props.onClick();await settle();assert.equal(h.input('流水类型').props.value,'income');assert.equal(h.input('摘要 / 备注').props.value,'Preserve rejected edit');assert.equal(find(h.render(),node=>node.type==='fieldset')!.props.disabled,false);
 h.input('流水类型').props.onChange({target:{value:'expense'}});find(h.render(),node=>node.type==='form')!.props.onSubmit({preventDefault(){}});await settle();assert.equal(f.repo.rows.get(original.entry.id)!.revision,2);assert.notEqual(f.writes[0].key,f.writes[1].key);
 }finally{h.dispose();}
});
test('failed GET readback followed by a definite 4xx never exposes edit or discard or replaces the original command',async()=>{
 const f=fixture();let h=harness(f);try{await start(h);await enter(h);f.failReadback();find(h.render(),node=>node.type==='form')!.props.onSubmit({preventDefault(){}});await settle();assert.equal(f.repo.rows.size,1);const retained=[...f.values.values()][0];h.dispose();h=harness(f);await start(h);f.reject(400,'INVALID_REFUND_SOURCE');h.button('重试原请求').props.onClick();await settle();assert.equal(find(h.render(),node=>node.type==='button'&&text(node)==='继续编辑'),undefined);assert.equal(find(h.render(),node=>node.type==='button'&&text(node)==='放弃本次保存'),undefined);assert.equal(find(h.render(),node=>node.type==='fieldset')!.props.disabled,true);assert.deepEqual(f.writes[1],f.writes[0]);assert.equal([...f.values.values()][0],retained);assert.equal(h.button('记一笔').props.disabled,true);
 }finally{h.dispose();}
});
