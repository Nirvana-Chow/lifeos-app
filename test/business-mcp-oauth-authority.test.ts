import assert from 'node:assert/strict';
import test from 'node:test';
import {AuthorityService} from '../src/agent-authority/service.ts';
import {assertAgentGrant} from '../src/agent-api/grant-fence.ts';
import {assertAgentTodoWriteGrant} from '../src/agent-api/grant-fence.ts';
import {PostgresPlatformRepository} from '../src/platform/postgres.ts';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {MemoryPort} from './helpers/platform.ts';
import {intersectOAuthGrant} from '../src/business-mcp-oauth/ledger.ts';

const oauthFence=Object.freeze({tokenId:'token-001',bindingId:'binding-001',bindingRevision:1,expiresAt:2000000000});
const grant={grantId:'grant',ownerId:'owner',spaceId:'space',scopes:['todo:read','todo:write','requirements:read','requirements:write'] as const,allowedOperationIds:['snapshotTodos','createTodo'],oauthFence};

test('OAuth actors preserve their token fence and current reader cannot fall back to a plain API key grant',async()=>{
 let current:unknown=grant;let seen:unknown;
 const authority=new AuthorityService({ownerId:'owner',spaceId:'space',verifyOwner:async()=>null,verifyAgent:async()=>grant,
  readCurrentAgent:async(_id,fence)=>{seen=fence;return current as typeof grant;}});
 const actor=await authority.resolveAgentActor('signed.jwt.token');assert.ok(actor);
 assert.deepEqual(actor.oauthFence,oauthFence);
 await authority.assertCurrentAuthority(actor,'snapshotTodos');assert.deepEqual(seen,oauthFence);
 current={...grant,oauthFence:undefined};
 await assert.rejects(authority.assertCurrentAuthority(actor,'snapshotTodos'));
});

test('OAuth operation allowlist applies to an explicit grant with engineering-overlapping scopes',async()=>{
 const authority=new AuthorityService({ownerId:'owner',spaceId:'space',verifyOwner:async()=>null,verifyAgent:async()=>grant,readCurrentAgent:async()=>grant});
 const actor=await authority.resolveAgentActor('signed.jwt.token');assert.ok(actor);
 await assert.rejects(authority.assertCurrentAuthority(actor,'claimRequirementExecution'));
 await assert.rejects(authority.assertCurrentAuthority(actor,'updateRequirementExecution'));
});

test('OAuth grant fence reaches the transaction and cannot use the legacy todo fence',async()=>{
 let received:unknown;
 const tx={lockAgentGrant:async(binding:unknown)=>{received=binding;return true;}} as unknown as import('../src/platform/contracts.ts').Transaction;
 await assertAgentGrant(tx,grant,['todo:read','todo:write'],'createTodo');
 assert.deepEqual((received as typeof grant).oauthFence,oauthFence);
 assert.equal((received as {operationId?:string}).operationId,'createTodo');
});

test('OAuth fence is checked on the held business connection before the original grant and denies without business writes',async()=>{
 const calls:string[]=[];
 const pool={connect:async()=>({query:async(sql:string)=>{calls.push(sql);return{rows:[{allowed:!sql.includes('assert_oauth_business_grant')}],rowCount:1};},release(){}})};
 const repository=new PostgresPlatformRepository(pool,false,true,{organization:true,classification:false,businessDataPolicy:true});
 await assert.rejects(repository.transaction('owner','command',async tx=>assertAgentGrant(tx,grant,['todo:read','todo:write'],'createTodo')),{code:'WRITE_GRANT_REVOKED'});
 assert.ok(calls.some(sql=>sql.includes('assert_oauth_business_grant')));
 assert.equal(calls.some(sql=>sql.includes('assert_current_business_grant')),false);
 assert.equal(calls.at(-1),'ROLLBACK');
});

test('an OAuth read revoked during the native todo read never returns business data',async()=>{
 let active=true;const repository=new MemoryPort();repository.readWindow=async()=>{active=false;return[];};
 const oauth={...grant,allowedOperationIds:['listTodos']};
 const handler=createAgentHandler({enabled:true,config:{ownerId:'owner',spaceId:'space',ownerEmail:'fixture@example.invalid',baseURL:'http://127.0.0.1:3190',databaseName:'fixture',approval:'personal-manual-v1',allowedTypes:['todo']},repository,verify:async()=>oauth,readCurrentGrant:async()=>active?oauth:null,operationAvailable:()=>true,assertWritable:async()=>{}});
 const result=await handler(new Request('http://127.0.0.1:3190/v1/todos',{headers:{host:'127.0.0.1:3190',authorization:'Bearer signed.jwt.token'}}));
 assert.equal(result.status,403);assert.equal('items'in await result.json(),false);
});

test('direct OAuth classification preview is denied before the plan writer while the native API key entry stays available',async()=>{
 const native={grantId:'grant',ownerId:'owner',spaceId:'space',scopes:['todo:read','organization:read'] as const};
 const oauth=intersectOAuthGrant({...native,oauthFence},native);assert.ok(oauth);let plans=0;
 const handler=createAgentHandler({enabled:true,fenceWrites:true,modules:{organization:true,classification:true},config:{ownerId:'owner',spaceId:'space',ownerEmail:'fixture@example.invalid',baseURL:'http://127.0.0.1:3190',databaseName:'fixture',approval:'personal-manual-v1',allowedTypes:['todo','project','domain','topic']},repository:new MemoryPort(),verify:async key=>key.includes('.')?oauth:native,readCurrentGrant:async(_id,fence)=>fence?oauth:native,operationAvailable:()=>true,assertWritable:async()=>{},classification:()=>({preview:async()=>{plans++;return{planId:'synthetic-native-plan'};}} as unknown as import('../src/personal-candidate/classification-service.ts').ClassificationService)});
 const send=(key:string)=>handler(new Request('http://127.0.0.1:3190/v1/todo-classifications/preview',{method:'POST',headers:{host:'127.0.0.1:3190',authorization:'Bearer '+key,'content-type':'application/json'},body:'{}'}));
 assert.equal((await send('signed.jwt.token')).status,403);assert.equal(plans,0);
 assert.equal((await send('original-key')).status,200);assert.equal(plans,1);
});

test('todo-only OAuth uses the new same-connection fence while native todo keys retain their legacy SQL path',async()=>{
 const calls:string[]=[];const pool={connect:async()=>({query:async(sql:string)=>{calls.push(sql);return{rows:[{allowed:true}],rowCount:1};},release(){}})};
 const repo=new PostgresPlatformRepository(pool,false,true,{organization:false,classification:false});
 await repo.transaction('owner','oauth-command',tx=>assertAgentTodoWriteGrant(tx,grant,'createTodo'));
 assert.ok(calls.some(sql=>sql.includes('assert_oauth_business_grant')));
 calls.length=0;
 await repo.transaction('owner','native-command',tx=>assertAgentTodoWriteGrant(tx,{grantId:'grant',ownerId:'owner',spaceId:'space'},'createTodo'));
 assert.ok(calls.some(sql=>sql.includes('assert_todo_write_grant')));assert.equal(calls.some(sql=>sql.includes('oauth_business')),false);
});
