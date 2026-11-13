// Additive same-output check: importing unconfigured OAuth routes must never activate identity.
import assert from 'node:assert/strict';import {createRequire}from'node:module';import{readFileSync}from'node:fs';import{resolve}from'node:path';
import{candidateBuildDirectory}from'../src/platform/build-directory.ts';
if(process.env.LIFEOS_PLATFORM_CANDIDATE!=='0'||process.env.LIFEOS_BUSINESS_MCP_OAUTH)throw Error('DEFAULT_CLOSED_OAUTH_CHECK_REQUIRED');
const directory=candidateBuildDirectory(),require=createRequire(import.meta.url),checks=[];
for(const[artifact,method,path]of[
 ['app/.well-known/oauth-protected-resource/[[...resource]]/route.js','GET','/.well-known/oauth-protected-resource/api/platform/mcp'],
 ['app/.well-known/oauth-authorization-server/[[...issuer]]/route.js','GET','/.well-known/oauth-authorization-server/api/platform/auth'],
 ['app/api/platform/auth/[...all]/route.js','GET','/api/platform/auth/jwks'],
 ['app/api/platform/auth/[...all]/route.js','GET','/api/platform/auth/oauth2/authorize'],
 ['app/api/platform/auth/[...all]/route.js','POST','/api/platform/auth/oauth2/token'],
 ['app/api/platform/auth/[...all]/route.js','POST','/api/platform/auth/oauth2/consent'],
 ['app/api/platform/auth/[...all]/route.js','POST','/api/platform/auth/oauth2/continue'],
 ['app/api/platform/auth/[...all]/route.js','POST','/api/platform/auth/oauth2/revoke'],
]){
 const{routeModule}=require(resolve(process.cwd(),directory,'server',artifact));assert.equal(typeof routeModule?.userland?.[method],'function');
 const response=await routeModule.userland[method](new Request('https://lifeos.nirvanachow.com'+path,{method,headers:{host:'lifeos.nirvanachow.com',...(method==='POST'?{'content-type':'application/x-www-form-urlencoded'}:{})},...(method==='POST'?{body:'grant_type=authorization_code'}:{})}));
 assert.equal(response.status,404);assert.equal(response.headers.get('set-cookie'),null);checks.push({method,path,status:response.status});
}
console.log(JSON.stringify({passed:true,buildId:readFileSync(resolve(directory,'BUILD_ID'),'utf8').trim(),checks,scope:'same compiled Next handlers, default closed; no listener/browser/database or deployed OAuth claim'},null,2));
