import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

type Runtime={readPlatformPagePrincipal?:()=>Promise<unknown>;readPlatformPasswordCapability?:()=>Promise<boolean>;readPlatformMfaState?:()=>Promise<unknown>};
function page(path:string,runtime:Runtime) {
 const module={exports:{} as {default:()=>Promise<any>}};
 const jsx={jsx:(type:unknown,props:unknown)=>({type,props})};
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','module','exports',code)((name:string)=>{
  if(name==='react/jsx-runtime')return jsx;
  if(name==='next/headers')return {headers:async()=>new Headers()};
  if(name==='next/navigation')return {redirect:(url:string)=>{throw Error('redirect '+url);}};
  if(name.endsWith('/platform/runtime'))return runtime;
  if(name.endsWith('/personal-page'))return {PersonalPage:'personal-shell'};
  if(name.endsWith('/password-page'))return {PasswordPage:'password-form'};
  if(name.endsWith('/account-api-keys'))return {AccountApiKeys:'key-form'};
  throw Error('Unexpected route dependency '+name);
 },module,module.exports);
 return module.exports.default;
}

test('legacy password entrance redirects into settings only after the server owner check',async()=>{
 let capabilities=0;
 for(const identity of [null,new Error('synthetic identity unavailable'),{id:'synthetic-owner'}]){
  const render=page('app/account/password/page.tsx',{
   readPlatformPagePrincipal:async()=>{if(identity instanceof Error)throw identity;return identity;},
   readPlatformPasswordCapability:async()=>{capabilities++;return true;},
  });
  if(!identity||identity instanceof Error)await assert.rejects(render(),{message:'redirect /login'});
  else await assert.rejects(render(),{message:'redirect /personal?modal=settings&panel=security'});
 }
 assert.equal(capabilities,0,'legacy redirect must not initialize password content');
});

test('API key account shell preserves anonymous and incomplete MFA redirects',async()=>{
 for(const [kind,destination] of [['anonymous','/login'],['setup','/account/mfa'],['challenge','/account/mfa'],['ready','/personal?modal=settings&panel=api-keys']] as const){
  const render=page('app/account/api-keys/page.tsx',{readPlatformMfaState:async()=>({kind})});
  if(destination)await assert.rejects(render(),{message:'redirect '+destination});

 }
});
