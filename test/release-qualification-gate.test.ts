import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import * as gate from '../scripts/release-qualification.ts';

const sha='a'.repeat(40),repo={id:1443243170,full_name:'Nirvana-Chow/lifeos-app'};
const requiredNames=['Qualification policy','Tests, types, webpack, isolated Auth and PostgreSQL','Isolated PostgreSQL recovery and native MFA'];
const visualNames=['Visual qualification scope','Visual source and isolated fixture prerequisites','Visual matrix and historical renderer benchmark'];
const guardName='Verify every enabled case and the finite synthetic capture manifest';
function evidence(kind:'required'|'visual',attempt=1){
 const id=kind==='required'?10:11,workflowId=kind==='required'?20:21,path='.github/workflows/'+(kind==='required'?'qualification':'visual-qualification')+'.yml',url=`https://github.com/Nirvana-Chow/lifeos-app/actions/runs/${id}`;
 const run={id,run_attempt:attempt,head_sha:sha,workflow_id:workflowId,path,head_branch:'main',event:'push',status:'completed',conclusion:'success',repository:repo,head_repository:repo,html_url:url};
 const jobs={total_count:3,jobs:(kind==='required'?requiredNames:visualNames).map((name,index)=>({id:id*10+index,name,run_id:id,run_attempt:attempt,head_sha:sha,status:'completed',conclusion:'success',html_url:url+'/job/'+(id*10+index),steps:kind==='visual'&&index===2?[{name:guardName,status:'completed',conclusion:'success'}]:[]}))};
 return {run,jobs,workflow:{id:workflowId,path,state:'active'}};
}
function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'lifeos-visual-gate-'));
 const git=(...args:string[])=>execFileSync('git',['-c','user.name=Synthetic Fixture','-c','user.email=fixture@example.invalid',...args],{cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const put=(path:string,value:string)=>{mkdirSync(join(directory,path,'..'),{recursive:true});writeFileSync(join(directory,path),value);};
 const commit=()=>{git('add','.');git('commit','-qm','synthetic gate fixture');return git('rev-parse','HEAD');};
 git('init','-q','-b','main');put('docs/readme.md','initial');const before=commit();
 const context=(after:string)=>({sha:after,event:'push',headBranch:'main',payload:{before,after,ref:'refs/heads/main',deleted:false,forced:false,repository:repo}});
 return {directory,git,put,commit,before,context,close:()=>rmSync(directory,{recursive:true,force:true})};
}
function harness(options:{profile?:'routine'|'full';visualRequired?:boolean;pendingVisual?:boolean;mutate?:(kind:'required'|'visual',value:ReturnType<typeof evidence>)=>void}={}){
 let now=0,visualPending=!!options.pendingVisual;const calls:string[]=[],sleeps:number[]=[];
 const values={required:evidence('required'),visual:evidence('visual')};for(const kind of ['required','visual'] as const)options.mutate?.(kind,values[kind]);
 const api=async(path:string)=>{
  calls.push(path);const kind=path.includes('visual-qualification')||path.includes('/21/')||path==='/actions/runs/11'||path.includes('/runs/11/')?'visual':'required';const value=values[kind];
  if(path==='/actions/workflows/qualification.yml'||path==='/actions/workflows/visual-qualification.yml')return structuredClone(value.workflow);
  if(path.includes('/runs?'))return {workflow_runs:[structuredClone({...value.run,...(kind==='visual'&&visualPending?{status:'in_progress',conclusion:null}:{})})]};
  if(path.includes('/jobs?'))return structuredClone(value.jobs);
  if(path==='/actions/runs/'+value.run.id)return structuredClone({...value.run,...(kind==='visual'&&visualPending?{status:'in_progress',conclusion:null}:{})});
  throw Error('Unexpected synthetic endpoint '+path);
 };
 const input={sha,event:'push',headBranch:'main',profile:options.profile??'full',visualRequired:options.visualRequired??true};
 return {input,api,calls,sleeps,values,now:()=>now,sleep:async(ms:number)=>{sleeps.push(ms);now+=ms;visualPending=false;},advance:(ms:number)=>{now+=ms;}};
}

test('real --wait CLI rejects required-green while the applicable same-SHA visual never completes',()=>{
 const f=fixture();try{
  f.put('src/screen.tsx','synthetic UI');const head=f.commit();const event=join(f.directory,'event.json'),preload=join(f.directory,'preload.mjs');writeFileSync(event,JSON.stringify(f.context(head).payload));
  const r=evidence('required');r.run.head_sha=head;for(const job of r.jobs.jobs)job.head_sha=head;
  writeFileSync(preload,`let now=0;Date.now=()=>now;globalThis.setTimeout=(cb,ms)=>{now+=ms;queueMicrotask(cb);return 0;};const e=${JSON.stringify(r)};globalThis.fetch=async url=>{const p=new URL(url).pathname.replace('/repos/Nirvana-Chow/lifeos-app','');let v;if(p==='/actions/workflows/qualification.yml')v=e.workflow;else if(p==='/actions/workflows/visual-qualification.yml')v={id:21,path:'.github/workflows/visual-qualification.yml',state:'active'};else if(p.includes('/workflows/20/runs?')||p==='/actions/workflows/20/runs')v={workflow_runs:[e.run]};else if(p.includes('/workflows/21/runs'))v={workflow_runs:[]};else if(p==='/actions/runs/10')v=e.run;else if(p.includes('/actions/runs/10/attempts/1/jobs'))v=e.jobs;return {ok:v!==undefined,text:async()=>JSON.stringify(v??{})};};`);
  const result=spawnSync(process.execPath,['--import',preload,new URL('../scripts/release-qualification.ts',import.meta.url).pathname,'--wait'],{cwd:f.directory,env:{NODE_ENV:'test',PATH:process.env.PATH,SOURCE_SHA:head,GITHUB_REPOSITORY:repo.full_name,GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_PATH:event,GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'100'},encoding:'utf8',timeout:20000});
  assert.equal(result.error,undefined);assert.notEqual(result.status,0,'Required green cannot release an expected but absent visual run');assert.match(result.stderr,/QUALIFICATION_NOT_COMPLETED/);
 }finally{f.close();}
});

test('finite waiter holds required success until same-SHA visual jobs and capture guard succeed',async()=>{
 const h=harness({pendingVisual:true});const result=await gate.waitForReleaseQualification(h.input,h);
 assert.equal(h.sleeps.length,1);assert.equal(h.sleeps[0],20000);assert.equal(result.visualRunId,11);assert.equal(result.visualRunAttempt,1);assert.equal(result.qualificationRunId,10);
});
test('routine matching UI waits visual while routine docs make no Actions calls',async()=>{
 const ui=harness({profile:'routine',pendingVisual:true});assert.equal((await gate.waitForReleaseQualification(ui.input,ui)).visualRunId,11);assert.ok(!ui.calls.some(p=>p.includes('qualification.yml')&&!p.includes('visual-qualification')));
 const docs=harness({profile:'routine',visualRequired:false});assert.equal((await gate.waitForReleaseQualification(docs.input,docs)).visual,'not-scheduled');assert.deepEqual(docs.calls,[]);
});
test('full changes outside visual scope retain required-only qualification',async()=>{
 const h=harness({visualRequired:false});const result=await gate.waitForReleaseQualification(h.input,h);assert.equal(result.qualificationRunId,10);assert.equal(result.visual,'not-scheduled');assert.ok(!h.calls.some(p=>p.includes('visual')));
});
test('visual skipped failed cancelled timed-out jobs and guard cannot masquerade as success',async()=>{
 for(const mutation of ['failure','cancelled','timed_out','skipped','missing-guard','guard-failure','guard-skipped','guard-pending','job-failure','job-skipped','wrong-sha','wrong-branch','wrong-repo','wrong-workflow','wrong-attempt','missing-job','duplicate-job']){
  const h=harness({mutate:(kind,e)=>{if(kind!=='visual')return;
   if(['failure','cancelled','timed_out','skipped'].includes(mutation))e.run.conclusion=mutation;
   if(mutation==='missing-guard')e.jobs.jobs[2]!.steps=[];
   if(mutation.startsWith('guard-'))e.jobs.jobs[2]!.steps[0]!.conclusion=mutation.slice(6);
   if(mutation==='guard-pending')e.jobs.jobs[2]!.steps[0]!.status='in_progress';
   if(mutation.startsWith('job-'))e.jobs.jobs[0]!.conclusion=mutation.slice(4);
   if(mutation==='wrong-sha')e.jobs.jobs[0]!.head_sha='b'.repeat(40);
   if(mutation==='wrong-branch')e.run.head_branch='elsewhere';
   if(mutation==='wrong-repo')e.run.repository={id:1,full_name:'elsewhere/repo'};
   if(mutation==='wrong-workflow')e.run.workflow_id=999;
   if(mutation==='wrong-attempt')e.jobs.jobs[0]!.run_attempt=2;
   if(mutation==='missing-job')e.jobs.jobs.pop();
   if(mutation==='duplicate-job')e.jobs.jobs[2]!.name=e.jobs.jobs[1]!.name;
  }});await assert.rejects(gate.waitForReleaseQualification(h.input,h),mutation);
 }
});
test('missing pending and unrelated visual runs exhaust one shared40minute deadline with20second polls',async()=>{
 for(const mode of ['missing','pending','other-source','other-event']){
  const h=harness();let now=0;const api=async(path:string)=>{
   if(path.includes('/workflows/21/runs?'))return {workflow_runs:mode==='missing'?[]:[{...evidence('visual').run,...(mode==='pending'?{status:'queued',conclusion:null}:mode==='other-source'?{head_sha:'b'.repeat(40)}:{event:'workflow_dispatch'})}]};
   return h.api(path);
  };let sleeps=0;await assert.rejects(gate.waitForReleaseQualification(h.input,{api,now:()=>now,sleep:async(ms)=>{assert.ok(ms>0&&ms<=20000);now+=ms;sleeps++;}}),/QUALIFICATION_NOT_COMPLETED/);assert.equal(now,2400000);assert.equal(sleeps,120);
 }
});
test('required wait consumes the shared deadline rather than opening a second visual deadline',async()=>{
 const h=harness();let now=0;const api=async(path:string)=>{if(path.includes('/workflows/20/runs?')&&now<2380000)return {workflow_runs:[]};if(path.includes('/workflows/21/runs?'))return {workflow_runs:[]};return h.api(path);};
 await assert.rejects(gate.waitForReleaseQualification(h.input,{api,now:()=>now,sleep:async(ms)=>{now+=ms;}}),/QUALIFICATION_NOT_COMPLETED/);assert.equal(now,2400000);
});
test('a stale listing cannot qualify jobs from an older run attempt',async()=>{
 const h=harness();let seen=false;const api=async(path:string)=>{if(path==='/actions/runs/11'&&!seen){seen=true;return {...evidence('visual',2).run,conclusion:'failure'};}return h.api(path);};
 await assert.rejects(gate.waitForReleaseQualification(h.input,{...h,api}));assert.ok(seen);
});
test('visual re-run after required verification cannot borrow the earlier successful attempt',async()=>{
 const h=harness();let changed=false;const api=async(path:string)=>{if(path.includes('/runs/11/attempts/1/jobs'))changed=true;if(path==='/actions/runs/11'&&changed)return {...evidence('visual',2).run,conclusion:'failure'};return h.api(path);};await assert.rejects(gate.waitForReleaseQualification(h.input,{...h,api}));
});

test('a new required run while visual waits invalidates the cached successful run',async()=>{
 const h=harness({pendingVisual:true});const api=async(path:string)=>{
  if(path.includes('/workflows/20/runs?')&&h.now()>0)return {workflow_runs:[{...evidence('required').run,id:12,status:'queued',conclusion:null},evidence('required').run]};
  return h.api(path);
 };
 await assert.rejects(gate.waitForReleaseQualification(h.input,{...h,api}),/QUALIFICATION_NOT_COMPLETED/);
 assert.equal(h.now(),2400000);
});
test('an index advertising attempt2 cannot qualify direct attempt1 and its old jobs',async()=>{
 const h=harness();const api=async(path:string)=>path.includes('/workflows/21/runs?')?{workflow_runs:[evidence('visual',2).run]}:h.api(path);
 await assert.rejects(gate.waitForReleaseQualification(h.input,{...h,api}),/QUALIFICATION_NOT_COMPLETED/);
 assert.equal(h.now(),2400000);assert.ok(!h.calls.some(path=>path.includes('/runs/11/attempts/1/jobs')));
});

for(const direction of ['index-ahead','direct-ahead'] as const)test(`temporary ${direction} attempt metadata waits and then converges`,async()=>{
 const h=harness();const api=async(path:string)=>{
  const e=evidence('visual',2);
  if(path.includes('/workflows/21/runs?'))return {workflow_runs:[direction==='direct-ahead'&&h.now()===0?evidence('visual').run:e.run]};
  if(path==='/actions/runs/11')return direction==='index-ahead'&&h.now()===0?evidence('visual').run:e.run;
  if(path.includes('/runs/11/attempts/2/jobs'))return e.jobs;
  return h.api(path);
 };
 const result=await gate.waitForReleaseQualification(h.input,{...h,api});
 assert.equal(result.visualRunAttempt,2);assert.deepEqual(h.sleeps,[20000]);
 assert.ok(!h.calls.some(path=>path.includes('/runs/11/attempts/1/jobs')));
});
test('closing index attempt change clears cached jobs until direct metadata converges',async()=>{
 const h=harness();let indexes=0;const api=async(path:string)=>{
  const e=evidence('required',2);
  if(path.includes('/workflows/20/runs?'))return {workflow_runs:[++indexes===1?evidence('required').run:e.run]};
  if(path==='/actions/runs/10')return h.now()===0?evidence('required').run:e.run;
  if(path.includes('/runs/10/attempts/2/jobs'))return e.jobs;
  return h.api(path);
 };
 const result=await gate.waitForReleaseQualification(h.input,{...h,api});
 assert.equal(result.attempt,2);assert.deepEqual(h.sleeps,[20000]);
});
for(const conclusion of ['success','failure'] as const)test(`new required run must itself reach ${conclusion} before closing`,async()=>{
 const h=harness({pendingVisual:true});const api=async(path:string)=>{
  if(h.now()>0){
   const e=evidence('required');e.run.id=12;e.run.html_url='https://github.com/Nirvana-Chow/lifeos-app/actions/runs/12';
   for(const job of e.jobs.jobs){job.run_id=12;job.id+=20;job.html_url=e.run.html_url+'/job/'+job.id;}
   if(h.now()<40000){e.run.status='queued';e.run.conclusion='';}else e.run.conclusion=conclusion;
   if(path.includes('/workflows/20/runs?'))return {workflow_runs:[e.run,evidence('required').run]};
   if(path==='/actions/runs/12')return e.run;
   if(path.includes('/runs/12/attempts/1/jobs'))return e.jobs;
  }
  return h.api(path);
 };
 if(conclusion==='failure')await assert.rejects(gate.waitForReleaseQualification(h.input,{...h,api}));
 else assert.equal((await gate.waitForReleaseQualification(h.input,{...h,api})).qualificationRunId,12);
 assert.deepEqual(h.sleeps,[20000,20000]);assert.equal(h.now(),40000);
});
test('stable latest indexes close without sleeping and are independently reread',async()=>{
 const h=harness();const result=await gate.waitForReleaseQualification(h.input,h);
 assert.equal(result.qualificationRunId,10);assert.equal(result.visualRunId,11);assert.deepEqual(h.sleeps,[]);
 for(const id of [20,21])assert.equal(h.calls.filter(path=>path.includes(`/workflows/${id}/runs?`)).length,2);
});

test('native glob scope matches every declared positive visual path, with literal behavioral boundaries',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/visual-qualification.yml',import.meta.url),'utf8');const section=workflow.split('    paths:\n')[1]!.split('  workflow_dispatch:')[0]!;
 const declared=[...section.matchAll(/^      - '([^']+)'$/gm)].map(m=>m[1]);assert.deepEqual([...gate.VISUAL_PATHS],declared);
 for(const path of ['app/page.tsx','app/nested/theme.css','components/button.ts','src/cooking/detail.tsx','src/cooking/log-workbench.module.css','test/cooking-browser.integration.test.ts','test/helpers/personal-synthetic-bootstrap.ts','test/helpers/task-grid-performance-fixture.ts','test/helpers/auth-theme-fixture-lifecycle.ts','scripts/synthetic-rendered-qualification.ts','scripts/release-qualification.ts','scripts/client-bundle-evidence.mjs','scripts/attach-vtable-benchmark.py','scripts/ci/prepare-runner-cjk-fonts.sh','test/ci-cjk-fonts.test.ts','.github/workflows/visual-qualification.yml'])assert.equal(gate.visualPathsApply([path]),true,path);
 for(const path of ['docs/readme.md','src/platform/auth.ts','db/001.sql','test/ordinary.test.ts'])assert.equal(gate.visualPathsApply([path]),false,path);
});

