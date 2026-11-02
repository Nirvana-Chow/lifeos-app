import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {pageAccess} from '../src/platform/page-access.ts';
import nextTesting from 'next/experimental/testing/server.js';
const {unstable_doesMiddlewareMatch}=nextTesting;

function load(){
 let accessCalls=0,principalCalls=0;
 class MockNextResponse extends Response{
  static next(){return new MockNextResponse(null,{status:200});}
  static redirect(url:URL){return new MockNextResponse(null,{status:307,headers:{location:url.toString()}});}
  static json(value:unknown,init:ResponseInit){return new MockNextResponse(JSON.stringify(value),init);}
 }
 const imports:Record<string,unknown>={'next/server':{NextResponse:MockNextResponse},'./src/platform/page-access':{pageAccess:async(path:string,read:()=>Promise<null>)=>{accessCalls++;return pageAccess(path,read);}},'./src/platform/runtime':{readPlatformPagePrincipal:async()=>{principalCalls++;return null;}}};
 const m={exports:{} as {proxy:(request:unknown)=>Promise<Response>;config:{matcher:string[]}}};
 const code=ts.transpileModule(readFileSync('proxy.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',code)((key:string)=>{assert.ok(key in imports);return imports[key];},m,m.exports);
 return {...m.exports,calls:()=>({accessCalls,principalCalls})};
}
function request(path:string,method:string){return {nextUrl:{pathname:path},method,url:'https://review.example.test'+path,headers:new Headers(),get body(){throw Error('must not read body');}};}

test('exact auth forms reject non-GET/HEAD without principal, body or reflected input',async()=>{
 const p=load();
 for(const path of ['/login','/account/password','/account/mfa'])for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS']){
  const r=await p.proxy(request(path,method));assert.equal(r.status,405);assert.equal(r.headers.get('allow'),'GET, HEAD');assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(await r.text(),'');
 }
 assert.deepEqual(p.calls(),{accessCalls:0,principalCalls:0});
});
test('GET and HEAD retain existing page flow; unrelated paths and API remain untouched',async()=>{
 const p=load();
 for(const path of ['/login','/account/password','/account/mfa'])for(const method of ['GET','HEAD']){const response=await p.proxy(request(path,method));assert.equal(response.status,200);assert.equal(response.headers.get('location'),null);}
 assert.deepEqual(p.calls(),{accessCalls:0,principalCalls:0});
 for(const path of ['/login/other','/account/password/other'])assert.equal((await p.proxy(request(path,'POST'))).status,307);
 assert.equal((await p.proxy(request('/api/session','POST'))).status,404);
 assert.deepEqual(p.calls(),{accessCalls:2,principalCalls:2});
});
test('matcher includes only the exact auth page paths and leaves native API alone',()=>{
 const {matcher}=load().config;
 assert.ok(matcher.includes('/login'));assert.ok(matcher.includes('/account/password'));
 for(const path of ['/login','/account/password','/account/mfa','/login/','/account/password/','/account/mfa/'])assert.equal(unstable_doesMiddlewareMatch({config:{matcher},nextConfig:{},url:path}),true);
 for(const path of ['/login/other','/account/password/other','/api/auth/sign-in/email'])assert.equal(unstable_doesMiddlewareMatch({config:{matcher},nextConfig:{},url:path}),false);
});
