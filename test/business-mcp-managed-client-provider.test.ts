import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {managedChatGptClientId} from '../src/business-mcp-oauth/managed-client-contract.ts';
import {registerManagedClient,replaceManagedClient} from '../src/business-mcp-oauth/managed-client.ts';
import {managedClientFixture,managedFixtureCallback} from './helpers/business-mcp-managed-client-fixture.ts';

test('official managed registration uses the fixed HTTPS ID and none without granting business authority',async()=>{
 const {auth,oauth,config,cookie,db}=await managedClientFixture();
 const value=await auth.api.adminCreateOAuthClient({headers:new Headers({cookie}),body:{client_name:'LifeOS ChatGPT',redirect_uris:[managedFixtureCallback],scope:oauth.scopes.join(' '),token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],application_type:'web',require_pkce:true,skip_consent:false,resources:[oauth.resource],metadata:{lifeos_managed_client:'chatgpt-v1',command_id:randomUUID()}}});
 assert.equal(value.client_id,'https://lifeos.nirvanachow.com/oauth/clients/chatgpt');
 assert.equal(value.client_secret,undefined);assert.equal(value.token_endpoint_auth_method,'none');assert.equal(value.require_pkce,true);assert.equal(value.skip_consent,false);
 assert.equal(db.platform_oauth_client.length,1);assert.equal(db.platform_oauth_client[0].clientDiscoveryId,null);assert.equal(db.platform_oauth_client[0].userId,config.ownerId);assert.deepEqual(db.platform_oauth_client_resource.map(row=>row.resourceId),[oauth.resource]);
 assert.equal(db.platform_oauth_consent.length,0);assert.equal(db.platform_oauth_access_token.length,0);assert.equal(db.platform_oauth_refresh_token.length,0);
});

test('official managed registration cannot use a password-only owner session',async()=>{
 const {auth,cookie,db}=await managedClientFixture();
 for(const row of db.platform_session)row.mfaVerified=false;
 await assert.rejects(auth.api.adminCreateOAuthClient({headers:new Headers({cookie}),body:{redirect_uris:[managedFixtureCallback],token_endpoint_auth_method:'none',require_pkce:true,skip_consent:false}}),{status:'UNAUTHORIZED'});
 assert.equal(db.platform_oauth_client.length,0);
});

test('the provider accepts only the replacement callback and requests new owner consent',async()=>{
 const {auth,oauth,config,cookie,db}=await managedClientFixture();
 const original={callback:managedFixtureCallback,commandId:randomUUID()};
 const replacement={callback:managedFixtureCallback+'new',commandId:randomUUID(),expectedRevision:original.commandId};
 await registerManagedClient(auth,oauth,config.ownerId,new Headers({cookie}),original);
 await replaceManagedClient(auth,oauth,config.ownerId,replacement);
 const authorize=async(callback:string)=>{
  const query=new URLSearchParams({
   client_id:managedChatGptClientId,redirect_uri:callback,resource:oauth.resource,
   scope:oauth.scopes.join(' '),response_type:'code',state:randomUUID(),prompt:'consent',
   code_challenge:createHash('sha256').update('v'.repeat(43)).digest('base64url'),code_challenge_method:'S256',
  });
  const response=await auth.handler(new Request(oauth.issuer+'/oauth2/authorize?'+query,{headers:{cookie,accept:'text/html'}}));
  assert.equal(response.status,302);
  const target=new URL(response.headers.get('location')!,config.baseURL);
  assert.equal(target.origin,config.baseURL);
  return target;
 };
 const denied=await authorize(original.callback);
 assert.equal(denied.pathname,'/api/platform/auth/error');
 assert.equal(denied.searchParams.get('error'),'invalid_redirect');
 const consent=await authorize(replacement.callback);
 assert.equal(consent.pathname,'/personal/oauth');
 assert.equal(db.platform_oauth_consent.length,0);
 assert.equal(db.platform_oauth_access_token.length,0);
});

