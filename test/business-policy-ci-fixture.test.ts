import test from 'node:test';
import assert from 'node:assert/strict';
import {businessPolicyCIIdentity,assertEmptyPolicyCICluster} from './helpers/business-policy-stage-pg.ts';

const sha='a'.repeat(40),workspace='/runner/work/lifeos-app/lifeos-app';
const env={RUN_BUSINESS_POLICY_POSTGRES_TESTS:'1',LIFEOS_FIXTURE_FRESH:'approved-isolated-fixture',LIFEOS_POLICY_FIXTURE_CONTEXT:'github-actions',LIFEOS_POLICY_FIXTURE_ID:'business-policy-ci-12345-2',CI:'true',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'Nirvana-Chow/lifeos-app',CI_SOURCE_REPOSITORY:'Nirvana-Chow/lifeos-app',SOURCE_SHA:sha,CI_HEAD_SHA:sha,GITHUB_RUN_ID:'12345',GITHUB_RUN_ATTEMPT:'2',GITHUB_WORKSPACE:workspace};
const facts={platform:'linux',execArgv:['--test-isolation=none'],workingDirectory:workspace,workspaceDirectory:workspace,head:sha};
test('business policy CI identity is bound to the actual source run attempt and workspace',()=>{
 assert.deepEqual(businessPolicyCIIdentity(env,facts),{fixtureId:'business-policy-ci-12345-2',identity:{repository:'Nirvana-Chow/lifeos-app',run_id:'12345',attempt:'2',source_sha:sha}});
});
test('business policy fixture refuses local or redirected CI claims before connecting',()=>{
 for(const [key,value]of Object.entries({RUN_BUSINESS_POLICY_POSTGRES_TESTS:'0',LIFEOS_FIXTURE_FRESH:'',LIFEOS_POLICY_FIXTURE_CONTEXT:'local-docker',LIFEOS_POLICY_FIXTURE_ID:'business-policy-ci-12345-1',CI:'false',GITHUB_ACTIONS:'false',GITHUB_REPOSITORY:'foreign/lifeos-app',CI_SOURCE_REPOSITORY:'foreign/lifeos-app',SOURCE_SHA:'b'.repeat(40),CI_HEAD_SHA:'b'.repeat(40),GITHUB_RUN_ID:'0',GITHUB_RUN_ATTEMPT:'02',GITHUB_WORKSPACE:'',LIFEOS_POLICY_PG_BIN:'/private/tmp/lifeos-pg17.fixture/install/bin',LIFEOS_POLICY_DATABASE_URL:'postgresql://other/db'}))assert.throws(()=>businessPolicyCIIdentity({...env,[key]:value},facts),Error,key);
 for(const patch of [{platform:'darwin'},{execArgv:[]},{workingDirectory:'/foreign'},{workspaceDirectory:'/foreign'},{head:'b'.repeat(40)}])assert.throws(()=>businessPolicyCIIdentity(env,{...facts,...patch}));
});
const empty={data:'/var/lib/postgresql/data',version:'170011',database:'postgres',role:'postgres',address:'172.17.0.2',port:5432,owner:'postgres',roles:[],databases:['postgres'],schemas:[]};
test('policy qualification requires its own empty PG17.11 cluster rather than a prepared requirements fixture',()=>{
 assert.doesNotThrow(()=>assertEmptyPolicyCICluster(empty));
 for(const patch of [{data:'/other'},{version:'170010'},{database:'lifeos_platform_test_local'},{role:'runtime'},{address:'203.0.113.1'},{port:55449},{owner:'runtime'},{roles:['lifeos_platform_candidate_runtime']},{databases:['postgres','lifeos_platform_test_local']},{schemas:['lifeos_platform']}])assert.throws(()=>assertEmptyPolicyCICluster({...empty,...patch}));
});
