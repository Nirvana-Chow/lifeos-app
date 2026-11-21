import assert from 'node:assert/strict';import test from 'node:test';
import {createManagedClientHandler} from '../src/business-mcp-oauth/managed-client-http.ts';
import {readManagedClientSetup} from '../src/business-mcp-oauth/managed-client-contract.ts';
import {readVerifiedOwnerSession} from '../src/platform/auth.ts';
import {managedClientFixture,managedFixtureCallback} from './helpers/business-mcp-managed-client-fixture.ts';
import {renderAuthComponent} from './helpers/auth-component-render.ts';
const setup={clientId:'https://lifeos.nirvanachow.com/oauth/clients/chatgpt',authorizationEndpoint:'https://lifeos.nirvanachow.com/api/platform/auth/oauth2/authorize',tokenEndpoint:'https://lifeos.nirvanachow.com/api/platform/auth/oauth2/token',resource:'https://lifeos.nirvanachow.com/api/platform/mcp',scopes:['todo:read','offline_access'],tokenEndpointAuthMethod:'none',codeChallengeMethod:'S256',registered:false};
test('managed owner page labels the exact callback and keeps submission disabled without JavaScript',()=>{
 const html=renderAuthComponent('src/business-mcp-oauth/managed-client-panel.tsx','ManagedClientPanel',{initial:setup});
 assert.match(html,/ChatGPT 回调地址/);assert.match(html,/保存连接配置/);assert.match(html,/<fieldset disabled=""/);assert.match(html,/授权地址/);assert.match(html,/S256/);
});
test('an existing managed configuration is displayed without a creation form or automatic replacement',()=>{
 const html=renderAuthComponent('src/business-mcp-oauth/managed-client-panel.tsx','ManagedClientPanel',{initial:{...setup,registered:true,callback:'https://chatgpt.com/connector/oauth/fixtureCallback1',commandId:'99fa7b22-534a-49e1-b527-8e8420244bc4'}});
 assert.match(html,/fixtureCallback1/);assert.match(html,/<button\b[^>]*>更换回调地址<\/button>/);assert.doesNotMatch(html,/<form/);assert.doesNotMatch(html,/<button\b[^>]*>保存连接配置<\/button>/);
});

test('full-policy registration and independent account-page readback render the same configured scopes',async()=>{
 const scopes=['personal-business:all','offline_access'];
 const f=await managedClientFixture(scopes);
 const handler=createManagedClientHandler({auth:f.auth,platform:f.config,config:f.oauth,
  owner:headers=>readVerifiedOwnerSession(f.auth,f.config,headers),assertReady:async()=>{},withOwnerLock:async run=>run()});
 const url=f.config.baseURL+'/api/platform/business-mcp/client';
 const headers={host:'lifeos.nirvanachow.com',origin:f.config.baseURL,cookie:f.cookie,'content-type':'application/json'};
 const command={callback:managedFixtureCallback,commandId:'99fa7b22-534a-49e1-b527-8e8420244bc4'};
 async function page(){
  const response=await handler(new Request(url,{headers}));
  assert.equal(response.status,200);
  const configuration=(await response.json()).configuration;
  assert.deepEqual(configuration.scopes,scopes);
  return renderAuthComponent('src/business-mcp-oauth/managed-client-panel.tsx','ManagedClientPanel',{initial:readManagedClientSetup(configuration)});
 }
 const before=await page();
 const saved=await handler(new Request(url,{method:'POST',headers,body:JSON.stringify(command)}));
 assert.equal(saved.status,201);
 assert.deepEqual(f.db.platform_oauth_client[0].scopes,scopes);
 const after=await page();
 assert.match(before,/<form/);
 assert.match(after,/已保存的配置/);
 assert.match(after,/personal-business:all offline_access/);
 assert.doesNotMatch(after,/<form/);
});
