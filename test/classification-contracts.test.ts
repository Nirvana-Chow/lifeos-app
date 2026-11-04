import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeChanges,decodePlan,decodeApproval,decodeReceipt,classificationNoOp,classificationPlanDigest,classificationBindingsDigest,assertApprovalMatchesPlan} from '../src/personal-candidate/classification-contracts.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${n.toString().padStart(12,'0')}`;
const empty={project:null,domain:null,topics:[]};
const change={todo:{id:id(1),sourceId:id(2),expectedRevision:1},before:null,after:empty};
function plan(){const value={schemaVersion:1 as const,proposalRevision:1 as const,ownerId:'fixture-owner',spaceId:'fixture-space',grantId:null,producerAuthorizationRevision:null,policyRevision:'policy-v1',createdAt:'2026-11-05T00:00:00.000Z',preview:{planId:id(3),digest:'a'.repeat(64),expiresAt:'2026-11-05T00:30:00.000Z',changes:[change],unchangedIds:[id(1)]}};value.preview.digest=classificationPlanDigest(value);return value;}
test('classification changes reject omitted and arbitrary business fields, invalid sources/revisions and duplicate physical todos',()=>{
 assert.deepEqual(decodeChanges([change]),[change]);
 for(const value of [[],Array.from({length:101},(_,i)=>({...change,todo:{...change.todo,id:id(i+100)}})),[change,change],
  [{...change,before:{project:null}}],[{...change,after:{...empty,notes:'secret'}}],[{...change,title:'text'}],
  [{...change,todo:{...change.todo,sourceId:'bad'}}],[{...change,todo:{...change.todo,expectedRevision:0}}],
  [{...change,todo:{...change.todo,expectedRevision:2147483648}}],[{...change,after:{...empty,topics:Array.from({length:21},(_,i)=>({id:id(i+100),sourceId:id(i+200),revision:1}))}}],
  [{...change,after:{...empty,topics:[{id:id(4),sourceId:id(5),revision:1},{id:id(4),sourceId:id(5),revision:1}]}}]])assert.throws(()=>decodeChanges(value));
 assert.equal(decodeChanges(Array.from({length:100},(_,i)=>({...change,todo:{...change.todo,id:id(i+100)}}))).length,100);
});
test('no-op preserves null versus complete empty relations and compares source, revision and topic order',()=>{
 assert.equal(classificationNoOp(null,empty),true);assert.equal(classificationNoOp(empty,empty),true);
 const ref={id:id(4),sourceId:id(5),revision:1};assert.equal(classificationNoOp(null,{...empty,project:ref}),false);
 assert.equal(classificationNoOp({...empty,project:ref},{...empty,project:{...ref,revision:2}}),false);
 assert.equal(classificationNoOp({...empty,topics:[ref,{...ref,id:id(6)}]},{...empty,topics:[{...ref,id:id(6)},ref]}),false);
});
test('plan strict decoding binds the digest, lifetime, producer and unchanged IDs',()=>{
 const good=plan();assert.deepEqual(decodePlan(good),good);
 for(const bad of [{...good,title:'private'},{...good,schemaVersion:2},{...good,proposalRevision:2},{...good,policyRevision:'other'},
  {...good,grantId:'grant'}, {...good,producerAuthorizationRevision:'revision'},
  {...good,preview:{...good.preview,expiresAt:'2026-11-05T00:30:00.001Z'}},
  {...good,preview:{...good.preview,unchangedIds:[id(7)]}},{...good,preview:{...good.preview,extra:true}}])assert.throws(()=>decodePlan(bad));
});
test('approval must bind the exact plan, revisions, operation and bounded time',()=>{
 const p=plan();const good={planId:p.preview.planId,proposalRevision:1 as const,digest:p.preview.digest,operationIds:['commitTodoClassification'] as const,bindingsDigest:classificationBindingsDigest(p),producerAuthorizationRevision:null,policyRevision:p.policyRevision,approvedAt:'2026-11-05T00:01:00.000Z',expiresAt:p.preview.expiresAt};
 assert.deepEqual(decodeApproval(good),good);assert.doesNotThrow(()=>assertApprovalMatchesPlan(good,p));
 for(const patch of [{planId:id(8)},{proposalRevision:2},{digest:'b'.repeat(64)},{operationIds:['previewTodoClassification']},{bindingsDigest:'c'.repeat(64)},{policyRevision:'other'},{producerAuthorizationRevision:'other'},{expiresAt:'2026-11-05T00:29:00.000Z'},{approvedAt:'2026-11-05T00:31:00.000Z'},{extra:1}])assert.throws(()=>assertApprovalMatchesPlan({...good,...patch} as never,p));
});
test('batch receipt cannot decode arbitrary responses, duplicate entries or inconsistent plan identity',()=>{
 const p=plan();const good={requestDigest:'d'.repeat(64),planId:p.preview.planId,result:{planId:p.preview.planId,digest:p.preview.digest,duplicate:false,entries:[{id:id(1),sourceId:id(2),revision:1,personal:null}],unchangedIds:[id(1)]}};
 assert.deepEqual(decodeReceipt(good),good);
 for(const bad of [{...good,extra:1},{...good,result:{...good.result,entry:{title:'secret'}}},{...good,result:{...good.result,planId:id(9)}},{...good,result:{...good.result,entries:[...good.result.entries,...good.result.entries]}},{...good,result:{...good.result,entries:[{...good.result.entries[0],title:'secret'}]}}])assert.throws(()=>decodeReceipt(bad));
});

