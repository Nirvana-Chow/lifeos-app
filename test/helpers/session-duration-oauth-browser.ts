// Synthetic, loopback-only browser fixture. All native passwords/codes remain in this test process.
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export async function prepareSessionOAuthBrowser(source:string,deps:string){
 const root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-oauth-stepup-'));
 try{
  for(const path of ['app/login','app/account/password','app/personal/oauth/continue','app/api/platform/auth/[...all]','app/fixture/control','fixture','test/helpers'])await mkdir(join(root,path),{recursive:true});
  await cp(join(source,'src'),join(root,'src'),{recursive:true});
  await cp(join(source,'proxy.ts'),join(root,'proxy.ts'));
  for(const path of ['app/login/page.tsx','app/account/password/page.tsx','app/personal/oauth/page.tsx','app/personal/oauth/continue/page.tsx','test/helpers/session-duration.ts','test/helpers/owner-mfa-fixture.ts'])await cp(join(source,path),join(root,path));
  await symlink(deps,join(root,'node_modules'));
  await writeFile(join(root,'package.json'),JSON.stringify({private:true,type:'module'}));
  await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
  await writeFile(join(root,'app/layout.tsx'),`import type{ReactNode}from'react';export default function Layout({children}:{children:ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}`);
  await writeFile(join(root,'app/personal/page.tsx'),`export default function Page(){return <main><h1>Synthetic authenticated home</h1></main>;}`);
  await writeFile(join(root,'fixture/session.ts'),`
import {sessionDurationFixture} from '../test/helpers/session-duration.ts';
import {enrollSyntheticOwnerMfa,mergeSyntheticAuthCookies,syntheticOwnerTotp} from '../test/helpers/owner-mfa-fixture.ts';
import {readVerifiedOwnerSession,readOwnerMfaState} from '../src/platform/auth.ts';
import {assertLocalRequest} from '../src/platform/request-boundary.ts';
import {createBusinessOAuthHttp} from '../src/business-mcp-oauth/http.ts';
import {verifyOAuthQueryParams} from '@better-auth/oauth-provider';
const key=Symbol.for('lifeos.synthetic.oauth-stepup.fixture');
export const origin='http://127.0.0.1:32142';
export const oauthConfig={resource:'https://lifeos.nirvanachow.com/api/platform/mcp',issuer:'https://lifeos.nirvanachow.com/api/platform/auth',grantId:'synthetic-stepup-grant',scopes:['todo:read']};
export function fixture(){const store=globalThis as any;return store[key]??= (async()=>{
 const f=await sessionDurationFixture(true),initial=await f.login({mode:'rolling'});
 await enrollSyntheticOwnerMfa(f.auth,f.config.ownerId,f.password,(p,b,c)=>f.send(p,b,c),mergeSyntheticAuthCookies(initial));
 return {...f,requests:[] as {path:string;query:string}[],authRequests:[] as {path:string;status:number}[],providerCalls:0,unconfirmed:false};
})();}
export async function authHandler(request:Request){
 const f=await fixture(),path=new URL(request.url).pathname;
 if(path.startsWith('/api/platform/auth/oauth2/')){
  const input=await request.clone().json().catch(()=>null);f.requests.push({path,query:input?.oauth_query??''});
  return createBusinessOAuthHttp({origin,config:oauthConfig,assertReady:async()=>{},owner:headers=>readVerifiedOwnerSession(f.auth,f.config,headers),
   verifyQuery:value=>verifyOAuthQueryParams(value,f.config.secret),verifyToken:async()=>null,
   handler:async()=>{f.providerCalls++;return f.unconfirmed?Response.json({error:'SYNTHETIC_UNCONFIRMED'},{status:503}):Response.json({redirect:true,url:'https://client.example/callback?iss='+encodeURIComponent(oauthConfig.issuer)+'&code=synthetic-only'});},
   ledger:{register:async()=>null,approve:async()=>{},revoke:async()=>{}}})(request);
 }
 const {authRequest}=await import('../src/platform/auth.ts');
 const context=await f.auth.$context;
 const response=await authRequest(request,f.config,r=>f.auth.handler(r),{requireMfa:true,sessionDuration:true,
  readMfaState:headers=>readOwnerMfaState(f.auth,f.config,headers),withOwnerLock:async run=>run(),
  trustedDeviceCookieNames:[context.createAuthCookie('trust_device').name],sessionCookieNames:[context.authCookies.sessionToken.name],twoFactorCookieNames:[context.createAuthCookie('two_factor').name]});
 f.authRequests.push({path,status:response.status});return response;
}
export async function control(request:Request){
 try{assertLocalRequest(request,origin);}catch{return new Response(null,{status:403});}
 const input=request.method==='POST'?await request.json():{};
 // Each browser scenario gets a new synthetic database/native Auth instance;
 // production rate limits stay enabled and unchanged rather than being bypassed.
 if(input.action==='fresh')delete (globalThis as any)[key];
 const f=await fixture();
 if(request.method==='POST'){
  const {action}=input;
  if(action==='age')for(const session of f.db.platform_session){session.createdAt=new Date(Date.now()-1801*1000);session.expiresAt=new Date((session.createdAt as Date).valueOf()+Number(session.sessionDurationSeconds)*1000);}
  else if(action==='reset') {f.requests=[];f.providerCalls=0;f.unconfirmed=false;}
  else if(action==='unconfirmed')f.unconfirmed=true;
  else if(action!=='fresh')return new Response(null,{status:400});
 }
 return Response.json({code:await syntheticOwnerTotp(f.auth,f.config.ownerId),requests:f.requests,authRequests:f.authRequests,providerCalls:f.providerCalls,staleValidSessions:f.db.platform_session.filter(session=>new Date(session.createdAt as string).valueOf()<Date.now()-1800*1000&&new Date(session.expiresAt as string).valueOf()>Date.now()).length},{headers:{'cache-control':'no-store'}});
}
`);
  await writeFile(join(root,'src/platform/runtime.ts'),`
import {fixture,oauthConfig} from '../../fixture/session';import {readOwnerPrincipal} from './auth';
export const getPlatformBusinessOAuthContext=async()=>{const f=await fixture();return{config:oauthConfig,platform:f.config,readAuth:f.auth};};
export const readPlatformLoginCapability=async()=>({mode:'personal',enabled:true,sessionDuration:true});
export const readPlatformPasswordCapability=async()=>true;
export const readPlatformPagePrincipal=async(headers:Headers)=>{const f=await fixture();return readOwnerPrincipal(f.auth,f.config,headers);};
`);
  await writeFile(join(root,'app/api/platform/auth/[...all]/route.ts'),`import{authHandler}from'../../../../../fixture/session';export const runtime='nodejs';export const GET=authHandler;export const POST=authHandler;`);
  await writeFile(join(root,'app/fixture/control/route.ts'),`import{control}from'../../../fixture/session';export const runtime='nodejs';export const GET=control;export const POST=control;`);
  return root;
 }catch(error){const {rm}=await import('node:fs/promises');await rm(root,{recursive:true,force:true});throw error;}
}
