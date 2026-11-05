import test from 'node:test';
import assert from 'node:assert/strict';
import {readPersonalConfig} from '../src/personal-candidate/config.ts';
const platform={ownerId:'personal-review-user',ownerEmail:'owner@example.test',baseURL:'https://support.example.test',databaseURL:'postgresql://lifeos_platform_candidate_runtime:synthetic-only@127.0.0.1:55432/lifeos_platform_test_local'};
const env={LIFEOS_PERSONAL_ENABLED:'1',LIFEOS_PERSONAL_APPROVED:'personal-manual-v1',LIFEOS_PERSONAL_OWNER_ID:platform.ownerId,LIFEOS_PERSONAL_OWNER_EMAIL:platform.ownerEmail,LIFEOS_PERSONAL_SPACE_ID:'personal-review-space',LIFEOS_PERSONAL_DATABASE_NAME:'lifeos_platform_test_local',LIFEOS_PERSONAL_ALLOWED_TYPES:'todo,journal',LIFEOS_PERSONAL_REQUIREMENTS:'requirements-v1'};
test('support flag is independent, exact, requires requirements and preserves original personal types',()=>{
 assert.equal(readPersonalConfig(env,platform)?.requirementSupportEnabled,undefined);
 const enabled=readPersonalConfig({...env,LIFEOS_PERSONAL_REQUIREMENT_SUPPORT:'requirement-support-v1'},platform)!;assert.equal(enabled.requirementSupportEnabled,true);assert.deepEqual(enabled.allowedTypes,['todo','journal']);
 for(const value of ['1','true','feedback-v1',''])assert.throws(()=>readPersonalConfig({...env,LIFEOS_PERSONAL_REQUIREMENT_SUPPORT:value},platform));
 assert.throws(()=>readPersonalConfig({...env,LIFEOS_PERSONAL_REQUIREMENTS:undefined,LIFEOS_PERSONAL_REQUIREMENT_SUPPORT:'requirement-support-v1'},platform));
});