test('the two exact OAuth metadata routes are legal without scheduling a metadata-only visual run',()=>{
 const paths=['app/.well-known/oauth-authorization-server/[[...issuer]]/route.ts','app/.well-known/oauth-protected-resource/[[...resource]]/route.ts'];
 for(const path of paths)assert.equal(gate.visualPathsApply([path]),false,path);
 assert.equal(gate.visualPathsApply(paths),false);
 assert.equal(gate.visualPathsApply([...paths,'src/business-mcp-oauth/panel.tsx']),true);
});

test('actual metadata-only push is nonvisual and OAuth UI in the same push requires visual evidence',()=>{
 const f=fixture();try{
  f.put('app/.well-known/oauth-authorization-server/[[...issuer]]/route.ts','synthetic metadata');
  f.put('app/.well-known/oauth-protected-resource/[[...resource]]/route.ts','synthetic metadata');
  const metadata=f.commit();assert.deepEqual(gate.readVisualScope(f.context(metadata),f.directory),{required:false,reason:'push-paths-not-matched'});
  f.put('src/business-mcp-oauth/panel.tsx','synthetic UI');const ui=f.commit();assert.deepEqual(gate.readVisualScope(f.context(ui),f.directory),{required:true,reason:'push-paths-match'});
 }finally{f.close();}
});

