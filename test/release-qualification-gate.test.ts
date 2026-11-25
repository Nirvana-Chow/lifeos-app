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
test('exact OAuth metadata and UI paths both preserve push provenance',()=>{
 const f=fixture();try{
  f.put('app/.well-known/oauth-authorization-server/[[...issuer]]/route.ts','synthetic metadata');
  f.put('app/.well-known/oauth-protected-resource/[[...resource]]/route.ts','synthetic metadata');
  const metadata=f.commit();gate.verifyReleaseScope(f.context(metadata),f.directory);
  f.put('src/business-mcp-oauth/panel.tsx','synthetic UI');const ui=f.commit();gate.verifyReleaseScope(f.context(ui),f.directory);
 }finally{f.close();}
});

test('release control changes preserve push provenance',()=>{
 const f=fixture();try{
  f.put('scripts/release-qualification.ts','synthetic gate fix');f.put('.github/workflows/ci.yml','synthetic workflow fix');
  const head=f.commit();gate.verifyReleaseScope(f.context(head),f.directory);
 }finally{f.close();}
});
test('real pushed Git scope includes added deleted and earlier multicommit UI changes',()=>{
 const f=fixture();try{
  f.put('src/cooking/detail.tsx','add UI');f.commit();f.put('docs/readme.md','latest docs');const head=f.commit();gate.verifyReleaseScope(f.context(head),f.directory);
  const before=head;f.git('rm','src/cooking/detail.tsx');const after=f.commit();const context=f.context(after);context.payload.before=before;gate.verifyReleaseScope(context,f.directory);
 }finally{f.close();}
});
test('renames, unknown events and excessive paths fail closed',()=>{
 const f=fixture();try{
  f.put('docs/readme.md','docs');let head=f.commit();gate.verifyReleaseScope(f.context(head),f.directory);
  const renameBefore=head;f.git('mv','docs/readme.md','docs/renamed.md');head=f.commit();const rename=f.context(head);rename.payload.before=renameBefore;assert.throws(()=>gate.verifyReleaseScope(rename,f.directory),/RELEASE_SCOPE_UNCONFIRMED/);
  for(const change of [{before:'0'.repeat(40)},{after:'b'.repeat(40)},{forced:true},{ref:'refs/heads/elsewhere'}]){const context=f.context(head);Object.assign(context.payload,change);assert.throws(()=>gate.verifyReleaseScope(context,f.directory),/RELEASE_SCOPE_UNCONFIRMED/);}
 }finally{f.close();}
 const many=fixture();try{for(let i=0;i<301;i++)many.put(`docs/${i}.md`,'large push');const head=many.commit();assert.throws(()=>gate.verifyReleaseScope(many.context(head),many.directory),/RELEASE_SCOPE_UNCONFIRMED/);}finally{many.close();}
});
test('unexpected hidden paths fail closed',()=>{
 const f=fixture();try{
  f.put('src/.hidden/view.tsx','synthetic');const head=f.commit();
  assert.throws(()=>gate.verifyReleaseScope(f.context(head),f.directory),/RELEASE_SCOPE_UNCONFIRMED/);
 }finally{f.close();}
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
function attempt(profile:'routine'|'full',{sha:source=sha,runId=51,attempt=1,audit=profile==='full'}={}){
 const identity={sha:source,runId,attempt},key=`${source}:${runId}:${attempt}`,suffix=key.replaceAll(':','-');
 const full=profile==='full';
 const results={'policy':'success','checks':'success','platform':full?'success':'skipped',
  'recovery-pg':full?'success':'skipped','rendered':full?'success':'skipped'};
 const needs=Object.fromEntries(Object.entries(results).map(([name,result])=>[name,{result,outputs:{} as Record<string,string>}]));
 needs.policy.outputs={identity:key,profile,audit:String(audit)};
 if(full)needs.rendered.outputs={identity:key,'build-id':'synthetic_build','compiled-id':'601'};
 const ran=(condition?:string)=>{
  if(!condition)return true;
  if(condition.includes("!= 'full'"))return !full;
  return condition.includes('outputs.audit')?audit:full;
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
 const compiled=artifact(601,'lifeos-compiled-'+suffix);
 const calls:string[]=[];
 const api=async (path:string)=>{
  calls.push(path);
  if(path===attemptUrl(runId,attempt))return response;
  if(path==='/actions/artifacts/601')return compiled;
  throw Error('Unexpected evidence request '+path);
 };
 return {identity,needs,response,jobs,rendered,compiled,api,calls,verify:()=>gate.verifyAttempt(identity,needs,api)};
}
for(const profile of ['routine','full'] as const)test(`exact-attempt producers close profile=${profile}`,async()=>{
 const a=attempt(profile);
 assert.deepEqual(await a.verify(),{sourceSha:sha,runId:51,runAttempt:1,profile,visual:'not-scheduled'});
 assert.deepEqual(a.calls,[attemptUrl(51,1),...(profile==='full'?['/actions/artifacts/601']:[])]);
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
 ['successful capture guard',a=>{a.rendered.steps.find(step=>step.name===captureGuard)!.conclusion='success';}],
 ['failed capture guard',a=>{a.rendered.steps.find(step=>step.name===captureGuard)!.conclusion='failure';}],
 ['pending capture guard',a=>{a.rendered.steps.find(step=>step.name===captureGuard)!.status='in_progress';}],
 ['successful named upload',a=>{a.rendered.steps.find(step=>step.name===capture)!.conclusion='success';}],
 ['required security case absent',a=>{const p=a.jobs.find(job=>job.name===jobSections.platform.name)!;p.steps=p.steps.filter(step=>!step.name.startsWith('Qualify native MFA'));}],
 ['dependency audit required but absent',a=>{const j=a.jobs.find(job=>job.name===jobSections.policy.name)!;j.steps=j.steps.filter(step=>!step.name.includes('security audit'));}],
 ['unexpected screenshot artifact ID',a=>{a.needs.rendered.outputs['capture-id']='602';}],
 ['missing compiled artifact ID',a=>{delete a.needs.rendered.outputs['compiled-id'];}],
 ['expired compiled archive',a=>{a.compiled.expired=true;}],
 ['wrong compiled digest',a=>{a.compiled.digest='';}],
 ['artifact from the wrong attempt',a=>{a.compiled.name=a.compiled.name.replace(/-2$/,'-1');}],
 ['artifact from another SHA',a=>{a.compiled.workflow_run.head_sha='b'.repeat(40);}],
 ['artifact from another run',a=>{a.compiled.workflow_run.id=52;}],
 ['artifact from another repository',a=>{a.compiled.workflow_run.head_repository_id=1;}],
];
for(const [name,mutate] of failures)test('rejects '+name,async()=>{
 const a=attempt('full',{attempt:2});mutate(a);await assert.rejects(a.verify());
});

test('only expected skips are accepted and a full rerun can supply all fresh producers',async()=>{
 const a=attempt('routine');
 const optional=a.jobs.findIndex(job=>job.name===jobSections.platform.name);
 a.jobs.splice(optional,1);a.response.total_count--;
 await a.verify();
 a.needs.platform.result='success';await assert.rejects(a.verify(),/DAG_SCOPE_UNCONFIRMED/);
 a.needs.platform.result='skipped';
 a.jobs.splice(a.jobs.indexOf(a.rendered),1);a.response.total_count--;
 await a.verify();
 await attempt('full',{attempt:2}).verify();
});

test('routine UI has no hosted build or browser qualification',async()=>{
 const a=attempt('routine');
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
 await attempt('full',{audit:false}).verify();
});

test('dispatch verifies main identity and rejects unsupported events',()=>{
 const context={sha,event:'workflow_dispatch',headBranch:'main',payload:{}};
 gate.verifyReleaseScope(context);
 assert.throws(()=>gate.verifyReleaseScope({...context,headBranch:'elsewhere'}),/RELEASE_SCOPE_UNCONFIRMED/);
 assert.throws(()=>gate.verifyReleaseScope({...context,event:'unknown'}),/RELEASE_SCOPE_UNCONFIRMED/);
});

test('real CLI classifies first as full with browser disabled and retains exact-attempt build evidence',()=>{
 const f=fixture();
 try {
  f.put('src/screen.tsx','synthetic UI');
  const head=f.commit(),eventFile=join(f.directory,'event.json'),preload=join(f.directory,'preload.mjs'),output=join(f.directory,'output');
  writeFileSync(eventFile,JSON.stringify(f.context(head).payload));
  const a=attempt('full',{sha:head});
  const responses={[attemptUrl(51,1)]:a.response,'/actions/artifacts/601':a.compiled};
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
  assert.match(readFileSync(output,'utf8'),/^profile=full\naudit=true\nidentity=/);
  const good=run('--verify',responses);
  assert.equal(good.status,0,good.stderr);
  assert.equal(JSON.parse(good.stdout).visual,'not-scheduled');
  assert.match(run('--verify',responses,'.github/workflows/other.yml').stderr,/SOURCE_IDENTITY_UNCONFIRMED/);
  a.rendered.status='in_progress';
  const rejected=run('--verify',responses);
  assert.equal(rejected.status,1);
  assert.match(rejected.stderr,/REQUIRED_JOB_UNCONFIRMED/);
 }finally{f.close();}
});
