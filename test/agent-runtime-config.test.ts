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

test('current grant lookup rejects disabled, expired, malformed and changed grants without selecting secrets', async () => {
  const runtime = await import('../src/agent-api/runtime.ts');
  const read = (runtime as typeof runtime & {readCurrentAgentGrant:(pool:{query:(sql:string, values:unknown[])=>Promise<{rows:unknown[]}>},id:string)=>Promise<unknown>}).readCurrentAgentGrant;
  let row: Record<string,unknown> = {id:'grant',referenceId:'owner',metadata:JSON.stringify({spaceId:'space'}),permissions:JSON.stringify({todo:['read']}),enabled:true,expiresAt:null};
  const pool = {query:async (sql:string,values:unknown[]) => {
    assert.match(sql,/SELECT\s+id\s*,\s*"referenceId"\s*,\s*metadata\s*,\s*permissions\s*,\s*enabled\s*,\s*"expiresAt"/i);
    assert.deepEqual(values,['grant']); return {rows:row ? [row] : []};
  }};
  assert.deepEqual(Object.fromEntries(Object.entries(await read(pool,'grant') as object).filter(([key])=>key!=='authorizationRevision')), {grantId:'grant',ownerId:'owner',spaceId:'space',scopes:['todo:read']});
  row = {...row,enabled:null};
  assert.deepEqual(Object.fromEntries(Object.entries(await read(pool,'grant') as object).filter(([key])=>key!=='authorizationRevision')), {grantId:'grant',ownerId:'owner',spaceId:'space',scopes:['todo:read']});
  for(const update of [{enabled:false},{expiresAt:new Date(0)},{metadata:'{}'},{permissions:'{"todo":["write"]}'},{id:'different'}]) {
    const original=row; row={...row,...update}; assert.equal(await read(pool,'grant'),null); row=original;
  }
});

test('runtime operation readiness follows current business write policy and fence', async () => {
  const runtime=await import('../src/agent-api/runtime.ts');
  const available=(runtime as typeof runtime & {agentOperationAvailable:(id:string,personal:import('../src/personal-candidate/config.ts').PersonalConfig,fence:boolean)=>boolean}).agentOperationAvailable;
  const base={ownerId:'owner',ownerEmail:'owner@example.test',spaceId:'space',databaseName:'fixture',allowedTypes:['todo','journal'] as const,approval:'personal-manual-v1' as const,baseURL:origin};
  assert.equal(available('listTodos',{...base,businessWriteMode:'disabled'},true),true);
  assert.equal(available('createTodo',{...base,businessWriteMode:'disabled'},true),false);
  assert.equal(available('createTodo',{...base,businessWriteMode:'owner-managed'},false),false);
  assert.equal(available('createTodo',{...base,businessWriteMode:'owner-managed'},true),true);
  assert.equal(available('unimplemented',{...base,businessWriteMode:'owner-managed'},true),false);
});

test('organization operations require the module, full native types, actual fence readiness and write policy',async()=>{
 const {agentOperationAvailable}=await import('../src/agent-api/runtime.ts');
 const personal={ownerId:'owner',ownerEmail:'owner@example.test',spaceId:'space',databaseName:'fixture',allowedTypes:['todo','journal','project','domain','topic'] as const,approval:'personal-manual-v1' as const,baseURL:origin,businessWriteMode:'owner-managed' as const};
 const modules={organization:true,classification:false};
 for(const id of ['snapshotOrganization','getOrganization','createOrganization','updateOrganization']){
  assert.equal(agentOperationAvailable(id,personal,true),false);
  assert.equal(agentOperationAvailable(id,personal,false,modules),false);
  assert.equal(agentOperationAvailable(id,{...personal,allowedTypes:['todo','journal']},true,modules),false);
  assert.equal(agentOperationAvailable(id,personal,true,modules),true);
 }
 assert.equal(agentOperationAvailable('snapshotOrganization',{...personal,businessWriteMode:'disabled'},true,modules),true);
 assert.equal(agentOperationAvailable('updateOrganization',{...personal,businessWriteMode:'disabled'},true,modules),false);
 assert.equal(agentOperationAvailable('classifyTodos',personal,true,{...modules,classification:true}),false);
});

test('classification preview readiness does not require business writes but commit does',async()=>{
 const {agentOperationAvailable}=await import('../src/agent-api/runtime.ts');
 const personal={ownerId:'owner',ownerEmail:'owner@example.test',spaceId:'space',databaseName:'fixture',allowedTypes:['todo','journal','project','domain','topic'] as const,approval:'personal-manual-v1' as const,baseURL:origin,businessWriteMode:'disabled' as const};
 assert.equal(agentOperationAvailable('previewTodoClassification',personal,true,{organization:true,classification:true}),true);
 assert.equal(agentOperationAvailable('commitTodoClassification',personal,true,{organization:true,classification:true}),false);
 assert.equal(agentOperationAvailable('previewTodoClassification',personal,true,{organization:true,classification:false}),false);
});
test('producer revision changes with permissions or expiry but excludes quota bookkeeping',async()=>{
 const {readCurrentAgentGrant,getAgentGrantReader}=await import('../src/agent-api/runtime.ts');
 let row={id:'grant',referenceId:'owner',metadata:{spaceId:'space'},permissions:{todo:['read']},enabled:true,expiresAt:null as string|null,requestCount:1,updatedAt:'one'};
 const pool={query:async()=>({rows:[row]})};const first=await readCurrentAgentGrant(pool,'grant');assert.match(first!.authorizationRevision,/^[a-f0-9]{64}$/);
 row={...row,requestCount:2,updatedAt:'two'};assert.equal((await readCurrentAgentGrant(pool,'grant'))!.authorizationRevision,first!.authorizationRevision);
 row={...row,permissions:{todo:['read','write']}};assert.notEqual((await readCurrentAgentGrant(pool,'grant'))!.authorizationRevision,first!.authorizationRevision);
 row={...row,permissions:{todo:['read']},expiresAt:'2099-01-01T00:00:00.000Z'};assert.notEqual((await readCurrentAgentGrant(pool,'grant'))!.authorizationRevision,first!.authorizationRevision);
 const flag=process.env.LIFEOS_AGENT_CLASSIFICATION;delete process.env.LIFEOS_AGENT_CLASSIFICATION;try{assert.equal(await getAgentGrantReader(),null);}finally{if(flag!==undefined)process.env.LIFEOS_AGENT_CLASSIFICATION=flag;}
});