test('previously issued refresh and authorization code stay unusable after new consent and callback reuse',async()=>{
 const {auth,oauth,config,cookie}=await managedClientFixture();
 const original={callback:managedFixtureCallback,commandId:randomUUID()};
 await registerManagedClient(auth,oauth,config.ownerId,new Headers({cookie}),original);
 const {createBusinessOAuthHttp}=await import('../src/business-mcp-oauth/http.ts');
 const {verifyOAuthQueryParams}=await import('@better-auth/oauth-provider');
 const {requireMcpAuth}=await import('@better-auth/mcp');
 const {validateBusinessClaims}=await import('../src/business-mcp-oauth/ledger.ts');
 const {readManagedCredentialRegistration}=await import('../src/business-mcp-oauth/managed-client.ts');
 const http=createBusinessOAuthHttp({
  origin:config.baseURL,config:oauth,assertReady:async()=>{},owner:async()=>({sessionRef:'synthetic-verified-session'}),
  handler:request=>auth.handler(request),verifyQuery:q=>verifyOAuthQueryParams(q,config.secret),
  verifyToken:async token=>{
   let claims=null as ReturnType<typeof validateBusinessClaims>;
   await requireMcpAuth(auth,(_request,value)=>{claims=validateBusinessClaims(value,oauth,config.ownerId);return new Response(null,{status:204});},{resource:oauth.resource,issuer:oauth.issuer})(new Request(oauth.resource,{headers:{authorization:'Bearer '+token}}));
   return claims;
  },
  managedClient:{withOwnerLock:async run=>run(),read:()=>readManagedCredentialRegistration(auth,oauth,config.ownerId)},
  ledger:{approve:async()=>{},register:async()=>({} as never),revoke:async()=>{}},
 });
 const codeVerifier='v'.repeat(43);
 const authorizationTarget=async(callback:string,prompt:string|null)=>{
  const query=new URLSearchParams({client_id:managedChatGptClientId,redirect_uri:callback,resource:oauth.resource,scope:oauth.scopes.join(' '),response_type:'code',state:randomUUID(),prompt:'consent',code_challenge:createHash('sha256').update(codeVerifier).digest('base64url'),code_challenge_method:'S256'});
  if(prompt===null)query.delete('prompt');else query.set('prompt',prompt);
  const authorize=await http(new Request(oauth.issuer+'/oauth2/authorize?'+query,{headers:{host:'lifeos.nirvanachow.com',cookie,accept:'text/html'}}));
  assert.equal(authorize.status,302);
  return new URL(authorize.headers.get('location')!,config.baseURL);
 };
 const obtainCode=async(callback:string,prompt:string|null='consent')=>{
  const url=await authorizationTarget(callback,prompt);
  assert.equal(url.pathname,'/personal/oauth');
  const consent=await http(new Request(oauth.issuer+'/oauth2/consent',{method:'POST',headers:{host:'lifeos.nirvanachow.com',origin:config.baseURL,cookie,'content-type':'application/json'},body:JSON.stringify({accept:true,oauth_query:url.search.slice(1)})}));
  assert.equal(consent.status,200);
  const code=new URL((await consent.json()).url).searchParams.get('code');
  assert.ok(code);
  return code;
 };
 const exchange=async(fields:Record<string,string>)=>http(new Request(oauth.issuer+'/oauth2/token',{method:'POST',headers:{host:'lifeos.nirvanachow.com','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:managedChatGptClientId,resource:oauth.resource,...fields})}));
 const codeFields=(callback:string,code:string)=>({grant_type:'authorization_code',redirect_uri:callback,code,code_verifier:codeVerifier});
 const refreshFields=(token:string)=>({grant_type:'refresh_token',refresh_token:token});
 const originalExchange=await exchange(codeFields(original.callback,await obtainCode(original.callback)));
 assert.equal(originalExchange.status,200);
 const previousRefresh=(await originalExchange.json()).refresh_token;
 const pendingCode=await obtainCode(original.callback);
 const replacement={callback:original.callback+'new',commandId:randomUUID(),expectedRevision:original.commandId};
 await replaceManagedClient(auth,oauth,config.ownerId,replacement);
 const afterFirst=await readManagedCredentialRegistration(auth,oauth,config.ownerId);
 assert.ok(afterFirst?.generation);
 const restored={callback:original.callback,commandId:randomUUID(),expectedRevision:afterFirst.generation};
 await replaceManagedClient(auth,oauth,config.ownerId,restored);
 const silent=await authorizationTarget(restored.callback,'none');
 assert.equal(silent.origin+silent.pathname,restored.callback);
 assert.equal(silent.searchParams.get('error'),'consent_required');
 const newExchange=await exchange(codeFields(restored.callback,await obtainCode(restored.callback,null)));
 assert.equal(newExchange.status,200);
 const currentRefresh=(await newExchange.json()).refresh_token;
 for(const stale of [refreshFields(previousRefresh),codeFields(original.callback,pendingCode)]){
  const denied=await exchange(stale);
  assert.equal(denied.status,400);
  assert.equal((await denied.json()).error,'invalid_grant');
 }
 assert.equal((await exchange(refreshFields(currentRefresh))).status,200);
});
