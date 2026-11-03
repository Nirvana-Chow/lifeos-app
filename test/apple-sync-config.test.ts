import test from 'node:test';
import assert from 'node:assert/strict';
import {readAppleSyncConfig} from '../src/apple-sync-candidate/config.ts';
test('candidate flag never enables device identity or business writes',()=>{
 assert.equal(readAppleSyncConfig({}).enabled,false);
 assert.equal(readAppleSyncConfig({LIFEOS_APPLE_SYNC_CANDIDATE:'0'}).enabled,false);
 assert.equal(readAppleSyncConfig({LIFEOS_APPLE_SYNC_CANDIDATE:'source-v1'}).enabled,true);
 assert.throws(()=>readAppleSyncConfig({LIFEOS_APPLE_SYNC_CANDIDATE:'1'}));
});
