import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {readFileSync} from 'node:fs';
import {checkOwnerPageAccess} from '../src/session-duration/client.ts';
test('background and BFCache conceal without unmounting the editor; only fresh owner read reveals it',async()=>{
 let phase='active',setup:(()=>void)|undefined,replace='',respond!:(r:Response)=>void;const listeners:Record<string,()=>void>={};
 const document={visibilityState:'visible',documentElement:{style:{visibility:''}},addEventListener:(k:string,v:()=>void)=>listeners[k]=v,removeEventListener:()=>{}};
 const window={addEventListener:(k:string,v:()=>void)=>listeners[k]=v,removeEventListener:()=>{},location:{replace:(p:string)=>replace=p}};
 const retry={current:null};
 let managedScope:boolean|null=null;
 const react={useState:()=>[phase,(v:string)=>{phase=v;}],useEffect:(fn:()=>void)=>{setup=fn;},useRef:()=>retry,createContext:()=>({Provider:'provider'}),useContext:()=>managedScope};
 const jsx={jsx:(type:unknown,props:any)=>({type,props}),jsxs:(type:unknown,props:any)=>({type,props})},module={exports:{} as any};
 const code=ts.transpileModule(readFileSync('src/personal-candidate/privacy.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','module','exports','document','window','fetch',code)((p:string)=>p==='react'?react:p==='../session-duration/client'?{checkOwnerPageAccess}:jsx,module,module.exports,document,window,()=>new Promise<Response>(resolve=>{respond=resolve;}));
 const editor={stable:'unsent-editor'};
 for(const checked of [false,true]){
  managedScope=checked;
  assert.equal(module.exports.PrivacyBoundary({children:editor}),editor,'the containing guard owns verification');
 }
 managedScope=null;
 const render=()=>{const wrapper=module.exports.PrivacyBoundary({children:editor});return wrapper.type(wrapper.props);};
 render();setup!();document.visibilityState='hidden';listeners.visibilitychange();
 const hidden=render();assert.ok(Array.isArray(hidden.props.children),'private editor must remain mounted while concealed');assert.equal(hidden.props.children[0].props.children.props.children,editor);assert.equal(hidden.props.children[0].props.children.props.value,false);assert.equal(hidden.props.children[0].props.hidden,true);assert.equal(document.documentElement.style.visibility,'hidden');
 document.visibilityState='visible';listeners.visibilitychange();assert.equal(phase,'checking');
 respond(new Response(null,{status:503}));await new Promise(r=>setImmediate(r));
 assert.equal(phase,'unavailable');assert.equal(replace,'');
 const unavailable=render();
 assert.equal(unavailable.props.children[0].props.children.props.children,editor);
 assert.equal(unavailable.props.children[0].props.inert,true);
 assert.equal(unavailable.props.children[1].props.style.visibility,'visible');
 unavailable.props.children[1].props.children[1].props.onClick();
 respond(Response.json({ok:true}));await new Promise(r=>setImmediate(r));assert.equal(phase,'active');assert.equal(document.documentElement.style.visibility,'');
 listeners.pagehide();listeners.pageshow();respond(new Response(null,{status:401}));await new Promise(r=>setImmediate(r));assert.equal(phase,'checking');assert.equal(replace,'/login');
});
