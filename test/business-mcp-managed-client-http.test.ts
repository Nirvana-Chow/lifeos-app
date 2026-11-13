import assert from 'node:assert/strict';import test from 'node:test';import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';import {once} from 'node:events';
import {createManagedClientHandler} from '../src/business-mcp-oauth/managed-client-http.ts';
import {readVerifiedOwnerSession} from '../src/platform/auth.ts';
import {OwnerRecoveryBusy} from '../src/personal-candidate/owner-recovery-lock.ts';
import {managedClientFixture,managedFixtureCallback} from './helpers/business-mcp-managed-client-fixture.ts';
const path='/api/platform/business-mcp/client';
test('actual HTTP native owner MFA creates the fixed client and GET independently projects only setup fields',async()=>{
 const f=await managedClientFixture();let inLock=false,checks=0;
 const handler=createManagedClientHandler({auth:f.auth,platform:f.config,config:f.oauth,owner:async headers=>{assert.equal(inLock,true);checks++;return readVerifiedOwnerSession(f.auth,f.config,headers);},assertReady:async()=>{assert.equal(inLock,true);},withOwnerLock:async run=>{assert.equal(inLock,false);inLock=true;try{return await run();}finally{inLock=false;}}});
 const server=createServer(async(req,res)=>{try{const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const incoming=new Headers();for(const[key,value]of Object.entries(req.headers)){if(typeof value==='string')incoming.set(key,value);else if(value)incoming.set(key,value.join(', '));}incoming.set('host','lifeos.nirvanachow.com');const response=await handler(new Request(f.config.baseURL+req.url,{method:req.method,headers:incoming,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end();}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');
 const url='http://127.0.0.1:'+address.port+path,command={callback:managedFixtureCallback,commandId:randomUUID()},headers={cookie:f.cookie,origin:f.config.baseURL,'content-type':'application/json'};
 try{
  const before=await fetch(url,{headers});assert.equal(before.status,200);assert.equal((await before.json()).configuration.registered,false);
  const created=await fetch(url,{method:'POST',headers,body:JSON.stringify(command)});assert.equal(created.status,201);const value=await created.json();assert.equal(value.verified,true);assert.equal(value.configuration.clientId,'https://lifeos.nirvanachow.com/oauth/clients/chatgpt');assert.equal(value.configuration.callback,command.callback);assert.equal(created.headers.get('set-cookie'),null);assert.match(created.headers.get('cache-control')??'',/no-store/);
  assert.deepEqual(Object.keys(value.configuration).sort(),['authorizationEndpoint','callback','clientId','codeChallengeMethod','commandId','registered','resource','scopes','tokenEndpoint','tokenEndpointAuthMethod'].sort());
  const readback=await fetch(url,{headers});assert.equal(readback.status,200);assert.deepEqual((await readback.json()).configuration,value.configuration);
  const duplicate=await fetch(url,{method:'POST',headers,body:JSON.stringify(command)});assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);assert.equal(f.db.platform_oauth_client.length,1);assert.ok(checks>=8);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('HTTP rejects API/OAuth bearer anonymous incomplete MFA foreign origin and arbitrary client parameters before any registration',async()=>{
 const f=await managedClientFixture(),command={callback:managedFixtureCallback,commandId:randomUUID()};
 const handler=createManagedClientHandler({auth:f.auth,platform:f.config,config:f.oauth,owner:h=>readVerifiedOwnerSession(f.auth,f.config,h),assertReady:async()=>{},withOwnerLock:async run=>run()});
 const request=(headers:Record<string,string>,body:unknown=command)=>handler(new Request(f.config.baseURL+path,{method:'POST',headers:{host:'lifeos.nirvanachow.com',origin:f.config.baseURL,'content-type':'application/json',...headers},body:JSON.stringify(body)}));
 assert.equal((await request({})).status,401);
 for(const bearer of ['x'.repeat(64),'eyJhbGciOiJSUzI1NiJ9.e30.signature'])assert.equal((await request({authorization:'Bearer '+bearer,cookie:f.cookie})).status,401);
 assert.equal((await request({cookie:f.cookie,origin:'https://other.example'})).status,403);
 assert.equal((await request({cookie:f.cookie},{...command,scopes:['todo:write']})).status,400);
 assert.equal((await request({cookie:f.cookie},{...command,callback:'https://127.0.0.1/connector/oauth/fixtureCallback1'})).status,400);
 for(const row of f.db.platform_session)row.mfaVerified=false;assert.equal((await request({cookie:f.cookie})).status,401);
 assert.equal(f.db.platform_oauth_client.length,0);
});

test('MFA loss inside the existing owner lock is observed before SDK persistence',async()=>{
 const f=await managedClientFixture(),handler=createManagedClientHandler({auth:f.auth,platform:f.config,config:f.oauth,owner:h=>readVerifiedOwnerSession(f.auth,f.config,h),assertReady:async()=>{},withOwnerLock:async run=>{for(const row of f.db.platform_two_factor)row.verified=false;return run();}});
 const response=await handler(new Request(f.config.baseURL+path,{method:'POST',headers:{host:'lifeos.nirvanachow.com',origin:f.config.baseURL,'content-type':'application/json',cookie:f.cookie},body:JSON.stringify({callback:managedFixtureCallback,commandId:randomUUID()})}));
 assert.equal(response.status,401);assert.equal(f.db.platform_oauth_client.length,0);
});

test('busy owner maintenance and current readiness failure cannot reach official client persistence',async()=>{
 for(const busy of [false,true]){
  const f=await managedClientFixture(),handler=createManagedClientHandler({auth:f.auth,platform:f.config,config:f.oauth,owner:h=>readVerifiedOwnerSession(f.auth,f.config,h),assertReady:async()=>{if(!busy)throw Error('Synthetic readiness denied');},withOwnerLock:async run=>{if(busy)throw new OwnerRecoveryBusy();return run();}});
  const response=await handler(new Request(f.config.baseURL+path,{method:'POST',headers:{host:'lifeos.nirvanachow.com',origin:f.config.baseURL,'content-type':'application/json',cookie:f.cookie},body:JSON.stringify({callback:managedFixtureCallback,commandId:randomUUID()})}));
  assert.equal(response.status,busy?409:503);assert.equal(f.db.platform_oauth_client.length,0);assert.deepEqual(Object.keys(await response.json()),['error']);
 }
});

test('JSON and exact-route boundaries and a different native owner reject without creating a client',async()=>{
 const f=await managedClientFixture(),handler=createManagedClientHandler({auth:f.auth,platform:f.config,config:f.oauth,owner:h=>readVerifiedOwnerSession(f.auth,f.config,h),assertReady:async()=>{},withOwnerLock:async run=>run()});
 const headers={host:'lifeos.nirvanachow.com',origin:f.config.baseURL,cookie:f.cookie,'content-type':'application/json'},body=JSON.stringify({callback:managedFixtureCallback,commandId:randomUUID()});
 for(const [url,method,h,payload,status] of [[path+'?client_id=other','POST',headers,body,404],[path,'DELETE',headers,body,405],[path,'POST',{...headers,'content-type':'text/plain'},body,415],[path,'POST',headers,'{',400]] as const){const response=await handler(new Request(f.config.baseURL+url,{method,headers:h,body:payload}));assert.equal(response.status,status);}
 f.db.platform_user[0].email='other-owner@example.invalid';assert.equal((await handler(new Request(f.config.baseURL+path,{method:'POST',headers,body}))).status,401);assert.equal(f.db.platform_oauth_client.length,0);
});
