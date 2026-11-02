import test from'node:test';import assert from'node:assert/strict';import{readAISettingsRuntimeConfig,aiMasterKeyPath}from'../src/platform/ai-settings-config.ts';
test('AI settings defaults off; optional storage flag never grants model data/cost permission',()=>{
 assert.equal(readAISettingsRuntimeConfig({},'http://127.0.0.1:3002'),null);
 assert.deepEqual(readAISettingsRuntimeConfig({LIFEOS_AI_SETTINGS_CANDIDATE:'1'},'http://127.0.0.1:3002'),{masterKeyFile:null,externalCallsApproved:false,dataTransmissionApproved:false,callBudgetApproved:false});
});
test('secret file and call flags require the pinned protected file, HTTPS and all separate approvals',()=>{
 for(const env of [{LIFEOS_AI_MASTER_KEY_FILE:aiMasterKeyPath},{LIFEOS_AI_SETTINGS_CANDIDATE:'true'},{LIFEOS_AI_SETTINGS_CANDIDATE:'1',LIFEOS_AI_MASTER_KEY_FILE:'/tmp/untrusted.json'},{LIFEOS_AI_SETTINGS_CANDIDATE:'1',LIFEOS_AI_EXTERNAL_CALLS_APPROVED:'1'}])assert.throws(()=>readAISettingsRuntimeConfig(env,'https://review.example.invalid'));
 const env={LIFEOS_AI_SETTINGS_CANDIDATE:'1',LIFEOS_AI_MASTER_KEY_FILE:aiMasterKeyPath,LIFEOS_AI_EXTERNAL_CALLS_APPROVED:'1',LIFEOS_AI_DATA_APPROVED:'1',LIFEOS_AI_BUDGET_APPROVED:'1'};
 assert.throws(()=>readAISettingsRuntimeConfig(env,'http://127.0.0.1:3002'));
 assert.equal(readAISettingsRuntimeConfig(env,'https://review.example.invalid')?.externalCallsApproved,true);
});
test('runtime key path is the container read-only target, never a host path',()=>{
 assert.equal(aiMasterKeyPath,'/run/lifeos-platform/ai-master-key.json');
 assert.throws(()=>readAISettingsRuntimeConfig({LIFEOS_AI_SETTINGS_CANDIDATE:'1',LIFEOS_AI_MASTER_KEY_FILE:'/var/lib/lifeos-platform-review-20261023/private/ai-master-key.json'},'https://review.example.invalid'));
});
