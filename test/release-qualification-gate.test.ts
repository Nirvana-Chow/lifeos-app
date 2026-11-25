import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import * as gate from '../scripts/release-qualification.ts';

const sha='a'.repeat(40),repo={id:1443243170,full_name:'Nirvana-Chow/lifeos-app'};
function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'lifeos-visual-gate-'));
 const git=(...args:string[])=>execFileSync('git',['-c','user.name=Synthetic Fixture','-c','user.email=fixture@example.invalid',...args],{cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const put=(path:string,value:string)=>{mkdirSync(join(directory,path,'..'),{recursive:true});writeFileSync(join(directory,path),value);};
 const commit=()=>{git('add','.');git('commit','-qm','synthetic gate fixture');return git('rev-parse','HEAD');};
 git('init','-q','-b','main');put('docs/readme.md','initial');const before=commit();
 const context=(after:string)=>({sha:after,event:'push',headBranch:'main',payload:{before,after,ref:'refs/heads/main',deleted:false,forced:false,repository:repo}});
 return {directory,git,put,commit,before,context,close:()=>rmSync(directory,{recursive:true,force:true})};
}
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

test('release control changes do not request the visual matrix',()=>{
 const f=fixture();try{
  f.put('scripts/release-qualification.ts','synthetic gate fix');f.put('.github/workflows/ci.yml','synthetic workflow fix');
  const head=f.commit();assert.deepEqual(gate.readVisualScope(f.context(head),f.directory),{required:false,reason:'push-paths-not-matched'});
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
test('native glob ambiguity on hidden path segments is unconfirmed, never irrelevant',()=>{
 for(const path of ['components/.hidden.tsx','src/.hidden/view.tsx','components/.github/view.tsx','../src/view.tsx','/src/view.tsx','src\\view.tsx',
  'app/.well-known/other/route.ts','app/.well-known/oauth-authorization-server/route.ts','app/.well-known/oauth-authorization-server/[[...issuer]]/page.tsx',
  'app/.well-known/oauth-authorization-server/[[...issuer]]/route.ts/extra','app/.well-known/oauth-protected-resource/[...resource]/route.ts',
  'app/.well-known/oauth-protected-resource/[[...resource]]/route.tsx','app/.well-known/.hidden/route.ts','app/.well-known/oauth-protected-resource/[[...resource]]//route.ts',
  'app/.well-known/oauth-protected-resource/../[[...resource]]/route.ts','App/.well-known/oauth-protected-resource/[[...resource]]/route.ts',
 ])assert.throws(()=>gate.visualPathsApply([path]),/VISUAL_SCOPE_UNCONFIRMED/);
});

const workflowPath='.github/workflows/ci.yml';
const workflow=readFileSync(new URL('../'+workflowPath,import.meta.url),'utf8');
const jobSections=Object.fromEntries([...workflow.split('jobs:\n')[1]!.matchAll(/^  ([a-z-]+):\n([\s\S]*?)(?=^  [a-z-]+:\n|$(?![\s\S]))/gm)]
 .filter(match=>match[2].includes('    runs-on: ubuntu-24.04'))
 .map(match=>[match[1],{
  name:/^    name: (.+)$/m.exec(match[2])![1]!,
  steps:[...match[2].matchAll(/^      - (?:id: [^\n]+\n        )?name: (.+)\n((?:(?!^      - )[\s\S])*)/gm)]
   .map(step=>({name:step[1]!,condition:/^        if: (.+)$/m.exec(step[2])?.[1]})),
 }]));
const capture='Upload only named synthetic images and their finite manifest';
const captureGuard='Verify finite synthetic capture manifest and PNGs';
const attemptUrl=(runId:number,attempt:number)=>`/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`;
function attempt(profile:'routine'|'full',ui:boolean,{sha:source=sha,runId=51,attempt=1,audit=profile==='full'}={}){
 const identity={sha:source,runId,attempt},key=`${source}:${runId}:${attempt}`,suffix=key.replaceAll(':','-');
 const full=profile==='full';
 const visual=full&&ui;
 const results={'policy':'success','checks':'success','platform':full?'success':'skipped',
  'recovery-pg':full?'success':'skipped','rendered':full?'success':'skipped'};
 const needs=Object.fromEntries(Object.entries(results).map(([name,result])=>[name,{result,outputs:{} as Record<string,string>}]));
 needs.policy.outputs={identity:key,profile,visual:String(visual),ui:String(ui),audit:String(audit)};
 if(full)needs.rendered.outputs={identity:key,'build-id':'synthetic_build','compiled-id':'601',...(visual?{'capture-id':'602'}:{})};
 const ran=(condition?:string)=>{
  if(!condition)return true;
  const predicates=condition.split(/ (?:&&|\|\|) /).map(part=>part.includes('outputs.visual')?visual:part.includes('outputs.ui')?ui:part.includes('outputs.audit')?audit:full);
  return condition.includes(' || ')?predicates.some(Boolean):predicates.every(Boolean);
 };
 const url=`https://github.com/${repo.full_name}/actions/runs/${runId}`;
 const jobs=Object.entries(jobSections).map(([name,section],i)=>{
  const id=100+i,conclusion=results[name as keyof typeof results]??'success';
  return {id,name:section.name,run_id:runId,run_attempt:attempt,head_sha:source,html_url:url+'/job/'+id,
   status:name==='eligibility'?'in_progress':'completed',conclusion,
   steps:section.steps.map(step=>({name:step.name,status:'completed',conclusion:ran(step.condition)?'success':'skipped'}))};
 });
 const response={total_count:jobs.length,jobs};
 const rendered=jobs.find(job=>job.name===jobSections.rendered.name)!;
 const artifact=(id:number,name:string)=>({id,name,expired:false,size_in_bytes:100,digest:'sha256:'+'c'.repeat(64),
  workflow_run:{id:runId,repository_id:repo.id,head_repository_id:repo.id,head_branch:'main',head_sha:source}});
 const compiled=artifact(601,'lifeos-compiled-'+suffix),images=artifact(602,'synthetic-rendered-'+suffix);
 const calls:string[]=[];
 const api=async (path:string)=>{
  calls.push(path);
  if(path===attemptUrl(runId,attempt))return response;
  if(path==='/actions/artifacts/601')return compiled;
  if(path==='/actions/artifacts/602')return images;
  throw Error('Unexpected evidence request '+path);
 };
 return {identity,needs,response,jobs,rendered,compiled,images,api,calls,verify:()=>gate.verifyAttempt(identity,ui,needs,api)};
}
for(const profile of ['routine','full'] as const)for(const ui of [false,true])test(`exact-attempt producers close profile=${profile}, UI=${ui}`,async()=>{
 const a=attempt(profile,ui),visual=profile==='full'&&ui;
 assert.deepEqual(await a.verify(),{sourceSha:sha,runId:51,runAttempt:1,profile,visual:visual?'verified':'not-scheduled'});
 assert.deepEqual(a.calls,[attemptUrl(51,1),...(profile==='full'?['/actions/artifacts/601']:[]),...(visual?['/actions/artifacts/602']:[])]);
});

const failures:[string,(value:ReturnType<typeof attempt>)=>void][]=[
 ['failed DAG prerequisite',a=>{a.needs.checks.result='failure';}],
 ['unplanned skipped DAG prerequisite',a=>{a.needs.rendered.result='skipped';}],
 ['cancelled recovery',a=>{a.needs['recovery-pg'].result='cancelled';}],
 ['failed named job',a=>{a.rendered.conclusion='failure';}],
 ['cancelled named job',a=>{a.rendered.conclusion='cancelled';}],
 ['timed-out named job',a=>{a.rendered.conclusion='timed_out';}],
 ['skipped named job',a=>{a.rendered.conclusion='skipped';}],
 ['still running required job',a=>{a.rendered.status='in_progress';}],
 ['wrong producer SHA',a=>{a.rendered.head_sha='b'.repeat(40);}],
 ['wrong producer run',a=>{a.rendered.run_id=52;}],
 ['old producer attempt',a=>{a.rendered.run_attempt=1;}],
 ['old policy output attempt',a=>{a.needs.policy.outputs.identity=sha+':51:1';}],
 ['missing producer with a green DAG result',a=>{a.jobs.splice(a.jobs.indexOf(a.rendered),1);a.response.total_count--; }],
 ['two jobs with the same name',a=>{a.jobs[0].name=a.jobs[1].name;}],
 ['two jobs with the same ID',a=>{a.jobs[0].id=a.jobs[1].id;}],
 ['missing capture guard',a=>{a.rendered.steps=a.rendered.steps.filter(step=>step.name!==captureGuard);}],
 ['duplicate capture guard',a=>{a.rendered.steps.push({...a.rendered.steps.find(step=>step.name===captureGuard)!});}],
 ['skipped capture guard',a=>{a.rendered.steps.find(step=>step.name===captureGuard)!.conclusion='skipped';}],
 ['failed capture guard',a=>{a.rendered.steps.find(step=>step.name===captureGuard)!.conclusion='failure';}],
 ['pending capture guard',a=>{a.rendered.steps.find(step=>step.name===captureGuard)!.status='in_progress';}],
 ['skipped named upload',a=>{a.rendered.steps.find(step=>step.name===capture)!.conclusion='skipped';}],
 ['required security case absent',a=>{const p=a.jobs.find(job=>job.name===jobSections.platform.name)!;p.steps=p.steps.filter(step=>!step.name.startsWith('Qualify native MFA'));}],
 ['dependency audit required but absent',a=>{const j=a.jobs.find(job=>job.name===jobSections.policy.name)!;j.steps=j.steps.filter(step=>!step.name.includes('security audit'));}],
 ['missing screenshot artifact ID',a=>{delete a.needs.rendered.outputs['capture-id'];}],
 ['missing compiled artifact ID',a=>{delete a.needs.rendered.outputs['compiled-id'];}],
 ['expired screenshot archive',a=>{a.images.expired=true;}],
 ['wrong screenshot digest',a=>{a.images.digest='';}],
 ['artifact from the wrong attempt',a=>{a.images.name=a.images.name.replace(/-2$/,'-1');}],
 ['artifact from another SHA',a=>{a.images.workflow_run.head_sha='b'.repeat(40);}],
 ['artifact from another run',a=>{a.images.workflow_run.id=52;}],
 ['artifact from another repository',a=>{a.images.workflow_run.head_repository_id=1;}],
 ['UI scope falsely reported as skipped',a=>{a.needs.policy.outputs.visual='false';}],
];
for(const [name,mutate] of failures)test('rejects '+name,async()=>{
 const a=attempt('full',true,{attempt:2});mutate(a);await assert.rejects(a.verify());
});

test('only expected skips are accepted and a full rerun can supply all fresh producers',async()=>{
 const a=attempt('routine',false);
 const optional=a.jobs.findIndex(job=>job.name===jobSections.platform.name);
 a.jobs.splice(optional,1);a.response.total_count--;
 await a.verify();
 a.needs.platform.result='success';await assert.rejects(a.verify(),/DAG_SCOPE_UNCONFIRMED/);
 a.needs.platform.result='skipped';
 a.jobs.splice(a.jobs.indexOf(a.rendered),1);a.response.total_count--;
 await a.verify();
 await attempt('full',true,{attempt:2}).verify();
});

test('routine UI has no hosted build or browser qualification',async()=>{
 const a=attempt('routine',true);
 await a.verify();
 a.needs.rendered.result='success';
 await assert.rejects(a.verify(),/DAG_SCOPE_UNCONFIRMED/);
 a.needs.rendered.result='skipped';
 a.needs.rendered.outputs['build-id']='unexpected';
 await assert.rejects(a.verify(),/UNEXPECTED_COMPILED_EVIDENCE/);
});

test('audit follows dependency edits or the existing manual qualification entry',async()=>{
 const ordinary={profile:'routine',reason:'presentation-only-since-full-green',baselineSha:sha,changedPaths:['src/ui-review/requirements-page.tsx']} as const;
 assert.equal(gate.dependencyAuditRequired({...ordinary,changedPaths:[...ordinary.changedPaths]},'push'),false);
 assert.equal(gate.dependencyAuditRequired({...ordinary,profile:'full',changedPaths:['src/platform/auth.ts']},'push'),false);
 assert.equal(gate.dependencyAuditRequired({...ordinary,profile:'full',changedPaths:['package-lock.json']},'push'),true);
 assert.equal(gate.dependencyAuditRequired({...ordinary,changedPaths:[]},'workflow_dispatch'),true);
 await attempt('full',false,{audit:false}).verify();
});

test('visual scope matches key UI and fixture paths',()=>{
 for(const path of ['app/page.tsx','app/nested/theme.css','components/button.ts','src/cooking/detail.tsx','src/cooking/log-workbench.module.css',
  'test/cooking-browser.integration.test.ts','test/helpers/personal-synthetic-bootstrap.ts','test/helpers/task-grid-performance-fixture.ts',
  'test/helpers/auth-theme-fixture-lifecycle.ts','scripts/synthetic-rendered-qualification.ts',
  'scripts/client-bundle-evidence.mjs','src/workbench/theme.ts','scripts/ci/prepare-runner-cjk-fonts.sh','test/ci-cjk-fonts.test.ts'])
  assert.equal(gate.visualPathsApply([path]),true,path);
 for(const path of ['docs/readme.md','src/platform/auth.ts','db/001.sql','test/ordinary.test.ts','scripts/attach-vtable-benchmark.py','scripts/release-qualification.ts',workflowPath])
  assert.equal(gate.visualPathsApply([path]),false,path);
});

test('dispatch accepts explicit UI opt-in and rejects unsupported scope',()=>{
 const context={sha,event:'workflow_dispatch',headBranch:'main',payload:{}};
 assert.equal(gate.readVisualScope(context).required,false);
 assert.equal(gate.readVisualScope({...context,payload:{inputs:{visual:'true'}}}).required,true);
 assert.throws(()=>gate.readVisualScope({...context,payload:{inputs:{visual:'unknown'}}}),/VISUAL_SCOPE_UNCONFIRMED/);
 assert.throws(()=>gate.readVisualScope({...context,event:'unknown'}),/VISUAL_SCOPE_UNCONFIRMED/);
});

test('real CLI classifies first as full and final gate rejects missing exact-attempt browser evidence',()=>{
 const f=fixture();
 try {
  f.put('src/screen.tsx','synthetic UI');
  const head=f.commit(),eventFile=join(f.directory,'event.json'),preload=join(f.directory,'preload.mjs'),output=join(f.directory,'output');
  writeFileSync(eventFile,JSON.stringify(f.context(head).payload));
  const a=attempt('full',true,{sha:head});
  const responses={[attemptUrl(51,1)]:a.response,'/actions/artifacts/601':a.compiled,'/actions/artifacts/602':a.images};
  const run=(mode:string,fixtureResponses:unknown,resolvedWorkflow=workflowPath)=>{
   writeFileSync(preload,`const rows=${JSON.stringify(fixtureResponses)};globalThis.fetch=async url=>{const suffix=url.replace('https://api.github.com/repos/${repo.full_name}','');return {ok:Object.hasOwn(rows,suffix),text:async()=>JSON.stringify(rows[suffix])};};`);
   return spawnSync(process.execPath,['--import',preload,new URL('../scripts/release-qualification.ts',import.meta.url).pathname,mode],{
    cwd:f.directory,encoding:'utf8',timeout:5000,
    env:{NODE_ENV:'test',PATH:process.env.PATH,SOURCE_SHA:head,GITHUB_SHA:head,GITHUB_WORKFLOW_SHA:head,GITHUB_WORKFLOW_REF:repo.full_name+'/'+resolvedWorkflow+'@refs/heads/main',
     GITHUB_EVENT_NAME:'push',GITHUB_EVENT_PATH:eventFile,GITHUB_REPOSITORY:repo.full_name,GITHUB_REPOSITORY_ID:String(repo.id),
     GITHUB_REF:'refs/heads/main',GITHUB_RUN_ID:'51',GITHUB_RUN_ATTEMPT:'1',GITHUB_OUTPUT:output,CI_NEEDS:JSON.stringify(a.needs)},
   });
  };
  const classifyResult=run('--classify',{});
  assert.equal(classifyResult.status,0,classifyResult.stderr);
  assert.match(readFileSync(output,'utf8'),/^profile=full\nui=true\nvisual=true\naudit=true\nidentity=/);
  const good=run('--verify',responses);
  assert.equal(good.status,0,good.stderr);
  assert.equal(JSON.parse(good.stdout).visual,'verified');
  assert.match(run('--verify',responses,'.github/workflows/other.yml').stderr,/SOURCE_IDENTITY_UNCONFIRMED/);
  a.rendered.status='in_progress';
  const rejected=run('--verify',responses);
  assert.equal(rejected.status,1);
  assert.match(rejected.stderr,/REQUIRED_JOB_UNCONFIRMED/);
 }finally{f.close();}
});
