import {assertLocalRequest,readJSONBody} from '../platform/request-boundary.ts';
import type {BusinessOAuthConfig} from './boundary.ts';
import type {BusinessAccessClaims,BusinessOAuthLedger} from './ledger.ts';
const privacy={'Cache-Control':'private, no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Authorization, Cookie'};
const error=(status:number,code:string)=>Response.json({error:code},{status,headers:privacy});
class OAuthRequestError extends Error{readonly status:number;constructor(status:number){super('INVALID_OAUTH_REQUEST');this.status=status;}}
export const oauthMetadataPaths=new Set(['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/api/platform/mcp','/.well-known/oauth-authorization-server/api/platform/auth']);
export function isBusinessOAuthRoute(path:string):boolean{return oauthMetadataPaths.has(path)||path.startsWith('/api/platform/auth/oauth2/')||path==='/api/platform/auth/jwks';}
type Options={origin:string;config:BusinessOAuthConfig;assertReady:()=>Promise<void>;owner:(headers:Headers)=>Promise<{sessionRef:string}|null>;handler:(request:Request)=>Promise<Response>;verifyToken:(token:string)=>Promise<BusinessAccessClaims|null>;verifyQuery?:(query:string)=>Promise<boolean>;ledger:Pick<BusinessOAuthLedger,'register'|'approve'|'revoke'>};
async function readForm(request:Request):Promise<URLSearchParams>{
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/x-www-form-urlencoded')throw new OAuthRequestError(415);
 const reader=request.body?.getReader();if(!reader)throw new OAuthRequestError(400);let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>16384){await reader.cancel();throw new OAuthRequestError(413);}chunks.push(part.value);}}finally{reader.releaseLock();}
 const form=new URLSearchParams(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
 for(const name of new Set(form.keys()))if(form.getAll(name).length!==1)throw new OAuthRequestError(400);
 return form;
}
/** Public protocol endpoints and owner consent deliberately have separate request boundaries. */
export function createBusinessOAuthHttp(options:Options){return async(request:Request):Promise<Response>=>{
 const url=new URL(request.url),path=url.pathname,protocol='/api/platform/auth/oauth2/';
 const metadata=oauthMetadataPaths.has(path),jwks=path==='/api/platform/auth/jwks',authorize=path===protocol+'authorize',token=path===protocol+'token',revoke=path===protocol+'revoke',consent=path===protocol+'consent',continuation=path===protocol+'continue';
 if(!metadata&&!jwks&&!authorize&&!token&&!revoke&&!consent&&!continuation)return error(404,'NOT_FOUND');
 if((metadata||jwks||authorize)?!['GET',...(metadata?['HEAD']:[])].includes(request.method):request.method!=='POST')return error(405,'METHOD_NOT_ALLOWED');
 try{assertLocalRequest(request,options.origin);}catch{return error(403,'ORIGIN_DENIED');}
 try{
  await options.assertReady();
  const headers=new Headers(request.headers);headers.delete('content-length');headers.set('x-platform-client','127.0.0.1');
  let forwarded=request,owner:{sessionRef:string}|null=null,input:Record<string,unknown>|undefined,form:URLSearchParams|undefined,revokeClaims:BusinessAccessClaims|null=null;
  if(consent||continuation){
   if(headers.get('origin')!==options.origin)return error(403,'ORIGIN_DENIED');
   owner=await options.owner(headers);if(!owner)return error(401,'OWNER_MFA_REQUIRED');
   const value=await readJSONBody(request);if(!value||typeof value!=='object'||Array.isArray(value))return error(400,'INVALID_REQUEST');input=value as Record<string,unknown>;
   const keys=consent?['accept','oauth_query']:['postLogin','oauth_query'];
   if(Object.keys(input).some(key=>!keys.includes(key))||typeof input.oauth_query!=='string'||input.oauth_query.length>8192||consent&&typeof input.accept!=='boolean'||continuation&&input.postLogin!==true)return error(400,'INVALID_REQUEST');
   if(!options.verifyQuery||!await options.verifyQuery(input.oauth_query))return error(400,'INVALID_OAUTH_QUERY');
   forwarded=new Request(request.url,{method:'POST',headers,body:JSON.stringify(input)});
  }else if(token||revoke){
   // A browser session never becomes OAuth client authentication.
   headers.delete('cookie');headers.delete('authorization');
   form=await readForm(request);
   if(token){
    if(!['authorization_code','refresh_token'].includes(form.get('grant_type')??'')||form.get('resource')!==options.config.resource)return error(400,'invalid_request');
    const allowed= new Set(['grant_type','client_id','client_assertion','client_assertion_type','code','code_verifier','redirect_uri','refresh_token','resource','scope']);
    if([...form.keys()].some(key=>!allowed.has(key)))return error(400,'invalid_request');
   }else if([...form.keys()].some(key=>!['token','token_type_hint','client_id','client_assertion','client_assertion_type'].includes(key))||form.has('token_type_hint')&&!['access_token','refresh_token'].includes(form.get('token_type_hint')!))return error(400,'invalid_request');
   const clientId=form.get('client_id');if(!clientId)return error(400,'invalid_client');
   forwarded=new Request(request.url,{method:'POST',headers,body:form});
   if(revoke&&form.get('token')?.includes('.')){
    const raw=form.get('token')!,claims=await options.verifyToken(raw);
    if(!claims||claims.azp!==clientId)return error(400,'invalid_request');
    if(form.get('token_type_hint')==='refresh_token')return error(400,'invalid_request');
    revokeClaims=claims;
   }
  }else if(metadata||jwks){headers.delete('cookie');headers.delete('authorization');forwarded=new Request(request.url,{method:metadata?'GET':request.method,headers});}
  else if(authorize){
   if(url.searchParams.getAll('resource').length!==1||url.searchParams.get('resource')!==options.config.resource||url.searchParams.get('code_challenge_method')!=='S256')return error(400,'invalid_request');
  }
  const response=await options.handler(forwarded);
  if(metadata&&response.ok){
   const value=await response.json() as Record<string,unknown>;
   // This request boundary exposes only these native authentication methods.
   // The provider's issuer, endpoints, resource, S256 and callback values are retained.
   if(value.issuer){
    value.token_endpoint_auth_methods_supported=['none','private_key_jwt'];value.revocation_endpoint_auth_methods_supported=['none','private_key_jwt'];
    for(const key of Object.keys(value))if(key.startsWith('introspection_')||key.startsWith('backchannel_')||key.startsWith('dpop_')||key==='end_session_endpoint')delete value[key];
   }else for(const key of Object.keys(value))if(key.startsWith('dpop_'))delete value[key];
   return request.method==='HEAD'?new Response(null,{status:response.status,headers:{...privacy,'Content-Type':'application/json'}}):Response.json(value,{status:response.status,headers:privacy});
  }
  if(revokeClaims&&response.status===400){
   const failure=await response.clone().json().catch(()=>null);
   // Fixed 1.7.23 authenticates the client before this exact native JWT result.
   // Invalid assertions, wrong clients and replayed jti never reach this branch.
   if(failure?.error==='unsupported_token_type'){
    await options.ledger.revoke(form!.get('token')!,revokeClaims,true);return new Response(null,{status:200,headers:privacy});
   }
  }
  if(token&&response.ok){
   const value=await response.json() as Record<string,unknown>;
   if(typeof value.access_token!=='string'||value.access_token.length>8192||value.token_type!=='Bearer')return error(503,'OAUTH_TOKEN_UNAVAILABLE');
   const claims=await options.verifyToken(value.access_token);
   if(!claims||claims.azp!==form!.get('client_id')||!await options.ledger.register(value.access_token,claims,form!.get('grant_type') as 'authorization_code'|'refresh_token'))return error(503,'OAUTH_TOKEN_REGISTRATION_FAILED');
   return Response.json(value,{status:response.status,headers:privacy});
  }
  if(consent&&input?.accept===true&&response.ok){
   const data=await response.clone().json() as Record<string,unknown>;
   if(data.redirect!==true||typeof data.url!=='string')return error(503,'OAUTH_CONSENT_UNCONFIRMED');
   const query=new URLSearchParams(input.oauth_query as string),clientId=query.get('client_id'),scopes=query.get('scope')?.split(' ');
   if(!clientId||!scopes||query.getAll('resource').length!==1||query.get('resource')!==options.config.resource||scopes.some(scope=>!options.config.scopes.includes(scope)))return error(400,'INVALID_OAUTH_QUERY');
   await options.ledger.approve(owner!.sessionRef,clientId,scopes);
  }
  const resultHeaders=new Headers(response.headers);for(const[key,value]of Object.entries(privacy))resultHeaders.set(key,value);
  return new Response(response.body,{status:response.status,headers:resultHeaders});
 }catch(e){return e instanceof OAuthRequestError?error(e.status,'invalid_request'):error(503,'OAUTH_UNAVAILABLE');}
};}