test('bounded plans reject oversized controlled references and receipts reject changed plan bindings',async()=>{
 const p=plan();const value={...p,preview:{...p.preview,changes:Array.from({length:100},(_,i)=>({...change,todo:{...change.todo,id:id(i+100)},before:{...empty,topics:Array.from({length:20},(_,j)=>({id:id(j+1000),sourceId:id(j+2000),revision:2147483647}))},after:{...empty,topics:Array.from({length:20},(_,j)=>({id:id(j+1000),sourceId:id(j+2000),revision:2147483646}))}})),unchangedIds:[]}};
 assert.throws(()=>decodeChanges(value.preview.changes));
 const {assertReceiptMatchesPlan}=await import('../src/personal-candidate/classification-postgres.ts');
 const receipt={requestDigest:'d'.repeat(64),planId:p.preview.planId,result:{planId:p.preview.planId,digest:p.preview.digest,duplicate:false,entries:[{id:id(1),sourceId:id(2),revision:1,personal:null}],unchangedIds:[id(1)]}};
 assert.doesNotThrow(()=>assertReceiptMatchesPlan(receipt,p));
 for(const patch of [{sourceId:id(3)},{revision:2},{personal:empty}])assert.throws(()=>assertReceiptMatchesPlan({...receipt,result:{...receipt.result,entries:[{...receipt.result.entries[0],...patch}]}},p));
});
test('synthetic classification transaction rolls back a new plan and legacy receipt together',async()=>{
 const {ClassificationMemoryPort}=await import('./helpers/classification-memory.ts');const port=new ClassificationMemoryPort(),p=plan();
 await assert.rejects(port.classificationTransaction(p.ownerId,p.spaceId,'classify-1',async tx=>{await tx.saveClassificationPlan(p);assert.ok(await tx.getClassificationPlan(p.preview.planId));await tx.saveReceipt({digest:'legacy',result:{entry:{} as never,duplicate:false}});throw Error('fixture-failure');}),/fixture-failure/);
 assert.equal(port.plans.size,0);assert.equal(port.receipts.size,0);assert.equal(port.historyRows.length,0);
 await port.classificationTransaction(p.ownerId,p.spaceId,'classify-2',async tx=>tx.saveClassificationPlan(p));assert.equal(port.plans.size,1);
});
