import assert from 'node:assert/strict';import test from 'node:test';
import {parseManagedClientCommand,readManagedClientSetup} from '../src/business-mcp-oauth/managed-client-contract.ts';
const command={callback:'https://chatgpt.com/connector/oauth/fixtureCallback1',commandId:'99fa7b22-534a-49e1-b527-8e8420244bc4'};
test('managed registration accepts only the canonical ChatGPT callback and original UUID body',()=>{
 assert.deepEqual(parseManagedClientCommand(command),command);
 for(const value of [null,[],{}, {...command,scope:'todo:write'},{...command,clientId:'https://evil.example/client'},{...command,commandId:'new-key'},{...command,callback:command.callback+'?code=x'},{...command,callback:command.callback+'#x'},{...command,callback:command.callback.replace('chatgpt.com','chatgpt.com:443')},{...command,callback:command.callback.replace('chatgpt.com','chatgpt.com.evil.example')},{...command,callback:command.callback.replace('https://','http://')},{...command,callback:command.callback.replace('chatgpt.com','owner@chatgpt.com')},{...command,callback:command.callback.replace('fixtureCallback1','..')},{...command,callback:command.callback.replace('fixtureCallback1','fixture%2fCallback')},{...command,callback:'https://127.0.0.1/connector/oauth/fixtureCallback1'},{...command,callback:'https://chatgpt.com\\@127.0.0.1/connector/oauth/fixtureCallback1'},{...command,callback:command.callback+'\n'}])assert.equal(parseManagedClientCommand(value),null,JSON.stringify(value));
});
test('the setup UI accepts only the fixed nonsecret configuration response and rejects raw or incomplete SDK objects',()=>{
 const setup={clientId:'https://lifeos.nirvanachow.com/oauth/clients/chatgpt',authorizationEndpoint:'https://lifeos.nirvanachow.com/api/platform/auth/oauth2/authorize',tokenEndpoint:'https://lifeos.nirvanachow.com/api/platform/auth/oauth2/token',resource:'https://lifeos.nirvanachow.com/api/platform/mcp',scopes:['todo:read','offline_access'],tokenEndpointAuthMethod:'none',codeChallengeMethod:'S256',registered:false};
 assert.deepEqual(readManagedClientSetup(setup),setup);
 const registered={...setup,registered:true,...command};assert.deepEqual(readManagedClientSetup(registered),registered);
 for(const value of [null,{}, {...setup,client_secret:'synthetic-forbidden-secret'},{...setup,tokenEndpoint:'https://other.example/token'},{...setup,codeChallengeMethod:'plain'},{...setup,scopes:['todo:read','todo:read']},{...registered,commandId:undefined}])assert.equal(readManagedClientSetup(value),null);
});
test('the original UUID is canonical and cannot contain a trailing line terminator',()=>{
 assert.equal(parseManagedClientCommand({...command,commandId:command.commandId+'\n'}),null);
 assert.equal(parseManagedClientCommand({...command,commandId:command.commandId+'\r\n'}),null);
});
