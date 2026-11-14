import assert from 'node:assert/strict';
import test from 'node:test';
import {applyReviewEnvironment,validateReviewConfig} from '../src/platform/private-config.ts';
import {applyBoundStartupConfig} from '../src/deployment-candidate/startup-mount-guard.ts';

const flag='LIFEOS_PERSONAL_SESSION_DURATION';
const platform={
 LIFEOS_PLATFORM_CANDIDATE:'1',LIFEOS_PLATFORM_TARGET:'isolated-test',
 LIFEOS_PLATFORM_BASE_URL:'https://review.example.test',LIFEOS_PLATFORM_TRANSPORT:'https-origin',LIFEOS_PLATFORM_HTTPS_HOST:'review.example.test',
 LIFEOS_PLATFORM_OWNER_ID:'personal-review-user',LIFEOS_PLATFORM_OWNER_EMAIL:'owner@example.test',
 LIFEOS_PLATFORM_SECRET:'synthetic-browser-config-only-000000000000',
 LIFEOS_PLATFORM_TEST_DATABASE_URL:'postgresql://lifeos_platform_candidate_runtime:fixture-only@127.0.0.1:55432/lifeos_platform_test_local',
};
const personal={
 LIFEOS_PERSONAL_ENABLED:'1',LIFEOS_PERSONAL_APPROVED:'personal-manual-v1',
 LIFEOS_PERSONAL_OWNER_ID:platform.LIFEOS_PLATFORM_OWNER_ID,LIFEOS_PERSONAL_OWNER_EMAIL:platform.LIFEOS_PLATFORM_OWNER_EMAIL,
 LIFEOS_PERSONAL_SPACE_ID:'personal-review-space',LIFEOS_PERSONAL_DATABASE_NAME:'lifeos_platform_test_local',LIFEOS_PERSONAL_ALLOWED_TYPES:'todo,journal',
};
const binding={...platform,...personal};

test('the strict startup loader admits the exact reviewed device-session option in personal mode',()=>{
 const approved=validateReviewConfig({...binding,[flag]:'native-device-v1'});
 assert.equal(approved[flag],'native-device-v1');
 for(const apply of [applyReviewEnvironment,applyBoundStartupConfig]){
  const env:Record<string,string|undefined>={};apply(approved,env);
  assert.equal(env[flag],'native-device-v1');
  assert.equal(env.LIFEOS_PERSONAL_OWNER_ID,'personal-review-user');
 }
});

test('the device-session startup seam rejects unknown options, invalid values and nonpersonal launchers',()=>{
 for(const value of ['', '1', 'native-device-v2',42,null])assert.throws(()=>validateReviewConfig({...binding,[flag]:value}));
 const fixture={...platform,LIFEOS_PLATFORM_OWNER_ID:'fixture-owner-a',LIFEOS_PLATFORM_OWNER_EMAIL:'fixture@example.invalid'};
 assert.throws(()=>validateReviewConfig({...fixture,[flag]:'native-device-v1'}));
 assert.throws(()=>validateReviewConfig({...binding,[flag]:'native-device-v1',LIFEOS_PERSONAL_SESSION_UNREVIEWED:'1'}));
});

test('both startup adapters clear an inherited device-session option when the measured source omits it',()=>{
 for(const apply of [applyReviewEnvironment,applyBoundStartupConfig]){
  const env:Record<string,string|undefined>={[flag]:'native-device-v1'};
  apply(binding,env);assert.equal(env[flag],undefined);
 }
});
