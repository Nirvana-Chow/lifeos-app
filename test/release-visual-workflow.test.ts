import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const required=readFileSync('.github/workflows/qualification.yml','utf8');
const visual=readFileSync('.github/workflows/visual-qualification.yml','utf8');
const groups:Record<string,string[]>={
 recovery:['isolated real Next, Caddy TLS and PostgreSQL recovery'],
 permit:['isolated Next permits logout after a previously valid business permit is revoked'],
 journal:['isolated synthetic journal receipt and refresh readback'],
 browser:['no-JS page lifecycle finishes and closes before the next page opens','isolated browser owner recovery and password flow','isolated private business route boundaries','isolated private appearance and draft lifecycle'],
};
test('required release JUnit guard accepts exact four browser cases and rejects missing extra or skipped cases',()=>{
 const match=required.match(/python3 - <<'PY_GUARD'\n([\s\S]*?)\n          PY_GUARD/);assert.ok(match);
 const code=match[1]!.split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
 const root=mkdtempSync(join(tmpdir(),'lifeos-release-junit-'));
 const run=(mutation:'none'|'missing'|'matrix'|'skip')=>{
  for(const [name,names] of Object.entries(groups)){
   const cases=[...names];if(name==='browser'&&mutation==='missing')cases.pop();if(name==='browser'&&mutation==='matrix')cases.push('isolated private business presentation matrix');
   writeFileSync(join(root,`rendered-${name}.xml`),`<testsuite>${cases.map((label,index)=>`<testcase name="${label}">${name==='browser'&&mutation==='skip'&&index===0?'<skipped/>':''}</testcase>`).join('')}</testsuite>`);
  }
  return spawnSync('python3',['-c',code],{env:{...process.env,RUNNER_TEMP:root},encoding:'utf8'});
 };
 try{assert.equal(run('none').status,0);for(const mutation of ['missing','matrix','skip']as const)assert.notEqual(run(mutation).status,0,mutation);}
 finally{rmSync(root,{recursive:true,force:true});}
});
test('required security and data fixtures remain named and the visual matrix cannot mint release evidence',()=>{
 for(const file of ['organization-key-network.integration.test.ts','organization-agent-postgres.integration.test.ts','classification-postgres.integration.test.ts','requirements-postgres.integration.test.ts','platform-postgres.integration.test.ts','platform-auth-postgres.integration.test.ts','ai-settings-postgres.integration.test.ts','calendar-candidate-postgres.integration.test.ts','agent-api-postgres.integration.test.ts','platform-network.integration.test.ts','platform-capture-network.integration.test.ts','owner-recovery-postgres.integration.test.ts','owner-mfa-postgres.integration.test.ts','agent-key-issuer-postgres.integration.test.ts','owner-recovery-https.integration.test.ts','owner-permit-https.integration.test.ts','owner-journal-browser.integration.test.ts'])assert.ok(required.includes(file),file);
 assert.match(required,/LIFEOS_OWNER_BROWSER_QUALIFICATION_MODE: release/);
 assert.doesNotMatch(required,/vtable-baseline|0371234b6b472790a4b1bc78a5869a2251fda68e|synthetic-rendered-qualification\.json|owner-personal-browser-screenshots\/|isolated private business presentation matrix/);
 assert.match(required,/name: lifeos-full-green-v1/);
 assert.match(visual,/LIFEOS_OWNER_BROWSER_QUALIFICATION_MODE: visual/);
 assert.match(visual,/workflow_dispatch:/);assert.match(visual,/paths:/);assert.match(visual,/profile=full/);
 assert.match(visual,/0371234b6b472790a4b1bc78a5869a2251fda68e/);assert.match(visual,/isolated private business presentation matrix/);
 assert.match(visual,/len\(manifest\['images'\]\)==118/);assert.doesNotMatch(visual,/name: lifeos-full-green-v1/);
});
