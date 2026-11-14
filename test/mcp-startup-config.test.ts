import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,openSync,closeSync,fstatSync,rmSync,constants} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {readAgentRuntimeConfig,readAgentMcpHttpTransport} from '../src/agent-api/config.ts';
import {handleMcpHttpRequest} from '../src/mcp-http/runtime.ts';
import {readPlatformConfig} from '../src/platform/config.ts';
import {readPersonalConfig} from '../src/personal-candidate/config.ts';
import {applyReviewEnvironment,validateReviewConfig} from '../src/platform/private-config.ts';
import {applyBoundStartupConfig,readBoundStartupConfig} from '../src/deployment-candidate/startup-mount-guard.ts';

const platform={
 LIFEOS_PLATFORM_CANDIDATE:'1',LIFEOS_PLATFORM_TARGET:'isolated-test',
 LIFEOS_PLATFORM_BASE_URL:'https://review.example.test',LIFEOS_PLATFORM_TRANSPORT:'https-origin',LIFEOS_PLATFORM_HTTPS_HOST:'review.example.test',
 LIFEOS_PLATFORM_OWNER_ID:'personal-review-user',LIFEOS_PLATFORM_OWNER_EMAIL:'owner@example.test',
 LIFEOS_PLATFORM_SECRET:'synthetic-browser-config-only-000000000000',
 LIFEOS_PLATFORM_TEST_DATABASE_URL:'postgresql://lifeos_platform_candidate_runtime:fixture-only@127.0.0.1:55432/lifeos_platform_test_local',
};
const personal={
 LIFEOS_PERSONAL_ENABLED:'1',LIFEOS_PERSONAL_APPROVED:'personal-manual-v1',
 LIFEOS_PERSONAL_OWNER_ID:platform.LIFEOS_PLATFORM_OWNER_ID,LIFEOS_PERSONAL_OWNER_EMAIL:platform.LIFEOS_PLATFORM_OWNER_EMAIL,
 LIFEOS_PERSONAL_SPACE_ID:'personal-review-space',LIFEOS_PERSONAL_DATABASE_NAME:'lifeos_platform_test_local',LIFEOS_PERSONAL_ALLOWED_TYPES:'todo,journal',
};
const agent={
 LIFEOS_AGENT_API_ENABLED:'1',LIFEOS_AGENT_API_DATABASE_URL:'postgresql://lifeos_agent_verifier:fixture-only@127.0.0.1:55432/lifeos_platform_test_local',
 LIFEOS_AGENT_API_SECRET:'synthetic-machine-config-only-000000000000',
};
const binding={...platform,...personal,...agent};
const platformConfig=readPlatformConfig(platform)!;
const personalConfig=readPersonalConfig(binding,platformConfig)!;
const oauthFlags={LIFEOS_BUSINESS_MCP_OAUTH:'business-mcp-oauth-v1',LIFEOS_BUSINESS_MCP_GRANT_ID:'synthetic-reviewed-grant',LIFEOS_BUSINESS_MCP_SCOPES:'todo:read todo:write offline_access'};
const oauthBinding={...binding,LIFEOS_PLATFORM_BASE_URL:'https://lifeos.nirvanachow.com',LIFEOS_PLATFORM_HTTPS_HOST:'lifeos.nirvanachow.com',LIFEOS_MCP_HTTP:'streamable-http-v1',...oauthFlags};

test('protected startup accepts the reviewed OAuth flags without changing the original Agent result',()=>{
 const approved=validateReviewConfig(oauthBinding),platform=readPlatformConfig(approved)!,personal=readPersonalConfig(approved,platform)!;
 for(const[key,value]of Object.entries(oauthFlags))assert.equal(approved[key],value);
 assert.deepEqual(readAgentRuntimeConfig(approved,platform,personal),{databaseURL:agent.LIFEOS_AGENT_API_DATABASE_URL,secret:agent.LIFEOS_AGENT_API_SECRET});
});

test('both original adapters clear inherited OAuth flags when the protected config omits them',()=>{
 for(const apply of [applyReviewEnvironment,applyBoundStartupConfig]){
  const sink:Record<string,string|undefined>={...oauthFlags};apply(binding,sink);
  for(const key of Object.keys(oauthFlags))assert.equal(sink[key],undefined);
 }
});

