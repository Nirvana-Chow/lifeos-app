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
 const replacement={callback:managedFixtureCallback+'new',commandId:randomUUID(),expectedCommandId:original.commandId};
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
