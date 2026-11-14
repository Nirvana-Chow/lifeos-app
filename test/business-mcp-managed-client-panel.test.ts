import assert from 'node:assert/strict';import test from 'node:test';
import {renderAuthComponent} from './helpers/auth-component-render.ts';
const setup={clientId:'https://lifeos.nirvanachow.com/oauth/clients/chatgpt',authorizationEndpoint:'https://lifeos.nirvanachow.com/api/platform/auth/oauth2/authorize',tokenEndpoint:'https://lifeos.nirvanachow.com/api/platform/auth/oauth2/token',resource:'https://lifeos.nirvanachow.com/api/platform/mcp',scopes:['todo:read','offline_access'],tokenEndpointAuthMethod:'none',codeChallengeMethod:'S256',registered:false};
test('managed owner page labels the exact callback and keeps submission disabled without JavaScript',()=>{
 const html=renderAuthComponent('src/business-mcp-oauth/managed-client-panel.tsx','ManagedClientPanel',{initial:setup});
 assert.match(html,/ChatGPT 回调地址/);assert.match(html,/保存连接配置/);assert.match(html,/<fieldset disabled=""/);assert.match(html,/授权地址/);assert.match(html,/S256/);
});
test('an existing managed configuration is displayed without a creation form or automatic replacement',()=>{
 const html=renderAuthComponent('src/business-mcp-oauth/managed-client-panel.tsx','ManagedClientPanel',{initial:{...setup,registered:true,callback:'https://chatgpt.com/connector/oauth/fixtureCallback1',commandId:'99fa7b22-534a-49e1-b527-8e8420244bc4'}});
 assert.match(html,/fixtureCallback1/);assert.doesNotMatch(html,/<form/);assert.doesNotMatch(html,/<button\b[^>]*>保存连接配置<\/button>/);
});