test('OAuth startup requires all reviewed values and the complete canonical HTTPS Agent/MCP binding',()=>{
 for(const change of [
  {LIFEOS_BUSINESS_MCP_OAUTH:undefined},{LIFEOS_BUSINESS_MCP_OAUTH:''},{LIFEOS_BUSINESS_MCP_OAUTH:'1'},
  {LIFEOS_BUSINESS_MCP_OAUTH:'business-mcp-oauth-v2'},{LIFEOS_BUSINESS_MCP_GRANT_ID:undefined},
  {LIFEOS_BUSINESS_MCP_GRANT_ID:''},{LIFEOS_BUSINESS_MCP_GRANT_ID:'not/a/grant'},
  {LIFEOS_BUSINESS_MCP_SCOPES:undefined},{LIFEOS_BUSINESS_MCP_SCOPES:''},{LIFEOS_BUSINESS_MCP_SCOPES:'offline_access'},
  {LIFEOS_BUSINESS_MCP_SCOPES:'todo:write'},{LIFEOS_BUSINESS_MCP_SCOPES:'todo:read todo:read'},
  {LIFEOS_BUSINESS_MCP_SCOPES:'todo:read account:write'},{LIFEOS_MCP_HTTP:undefined},
  {LIFEOS_MCP_HTTP:'1'},{LIFEOS_AGENT_API_ENABLED:'0'},{LIFEOS_AGENT_API_SECRET:undefined},
  {LIFEOS_AGENT_API_DATABASE_URL:undefined},{LIFEOS_PERSONAL_ENABLED:undefined},
  {LIFEOS_PLATFORM_BASE_URL:'https://review.example.test',LIFEOS_PLATFORM_HTTPS_HOST:'review.example.test'},
 ]){
  const value={...oauthBinding,...change};
  const platform=readPlatformConfig(value)!,personal=readPersonalConfig(value,platform);
  assert.throws(()=>readAgentRuntimeConfig(value,platform,personal));
  assert.throws(()=>validateReviewConfig(value),/^Error: Isolated review configuration unavailable$/);
 }
 for(const change of [{LIFEOS_BUSINESS_MCP_ENABLED:'1'},{LIFEOS_BUSINESS_MCP_GRANT_ID:42}])assert.throws(()=>validateReviewConfig({...oauthBinding,...change}));
});

test('measured OAuth bytes reach both original adapters; changed FD proof still fails closed',()=>{
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'oauth-startup-')),runtimePath=join(dir,'runtime.json'),gatePath=join(dir,'gate');
 let runtime:number|undefined,gate:number|undefined;
 try{
  mkdirSync(gatePath,{mode:0o700});const bytes=JSON.stringify(oauthBinding);writeFileSync(runtimePath,bytes,{mode:0o600});
  runtime=openSync(runtimePath,constants.O_RDONLY|constants.O_NOFOLLOW);gate=openSync(gatePath,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  const r=fstatSync(runtime,{bigint:true}),g=fstatSync(gate,{bigint:true});
  const proof={version:1,runtime:{dev:String(r.dev),ino:String(r.ino),sha256:createHash('sha256').update(bytes).digest('hex')},gate:{dev:String(g.dev),ino:String(g.ino)}};
  const verified=readBoundStartupConfig(proof,{runtime,gate});
  for(const apply of [applyReviewEnvironment,applyBoundStartupConfig]){const sink:Record<string,string|undefined>={LIFEOS_BUSINESS_MCP_OAUTH:'unreviewed'};apply(verified,sink);for(const[key,value]of Object.entries(oauthFlags))assert.equal(sink[key],value);}
  for(const runtimeProof of [{...proof.runtime,ino:String(r.ino+1n)},{...proof.runtime,sha256:'0'.repeat(64)}])assert.throws(()=>readBoundStartupConfig({...proof,runtime:runtimeProof},{runtime:runtime!,gate:gate!}),/^Error: STARTUP_MOUNT_UNVERIFIED$/);
 }finally{if(runtime!==undefined)closeSync(runtime);if(gate!==undefined)closeSync(gate);rmSync(dir,{recursive:true,force:true});}
});

