import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const workflow=readFileSync('.github/workflows/ci.yml','utf8');
const groups:Record<string,string[]>={
 recovery:['isolated real Next, Caddy TLS and PostgreSQL recovery'],
 permit:['isolated Next permits logout after a previously valid business permit is revoked'],

};
test('required release JUnit guard accepts exact recovery and revoked-permit HTTPS cases and rejects missing extra or skipped cases',()=>{
 const match=workflow.match(/python3 - <<'PY_GUARD'\n([\s\S]*?)\n          PY_GUARD/);assert.ok(match);
 const code=match[1]!.split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
 const root=mkdtempSync(join(tmpdir(),'lifeos-release-junit-'));
 const run=(mutation:'none'|'missing'|'extra'|'skip'|'failure'|'error')=>{
  for(const [name,names] of Object.entries(groups)){
   const cases=[...names];
   if(name==='permit'&&mutation==='missing')cases.pop();
   if(name==='permit'&&mutation==='extra')cases.push('unexpected fixture');
   writeFileSync(join(root,`rendered-${name}.xml`),`<testsuite>${cases.map(label=>`<testcase name="${label}">${name==='permit'&&['skip','failure','error'].includes(mutation)?`<${mutation==='skip'?'skipped':mutation}/>`:''}</testcase>`).join('')}</testsuite>`);
  }
  return spawnSync('python3',['-c',code],{env:{...process.env,RUNNER_TEMP:root},encoding:'utf8'});
 };
 try{
  assert.equal(run('none').status,0);
  for(const mutation of ['missing','extra','skip','failure','error']as const)assert.notEqual(run(mutation).status,0,mutation);
 }
 finally{rmSync(root,{recursive:true,force:true});}
});
test('required security and data fixtures remain named and production CI never launches browsers',()=>{
 for(const file of ['organization-key-network.integration.test.ts','organization-agent-postgres.integration.test.ts','classification-postgres.integration.test.ts','requirements-postgres.integration.test.ts','platform-postgres.integration.test.ts','platform-auth-postgres.integration.test.ts','ai-settings-postgres.integration.test.ts','calendar-candidate-postgres.integration.test.ts','agent-api-postgres.integration.test.ts','platform-network.integration.test.ts','platform-capture-network.integration.test.ts','owner-recovery-postgres.integration.test.ts','owner-mfa-postgres.integration.test.ts','agent-key-issuer-postgres.integration.test.ts','owner-recovery-https.integration.test.ts','owner-permit-https.integration.test.ts'])assert.ok(workflow.includes(file),file);
 assert.match(workflow,/name: lifeos-unified-full-green-v1/);
 assert.doesNotMatch(workflow,/vtable-baseline|0371234b6b472790a4b1bc78a5869a2251fda68e|LIFEOS_SYNTHETIC_GRID_ROWS/);
 for(const command of ['npm test','npm run typecheck','npm audit --audit-level=high','docker build --pull'])
  assert.equal(workflow.split(command).length-1,1,command);
 assert.doesNotMatch(workflow,/google-chrome|RUN_.*BROWSER_TESTS:|owner-journal-browser\.integration/);
 for(const scenario of ['recovery','permit'])
  assert.equal(workflow.split('run_scenario '+scenario+'\n').length-1,1,scenario);
});
