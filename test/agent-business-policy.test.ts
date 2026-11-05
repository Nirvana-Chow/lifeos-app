import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveBusinessPolicyGrant, allPersonalBusinessPolicy} from '../src/agent-api/business-policy.ts';

const now=Date.parse('2026-11-05T00:00:00Z');
const grant={id:'grant',referenceId:'owner',metadata:{spaceId:'space'},permissions:{todo:['read']},enabled:true,expiresAt:new Date(now+60000).toISOString()};
const operation=(id:string,scopes:readonly string[],policyClass='personal-business-data')=>({id,requiredScopes:scopes,policyClass});
const registry=[operation('readTodo',['todo:read']),operation('writeTodo',['todo:read','todo:write']),operation('readJournal',['journal:read']),operation('writeJournal',['journal:read','journal:write'])];
const options={ownerId:'owner',spaceId:'space',now,policyEnabled:true,registry,operationAvailable:(id:string)=>id!=='writeJournal'};
const all={...grant,metadata:{...grant.metadata,businessDataPolicy:allPersonalBusinessPolicy}};

test('legacy readonly grants retain only their exact permissions with an enabled policy runtime',()=>{
 assert.deepEqual(resolveBusinessPolicyGrant(grant,options)?.scopes,['todo:read']);
 assert.equal(resolveBusinessPolicyGrant({...grant,permissions:{todo:['write']}},options),null);
});
test('explicit policy derives scopes only from reviewed available business operations, including future registration',()=>{
 assert.deepEqual(resolveBusinessPolicyGrant(all,options)?.scopes,['todo:read','todo:write','journal:read']);
 const next={...options,registry:[...registry,operation('writeFood',['food:read','food:write'])]};
 assert.deepEqual(resolveBusinessPolicyGrant(all,next)?.scopes,['todo:read','todo:write','journal:read','food:read','food:write']);
 assert.deepEqual(resolveBusinessPolicyGrant(all,{...next,operationAvailable:()=>false})?.scopes,[]);
});
test('only the two legacy todo write operations close advertised single-write scopes to read/write authorization',()=>{
 const legacy=[operation('createTodo',['todo:write']),operation('updateTodo',['todo:write'])];
 const row={...all,permissions:{organization:['read']}};
 assert.deepEqual(resolveBusinessPolicyGrant(row,{...options,registry:legacy})?.scopes,['todo:read','todo:write']);
 assert.deepEqual(resolveBusinessPolicyGrant(row,{...options,registry:[operation('futureTodoWrite',['todo:write'])]})?.scopes,[]);
});
test('policy does not cover security, keys, settings, payment/order or irreversible operations',()=>{
 const forbidden=['account:read','security:read','keys:read','settings:read','payment:read','order:read'];
 const registry=[...forbidden.map((scope,i)=>operation('protected'+i,[scope])),operation('erase',['todo:read','todo:write'],'irreversible'),operation('unknown',['mystery:admin'])];
 assert.deepEqual(resolveBusinessPolicyGrant(all,{...options,registry})?.scopes,[]);
 assert.deepEqual(resolveBusinessPolicyGrant(all,{...options,registry:[operation('bad',['todo:write'])]})?.scopes,[]);
});
test('closed policy, malformed policy, identity mismatch, expiry and revocation deny rather than use fallback permissions',()=>{
 assert.equal(resolveBusinessPolicyGrant(all,{...options,policyEnabled:false}),null);
 for(const change of [{referenceId:'foreign'},{metadata:{spaceId:'foreign',businessDataPolicy:allPersonalBusinessPolicy}},{metadata:{...all.metadata,businessDataPolicy:'*'}},{enabled:false},{expiresAt:new Date(now).toISOString()},{expiresAt:null},{expiresAt:'invalid'}])assert.equal(resolveBusinessPolicyGrant({...all,...change},options),null);
 assert.equal(resolveBusinessPolicyGrant(all,{...options,now:Number.NaN}),null);
});

test('an all-policy actor loses authority when policy is removed even if effective scopes are unchanged',async()=>{
 const {AuthorityService}=await import('../src/agent-authority/service.ts');
 let current:{ownerId:string;spaceId:string;grantId:string;scopes:readonly ['todo:read'];businessDataPolicy?:typeof allPersonalBusinessPolicy;allowedOperationIds?:readonly string[]}={ownerId:'owner',spaceId:'space',grantId:'grant',scopes:['todo:read'],businessDataPolicy:allPersonalBusinessPolicy,allowedOperationIds:['getTodo']};
 const authority=new AuthorityService({ownerId:'owner',spaceId:'space',verifyOwner:async()=>null,verifyAgent:async()=>current,readCurrentAgent:async()=>current});
 const actor=await authority.resolveAgentActor('synthetic');assert.ok(actor);await authority.assertCurrentAuthority(actor,'getTodo');
 await assert.rejects(authority.assertCurrentAuthority(actor,'listTodos'));
 current={ownerId:'owner',spaceId:'space',grantId:'grant',scopes:['todo:read']};await assert.rejects(authority.assertCurrentAuthority(actor,'getTodo'));
});
