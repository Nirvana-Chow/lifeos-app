import assert from 'node:assert/strict';import test from 'node:test';
import {memoryAdapter}from'better-auth/adapters/memory';
import type {BetterAuthOptions}from'better-auth';
import {createPlatformAuth}from'../src/platform/auth.ts';
import {authRequest,readVerifiedOwnerSession,readOwnerMfaState}from'../src/platform/auth.ts';
import {hashPassword}from'better-auth/crypto';
import {createHash}from'node:crypto';
import {requireMcpAuth}from'@better-auth/mcp';
import {verifyOAuthQueryParams}from'@better-auth/oauth-provider';
import {createBusinessOAuthHttp}from'../src/business-mcp-oauth/http.ts';
import {validateBusinessClaims}from'../src/business-mcp-oauth/ledger.ts';
import {readSignedOAuthQuery}from'../src/business-mcp-oauth/query.ts';
import {enrollSyntheticOwnerMfa,mergeSyntheticAuthCookies}from'./helpers/owner-mfa-fixture.ts';
const config={baseURL:'https://lifeos.nirvanachow.com',ownerId:'fixture-owner',ownerEmail:'owner@example.invalid',secret:'Synthetic-only-platform-secret-0000000000',databaseURL:'',sessionSeconds:1800};
const oauth={resource:config.baseURL+'/api/platform/mcp',issuer:config.baseURL+'/api/platform/auth',grantId:'reviewed-grant',scopes:['todo:read','todo:write','offline_access']};
test('the same Better Auth instance exposes fixed official OAuth metadata with no registration or client-credentials grant',async()=>{
 const auth=createPlatformAuth(config,memoryAdapter({platform_user:[],platform_session:[],platform_verification:[],platform_rate_limit:[],platform_oauth_client:[],platform_oauth_resource:[],platform_oauth_client_resource:[],platform_oauth_refresh_token:[],platform_oauth_access_token:[],platform_oauth_consent:[],platform_oauth_client_assertion:[],platform_oauth_jwks:[]}),{requireMfa:true,businessOAuth:oauth});
 const request=(path:string)=>auth.handler(new Request(config.baseURL+path,{headers:{host:'lifeos.nirvanachow.com'}}));
 const metadata=await request('/.well-known/oauth-authorization-server/api/platform/auth');assert.equal(metadata.status,200);
 const value=await metadata.json();assert.equal(value.issuer,oauth.issuer);assert.equal(value.registration_endpoint,undefined);assert.deepEqual(value.grant_types_supported,['authorization_code','refresh_token']);assert.equal(value.client_id_metadata_document_supported,true);
 const resource=await request('/.well-known/oauth-protected-resource/api/platform/mcp');assert.equal(resource.status,200);assert.equal((await resource.json()).resource,oauth.resource);
 assert.equal((await request('/api/platform/auth/token')).status,404);
 assert.equal(auth.options.advanced?.defaultCookieAttributes?.sameSite,'strict');assert.equal(auth.options.session?.cookieCache?.enabled,false);
});