test('controlled startup carries the approved MCP transport from the measured private runtime bytes',()=>{
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'mcp-startup-')),runtimePath=join(dir,'runtime.json'),gatePath=join(dir,'gate');
 let runtime:number|undefined,gate:number|undefined;
 try{
  mkdirSync(gatePath,{mode:0o700});
  const bytes=JSON.stringify({...binding,LIFEOS_MCP_HTTP:'streamable-http-v1'});
  writeFileSync(runtimePath,bytes,{mode:0o600});
  runtime=openSync(runtimePath,constants.O_RDONLY|constants.O_NOFOLLOW);gate=openSync(gatePath,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  const r=fstatSync(runtime,{bigint:true}),g=fstatSync(gate,{bigint:true});
  const proof={version:1,runtime:{dev:String(r.dev),ino:String(r.ino),sha256:createHash('sha256').update(bytes).digest('hex')},gate:{dev:String(g.dev),ino:String(g.ino)}};
  const verified=readBoundStartupConfig(proof,{runtime,gate});
  assert.throws(()=>readBoundStartupConfig({...proof,runtime:{...proof.runtime,sha256:'0'.repeat(64)}},{runtime:runtime!,gate:gate!}),/^Error: STARTUP_MOUNT_UNVERIFIED$/);
  const sink:Record<string,string|undefined>={LIFEOS_MCP_HTTP:'unreviewed',LIFEOS_REVIEW_GIT_SHA:'a'.repeat(40)};
  applyBoundStartupConfig(verified,sink);
  assert.equal(sink.LIFEOS_MCP_HTTP,'streamable-http-v1');
  assert.equal(sink.LIFEOS_AGENT_API_ENABLED,'1');
  assert.equal(sink.LIFEOS_REVIEW_GIT_SHA,'a'.repeat(40));
 }finally{if(runtime!==undefined)closeSync(runtime);if(gate!==undefined)closeSync(gate);rmSync(dir,{recursive:true,force:true});}
});

test('both startup adapters remove inherited MCP enablement when the protected config omits it',()=>{
 for(const apply of [applyReviewEnvironment,applyBoundStartupConfig]){
  const sink:Record<string,string|undefined>={LIFEOS_MCP_HTTP:'streamable-http-v1'};
  apply(binding,sink);
  assert.equal(sink.LIFEOS_MCP_HTTP,undefined);
 }
});

test('MCP startup rejects noncanonical transport values even with a valid Agent binding',()=>{
 for(const value of ['1','', 'enabled','streamable-http-v2']){
  assert.throws(()=>readAgentRuntimeConfig({...agent,LIFEOS_MCP_HTTP:value},platformConfig,personalConfig),/^Error: Agent runtime configuration unavailable$/);
  assert.throws(()=>validateReviewConfig({...binding,LIFEOS_MCP_HTTP:value}),/^Error: Isolated review configuration unavailable$/);
 }
});

test('an MCP transport flag alone cannot bypass the existing complete HTTPS Agent dependency gate',()=>{
 for(const config of [
  {LIFEOS_MCP_HTTP:'streamable-http-v1'},
  {...agent,LIFEOS_MCP_HTTP:'streamable-http-v1',LIFEOS_AGENT_API_ENABLED:'0'},
  {...agent,LIFEOS_MCP_HTTP:'streamable-http-v1',LIFEOS_AGENT_API_SECRET:undefined},
  {...agent,LIFEOS_MCP_HTTP:'streamable-http-v1',LIFEOS_AGENT_API_DATABASE_URL:undefined},
 ])assert.throws(()=>readAgentRuntimeConfig(config,platformConfig,personalConfig),/^Error: Agent runtime configuration unavailable$/);
 assert.throws(()=>readAgentRuntimeConfig({...agent,LIFEOS_MCP_HTTP:'streamable-http-v1'},platformConfig,null),/^Error: Agent runtime configuration unavailable$/);
});

test('omitting MCP preserves existing Agent configuration and leaves the transport closed',()=>{
 assert.equal(readAgentRuntimeConfig({},platformConfig,personalConfig),null);
 assert.equal(validateReviewConfig(binding).LIFEOS_MCP_HTTP,undefined);
 assert.deepEqual(readAgentRuntimeConfig(agent,platformConfig,personalConfig),{databaseURL:agent.LIFEOS_AGENT_API_DATABASE_URL,secret:agent.LIFEOS_AGENT_API_SECRET});
});

test('HTTP and startup share one exact typed transport codec with a closed omitted value',()=>{
 assert.equal(readAgentMcpHttpTransport({}),null);
 assert.equal(readAgentMcpHttpTransport({LIFEOS_MCP_HTTP:'streamable-http-v1'}),'streamable-http-v1');
 for(const value of ['1','','enabled','streamable-http-v2'])assert.throws(()=>readAgentMcpHttpTransport({LIFEOS_MCP_HTTP:value}),/^Error: Agent runtime configuration unavailable$/);
});

