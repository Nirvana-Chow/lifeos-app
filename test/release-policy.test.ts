import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyRelease, fullGreenRecord} from '../scripts/release-policy.ts';
import {validateSuccessfulRun} from '../scripts/release-qualification.ts';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const valid = {baseline: fullGreenRecord, head: 'a'.repeat(40), ancestor: true, previousFailed: false,
 changes: [{status: 'M', path: 'src/ui-review/requirements-views.tsx'}]};
test('ordinary presentation changes use the cumulative full-green baseline', () => {
 assert.equal(classifyRelease(valid).profile, 'routine');
 assert.equal(classifyRelease({...valid, changes: [...valid.changes, {status: 'M', path: 'src/personal-candidate/service.ts'}]}).profile, 'full');
});
test('auth, scopes, SQL, routes, theme, dependencies, policy and unknown paths require full qualification', () => {
 for (const path of ['src/platform/auth.ts','src/agent-api/registry.ts','db/0014.sql','app/login/page.tsx','app/theme.css','package-lock.json','.github/workflows/ci.yml','scripts/release-policy.ts','src/new-module.ts'])
  assert.equal(classifyRelease({...valid, changes:[{status:'M',path}]}).profile,'full',path);
});
test('missing evidence, divergent history, failure, ambiguous status and unsafe names fail closed', () => {
 for (const patch of [{baseline:null},{baseline:{...fullGreenRecord,conclusion:'failure'}},{ancestor:false},{previousFailed:true},{head:'bad'},
  {changes:[{status:'R100',path:'src/ui-review/requirements-views.tsx'}]}, {changes:[{status:'D',path:'src/ui-review/requirements-views.tsx'}]},
  {changes:[{status:'M',path:'../src/ui-review/requirements-views.tsx'}]}, {changes:[]}])
  assert.equal(classifyRelease({...valid,...patch}).profile,'full');
});
test('a verified newer full-green record classifies the next UI update without changing the seed', () => {
 assert.equal(classifyRelease({...valid,baseline:{...fullGreenRecord,sourceSha:'b'.repeat(40),runId:'50000000000'}}).profile,'routine');
 assert.equal(classifyRelease({...valid,changes:[{status:'M',path:'.github/release-full-green.json'}]}).profile,'full');
});
test('workflow success cannot disguise skipped jobs, wrong source, attempt, repository or job identity',()=>{
 const sha='a'.repeat(40),url='https://github.com/Nirvana-Chow/lifeos-app/actions/runs/10';
 const repo={id:1443243170,full_name:'Nirvana-Chow/lifeos-app'};
 const run={id:10,run_attempt:1,head_sha:sha,workflow_id:20,path:'.github/workflows/qualification.yml',head_branch:'main',event:'push',status:'completed',conclusion:'success',repository:repo,head_repository:repo,html_url:url};
 const jobs={total_count:1,jobs:[{id:30,name:'actual native gate',run_id:10,run_attempt:1,head_sha:sha,status:'completed',conclusion:'success',html_url:url+'/job/30'}]};
 const expected={sha,workflowId:20,path:run.path,names:['actual native gate']};
 validateSuccessfulRun(run,jobs,expected);
 for(const mutation of [{conclusion:'skipped'},{head_sha:'b'.repeat(40)},{run_attempt:2},{run_id:11},{id:true},{html_url:'https://evil.invalid'}])assert.throws(()=>validateSuccessfulRun(run,{...jobs,jobs:[{...jobs.jobs[0],...mutation}]},expected));
 for(const mutation of [{repository:{id:1,full_name:'elsewhere/repo'}},{event:'pull_request'},{path:'.github/workflows/other.yml'},{conclusion:'failure'}])assert.throws(()=>validateSuccessfulRun({...run,...mutation},jobs,expected));
});
test('real cumulative Git diff retains earlier backend changes and detects executable-mode drift',()=>{
 const directory=mkdtempSync(join(tmpdir(),'lifeos-release-policy-'));
 const git=(...args:string[])=>execFileSync('git',['-c','user.name=Synthetic Fixture','-c','user.email=fixture@example.invalid',...args],{cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const ui='src/ui-review/requirements-views.tsx',backend='src/personal-candidate/service.ts';
 const commit=()=>{git('add','.');git('commit','-m','synthetic fixture only');};
 const baseline=()=>({...fullGreenRecord,sourceSha:git('rev-parse','HEAD'),treeSha:git('rev-parse','HEAD^{tree}')});
 const decide=(b:typeof fullGreenRecord)=>{
  const env={...process.env};delete env.SOURCE_SHA;
  return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`import {localReleaseDecision} from ${JSON.stringify(new URL('../scripts/release-policy.ts',import.meta.url).href)};console.log(JSON.stringify(localReleaseDecision(false,JSON.parse(process.argv[1]))))`,JSON.stringify(b)],{cwd:directory,env,encoding:'utf8'}));
 };
 try {
  git('init','-q');mkdirSync(join(directory,'src/ui-review'),{recursive:true});mkdirSync(join(directory,'src/personal-candidate'),{recursive:true});
  writeFileSync(join(directory,ui),'initial');writeFileSync(join(directory,backend),'initial');commit();const initial=baseline();
  writeFileSync(join(directory,ui),'presentation');commit();assert.equal(decide(initial).profile,'routine');
  const beforeMode=baseline();chmodSync(join(directory,ui),0o755);commit();assert.equal(decide(beforeMode).profile,'full');
  writeFileSync(join(directory,backend),'unqualified earlier backend change');commit();const afterBackend=git('rev-parse','HEAD');
  writeFileSync(join(directory,ui),'latest presentation');commit();const result=decide(initial);
  assert.equal(result.profile,'full');assert.ok(result.changedPaths.includes(backend));assert.notEqual(result.baselineSha,afterBackend);
 } finally {rmSync(directory,{recursive:true,force:true});}
});
