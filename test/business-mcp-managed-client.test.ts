import assert from 'node:assert/strict';import test from 'node:test';import {randomUUID} from 'node:crypto';
import type {PlatformAuth} from '../src/platform/auth.ts';
import {readManagedClient,registerManagedClient} from '../src/business-mcp-oauth/managed-client.ts';
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
