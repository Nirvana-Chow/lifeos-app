import test from'node:test';import assert from'node:assert/strict';
import{PostgresAISettingsRepository,verifyAISettingsPool}from'../src/platform/ai-settings-postgres.ts';
import type{SqlPool,SqlClient}from'../src/platform/postgres.ts';
const row={ownerId:'fixture-owner-a',revision:1,materialRevision:1,config:{provider:'volcengine-ark',baseURL:'https://ark.cn-beijing.volces.com/api/v3',model:'fixture',dataScope:'current-message-only',monthlyBudgetMinor:null},secret:null,enabled:false,testState:'never',testedMaterialRevision:null,testMode:null,testStartedAt:null,testedAt:null,updatedAt:'2026-10-23T00:00:00Z'};
test('PostgreSQL adapter binds owner and payload parameters in an explicit transaction; conflict rolls back',async()=>{
 const calls:{sql:string;values?:unknown[]}[]=[];let released=0;
 const client:SqlClient={async query(sql,values){calls.push({sql,values});return{rows:sql.startsWith('SELECT owner_id')?[{owner_id:row.ownerId,revision:1,payload:row}]:[],rowCount:1};},release(){released++;}};
 const repo=new PostgresAISettingsRepository({connect:async()=>client});
 await assert.rejects(()=>repo.change(row.ownerId,0,()=>{throw Error('callback must not run');}),{code:'AI_SETTINGS_CONFLICT'});
 assert.ok(calls.some(c=>c.sql==='ROLLBACK'));assert.deepEqual(calls.find(c=>c.sql.includes("set_config"))?.values,[row.ownerId]);assert.ok(calls.every(c=>!c.sql.includes(row.ownerId)));assert.equal(released,1);
 calls.length=0;await repo.change(row.ownerId,1,old=>({...old!,revision:2,materialRevision:2}));
 const write=calls.find(c=>c.sql.startsWith('INSERT INTO'));assert.ok(write);assert.equal(write.values?.[0],row.ownerId);assert.equal(write.values?.[1],2);assert.equal(JSON.parse(String(write.values?.[2])).revision,2);assert.equal(calls.at(-1)?.sql,'COMMIT');
});
test('AI extension metadata verifier fails closed for absent RLS or excessive runtime privileges',async()=>{
 const good={extension_version:1,core_version:2,rls:true,forced:true,owned:false,required:true,excessive:false};
 for(const patch of [{},{rls:false},{forced:false},{owned:true},{excessive:true},{extension_version:2},{required:false}]){
  const pool:SqlPool={connect:async()=>({query:async()=>({rows:[{...good,...patch}],rowCount:1}),release(){}})};
  if(Object.keys(patch).length)await assert.rejects(()=>verifyAISettingsPool(pool));else await verifyAISettingsPool(pool);
 }
});
test('a concurrent insert/update that does not meet CAS cannot be silently overwritten',async()=>{
 const calls:string[]=[];const client:SqlClient={query:async(sql)=>{calls.push(sql);return{rows:sql.startsWith('SELECT owner_id')?[{owner_id:row.ownerId,revision:1,payload:row}]:[],rowCount:sql.startsWith('INSERT INTO')?0:1};},release(){}};
 await assert.rejects(()=>new PostgresAISettingsRepository({connect:async()=>client}).change(row.ownerId,1,old=>({...old!,revision:2})),{code:'AI_SETTINGS_CONFLICT'});assert.equal(calls.at(-1),'ROLLBACK');
});
