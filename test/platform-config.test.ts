import test from 'node:test';import assert from 'node:assert/strict';
import {readPlatformConfig} from '../src/platform/config.ts';
export const isolatedEnv={LIFEOS_PLATFORM_CANDIDATE:'1',LIFEOS_PLATFORM_TARGET:'isolated-test',LIFEOS_PLATFORM_BASE_URL:'http://127.0.0.1:3190',LIFEOS_PLATFORM_OWNER_ID:'fixture-owner-a',LIFEOS_PLATFORM_OWNER_EMAIL:'fixture@example.invalid',LIFEOS_PLATFORM_SECRET:'fixture-only-not-a-live-secret-000000000',LIFEOS_PLATFORM_TEST_DATABASE_URL:'postgresql://lifeos_platform_candidate_runtime:fixture-not-live@127.0.0.1:55432/lifeos_platform_test_fixture'};
test('platform configuration is default-disabled and has no production database fallback',()=>{
 assert.equal(readPlatformConfig({}),null);assert.equal(readPlatformConfig({DATABASE_URL:'postgresql://private.invalid/real'}),null);
 assert.throws(()=>readPlatformConfig({LIFEOS_PLATFORM_CANDIDATE:'1'}),/Isolated platform configuration unavailable/);
});
test('only an explicit isolated loopback target with complete external owner configuration activates',()=>{
 const config=readPlatformConfig(isolatedEnv)!;assert.equal(config.baseURL,'http://127.0.0.1:3190');assert.equal(config.ownerEmail,'fixture@example.invalid');assert.equal(config.sessionSeconds,1800);
 const bad:Record<string,string>[]=[{LIFEOS_PLATFORM_TARGET:'production'},{LIFEOS_PLATFORM_BASE_URL:'https://example.invalid'},{LIFEOS_PLATFORM_BASE_URL:'http://127.0.0.1:3190/path'},{LIFEOS_PLATFORM_SECRET:'short'},{LIFEOS_PLATFORM_OWNER_ID:'x'},{LIFEOS_PLATFORM_OWNER_EMAIL:'bad'},{LIFEOS_PLATFORM_TEST_DATABASE_URL:'postgres://admin:fixture@127.0.0.1/lifeos_platform_test_fixture'},{LIFEOS_PLATFORM_TEST_DATABASE_URL:'postgres://lifeos_platform_candidate_runtime:fixture@203.0.113.8/lifeos_platform_test_fixture'},{LIFEOS_PLATFORM_TEST_DATABASE_URL:'postgres://lifeos_platform_candidate_runtime:fixture@127.0.0.1/real'},{LIFEOS_PLATFORM_TEST_DATABASE_URL:isolatedEnv.LIFEOS_PLATFORM_TEST_DATABASE_URL+'?sslmode=disable'}];
 for(const extra of bad)assert.throws(()=>readPlatformConfig({...isolatedEnv,...extra}),e=>e instanceof Error&&e.message==='Isolated platform configuration unavailable');
});
