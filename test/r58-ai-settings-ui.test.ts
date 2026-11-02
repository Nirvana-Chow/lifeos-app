import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import ts from'typescript';
import * as clientModule from'../src/workbench/ai-settings-client.ts';import * as contracts from'../src/platform/ai-settings-contract.ts';
type Node={type:unknown;props:Record<string,any>};
const owner='synthetic-settings-ui-owner';
const initial:contracts.PublicAISettings={storage:'ready',revision:3,config:{provider:'volcengine-ark',baseURL:'https://ark.cn-beijing.volces.com/api/v3',model:'synthetic-private-model',dataScope:'current-message-only',monthlyBudgetMinor:2500},secretState:'stored',secretMask:'••••••••',enabled:false,realModelActive:false,mode:'synthetic-sdk-test',testState:'passed',testedAt:'2026-10-23T10:00:00.000Z',capabilities:{configurationWritable:true,secretWritable:true,connectionTestAvailable:true,activationAvailable:true},notice:'Synthetic state'};
function text(node:any):string{if(node==null||typeof node==='boolean')return'';if(Array.isArray(node))return node.map(text).join(' ');return typeof node==='object'?text(node.props?.children):String(node);}
function find(node:any,predicate:(node:Node)=>boolean):Node|undefined{if(!node||typeof node!=='object')return;if(Array.isArray(node)){for(const child of node){const found=find(child,predicate);if(found)return found;}return;}return predicate(node)?node:find(node.props?.children,predicate);}
const flush=async()=>{for(let n=0;n<10;n++)await new Promise<void>(resolve=>setImmediate(resolve));};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
function fixture(){let account:string|null=owner,view=structuredClone(initial);const calls:{path:string;method:string;body:unknown}[]=[];
 const transport:typeof fetch=async(input,init)=>{const path=String(input),method=init?.method??'GET';calls.push({path,method,body:init?.body});if(path.endsWith('/get-session'))return Response.json(account?{user:{id:account},session:{userId:account}}:null);if(method!=='GET')view={...view,revision:view.revision+1};return Response.json(view);};
 return{transport,calls,setAccount(value:string|null){account=value;},setView(value:contracts.PublicAISettings){view=value;}};
}
/** Real TSX and client, deterministic hook/event stubs; no browser or network. */
function harness(transport:typeof fetch){let cursor=0;const values:any[]=[],effects=new Map<number,{run:()=>void|(()=>void);deps:any[];cleanup?:()=>void;pending:boolean}>();
 const react={useRef(value:any){const index=cursor++;return values[index]??(values[index]={current:value});},useState(initial:any){const index=cursor++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return[values[index],(next:any)=>{values[index]=typeof next==='function'?next(values[index]):next;}];},useEffect(run:()=>void|(()=>void),deps:any[]){const index=cursor++,old=effects.get(index);if(!old||deps.some((value,at)=>value!==old.deps[at]))effects.set(index,{run,deps,cleanup:old?.cleanup,pending:true});}};
 const jsx={jsx:(type:unknown,props:Record<string,any>)=>({type,props}),jsxs:(type:unknown,props:Record<string,any>)=>({type,props}),Fragment:'fragment'},module={exports:{}as{AISettings:()=>Node}};
 const imports:Record<string,unknown>={'./draft-workspace':{DraftEditor:'public-local-config-draft'},react,'react/jsx-runtime':jsx,'next/link':{default:'a'},'../../components/ui/card':{Card:'card',CardHeader:'header',CardTitle:'title',CardContent:'content'},'../platform/ai-settings-contract':contracts,'./ai-settings-client':clientModule,'./styles.module.css':{default:{}}};
 const listeners=new Map<string,Set<()=>void>>(),events={addEventListener:(name:string,fn:()=>void)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(fn);},removeEventListener:(name:string,fn:()=>void)=>listeners.get(name)?.delete(fn)},window={...events},document={...events,visibilityState:'visible'};
 const code=ts.transpileModule(readFileSync(new URL('../src/workbench/ai-settings.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports','fetch','window','document','confirm',code)((path:string)=>{if(!(path in imports))throw Error('Unexpected import '+path);return imports[path];},module,module.exports,transport,window,document,()=>true);
 return{document,render(){cursor=0;const tree=module.exports.AISettings();for(const effect of effects.values())if(effect.pending){effect.cleanup?.();effect.cleanup=effect.run()||undefined;effect.pending=false;}return tree;},fire(name:string){for(const fn of listeners.get(name)??[])fn();},strictReplay(){for(const effect of effects.values())effect.cleanup?.();for(const effect of effects.values())effect.cleanup=effect.run()||undefined;},dispose(){for(const effect of effects.values())effect.cleanup?.();}};
}
type Harness=ReturnType<typeof harness>;
const field=(h:Harness,name:string)=>find(h.render(),node=>node.props['aria-label']===name);
const button=(h:Harness,name:string)=>find(h.render(),node=>node.type==='button'&&text(node).includes(name));
async function ready(h:Harness){h.render();await flush();assert.equal(field(h,'模型 ID')?.props.value,'synthetic-private-model');}

test('AI settings hides configuration and clears unsent secret on blur, then verifies the original owner',async()=>{
 const f=fixture(),h=harness(f.transport);await ready(h);field(h,'API Key')!.props.onChange({target:{value:'synthetic-unsent-not-real-key'}});h.fire('blur');assert.equal(field(h,'模型 ID'),undefined);assert.equal(field(h,'API Key'),undefined);
 f.setAccount('synthetic-other-owner');h.fire('focus');await flush();assert.equal(field(h,'模型 ID'),undefined);assert.match(text(h.render()),/原账号|账号.*变化/);
 f.setAccount(owner);button(h,'重新读取')!.props.onClick();await flush();assert.equal(field(h,'API Key')!.props.value,'');assert.equal(field(h,'模型 ID')!.props.value,'synthetic-private-model');assert.equal(f.calls.filter(c=>c.method!=='GET').length,0);h.dispose();
});

test('a hidden pending settings read cannot republish private fields on late success',async()=>{
 const f=fixture(),pending=deferred<Response>();let hold=true;const h=harness(async(input,init)=>String(input).endsWith('/settings')&&hold?pending.promise:f.transport(input,init));h.render();await flush();h.document.visibilityState='hidden';h.fire('visibilitychange');hold=false;pending.resolve(Response.json(initial));await flush();assert.equal(field(h,'模型 ID'),undefined);
 f.setAccount(null);h.document.visibilityState='visible';h.fire('focus');await flush();assert.equal(field(h,'模型 ID'),undefined);assert.match(text(h.render()),/登录/);h.dispose();
});

test('blur during secret identity preflight prevents dispatch and a captured old save handler cannot resend',async()=>{
 const f=fixture(),preflight=deferred<Response>();let hold=false;const h=harness(async(input,init)=>hold&&String(input).endsWith('/get-session')?preflight.promise:f.transport(input,init));await ready(h);field(h,'API Key')!.props.onChange({target:{value:'synthetic-unsent-not-real-key'}});const save=button(h,'保存密钥')!.props.onClick;hold=true;save();await flush();h.fire('blur');preflight.resolve(Response.json({user:{id:owner},session:{userId:owner}}));await flush();assert.equal(f.calls.filter(c=>c.method==='PUT').length,0);save();await flush();assert.equal(f.calls.filter(c=>c.method==='PUT').length,0);
 hold=false;h.fire('focus');await flush();assert.equal(field(h,'API Key')!.props.value,'');h.dispose();
});

test('lost mutation receipt remains unresolved across concealment until revision readback, without automatic retries',async()=>{
 const f=fixture();let writes=0;const h=harness(async(input,init)=>{if(init?.method==='POST'){writes++;throw Error('synthetic lost receipt');}return f.transport(input,init);});await ready(h);
 find(h.render(),node=>node.type==='input'&&node.props.type==='checkbox')!.props.onChange({target:{checked:true}});button(h,'测试连接')!.props.onClick();await flush();assert.equal(writes,1);assert.match(text(h.render()),/未确认|重新读取/);assert.equal(button(h,'测试连接')!.props.disabled,true);assert.equal(find(h.render(),node=>node.type==='fieldset')!.props.disabled,true);
 h.fire('blur');h.fire('focus');await flush();assert.equal(button(h,'测试连接')!.props.disabled,true);assert.match(text(h.render()),/未确认|重新读取/);assert.equal(writes,1);
 f.setView({...initial,revision:4});button(h,'重新读取')!.props.onClick();await flush();assert.equal(writes,1);assert.equal(find(h.render(),node=>node.type==='fieldset')!.props.disabled,false);h.dispose();
});

test('StrictMode replay restores valid reads; unmount and a late identity failure cannot reveal stale state',async()=>{
 const f=fixture(),pending=deferred<Response>();let holds=0;const h=harness(async(input,init)=>String(input).endsWith('/settings')&&holds++===0?pending.promise:f.transport(input,init));h.render();h.strictReplay();await flush();assert.equal(field(h,'模型 ID')?.props.value,'synthetic-private-model');pending.resolve(Response.json({error:{code:'LOGIN_REQUIRED',message:'synthetic-private-error'}},{status:401}));await flush();assert.equal(field(h,'模型 ID'),undefined);assert.doesNotMatch(text(h.render()),/synthetic-private-error/);h.dispose();
 const late=deferred<Response>(),other=harness(async(input,init)=>String(input).endsWith('/settings')?late.promise:f.transport(input,init));other.render();await flush();other.dispose();late.resolve(Response.json(initial));await flush();assert.equal(field(other,'模型 ID'),undefined);
});

test('HTTP 408 after a paid test keeps mutation controls locked until a newer revision is read',async()=>{
 const f=fixture();let posts=0;const h=harness(async(input,init)=>{if(init?.method==='POST'){posts++;return Response.json({error:{code:'REQUEST_TIMEOUT',message:'synthetic-private-timeout'}},{status:408});}return f.transport(input,init);});await ready(h);
 find(h.render(),node=>node.type==='input'&&node.props.type==='checkbox')!.props.onChange({target:{checked:true}});button(h,'测试连接')!.props.onClick();await flush();assert.equal(posts,1);assert.equal(find(h.render(),node=>node.type==='fieldset')!.props.disabled,true);assert.doesNotMatch(text(h.render()),/synthetic-private-timeout/);
 button(h,'重新读取')!.props.onClick();await flush();assert.equal(find(h.render(),node=>node.type==='fieldset')!.props.disabled,true);assert.equal(posts,1);
 f.setView({...initial,revision:4});button(h,'重新读取')!.props.onClick();await flush();assert.equal(find(h.render(),node=>node.type==='fieldset')!.props.disabled,false);assert.equal(posts,1);h.dispose();
});
