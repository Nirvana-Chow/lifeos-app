import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
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
