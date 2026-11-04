import assert from 'node:assert/strict';
import test from 'node:test';
import {handleAgentRequest} from '../src/agent-api/runtime.ts';
import {applyReviewEnvironment,validateReviewConfig} from '../src/platform/private-config.ts';

const origin='https://review.example.test';
const platform={
  LIFEOS_PLATFORM_CANDIDATE:'1',
  LIFEOS_PLATFORM_TARGET:'isolated-test',
  LIFEOS_PLATFORM_BASE_URL:origin,
  LIFEOS_PLATFORM_TRANSPORT:'https-origin',
  LIFEOS_PLATFORM_HTTPS_HOST:'review.example.test',
  LIFEOS_PLATFORM_OWNER_ID:'personal-review-user',
  LIFEOS_PLATFORM_OWNER_EMAIL:'owner@example.test',
  LIFEOS_PLATFORM_SECRET:'synthetic-browser-config-only-000000000000',
  LIFEOS_PLATFORM_TEST_DATABASE_URL:'postgresql://lifeos_platform_candidate_runtime:fixture-only@127.0.0.1:55432/lifeos_platform_test_local',
};
const personal={
  LIFEOS_PERSONAL_ENABLED:'1',
  LIFEOS_PERSONAL_APPROVED:'personal-manual-v1',
  LIFEOS_PERSONAL_OWNER_ID:platform.LIFEOS_PLATFORM_OWNER_ID,
  LIFEOS_PERSONAL_OWNER_EMAIL:platform.LIFEOS_PLATFORM_OWNER_EMAIL,
  LIFEOS_PERSONAL_SPACE_ID:'personal-review-space',
  LIFEOS_PERSONAL_DATABASE_NAME:'lifeos_platform_test_local',
  LIFEOS_PERSONAL_ALLOWED_TYPES:'todo,journal',
};
const agent={
  LIFEOS_AGENT_API_ENABLED:'1',
  LIFEOS_AGENT_API_DATABASE_URL:'postgresql://lifeos_agent_verifier:fixture-only@127.0.0.1:55432/lifeos_platform_test_local',
  LIFEOS_AGENT_API_SECRET:'synthetic-machine-config-only-000000000000',
};
test('protected startup accepts only a complete dedicated Agent binding in HTTPS personal mode',()=>{
  const approved=validateReviewConfig({...platform,...personal,...agent});
  assert.equal(approved.LIFEOS_AGENT_API_ENABLED,'1');
  for (const change of [
    {LIFEOS_AGENT_API_ENABLED:'0'},
    {LIFEOS_AGENT_API_SECRET:undefined},
    {LIFEOS_AGENT_API_SECRET:platform.LIFEOS_PLATFORM_SECRET},
    {LIFEOS_AGENT_API_DATABASE_URL:platform.LIFEOS_PLATFORM_TEST_DATABASE_URL},
    {LIFEOS_AGENT_API_DATABASE_URL:agent.LIFEOS_AGENT_API_DATABASE_URL.replace('55432','55433')},
    {LIFEOS_AGENT_API_DATABASE_URL:agent.LIFEOS_AGENT_API_DATABASE_URL+'?options=changed'},
  ]) {
    assert.throws(()=>validateReviewConfig({...platform,...personal,...agent,...change}),/^Error: Isolated review configuration unavailable$/);
  }
  const loopback={...platform,LIFEOS_PLATFORM_BASE_URL:'http://127.0.0.1:3002',LIFEOS_PLATFORM_TRANSPORT:undefined,LIFEOS_PLATFORM_HTTPS_HOST:undefined};
  const clean=Object.fromEntries(Object.entries(loopback).filter(([,value])=>value!==undefined));
  assert.throws(()=>validateReviewConfig({...clean,...personal,LIFEOS_PERSONAL_SSH_LOOPBACK:'approved-private-ssh-v1',...agent}));
});

test('loading a validated runtime configuration clears inherited Agent enablement and credentials',()=>{
  const env:Record<string,string|undefined>={...agent};
  applyReviewEnvironment({...platform,...personal},env);
  for(const key of Object.keys(agent))assert.equal(env[key],undefined);
});


test('the mounted Agent route closes without an explicit validated runtime binding',async()=>{
  const previous=process.env.LIFEOS_AGENT_API_ENABLED;
  delete process.env.LIFEOS_AGENT_API_ENABLED;
  try {
    for(const method of ['GET','POST','PATCH']) {
      const response=await handleAgentRequest(new Request(origin+'/api/platform/agent/v1/todos',{method}));
      assert.equal(response.status,404);
      assert.equal(response.headers.get('cache-control'),'private, no-store');
    }
  } finally {
    if(previous!==undefined)process.env.LIFEOS_AGENT_API_ENABLED=previous;
  }
});

test('business module flags are closed and reject invalid combinations', async () => {
  const {readAgentBusinessModules} = await import('../src/agent-api/config.ts');
  assert.deepEqual(readAgentBusinessModules({}, null), {organization:false,classification:false});
  assert.throws(() => readAgentBusinessModules({LIFEOS_AGENT_CLASSIFICATION:'todo-classification-v1'}, null));
  assert.throws(() => readAgentBusinessModules({LIFEOS_AGENT_ORGANIZATION:'yes'}, null));
  assert.throws(() => readAgentBusinessModules({LIFEOS_AGENT_ORGANIZATION:'organization-v1'}, null));
  const binding = {ownerId:'owner',ownerEmail:'owner@example.test',spaceId:'space',databaseName:'fixture',allowedTypes:['todo','journal'] as const,approval:'personal-manual-v1' as const,baseURL:origin};
  assert.deepEqual(readAgentBusinessModules({LIFEOS_AGENT_ORGANIZATION:'organization-v1',LIFEOS_AGENT_CLASSIFICATION:'todo-classification-v1'}, binding), {organization:true,classification:true});
});
