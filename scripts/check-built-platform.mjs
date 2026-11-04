import{candidateBuildDirectory}from'../src/platform/build-directory.ts';
// Offline built-route check only: no listener, database, browser or provider call.
// This catches missing Next route exports which direct service tests cannot catch.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';

if (process.env.LIFEOS_PLATFORM_CANDIDATE !== '0') {
  throw new Error('Run only with LIFEOS_PLATFORM_CANDIDATE=0; this check never enables storage.');
}
const buildDirectory=candidateBuildDirectory(),root=process.cwd(),require=createRequire(import.meta.url);
const buildId=readFileSync(resolve(root,buildDirectory,'BUILD_ID'),'utf8').trim();
const checks=[];
for (const [artifact,requests] of [
  ['app/api/platform/[[...resource]]/route.js',[
    ['GET','status'],['GET','personal/availability'],['GET','personal/status'],['GET','personal/todo'],['POST','personal/todo'],['GET','personal/journal'],['POST','personal/journal'],['GET','personal/export'],['GET','ai/chat/status'],['POST','ai/chat'],['GET','ai/chat/turns'],['GET','ai/chat/turns/fixture-id'],['POST','ai/chat/turns/fixture-id/cancel'],['GET','ai/chat/export?includeSynthetic=true'],['GET','ai/chat/export-page?includeSynthetic=true'],['GET','ai/settings'],['PUT','ai/settings'],['PUT','ai/secret'],
    ['POST','ai/connection-test'],['GET','capture/status'],['POST','capture/preview'],['POST','capture/confirm'],
    ['GET','capture/runs/fixture-id'],['POST','capture/runs/fixture-id/cancel'],
    ['POST','todos'],['PATCH','todos/fixture-id'],['DELETE','ai/secret'],
    ['POST','journal'],['POST','calendar'],['GET','export'],
    ['GET','finance/compare'],['POST','records/training'],['GET','timeline'],['GET','timeline/page'],['GET','search/page'],['GET','records/project-links'],['GET','records/project/fixture-id/recap'],['GET','search'],['GET','search/source/inbox/fixture-id'],['POST','records/project'],['POST','records/project/fixture-id/review'],
  ]],
  ['app/api/platform/auth/[...all]/route.js',[
    ['GET','auth/get-session'],['POST','auth/sign-in/email'],
  ]],
]) {
  const {routeModule}=require(resolve(root,buildDirectory,'server',artifact));
  assert.ok(routeModule?.userland,`Next route artifact missing: ${artifact}`);
  for (const [method,path] of requests) {
    const handler=routeModule.userland[method];
    assert.equal(typeof handler,'function',`Built Next route must export ${method} for /api/platform/${path}`);
    const response=await handler(new Request('http://127.0.0.1:3193/api/platform/'+path,{
      method,headers:{host:'127.0.0.1:3193',origin:'http://127.0.0.1:3193','content-type':'application/json'},
      ...(method==='GET'?{}:{body:'{}'}),
    }));
    assert.equal(response.status,503,'Unconfigured runtime must remain closed');
    assert.equal((await response.json()).error.code,'PLATFORM_UNAVAILABLE');
    assert.match(response.headers.get('cache-control')??'',/no-store/);
    checks.push({method,path:'/api/platform/'+path,status:503});
  }
}
// This reviewed generic package is the sole anonymous static artifact under the
// platform prefix. Checking it separately must not relax the closed handlers.
const artifactPath='app/api/platform/agent-skill/route.js';
const {routeModule:skillRoute}=require(resolve(root,buildDirectory,'server',artifactPath));
assert.equal(typeof skillRoute?.userland?.GET,'function',`Built Next route missing: ${artifactPath}`);
const skillResponse=await skillRoute.userland.GET();
assert.equal(skillResponse.status,200,'Public Skill artifact stays available without private runtime');
assert.equal(skillResponse.headers.get('content-type'),'application/gzip');
assert.equal(skillResponse.headers.get('content-disposition'),'attachment; filename="lifeos-agent.tar.gz"');
assert.equal(skillResponse.headers.get('set-cookie'),null,'Generic download must not establish a session');
assert.ok(gunzipSync(Buffer.from(await skillResponse.arrayBuffer())).includes(Buffer.from('lifeos-agent/SKILL.md')));
checks.push({method:'GET',path:'/api/platform/agent-skill',status:200});
console.log(JSON.stringify({
  buildId,passed:true,checks,scope:'compiled Next userland handlers called in-process; no HTTP listener or browser',
  httpTransportTested:false,browserTested:false,databaseTested:false,externalModelCalls:0,
},null,2));
