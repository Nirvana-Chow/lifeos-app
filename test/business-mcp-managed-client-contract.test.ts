import assert from 'node:assert/strict';import test from 'node:test';
import {parseManagedClientCommand,parseManagedClientWriteCommand,readManagedClientSetup} from '../src/business-mcp-oauth/managed-client-contract.ts';
const command={callback:'https://chatgpt.com/connector/oauth/fixtureCallback1',commandId:'99fa7b22-534a-49e1-b527-8e8420244bc4'};
test('managed registration accepts only the canonical ChatGPT callback and original UUID body',()=>{
 assert.deepEqual(parseManagedClientCommand(command),command);
 for(const value of [null,[],{}, {...command,scope:'todo:write'},{...command,clientId:'https://evil.example/client'},{...command,commandId:'new-key'},{...command,callback:command.callback+'?code=x'},{...command,callback:command.callback+'#x'},{...command,callback:command.callback.replace('chatgpt.com','chatgpt.com:443')},{...command,callback:command.callback.replace('chatgpt.com','chatgpt.com.evil.example')},{...command,callback:command.callback.replace('https://','http://')},{...command,callback:command.callback.replace('chatgpt.com','owner@chatgpt.com')},{...command,callback:command.callback.replace('fixtureCallback1','..')},{...command,callback:command.callback.replace('fixtureCallback1','fixture%2fCallback')},{...command,callback:'https://127.0.0.1/connector/oauth/fixtureCallback1'},{...command,callback:'https://chatgpt.com\\@127.0.0.1/connector/oauth/fixtureCallback1'},{...command,callback:command.callback+'\n'}])assert.equal(parseManagedClientCommand(value),null,JSON.stringify(value));
});
const setup={clientId:'https://lifeos.nirvanachow.com/oauth/clients/chatgpt',authorizationEndpoint:'https://lifeos.nirvanachow.com/api/platform/auth/oauth2/authorize',tokenEndpoint:'https://lifeos.nirvanachow.com/api/platform/auth/oauth2/token',resource:'https://lifeos.nirvanachow.com/api/platform/mcp',scopes:['todo:read','offline_access'],tokenEndpointAuthMethod:'none',codeChallengeMethod:'S256',registered:false};
test('the setup UI accepts only the fixed nonsecret configuration response and rejects raw or incomplete SDK objects',()=>{
 assert.deepEqual(readManagedClientSetup(setup),setup);
 const registered={...setup,registered:true,...command};assert.deepEqual(readManagedClientSetup(registered),registered);
 const changed={...registered,revision:'ef0cb8cf-116e-4aaf-b7dd-992071c39692'};
 assert.deepEqual(readManagedClientSetup(changed),changed);
 assert.equal(readManagedClientSetup({...changed,revision:'stale'}),null);
 for(const value of [null,{}, {...setup,client_secret:'synthetic-forbidden-secret'},{...setup,tokenEndpoint:'https://other.example/token'},{...setup,codeChallengeMethod:'plain'},{...setup,scopes:['todo:read','todo:read']},{...registered,commandId:undefined}])assert.equal(readManagedClientSetup(value),null);
});
test('the original UUID is canonical and cannot contain a trailing line terminator',()=>{
 assert.equal(parseManagedClientCommand({...command,commandId:command.commandId+'\n'}),null);
 assert.equal(parseManagedClientCommand({...command,commandId:command.commandId+'\r\n'}),null);
});

test('managed setup accepts the explicit full policy and keeps narrow and file authority separate',()=>{
 const full='personal-business:all';
 for(const state of [{registered:false},{registered:true,...command}]){
  for(const scopes of [[full],[full,'offline_access'],['file-handoff:read',full,'offline_access','file-handoff:write'],['journal:read','journal:write','offline_access']]){
   const configuration={...setup,...state,scopes};
   assert.deepEqual(readManagedClientSetup(configuration),configuration);
  }
  for(const scopes of [[full,'journal:read'],[full,'file-handoff:write'],[full,full],[full,'admin:all'],['personal-business:ALL']]){
   assert.equal(readManagedClientSetup({...setup,...state,scopes}),null);
  }
 }
});

test('replacement requires the exact create fields plus a distinct canonical expected receipt',()=>{
 const replacement={...command,expectedRevision:'ef0cb8cf-116e-4aaf-b7dd-992071c39692'};
 assert.deepEqual(parseManagedClientWriteCommand(command),command);
 assert.deepEqual(parseManagedClientWriteCommand(replacement),replacement);
 assert.equal(parseManagedClientCommand(replacement),null);
 for(const invalid of [
  {...replacement,expectedRevision:command.commandId},
  {...replacement,expectedRevision:replacement.expectedRevision.toUpperCase()},
  {...replacement,expectedRevision:'not-a-receipt'},
  {...replacement,scope:'todo:write'},
  {...replacement,callback:command.callback+'?state=x'},
  {...replacement,callback:command.callback.replace('chatgpt.com','external.example')},
 ])assert.equal(parseManagedClientWriteCommand(invalid),null);
});
