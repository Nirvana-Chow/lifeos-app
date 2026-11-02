import test from'node:test';import assert from'node:assert/strict';
import{validateAcceptanceEnvironment,acceptancePool}from'./helpers/platform-pg.ts';
import{verifyRestrictedPool,type SqlPool}from'../src/platform/postgres.ts';
import{PostgresAISettingsRepository,verifyAISettingsPool}from'../src/platform/ai-settings-postgres.ts';
import{AISettingsService}from'../src/platform/ai-settings-service.ts';import{createAISecretVault}from'../src/platform/ai-secret-vault.ts';
// Definition only until exact extension migration and these retained synthetic writes are approved.
// Never bootstrap/migrate, overwrite an existing settings row, clean up records or call an external provider.
test('OPT-IN real PG AI-extension RLS, CAS and encrypted synthetic-key readback through a new pool (not a process/DB restart)',{skip:process.env.RUN_PLATFORM_AI_SETTINGS_POSTGRES_TESTS==='1'?false:'AI extension migration and retained synthetic settings writes have not been approved/executed'},async()=>{
 const config=validateAcceptanceEnvironment(process.env,process.execArgv),pool=acceptancePool(config.databaseURL);let reopened:ReturnType<typeof acceptancePool>|undefined;
 const options={baseURL:'https://review.example.invalid',externalCallsApproved:false,dataTransmissionApproved:false,callBudgetApproved:false};
 const vault=createAISecretVault({keyId:'fixture-fixed-master-never-live',key:Buffer.alloc(32,7)});
 const publicConfig={provider:'volcengine-ark',baseURL:'https://ark.cn-beijing.volces.com/api/v3',model:'fixture-no-real-endpoint',dataScope:'current-message-only',monthlyBudgetMinor:0};
 const syntheticSecret='fixture-provider-key-not-real-pg-extension';
 try{
  await verifyRestrictedPool(pool as SqlPool);await verifyAISettingsPool(pool as SqlPool);const repository=new PostgresAISettingsRepository(pool as SqlPool);
  assert.equal(await repository.get(config.ownerId),null,'Existing settings must be preserved; use a separately approved fresh target rather than overwrite');
  const service=new AISettingsService(repository,vault,options);
  const writes=await Promise.allSettled([service.saveConfig(config.ownerId,{expectedRevision:0,config:publicConfig}),service.saveConfig(config.ownerId,{expectedRevision:0,config:publicConfig})]);
  assert.equal(writes.filter(v=>v.status==='fulfilled').length,1);assert.equal(writes.filter(v=>v.status==='rejected').length,1);
  const masked=await service.saveSecret(config.ownerId,{expectedRevision:1,secret:syntheticSecret});assert.equal(masked.secretState,'stored');assert.equal(masked.realModelActive,false);
  assert.ok(!JSON.stringify(masked).includes(syntheticSecret));const persisted=await repository.get(config.ownerId);assert.ok(persisted?.secret);assert.ok(!JSON.stringify(persisted).includes(syntheticSecret));
  assert.equal(await repository.get('fixture-unowned-ai-settings'),null);
  const client=await pool.connect();try{const rows=await client.query('SELECT owner_id FROM lifeos_platform.platform_ai_settings');assert.equal(rows.rowCount,0,'RLS without transaction owner context');}finally{client.release();}
  await pool.end();reopened=acceptancePool(config.databaseURL);await verifyAISettingsPool(reopened as SqlPool);
  const restored=new AISettingsService(new PostgresAISettingsRepository(reopened as SqlPool),vault,options);const readback=await restored.view(config.ownerId);assert.deepEqual(readback.config,publicConfig);assert.equal(readback.secretState,'stored');assert.equal(readback.revision,2);assert.equal(readback.enabled,false);
  const stored=await new PostgresAISettingsRepository(reopened as SqlPool).get(config.ownerId);assert.equal(vault.open(config.ownerId,'volcengine-ark',stored!.secret!),syntheticSecret);
 }finally{if(!pool.ended)await pool.end();if(reopened)await reopened.end();}
});