test('enabled HTTP runtime refuses an incomplete Agent binding before SDK initialization without contacting a database',async()=>{
 const saved={...process.env};
 try{
  for(const key of Object.keys(process.env))if(key.startsWith('LIFEOS_'))delete process.env[key];
  Object.assign(process.env,binding,{LIFEOS_MCP_HTTP:'streamable-http-v1'});delete process.env.LIFEOS_AGENT_API_SECRET;
  const request=new Request(platform.LIFEOS_PLATFORM_BASE_URL+'/api/platform/mcp',{method:'POST',headers:{host:'review.example.test',authorization:'Bearer synthetic-runtime-only','Content-Type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2026-07-28',capabilities:{},clientInfo:{name:'synthetic-config-check',version:'1'}}})});
  // The existing handler discovers current API readiness before SDK setup;
  // retain its public failure contract rather than adding a second verifier.
  const response=await handleMcpHttpRequest(request);assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'MCP_API_UNAVAILABLE'});
 }finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
});

test('file runtime values are measured and cleared through both original launchers, with independent requirements dependencies',()=>{
 const files={LIFEOS_FILE_HANDOFF:'file-handoff-v1',LIFEOS_FILE_HANDOFF_DIRECTORY:'/private/tmp/synthetic-files',LIFEOS_FILE_HANDOFF_ALLOWED_ORIGINS:'["https://synthetic-files.example.invalid"]',LIFEOS_FILE_HANDOFF_MAX_BYTES:'1048576',LIFEOS_FILE_HANDOFF_MAX_RESERVED_BYTES:'4194304',LIFEOS_FILE_HANDOFF_SOURCE_TIMEOUT_MS:'2000'};
 const full={...oauthBinding,LIFEOS_PERSONAL_REQUIREMENTS:'requirements-v1',LIFEOS_AGENT_REQUIREMENTS:'requirements-v1',...files};
 const approved=validateReviewConfig(full),platform=readPlatformConfig(approved)!,personal=readPersonalConfig(approved,platform)!;
 assert.deepEqual(readAgentRuntimeConfig(approved,platform,personal),{databaseURL:agent.LIFEOS_AGENT_API_DATABASE_URL,secret:agent.LIFEOS_AGENT_API_SECRET});
 for(const apply of [applyReviewEnvironment,applyBoundStartupConfig]){
  const sink:Record<string,string|undefined>={};apply(approved,sink);for(const[key,value]of Object.entries({...oauthFlags,...files}))assert.equal(sink[key],value);
  apply(binding,sink);for(const key of Object.keys({...oauthFlags,...files}))assert.equal(sink[key],undefined);
 }
 for(const change of [{LIFEOS_FILE_HANDOFF:undefined},{LIFEOS_FILE_HANDOFF:'1'},{LIFEOS_FILE_HANDOFF_DIRECTORY:undefined},{LIFEOS_FILE_HANDOFF_ALLOWED_ORIGINS:'[]'},{LIFEOS_AGENT_REQUIREMENTS:undefined},{LIFEOS_PERSONAL_REQUIREMENTS:undefined}])assert.throws(()=>validateReviewConfig({...full,...change}));
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'file-startup-')),runtimePath=join(dir,'runtime.json'),gatePath=join(dir,'gate');let runtime:number|undefined,gate:number|undefined;
 try{
  mkdirSync(gatePath,{mode:0o700});const bytes=JSON.stringify(full);writeFileSync(runtimePath,bytes,{mode:0o600});runtime=openSync(runtimePath,constants.O_RDONLY|constants.O_NOFOLLOW);gate=openSync(gatePath,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  const r=fstatSync(runtime,{bigint:true}),g=fstatSync(gate,{bigint:true}),proof={version:1,runtime:{dev:String(r.dev),ino:String(r.ino),sha256:createHash('sha256').update(bytes).digest('hex')},gate:{dev:String(g.dev),ino:String(g.ino)}};
  const measured=readBoundStartupConfig(proof,{runtime,gate});for(const[key,value]of Object.entries(files))assert.equal(measured[key],value);
  assert.throws(()=>readBoundStartupConfig({...proof,runtime:{...proof.runtime,sha256:'0'.repeat(64)}},{runtime:runtime!,gate:gate!}),/^Error: STARTUP_MOUNT_UNVERIFIED$/);
 }finally{if(runtime!==undefined)closeSync(runtime);if(gate!==undefined)closeSync(gate);rmSync(dir,{recursive:true,force:true});}
});