for(const authMethod of ['none','private_key_jwt'] as const)test('official provider completes owner MFA, signed consent, S256 code/resource JWT/refresh/revoke: '+authMethod,async()=>{
 const now=new Date(),password='Synthetic-only-OAuth-password-0001',clientId='https://client.example/metadata',callback='https://client.example/callback';
 const {generateKeyPair,exportJWK,SignJWT}=await import('jose');const keys=authMethod==='private_key_jwt'?await generateKeyPair('RS256'):null;const jwks=keys?JSON.stringify({keys:[{...await exportJWK(keys.publicKey),kid:'fixture-client-key',alg:'RS256',use:'sig'}]}):undefined;
 const db:Record<string,Record<string,unknown>[]> ={platform_user:[{id:config.ownerId,name:'Synthetic owner',email:config.ownerEmail,emailVerified:false,twoFactorEnabled:false,createdAt:now,updatedAt:now}],platform_account:[{id:'fixture-account',accountId:config.ownerId,providerId:'credential',userId:config.ownerId,password:await hashPassword(password),createdAt:now,updatedAt:now}],platform_session:[],platform_verification:[],platform_rate_limit:[],platform_two_factor:[],platform_oauth_client:[{id:'fixture-client',clientId,name:'Synthetic OAuth client',disabled:false,skipConsent:false,tokenEndpointAuthMethod:authMethod,jwks,redirectUris:[callback],scopes:[...oauth.scopes],grantTypes:['authorization_code','refresh_token'],responseTypes:['code'],requirePKCE:true}],platform_oauth_resource:[],platform_oauth_client_resource:[{id:'fixture-link',clientId,resourceId:oauth.resource}],platform_oauth_refresh_token:[],platform_oauth_access_token:[],platform_oauth_consent:[],platform_oauth_client_assertion:[],platform_oauth_jwks:[]};
 // Official memoryAdapter does not enforce PKs. Emulate only PostgreSQL's
 // assertion primary-key constraint; provider auth/claims/jti logic stays real.
 // Cross-process uniqueness and row-lock qualification remain mandatory PG tests.
 const memory=memoryAdapter(db),assertionIds=new Set<string>();
 const constrained=(options:BetterAuthOptions)=>{const adapter=memory(options),create=adapter.create.bind(adapter);adapter.create=(async(args:Parameters<typeof adapter.create>[0])=>{if(['oauthClientAssertion','platform_oauth_client_assertion'].includes(args.model)){const id=String(args.data.id);if(assertionIds.has(id))throw Error('duplicate fixture assertion id');assertionIds.add(id);}return create(args);}) as typeof adapter.create;return adapter;};
 const auth=createPlatformAuth(config,constrained,{requireMfa:true,businessOAuth:oauth,disableSessionRefresh:true});await auth.$context;
 const native=async(path:string,body:Record<string,unknown>,cookie='')=>{
  const context=await auth.$context,trust=context.createAuthCookie('trust_device').name;
  return authRequest(new Request(oauth.issuer+'/'+path,{method:'POST',headers:{host:'lifeos.nirvanachow.com',origin:config.baseURL,'content-type':'application/json',cookie},body:JSON.stringify(body)}),config,r=>auth.handler(r),{requireMfa:true,readMfaState:h=>readOwnerMfaState(auth,config,h),withOwnerLock:async run=>run(),trustedDeviceCookieNames:[trust],sessionCookieNames:[context.authCookies.sessionToken.name],twoFactorCookieNames:[context.createAuthCookie('two_factor').name]});
 };
 let registered=0,approved=0,revoked=0;
 const verify=async(token:string)=>{let result=null as ReturnType<typeof validateBusinessClaims>;await requireMcpAuth(auth,(_r,claims)=>{result=validateBusinessClaims(claims,oauth,config.ownerId);return new Response(null,{status:204});},{resource:oauth.resource,issuer:oauth.issuer})(new Request(oauth.resource,{headers:{authorization:'Bearer '+token}}));return result;};
 const http=createBusinessOAuthHttp({origin:config.baseURL,config:oauth,assertReady:async()=>{},owner:h=>readVerifiedOwnerSession(auth,config,h),handler:r=>auth.handler(r),verifyQuery:q=>verifyOAuthQueryParams(q,config.secret),verifyToken:verify,ledger:{approve:async()=>{approved++;},register:async(_token,claims)=>{registered++;return{grantId:oauth.grantId,ownerId:config.ownerId,spaceId:'fixture-space',scopes:claims.scope.split(' '),oauthFence:{tokenId:'a'.repeat(64),bindingId:'binding',bindingRevision:1,expiresAt:claims.exp}};},revoke:async()=>{revoked++;}}});
 const verifier='v'.repeat(43),params=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:callback,resource:oauth.resource,scope:oauth.scopes.join(' '),state:'fixture-state',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
 const authorize=async(cookie='')=>http(new Request(oauth.issuer+'/oauth2/authorize?'+params,{headers:{host:'lifeos.nirvanachow.com',accept:'text/html',cookie}}));
 const anonymous=await authorize();assert.equal(anonymous.status,302);const login=new URL(anonymous.headers.get('location')!,config.baseURL);assert.equal(login.pathname,'/login');
 const signed=await readSignedOAuthQuery(login.search.slice(1),oauth,q=>verifyOAuthQueryParams(q,config.secret));assert.ok(signed);assert.equal(await verifyOAuthQueryParams(login.search.slice(1)+'&scope=todo%3Awrite',config.secret),false);
 const passwordOnly=await native('sign-in/email',{email:config.ownerEmail,password}),passwordCookie=mergeSyntheticAuthCookies(passwordOnly);assert.equal(await readVerifiedOwnerSession(auth,config,new Headers({cookie:passwordCookie})),null);
 db.platform_oauth_consent.push({id:'old-consent',clientId,userId:config.ownerId,referenceId:'lifeos-business-mcp-v1',resources:[oauth.resource],scopes:[...oauth.scopes],createdAt:now,updatedAt:now});
 const partial=await authorize(passwordCookie);assert.notEqual(partial.headers.get('location')?.startsWith(callback+'?code='),true);assert.equal(db.platform_verification.some(row=>{try{return JSON.parse(row.value as string).type==='authorization_code';}catch{return false;}}),false);db.platform_oauth_consent.length=0;
 const enrolled=await enrollSyntheticOwnerMfa(auth,config.ownerId,password,native,passwordCookie),cookie=enrolled.cookie;
 const consentRedirect=await authorize(cookie);assert.equal(consentRedirect.status,302);const consentUrl=new URL(consentRedirect.headers.get('location')!,config.baseURL);assert.equal(consentUrl.pathname,'/personal/oauth');
 const rejected=await http(new Request(oauth.issuer+'/oauth2/consent',{method:'POST',headers:{host:'lifeos.nirvanachow.com',origin:config.baseURL,'content-type':'application/json',cookie},body:JSON.stringify({accept:false,oauth_query:consentUrl.search.slice(1)})}));assert.equal(rejected.status,200);assert.equal(approved,0);assert.equal(db.platform_oauth_consent.length,0);assert.equal(new URL((await rejected.json()).url).searchParams.get('error'),'access_denied');
 const consent=await http(new Request(oauth.issuer+'/oauth2/consent',{method:'POST',headers:{host:'lifeos.nirvanachow.com',origin:config.baseURL,'content-type':'application/json',cookie},body:JSON.stringify({accept:true,oauth_query:consentUrl.search.slice(1)})}));assert.equal(consent.status,200);assert.equal(approved,1);const authorized=new URL((await consent.json()).url);assert.equal(authorized.searchParams.get('iss'),oauth.issuer);assert.equal(authorized.searchParams.get('state'),'fixture-state');const code=authorized.searchParams.get('code');assert.ok(code);
 let previousAssertion:string|undefined;
 const protocol=async(endpoint:string,body:Record<string,string>,badAssertion=false,replay=false)=>{
  const assertion=keys?replay?previousAssertion:badAssertion?'invalid.assertion.value':await new SignJWT({}).setProtectedHeader({alg:'RS256',kid:'fixture-client-key'}).setIssuer(clientId).setSubject(clientId).setAudience(oauth.issuer+'/oauth2/'+endpoint).setIssuedAt().setExpirationTime('1m').setJti(crypto.randomUUID()).sign(keys.privateKey):null;
  if(assertion&&!replay)previousAssertion=assertion;
  return http(new Request(oauth.issuer+'/oauth2/'+endpoint,{method:'POST',headers:{host:'lifeos.nirvanachow.com','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,...(endpoint==='token'?{resource:oauth.resource}:{}),...body,...(assertion?{client_assertion:assertion,client_assertion_type:'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'}:{})})}));
 };
 const exchange=(body:Record<string,string>)=>protocol('token',body);
 const wrong=await exchange({grant_type:'authorization_code',code,redirect_uri:callback,code_verifier:'z'.repeat(43)});assert.equal(wrong.status,400);assert.equal(registered,0);
 const token=await exchange({grant_type:'authorization_code',code,redirect_uri:callback,code_verifier:verifier});assert.equal(token.status,200);const tokens=await token.json();assert.equal(registered,1);assert.ok(await verify(tokens.access_token));assert.equal(tokens.id_token,undefined);assert.equal(typeof tokens.refresh_token,'string');
 const browserSessionId=String(db.platform_session[0].id);assert.equal((await native('sign-out',{},cookie)).status,200);assert.equal(await readVerifiedOwnerSession(auth,config,new Headers({cookie})),null);
 // Official memory storage lacks FK ON DELETE SET NULL; match the PG schema here.
 for(const row of db.platform_oauth_refresh_token)if(row.sessionId===browserSessionId)row.sessionId=null;
 const refreshed=await exchange({grant_type:'refresh_token',refresh_token:tokens.refresh_token});assert.equal(refreshed.status,200);assert.equal(registered,2);const refreshedTokens=await refreshed.json();
 if(keys){const rejected=await protocol('revoke',{token:tokens.access_token,token_type_hint:'access_token'},true);assert.notEqual(rejected.status,200);assert.equal(revoked,0);}
 const revokedToken=await protocol('revoke',{token:tokens.access_token,token_type_hint:'access_token'});assert.equal(revokedToken.status,200);assert.equal(revoked,1);
 if(keys){const replay=await protocol('revoke',{token:tokens.access_token,token_type_hint:'access_token'},false,true);assert.notEqual(replay.status,200);assert.equal(revoked,1);}
 const wrongClient=await protocol('revoke',{token:tokens.access_token,client_id:'https://unknown.example/meta',token_type_hint:'access_token'});assert.equal(wrongClient.status,400);assert.equal(revoked,1);
 // Independent refresh-revoke scenario: native rate limiting has its own regression suite.
 db.platform_rate_limit.length=0;
 const revokedRefresh=await protocol('revoke',{token:refreshedTokens.refresh_token,token_type_hint:'refresh_token'});assert.equal(revokedRefresh.status,200);
});
