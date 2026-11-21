import assert from 'node:assert/strict';import test from 'node:test';import {randomUUID} from 'node:crypto';
import type {PlatformAuth} from '../src/platform/auth.ts';
import {readManagedClient,registerManagedClient,replaceManagedClient} from '../src/business-mcp-oauth/managed-client.ts';
import {managedClientFixture,managedFixtureCallback} from './helpers/business-mcp-managed-client-fixture.ts';
test('fixed managed client is absent before registration and exact registration is independently read back',async()=>{
 const {auth,oauth,config,cookie,db}=await managedClientFixture(),command={callback:managedFixtureCallback,commandId:randomUUID()},headers=new Headers({cookie});
 assert.deepEqual(await readManagedClient(auth,oauth,config.ownerId),{registered:false});
 const created=await registerManagedClient(auth,oauth,config.ownerId,headers,command);
 assert.deepEqual(created,{created:true,state:{registered:true,...command}});
 assert.deepEqual(await readManagedClient(auth,oauth,config.ownerId),{registered:true,...command});
 assert.deepEqual(await registerManagedClient(auth,oauth,config.ownerId,headers,command),{created:false,state:{registered:true,...command}});
 assert.equal(db.platform_oauth_client.length,1);assert.equal(db.platform_oauth_client_resource.length,1);assert.equal(db.platform_oauth_consent.length,0);
});

test('changed original UUID callback or approved scopes never updates an existing fixed client',async()=>{
 const {auth,oauth,config,cookie,db}=await managedClientFixture(),command={callback:managedFixtureCallback,commandId:randomUUID()},headers=new Headers({cookie});
 await registerManagedClient(auth,oauth,config.ownerId,headers,command);
 const before=JSON.stringify(db.platform_oauth_client);
 for(const changed of [{...command,commandId:randomUUID()},{...command,callback:managedFixtureCallback+'x'}])await assert.rejects(registerManagedClient(auth,oauth,config.ownerId,headers,changed),{message:'MANAGED_CLIENT_CONFLICT'});
 await assert.rejects(readManagedClient(auth,{...oauth,scopes:['todo:read','offline_access']},config.ownerId),{message:'MANAGED_CLIENT_CONFLICT'});
 assert.equal(JSON.stringify(db.platform_oauth_client),before);
});

test('unknown SDK creation is resolved only by exact independent fixed-client readback without a second creation',async()=>{
 for(const persisted of [false,true]){
  const {auth,oauth,config,cookie,db}=await managedClientFixture(),command={callback:managedFixtureCallback,commandId:randomUUID()};let calls=0;
  const uncertain={...auth,api:{...auth.api,adminCreateOAuthClient:Object.assign(async(args:Parameters<typeof auth.api.adminCreateOAuthClient>[0])=>{calls++;if(persisted)await auth.api.adminCreateOAuthClient(args);throw Error('Synthetic response lost');},auth.api.adminCreateOAuthClient)}} satisfies PlatformAuth;
  if(persisted)assert.deepEqual(await registerManagedClient(uncertain,oauth,config.ownerId,new Headers({cookie}),command),{created:false,state:{registered:true,...command}});
  else await assert.rejects(registerManagedClient(uncertain,oauth,config.ownerId,new Headers({cookie}),command),{message:'MANAGED_CLIENT_UNKNOWN'});
  assert.equal(calls,1);assert.equal(db.platform_oauth_client.length,persisted?1:0);
 }
});

