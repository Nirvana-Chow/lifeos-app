import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {makeSignature} from 'better-auth/crypto';
import {verifyOAuthQueryParams} from '@better-auth/oauth-provider';
import {oauthQueryFromSearch} from '../src/business-mcp-oauth/query.ts';

test('the actual login page preserves the signed OAuth query alongside the exact reauthentication transport flag',async()=>{
 const secret='synthetic-login-page-signature-only-000000000000';
 const config={resource:'https://lifeos.nirvanachow.com/api/platform/mcp',issuer:'https://lifeos.nirvanachow.com/api/platform/auth',grantId:'synthetic-grant',scopes:['todo:read']};
 const params=new URLSearchParams({client_id:'https://client.example/meta',redirect_uri:'https://client.example/callback',resource:config.resource,scope:'todo:read',code_challenge_method:'S256',code_challenge:'x'.repeat(43),state:'original + raw & state',exp:String(Math.floor(Date.now()/1000)+300)});
 const canonical=new URLSearchParams([...params].sort(([a],[b])=>a<b?-1:a>b?1:0));
 params.set('sig',await makeSignature(canonical.toString(),secret));const query=params.toString();
 assert.equal(await verifyOAuthQueryParams(query,secret),true);
 const context={config,platform:{secret},readAuth:{options:{plugins:[{id:'two-factor'}]},api:{getSession:async()=>null}}};
 const native=createRequire(import.meta.url),cache=new Map<string,Record<string,any>>();
 // Execute the actual route, page-state and official verifier. Only Next's
 // request store and the database-backed platform port are controlled here.
 function load(file:string):Record<string,any>{
  const hit=cache.get(file);if(hit)return hit;const module={exports:{} as Record<string,any>};cache.set(file,module.exports);
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',code)((key:string)=>{
   if(key==='next/headers')return{headers:async()=>new Headers()};
   if(key==='next/navigation')return{redirect:(location:string)=>{throw Error('Unexpected redirect '+location);}};
   if(key.endsWith('.css'))return{__esModule:true,default:{}};
   if(!key.startsWith('.'))return native(key);
   const base=resolve(dirname(file),key),found=[base,base+'.tsx',base+'.ts'].find(existsSync);assert.ok(found,key);
   if(found===resolve('src/platform/runtime.ts'))return{getPlatformBusinessOAuthContext:async()=>context,readPlatformLoginCapability:async()=>({mode:'personal',enabled:true,sessionDuration:true}),readPlatformPagePrincipal:async()=>null};
   return load(found);
  },module,module.exports);return module.exports;
 }
 const page=load(resolve('app/login/page.tsx')).default;
 const result=await page({searchParams:Promise.resolve({reauthenticate:'1',oauth_query:query})});
 assert.equal(result.props.oauthQuery,query);
 for(const search of [{reauthenticate:'0',oauth_query:query},{reauthenticate:['1','1'],oauth_query:query},{reauthenticate:'1',oauth_query:query,extra:'unreviewed'}]){
  assert.notEqual(oauthQueryFromSearch(search),query,'unrecognized outer parameters must not be silently dropped');
 }
});
