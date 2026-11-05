import assert from 'node:assert/strict';
import test from 'node:test';
import {assertAgentTodoWriteGrant} from '../src/agent-api/grant-fence.ts';
import {PostgresPlatformRepository,type SqlPool} from '../src/platform/postgres.ts';

test('policy-enabled repositories bind every fence to expected policy, including old actors',async()=>{
 const calls:{sql:string;values?:unknown[]}[]=[];
 const pool={connect:async()=>({query:async(sql:string,values?:unknown[])=>{calls.push({sql,values});return{rows:[{allowed:true}],rowCount:1};},release(){}})} as SqlPool;
 const repository=new PostgresPlatformRepository(pool,false,true,{organization:false,classification:false,businessDataPolicy:true});
 for(const policy of [undefined,'all-personal-business-v1'] as const){
  await repository.transaction('owner','command',async tx=>{
   assert.ok(tx.lockAgentGrant);await assertAgentTodoWriteGrant(tx,{grantId:'grant',ownerId:'owner',spaceId:'space',...(policy?{businessDataPolicy:policy}:{})},'createTodo');
  });
 }
 const fences=calls.filter(call=>call.sql.includes('assert_current_business_grant'));
 assert.equal(fences.length,2);
 assert.deepEqual(fences.map(call=>call.values?.[4]),[null,'all-personal-business-v1']);
 assert.deepEqual(fences.map(call=>call.values?.[5]),[null,'createTodo']);
 assert.deepEqual(fences.map(call=>call.values?.[3]),[['todo:read','todo:write'],['todo:write']]);
});

test('server policy claim requires the exact registered operation and complete scope array before entering its SQL fence',async()=>{
 const {assertAgentGrant}=await import('../src/agent-api/grant-fence.ts');
 const grant={grantId:'grant',ownerId:'owner',spaceId:'space',businessDataPolicy:'all-personal-business-v1'} as const;
 let calls=0;
 const tx={lockAgentGrant:async()=>{calls++;return true;}} as unknown as import('../src/platform/contracts.ts').Transaction;
 for(const operationId of [undefined,'unknownOperation'])await assert.rejects(assertAgentGrant(tx,grant,['todo:read','todo:write'],operationId),{code:'GRANT_OPERATION_INVALID'});
 await assert.rejects(assertAgentGrant(tx,grant,['todo:read'],'createTodo'),{code:'GRANT_OPERATION_INVALID'});
 assert.equal(calls,0);await assertAgentGrant(tx,grant,['todo:read','todo:write'],'createTodo');assert.equal(calls,1);
});
