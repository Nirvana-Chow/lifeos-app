import test from 'node:test';import assert from 'node:assert/strict';
import {candidateBuildDirectory} from '../src/platform/build-directory.ts';
test('default preview keeps r515 .next while r516 output is explicit and bounded',()=>{assert.equal(candidateBuildDirectory({}),'.next');assert.equal(candidateBuildDirectory({LIFEOS_CANDIDATE_DIST_DIR:'.next-r516'}),'.next-r516');for(const value of ['', '../outside','/tmp/path','.next-r518','node_modules'])assert.throws(()=>candidateBuildDirectory({LIFEOS_CANDIDATE_DIST_DIR:value}),/Unsupported candidate build directory/);});