test('a gate-source-only push requires its own visual qualification',()=>{
 const f=fixture();try{
  f.put('scripts/release-qualification.ts','synthetic gate fix');const head=f.commit();assert.deepEqual(gate.readVisualScope(f.context(head),f.directory),{required:true,reason:'push-paths-match'});
 }finally{f.close();}
});
test('real pushed Git scope includes added deleted and earlier multicommit UI changes',()=>{
 const f=fixture();try{
  f.put('src/cooking/detail.tsx','add UI');f.commit();f.put('docs/readme.md','latest docs');const head=f.commit();assert.equal(gate.readVisualScope(f.context(head),f.directory).required,true);
  const before=head;f.git('rm','src/cooking/detail.tsx');const after=f.commit();const context=f.context(after);context.payload.before=before;assert.equal(gate.readVisualScope(context,f.directory).required,true);
 }finally{f.close();}
});
test('real docs-only push is not visual; rename unknown context and excessive paths fail closed',()=>{
 const f=fixture();try{
  f.put('docs/readme.md','docs');let head=f.commit();assert.equal(gate.readVisualScope(f.context(head),f.directory).required,false);
  const renameBefore=head;f.git('mv','docs/readme.md','docs/renamed.md');head=f.commit();const rename=f.context(head);rename.payload.before=renameBefore;assert.throws(()=>gate.readVisualScope(rename,f.directory),/VISUAL_SCOPE_UNCONFIRMED/);
  for(const change of [{before:'0'.repeat(40)},{after:'b'.repeat(40)},{forced:true},{ref:'refs/heads/elsewhere'}]){const context=f.context(head);Object.assign(context.payload,change);assert.throws(()=>gate.readVisualScope(context,f.directory),/VISUAL_SCOPE_UNCONFIRMED/);}
 }finally{f.close();}
 const many=fixture();try{for(let i=0;i<301;i++)many.put(`docs/${i}.md`,'large push');const head=many.commit();assert.throws(()=>gate.readVisualScope(many.context(head),many.directory),/VISUAL_SCOPE_UNCONFIRMED/);}finally{many.close();}
});
test('dispatch explicitly requires visual and unsupported scope is never treated as irrelevant',()=>{
 assert.equal(gate.readVisualScope({sha,event:'workflow_dispatch',headBranch:'main',payload:{}},'/unused').required,true);
 assert.throws(()=>gate.readVisualScope({sha,event:'unknown',headBranch:'main',payload:{}},'/unused'),/VISUAL_SCOPE_UNCONFIRMED/);
});

