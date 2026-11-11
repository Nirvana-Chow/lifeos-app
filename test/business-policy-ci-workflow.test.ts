import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('both qualification workflows run the new storage SQL scope gate against a dedicated pinned policy service',()=>{
 for(const file of ['qualification.yml','visual-qualification.yml']){
  const workflow=readFileSync('.github/workflows/'+file,'utf8');
  const service=workflow.match(/^      policy-postgres:\n([\s\S]*?)(?=^    steps:|^      [a-z][a-z-]+:)/m)?.[1];
  assert.ok(service,file+' lacks a dedicated policy cluster');
  assert.match(service,/postgres:17\.11-bookworm@sha256:839fbb5a4942a7758dd93e18b42ea5649807491a0545b5eeeb8f0b8bb11857a5/);
  assert.match(service,/POSTGRES_DB: postgres/);assert.match(service,/127\.0\.0\.1:55449:5432/);
  const step=workflow.match(/      - name: Qualify fresh policy and storage-review SQL fences without skips\n([\s\S]*?)(?=      - name:)/)?.[1];
  assert.ok(step);assert.match(step,/RUN_BUSINESS_POLICY_POSTGRES_TESTS: '1'/);assert.match(step,/LIFEOS_POLICY_FIXTURE_CONTEXT: github-actions/);
  assert.match(step,/business-policy-ci-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(step,/--test-isolation=none --test-concurrency=1/);assert.match(step,/test\/agent-business-policy-postgres\.integration\.test\.ts/);
  assert.match(step,/len\(cases\) == 34/);assert.match(step,/storage review registration stays disabled until explicit activation and uses the actual scoped SQL fence/);
  assert.match(step,/\('skipped', 'failure', 'error'\)/);assert.doesNotMatch(step,/continue-on-error/);
  assert.match(workflow,/permissions:\n  contents: read\n  actions: read/);
 }
});
test('the actual policy JUnit gate refuses missing storage coverage, duplicates, skips and failures',()=>{
 const names=['migration changes no existing key and keeps exact legacy digest; policy starts closed','wrong owner/space, revocation and expiry independently deny and direct roles cannot mutate policy or registry','storage review registration stays disabled until explicit activation and uses the actual scoped SQL fence',...Array.from({length:31},(_,i)=>'Synthetic additional leaf '+i)];
 const root=mkdtempSync(join(tmpdir(),'lifeos-policy-junit-'));
 try{
  for(const file of ['qualification.yml','visual-qualification.yml']){
   const match=readFileSync('.github/workflows/'+file,'utf8').match(/python3 - <<'PY_BUSINESS_POLICY_PG'\n([\s\S]*?)\n          PY_BUSINESS_POLICY_PG/);assert.ok(match);
   const code=match[1]!.split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
   for(const mutation of ['none','missing-storage','duplicate','count','skipped','failure','error']){
    const rows=[...names];if(mutation==='missing-storage')rows[2]='Different leaf';if(mutation==='duplicate')rows[3]=rows[4]!;if(mutation==='count')rows.pop();
    writeFileSync(join(root,'business-policy-pg.xml'),'<testsuite>'+rows.map((name,i)=>`<testcase name="${name}">${i===0&&['skipped','failure','error'].includes(mutation)?`<${mutation}/>`:''}</testcase>`).join('')+'</testsuite>');
    const result=spawnSync('python3',['-c',code],{env:{...process.env,RUNNER_TEMP:root},encoding:'utf8'});
    if(mutation==='none')assert.equal(result.status,0,result.stderr);else assert.notEqual(result.status,0,mutation);
   }
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
