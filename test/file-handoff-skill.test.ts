import test from 'node:test';import assert from 'node:assert/strict';
import {buildSkillRelease,verifySkillRelease} from '../src/agent-api/skill-update-channel.ts';
test('the public credential-free release carries the independently authorized file contract without executable adoption',()=>{
 const release=buildSkillRelease(),verified=verifySkillRelease(release.manifestBytes,release.archive,{trustedManifestSha256:release.manifestSha256,apiVersion:2});
 const text=verified.documents['SKILL.md']+'\n'+verified.documents['references/credential-runtime.md'];
 for(const contract of ['lifeos_stage_file','openai/fileParams','file-handoff-v1','lifeos_receive_file','FILE_HANDOFF_OUTCOME_UNKNOWN'])assert.ok(text.includes(contract),contract);
 for(const id of ['stageFileHandoff','getFileHandoff','downloadFileHandoff','acknowledgeFileHandoff'])assert.ok(verified.documents['references/operations.md'].includes(id),id);
 assert.deepEqual(Object.keys(verified.documents).sort(),['LICENSE','SKILL.md','references/credential-runtime.md','references/operations.md'].sort());
 assert.ok(verified.releaseSequence>2026111401);
});
