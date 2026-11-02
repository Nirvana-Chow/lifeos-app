import test from 'node:test';
import assert from 'node:assert/strict';
import {readCaptureRunCandidateFlag} from '../src/capture-runs-candidate/config.ts';
test('capture run persistence defaults off and requires its exact explicit extension flag',()=>{
 assert.equal(readCaptureRunCandidateFlag({}),false);assert.equal(readCaptureRunCandidateFlag({LIFEOS_CAPTURE_RUNS_CANDIDATE:'1'}),true);
 for(const value of ['true','0','','yes'])assert.throws(()=>readCaptureRunCandidateFlag({LIFEOS_CAPTURE_RUNS_CANDIDATE:value}));
});