test('managed client metadata origin resource links and security settings must all match',async()=>{
 const changes=[(r:Record<string,unknown>)=>r.clientDiscoveryId='cimd',(r:Record<string,unknown>)=>r.userId='other-owner',(r:Record<string,unknown>)=>r.skipConsent=true,(r:Record<string,unknown>)=>r.requirePKCE=false,(r:Record<string,unknown>)=>r.disabled=true,(r:Record<string,unknown>)=>r.tokenEndpointAuthMethod='client_secret_basic',(r:Record<string,unknown>)=>r.grantTypes=['client_credentials'],(r:Record<string,unknown>)=>r.clientCredentialsScopes=['todo:write'],(r:Record<string,unknown>)=>r.metadata={lifeos_managed_client:'forged'},(r:Record<string,unknown>)=>r.name='Changed client'];
 for(const change of changes){const {auth,oauth,config,cookie,db}=await managedClientFixture();await registerManagedClient(auth,oauth,config.ownerId,new Headers({cookie}),{callback:managedFixtureCallback,commandId:randomUUID()});change(db.platform_oauth_client[0]);await assert.rejects(readManagedClient(auth,oauth,config.ownerId),{message:'MANAGED_CLIENT_CONFLICT'});}
 const {auth,oauth,config,cookie,db}=await managedClientFixture();await registerManagedClient(auth,oauth,config.ownerId,new Headers({cookie}),{callback:managedFixtureCallback,commandId:randomUUID()});db.platform_oauth_client_resource.push({id:'extra-link',clientId:db.platform_oauth_client[0].clientId,resourceId:'https://other.example/resource'});await assert.rejects(readManagedClient(auth,oauth,config.ownerId),{message:'MANAGED_CLIENT_CONFLICT'});
});

test('uncertain replacement reconciles one write attempt against the exact stored receipt',async()=>{
 for(const persisted of [false,true]){
  const {auth,oauth,config,cookie}=await managedClientFixture();
  const command={callback:managedFixtureCallback,commandId:randomUUID()};
  const replacement={callback:managedFixtureCallback+'2',commandId:randomUUID(),expectedCommandId:command.commandId};
  await registerManagedClient(auth,oauth,config.ownerId,new Headers({cookie}),command);
  const context=await auth.$context;
  let attempts=0;
  const uncertain={...auth,$context:Promise.resolve({...context,adapter:{...context.adapter,updateMany:async(args:Parameters<typeof context.adapter.updateMany>[0])=>{
   attempts++;
   if(persisted)await context.adapter.updateMany(args);
   throw Error('Synthetic response lost');
  }}})} satisfies PlatformAuth;
  const result=replaceManagedClient(uncertain,oauth,config.ownerId,replacement);
  const expected={registered:true,callback:replacement.callback,commandId:replacement.commandId};
  if(persisted){
   assert.deepEqual(await result,{duplicate:true,state:expected});
   assert.deepEqual(await replaceManagedClient(uncertain,oauth,config.ownerId,replacement),{duplicate:true,state:expected});
   assert.deepEqual(await readManagedClient(auth,oauth,config.ownerId),expected);
  }else{
   await assert.rejects(result,{message:'MANAGED_CLIENT_UNKNOWN'});
   assert.deepEqual(await readManagedClient(auth,oauth,config.ownerId),{registered:true,...command});
  }
  assert.equal(attempts,1);
 }
});

test('two different replacements from the same receipt commit at most one callback',async()=>{
 const {auth,oauth,config,cookie}=await managedClientFixture();
 const original={callback:managedFixtureCallback,commandId:randomUUID()};
 await registerManagedClient(auth,oauth,config.ownerId,new Headers({cookie}),original);
 const commands=['one','two'].map(suffix=>({callback:managedFixtureCallback+suffix,commandId:randomUUID(),expectedCommandId:original.commandId}));
 const results=await Promise.allSettled(commands.map(command=>replaceManagedClient(auth,oauth,config.ownerId,command)));
 const succeeded=results.filter(result=>result.status==='fulfilled');
 const failed=results.filter(result=>result.status==='rejected');
 assert.equal(succeeded.length,1);
 assert.equal(failed.length,1);
 assert.equal(failed[0].reason.message,'MANAGED_CLIENT_CONFLICT');
 const saved=await readManagedClient(auth,oauth,config.ownerId);
 assert.deepEqual(saved,succeeded[0].value.state);
 assert.equal(succeeded[0].value.duplicate,false);
 const winner=commands[results.indexOf(succeeded[0])];
 await assert.rejects(replaceManagedClient(auth,oauth,config.ownerId,{...winner,expectedCommandId:randomUUID()}),{message:'MANAGED_CLIENT_CONFLICT'});
 assert.deepEqual(await readManagedClient(auth,oauth,config.ownerId),saved);
});
