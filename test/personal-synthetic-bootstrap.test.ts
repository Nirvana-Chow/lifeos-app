import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const target='postgresql://lifeos_platform_candidate_runtime:fixture-ci-runtime-never-live@127.0.0.1:55432/lifeos_platform_test_local';
const env={CI:'true',GITHUB_ACTIONS:'true',LIFEOS_FIXTURE_FRESH:'approved-isolated-fixture',LIFEOS_PLATFORM_TEST_DATABASE_URL:target,LIFEOS_PERSONAL_OWNER_ID:'personal-review-user',LIFEOS_PERSONAL_OWNER_EMAIL:'owner@example.test',LIFEOS_PERSONAL_SPACE_ID:'personal-review-space'};
test('synthetic bootstrap only accepts exact disposable owner or foreign fixture identity and fixed target',async()=>{
 assert.equal(existsSync('test/helpers/personal-synthetic-bootstrap.ts'),true,'synthetic-only helper required');
 const {readSyntheticIdentity}=await import('./helpers/personal-synthetic-bootstrap.ts');
 assert.deepEqual(readSyntheticIdentity(env),{ownerId:'personal-review-user',email:'owner@example.test',spaceId:'personal-review-space',password:'fixture-personal-initial-password'});
 assert.equal(readSyntheticIdentity({...env,LIFEOS_PERSONAL_OWNER_ID:'synthetic-foreign-user',LIFEOS_PERSONAL_OWNER_EMAIL:'foreign@example.test',LIFEOS_PERSONAL_SPACE_ID:'synthetic-foreign-space'}).password,'fixture-personal-foreign-password');
 for(const change of [{CI:'false'},{GITHUB_ACTIONS:''},{LIFEOS_FIXTURE_FRESH:''},{LIFEOS_PLATFORM_TEST_DATABASE_URL:target.replace('55432','55439')},{LIFEOS_PERSONAL_OWNER_EMAIL:'private@example.com'},{LIFEOS_PERSONAL_OWNER_ID:'real-owner'},{LIFEOS_PERSONAL_SPACE_ID:'other-space'}])assert.throws(()=>readSyntheticIdentity({...env,...change}),/SYNTHETIC_BOOTSTRAP_DENIED/);
});
