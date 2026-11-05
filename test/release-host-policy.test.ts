import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {classifyRelease,fullGreenRecord} from '../scripts/release-policy.ts';
const policy=JSON.parse(readFileSync(new URL('../.github/release-path-policy.json',import.meta.url),'utf8'));
test('trusted host classifier matches cumulative source classification and fails closed on prior failures',()=>{
 const paths=['src/ui-review/requirements-views.tsx','app/theme.css','src/platform/auth.ts','db/0014.sql','package-lock.json','.github/workflows/ci.yml','docs/example.md','unknown.ts'];
 for(const path of paths)for(const failed of [false,true]) {
  const row={path,mode:'100644',gitBlobSha:'a'.repeat(40)};const changed={...row,gitBlobSha:'b'.repeat(40)};
  const payload=JSON.stringify({policy,baseline:fullGreenRecord,previous:[row],current:[changed],ancestor:true,previous_failed:failed});
  const actual=execFileSync('python3',['-c',"import sys,json;sys.dont_write_bytecode=True;from scripts.release_eligibility import classify;print(classify(**json.load(sys.stdin)))"],{input:payload,encoding:'utf8'}).trim();
  assert.equal(actual,classifyRelease({baseline:fullGreenRecord,head:'c'.repeat(40),ancestor:true,previousFailed:failed,changes:[{status:'M',path}]}).profile);
 }
});
test('trusted host refuses deletion and mode changes instead of treating them as ordinary UI updates',()=>{
 const row={path:'src/ui-review/requirements-views.tsx',mode:'100644',gitBlobSha:'a'.repeat(40)};
 for(const current of [[],[{...row,mode:'100755'}]]) {
  const actual=execFileSync('python3',['-c',"import sys,json;sys.dont_write_bytecode=True;from scripts.release_eligibility import classify;print(classify(**json.load(sys.stdin)))"],{input:JSON.stringify({policy,baseline:fullGreenRecord,previous:[row],current,ancestor:true,previous_failed:false}),encoding:'utf8'}).trim();
  assert.equal(actual,'full');
 }
});
test('trusted full qualification rejects skipped jobs, mismatched attempts and duplicate job IDs',()=>{
 const program=`import sys,copy
sys.dont_write_bytecode=True
from scripts.release_eligibility import qualify_full,FULL_JOBS
sha='a'*40;url='https://github.com/Nirvana-Chow/lifeos-app/actions/runs/10';repo={'id':1443243170,'full_name':'Nirvana-Chow/lifeos-app'}
run={'id':10,'run_attempt':1,'head_sha':sha,'head_branch':'main','event':'push','status':'completed','conclusion':'success','workflow_id':20,'path':'.github/workflows/qualification.yml','repository':repo,'head_repository':repo,'html_url':url}
jobs={'total_count':3,'jobs':[{'id':30+i,'name':n,'head_sha':sha,'run_id':10,'run_attempt':1,'status':'completed','conclusion':'success','html_url':url+'/job/'+str(30+i)} for i,n in enumerate(sorted(FULL_JOBS))]}
assert qualify_full(run,jobs,20,sha)
for patch in ({'conclusion':'skipped'},{'run_attempt':2},{'head_sha':'b'*40},{'id':31}):
 changed=copy.deepcopy(jobs);changed['jobs'][0].update(patch)
 try:qualify_full(run,changed,20,sha)
 except ValueError:pass
 else:raise AssertionError('invalid full qualification accepted')
print('native full qualification negative cases passed')`;
 assert.match(execFileSync('python3',['-c',program],{encoding:'utf8'}),/negative cases passed/);
});
