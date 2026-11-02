import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {readFileSync} from 'node:fs';
test('background and BFCache conceal without unmounting the editor; only fresh owner read reveals it',async()=>{
 let visible=true,setup:(()=>void)|undefined,replace='',respond!:(r:Response)=>void;const listeners:Record<string,()=>void>={};
 const document={visibilityState:'visible',documentElement:{style:{visibility:''}},addEventListener:(k:string,v:()=>void)=>listeners[k]=v,removeEventListener:()=>{}};
 const window={addEventListener:(k:string,v:()=>void)=>listeners[k]=v,removeEventListener:()=>{},location:{replace:(p:string)=>replace=p}};
 const react={useState:()=>[visible,(v:boolean)=>{visible=v;}],useEffect:(fn:()=>void)=>{setup=fn;}};
 const jsx={jsx:(type:unknown,props:any)=>({type,props}),jsxs:(type:unknown,props:any)=>({type,props})},module={exports:{} as any};
 const code=ts.transpileModule(readFileSync('src/personal-candidate/privacy.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','module','exports','document','window','fetch',code)((p:string)=>p==='react'?react:jsx,module,module.exports,document,window,()=>new Promise<Response>(resolve=>{respond=resolve;}));
 const editor={stable:'unsent-editor'};module.exports.PrivacyBoundary({children:editor});setup!();document.visibilityState='hidden';listeners.visibilitychange();
 const hidden=module.exports.PrivacyBoundary({children:editor});assert.ok(Array.isArray(hidden.props.children),'private editor must remain mounted while concealed');assert.equal(hidden.props.children[0].props.children,editor);assert.equal(hidden.props.children[0].props.hidden,true);assert.equal(document.documentElement.style.visibility,'hidden');
 document.visibilityState='visible';listeners.visibilitychange();assert.equal(visible,false);respond(Response.json({ok:true}));await new Promise(r=>setImmediate(r));assert.equal(visible,true);assert.equal(document.documentElement.style.visibility,'');
 listeners.pagehide();listeners.pageshow();respond(new Response(null,{status:401}));await new Promise(r=>setImmediate(r));assert.equal(visible,false);assert.equal(replace,'/login');
});
