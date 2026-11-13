import assert from 'node:assert/strict';
import test from 'node:test';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {createAgentHandler} from '../src/agent-api/http.ts';
import type {Transaction} from '../src/platform/contracts.ts';
import {MemoryPort} from './helpers/platform.ts';

const baseURL='https://native-mutation-guard.example.invalid';
const config={ownerId:'synthetic-final-guard-owner',ownerEmail:'guard@example.invalid',
 spaceId:'synthetic-final-guard-space',databaseName:'fixture',baseURL,
 approval:'personal-manual-v1',allowedTypes:['todo','journal'],cookingEnabled:true} as const;
const owner={userId:config.ownerId,email:config.ownerEmail};
const foreign={userId:'synthetic-other-owner',email:'other@example.invalid'};
const cookingFields={title:'synthetic-private-cooking-note',text:'private synthetic notes',
 occurredOn:'2030-02-28',personal:{type:'cooking',schemaVersion:1,recipe:null}};

for(const type of ['cooking','journal','todo'] as const){
 test(`native ${type} withholds mutation contents after owner loss and preserves original-key recovery`,async t=>{
  for(const stage of ['duplicate-receipt','committed-new-write'] as const){
   for(const loss of ['expired','foreign-owner'] as const){
    await t.test(`${stage} / ${loss}`,async()=>{
     const repository=new MemoryPort();
     let actor:{userId:string;email:string}|null=owner;
     const handler=createPersonalPlatformHandler({repository,config,storageVerified:true,
      sessions:{read:async()=>actor},assertWritable:async()=>{}});
     const fields=type==='cooking'?cookingFields:type==='journal'
      ?{title:'synthetic-private-journal-note',text:'private synthetic journal',occurredOn:null}
      :{title:'synthetic-private-todo-note',notes:'private synthetic todo',dueOn:null,status:'open'};
     const body={spaceId:config.spaceId,confirmed:true,fields};
     const originalKey=`synthetic-native-${type}-${stage}-${loss}`;
     const send=()=>handler(new Request(baseURL+'/api/platform/personal/'+type,{method:'POST',
      headers:{host:new URL(baseURL).host,origin:baseURL,'content-type':'application/json','idempotency-key':originalKey},
      body:JSON.stringify(body)}));
     if(stage==='duplicate-receipt')assert.equal((await send()).status,201);
     const transact=repository.transaction.bind(repository);
     const lose=()=>{actor=loss==='expired'?null:foreign;};
     repository.transaction=async <T>(ownerId:string,key:string,run:(tx:Transaction)=>Promise<T>)=>{
      if(stage==='duplicate-receipt')return transact(ownerId,key,tx=>run({...tx,
       receipt:async()=>{const receipt=await tx.receipt();assert.ok(receipt);lose();return receipt;}}));
      const result=await transact(ownerId,key,run);
      lose(); // transaction has resolved: this committed write must not be rolled back.
      return result;
     };
     const denied=await send(),denial=await denied.json();
     assert.equal(denied.status,loss==='expired'?401:403);
     assert.equal(denial.error.code,loss==='expired'?'LOGIN_REQUIRED':'ACCOUNT_NOT_ALLOWED');
     assert.equal(Object.hasOwn(denial,'entry'),false);
     assert.equal(JSON.stringify(denial).includes(fields.title),false);
     assert.equal(repository.rows.size,1);
     assert.equal(repository.historyRows.length,1);
     assert.equal(repository.receipts.size,1);
     assert.equal(repository.events.length,1);
     const persisted=[...repository.rows.values()][0]!;
     const receiptBefore=structuredClone([...repository.receipts.values()][0]);

     actor=owner;repository.transaction=transact;
     const replay=await send(),recovered=await replay.json();
     assert.equal(replay.status,200);assert.equal(recovered.duplicate,true);
     assert.equal(recovered.entry.id,persisted.id);
     assert.equal(recovered.entry.source.id,persisted.source.id);
     assert.equal(recovered.entry.revision,1);
     const read=await handler(new Request(baseURL+'/api/platform/personal/'+type+'/'+persisted.id,
      {headers:{host:new URL(baseURL).host}}));
     assert.equal(read.status,200);assert.deepEqual((await read.json()).entry,recovered.entry);
     assert.equal(repository.rows.size,1);assert.equal(repository.historyRows.length,1);
     assert.equal(repository.receipts.size,1);assert.equal(repository.events.length,1);
     assert.deepEqual([...repository.receipts.values()][0],receiptBefore);
    });
   }
  }
 });
}

test('Agent cooking receipt replay retains its existing transaction grant fence after revocation',async()=>{
 const repository=new MemoryPort();let grantActive=true;
 const operations=['snapshotCooking','getCooking','createCooking','updateCooking'];
 const grant={grantId:'synthetic-agent-final-guard',ownerId:config.ownerId,spaceId:config.spaceId,
  scopes:['cooking:read','cooking:write'] as const,businessDataPolicy:'all-personal-business-v1' as const,allowedOperationIds:operations};
 const transact=repository.transaction.bind(repository);
 let revokeOnReceipt=false;
 repository.transaction=(ownerId,key,run)=>transact(ownerId,key,tx=>run({...tx,
  lockAgentGrant:async()=>grantActive,
  receipt:async()=>{const receipt=await tx.receipt();if(revokeOnReceipt)grantActive=false;return receipt;}}));
 const handler=createAgentHandler({enabled:true,config,repository,fenceWrites:true,
  modules:{organization:false,classification:false,personalRecords:true,businessDataPolicy:true},
  verify:async()=>grantActive?grant:null,readCurrentGrant:async()=>grantActive?grant:null,
  operationAvailable:()=>true,assertWritable:async()=>{}});
 const send=()=>handler(new Request(baseURL+'/v1/records/cooking',{method:'POST',headers:{host:new URL(baseURL).host,
  authorization:'Bearer synthetic-agent-final-guard','content-type':'application/json','idempotency-key':'synthetic-agent-original-key'},
  body:JSON.stringify({fields:cookingFields})}));
 assert.equal((await send()).status,201);
 revokeOnReceipt=true;
 const denied=await send(),denial=await denied.json();
 assert.equal(denied.status,403);assert.equal(Object.hasOwn(denial,'entry'),false);
 assert.equal(JSON.stringify(denial).includes(cookingFields.title),false);
 assert.equal(repository.rows.size,1);assert.equal(repository.historyRows.length,1);assert.equal(repository.receipts.size,1);
 revokeOnReceipt=false;grantActive=true;
 const replay=await send();assert.equal(replay.status,200);assert.equal((await replay.json()).duplicate,true);
 assert.equal(repository.rows.size,1);assert.equal(repository.historyRows.length,1);
});
