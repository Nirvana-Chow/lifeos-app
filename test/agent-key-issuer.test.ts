import assert from 'node:assert/strict';
import test from 'node:test';
import {createHmac} from 'node:crypto';
import {createKeyIssuer, readSignedOwnerSession} from '../src/agent-api/key-issuer.ts';

const now = Date.parse('2026-01-02T00:00:00Z');
const limit = now + 365 * 86400 * 1000;
const cookie = 'owner-session';
const item = {id: 'fixture-grant', name: 'Smoke', scopes: ['todo:read'] as const,
  createdAt: new Date(now).toISOString(), expiresAt: new Date(limit).toISOString(), status: 'active' as const};
const pageCursor = '2026-01-02T00:00:00.000000Z~fixture-grant';
function harness() {
  const calls: unknown[] = [];
  const handle = createKeyIssuer({
    authenticate: async value => value === cookie,
    list: async cursor => cursor ? {keys: [{...item, key: 'never-in-list'}]} : {keys: [], nextCursor: pageCursor},
    issue: async input => {calls.push(input); return {grant: item, key: 'only-visible-on-issue'};},
    revoke: async id => {calls.push(id);return id === item.id;},
  }, () => now);
  return {calls, handle};
}

test('private issuer authenticates independently and strictly caps expiry', async () => {
  const {calls,handle} = harness();
  const body = {name:'Smoke',scopes:['todo:read'],expiresAt:new Date(limit).toISOString()};
  assert.equal((await handle('create','other-session',body)).status,401);
  for (const expiresAt of [null,new Date(now).toISOString(),new Date(limit+1).toISOString(),'2026-07-01T12:00:00']) {
    assert.equal((await handle('create',cookie,{...body,expiresAt})).status,400);
  }
  assert.equal((await handle('create',cookie,{...body,scopes:['todo:write']})).status,400);
  assert.equal((await handle('create',cookie,{...body,ownerId:'spoof'})).status,400);
  assert.deepEqual(calls,[]);
  const created = await handle('create',cookie,body);
  assert.equal(created.status,201);
  assert.deepEqual(created.body,{grant:item,key:'only-visible-on-issue'});
  const preset={name:'Smoke',scopes:['todo:read'],expiresInDays:365};
  assert.equal((await handle('create',cookie,preset)).status,201);
  assert.equal((await handle('create',cookie,{...preset,expiresInDays:366})).status,400);
  assert.equal((await handle('create',cookie,{...preset,expiresAt:body.expiresAt})).status,400);
  assert.deepEqual(calls,[{name:'Smoke',scopes:['todo:read'],expiresIn:365*86400},{name:'Smoke',scopes:['todo:read'],expiresIn:365*86400}]);
});

test('private issuer projects safe metadata and revokes by opaque grant identifier', async () => {
  const {calls,handle}=harness();
  assert.deepEqual(await handle('list',cookie,{}),{status:200,body:{keys:[],nextCursor:pageCursor}});
  assert.deepEqual(await handle('list',cookie,{cursor:pageCursor}),{status:200,body:{keys:[item]}});
  assert.equal((await handle('list',cookie,{cursor:'invalid'})).status,400);
  assert.equal((await handle('revoke',cookie,{id:item.id,spaceId:'spoof'})).status,400);
  assert.equal((await handle('revoke',cookie,{id:'foreign-grant'})).status,404);
  assert.equal((await handle('revoke',cookie,{id:item.id})).status,204);
  assert.deepEqual(calls,['foreign-grant',item.id]);
});

test('session cookie authentication rejects tampering, duplicate values and insecure aliases', async () => {
  const secret='fixture-better-auth-secret-never-live-123';
  const token='SyntheticOwnerToken12345678901234567890';
  const signature=createHmac('sha256',secret).update(token).digest('base64');
  const name='__Secure-lifeos-platform-candidate.session_token';
  const pair=name+'='+encodeURIComponent(token+'.'+signature);
  assert.equal(await readSignedOwnerSession(pair,secret),token);
  assert.equal(await readSignedOwnerSession(pair.replace(token,token+'x'),secret),null);
  assert.equal(await readSignedOwnerSession(pair+'; '+pair,secret),null);
  assert.equal(await readSignedOwnerSession(pair.replace('__Secure-',''),secret),null);
});

test('business issuer validates explicit scope CAS and exposes safe grant digest only when enabled', async()=>{
  const calls: unknown[]=[];
  const grant={...item,grantDigest:'a'.repeat(64)};
  const deps={authenticate:async(value:string)=>value===cookie,list:async()=>({keys:[grant]}),
    issue:async()=>({grant,key:'synthetic-only'}),revoke:async()=>true,
    setScopes:async(input:unknown,session:string)=>{calls.push({input,session});return grant;}};
  const enabled=createKeyIssuer(deps,()=>now,'organization-v1');
  const input={id:item.id,expectedGrantDigest:'a'.repeat(64),scopes:['organization:read']};
  assert.deepEqual(await enabled('setScopes',cookie,input),{status:200,body:{grant}});
  assert.deepEqual(calls,[{input,session:cookie}]);
  const list=(await enabled('list',cookie,{})).body;
  assert.deepEqual(list,{keys:[grant],availableScopes:['todo:read','todo:write','organization:read','organization:write']});
  for(const body of [{...input,ownerId:'spoof'},{...input,key:'spoof'},{...input,expectedGrantDigest:'bad'},
    {...input,scopes:[]},{...input,scopes:['organization:write']},{...input,scopes:['unknown:read']}])
    assert.equal((await enabled('setScopes',cookie,body)).status,400);
  assert.equal((await enabled('setScopes','invalid',input)).status,401);
  assert.equal((await createKeyIssuer(deps,()=>now)('setScopes',cookie,input)).status,503);
  assert.equal((await enabled('create',cookie,{name:'organization',scopes:['organization:read'],expiresInDays:7})).status,201);
});

test('all-data policy is explicit, default closed and included in same-key CAS without changing legacy requests',async()=>{
 const calls:unknown[]=[];
 let enabled=false;
 const policy='all-personal-business-v1' as const;
 const handle=createKeyIssuer({authenticate:async()=>true,list:async()=>({keys:[item]}),revoke:async()=>false,
  businessPolicyAvailable:async()=>enabled,
  issue:async input=>{calls.push(input);return{grant:{...item,...(input.businessDataPolicy?{businessDataPolicy:input.businessDataPolicy}:{})},key:'synthetic-once'};},
  setScopes:async input=>{calls.push(input);return{...item,grantDigest:'b'.repeat(64),...(input.businessDataPolicy?{businessDataPolicy:input.businessDataPolicy}:{})};}},()=>now,'requirements-v1');
 const body={name:'all business',scopes:['todo:read'],expiresInDays:30,businessDataPolicy:policy};
 assert.equal((await handle('create',cookie,body)).status,503);
 enabled=true;
 const page=await handle('list',cookie,{});assert.deepEqual((page.body as {availablePolicies:unknown}).availablePolicies,[policy]);
 assert.equal((await handle('create',cookie,body)).status,201);
 assert.deepEqual(calls[0],{name:'all business',scopes:['todo:read'],expiresIn:30*86400,businessDataPolicy:policy});
 const change={id:item.id,expectedGrantDigest:'a'.repeat(64),scopes:['todo:read'],businessDataPolicy:policy};
 assert.equal((await handle('setScopes',cookie,change)).status,200);assert.deepEqual(calls[1],change);
 assert.equal((await handle('setScopes',cookie,{...change,businessDataPolicy:null})).status,200);
 assert.equal((await handle('create',cookie,{...body,businessDataPolicy:'*'})).status,400);
});