test('--classify does not read visual event scope or wait on other workflows',()=>{
 const f=fixture();try{
  const preload=join(f.directory,'classify.mjs');writeFileSync(preload,`globalThis.fetch=async()=>{throw Error('synthetic classification unavailable');};`);
  const result=spawnSync(process.execPath,['--import',preload,new URL('../scripts/release-qualification.ts',import.meta.url).pathname,'--classify'],{cwd:f.directory,env:{NODE_ENV:'test',PATH:process.env.PATH,GITHUB_EVENT_PATH:'/missing-synthetic-event',GITHUB_EVENT_NAME:'push',GITHUB_RUN_ATTEMPT:'1',GITHUB_REPOSITORY:repo.full_name,SOURCE_SHA:f.before},encoding:'utf8',timeout:20000});
  assert.equal(result.error,undefined);assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).profile,'full');assert.equal(result.stderr,'');
 }finally{f.close();}
});

test('native glob ambiguity on hidden path segments is unconfirmed, never irrelevant',()=>{
 for(const path of ['components/.hidden.tsx','src/.hidden/view.tsx','components/.github/view.tsx','../src/view.tsx','/src/view.tsx','src\\view.tsx',
  'app/.well-known/other/route.ts','app/.well-known/oauth-authorization-server/route.ts','app/.well-known/oauth-authorization-server/[[...issuer]]/page.tsx',
  'app/.well-known/oauth-authorization-server/[[...issuer]]/route.ts/extra','app/.well-known/oauth-protected-resource/[...resource]/route.ts',
  'app/.well-known/oauth-protected-resource/[[...resource]]/route.tsx','app/.well-known/.hidden/route.ts','app/.well-known/oauth-protected-resource/[[...resource]]//route.ts',
  'app/.well-known/oauth-protected-resource/../[[...resource]]/route.ts','App/.well-known/oauth-protected-resource/[[...resource]]/route.ts',
 ])assert.throws(()=>gate.visualPathsApply([path]),/VISUAL_SCOPE_UNCONFIRMED/);
});
