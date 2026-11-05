import test from 'node:test';
import assert from 'node:assert/strict';
import {requirementsCIIdentity} from './helpers/requirements-stage-pg.ts';
const sha='a'.repeat(40);
const env={RUN_REQUIREMENTS_POSTGRES_TESTS:'1',LIFEOS_FIXTURE_FRESH:'approved-isolated-fixture',LIFEOS_REQUIREMENTS_FIXTURE_CONTEXT:'github-actions',LIFEOS_REQUIREMENTS_FIXTURE_ID:'requirements-ci-12345-2',CI:'true',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'Nirvana-Chow/lifeos-app',CI_SOURCE_REPOSITORY:'Nirvana-Chow/lifeos-app',SOURCE_SHA:sha,CI_HEAD_SHA:sha,GITHUB_RUN_ID:'12345',GITHUB_RUN_ATTEMPT:'2',GITHUB_WORKSPACE:'/runner/work/lifeos-app/lifeos-app'};
const facts={platform:'linux',execArgv:['--test-isolation=none'],workingDirectory:env.GITHUB_WORKSPACE,workspaceDirectory:env.GITHUB_WORKSPACE,head:sha};
test('requirements CI fixture derives an exact run/attempt marker bound to the checked source',()=>{
 assert.deepEqual(requirementsCIIdentity(env,facts),{fixtureId:'requirements-ci-12345-2',identity:{repository:'Nirvana-Chow/lifeos-app',run_id:'12345',attempt:'2',source_sha:sha}});
});
test('requirements CI preflight rejects missing permissions, foreign sources, stale SHA, workspaces and local target claims before connecting',()=>{
 for(const [key,value]of Object.entries({RUN_REQUIREMENTS_POSTGRES_TESTS:'0',LIFEOS_FIXTURE_FRESH:'',LIFEOS_REQUIREMENTS_FIXTURE_CONTEXT:'ssh-loopback',LIFEOS_REQUIREMENTS_FIXTURE_ID:'requirements-source-only-20261105',CI:'false',GITHUB_ACTIONS:'false',GITHUB_REPOSITORY:'foreign/lifeos-app',CI_SOURCE_REPOSITORY:'foreign/lifeos-app',SOURCE_SHA:'b'.repeat(40),CI_HEAD_SHA:'b'.repeat(40),GITHUB_RUN_ID:'0',GITHUB_RUN_ATTEMPT:'02',GITHUB_WORKSPACE:'',LIFEOS_REQUIREMENTS_FIXTURE_DATA_DIRECTORY:'/var/lib/postgresql/data',LIFEOS_REQUIREMENTS_FIXTURE_CONTAINER_ID:'a'.repeat(64),LIFEOS_REQUIREMENTS_FIXTURE_IMAGE_ID:'sha256:'+'a'.repeat(64),LIFEOS_REQUIREMENTS_FIXTURE_FORWARD_SESSION:'94117'}))assert.throws(()=>requirementsCIIdentity({...env,[key]:value},facts),Error,key);
 for(const patch of [{platform:'darwin'},{execArgv:[]},{workingDirectory:'/foreign'},{workspaceDirectory:'/foreign'},{head:'b'.repeat(40)}])assert.throws(()=>requirementsCIIdentity(env,{...facts,...patch}));
});
