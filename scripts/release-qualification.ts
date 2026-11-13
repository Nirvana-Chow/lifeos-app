import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {matchesGlob} from 'node:path';
import {fullGreenRecord, localReleaseDecision, outputDecision, releasePathPolicy} from './release-policy.ts';

const repository='Nirvana-Chow/lifeos-app';
const path='.github/workflows/qualification.yml';
type Row=Record<string,any>;
export function validateSuccessfulRun(run:Row, jobs:Row, expected:{sha:string;workflowId:number;path:string;names:string[];runId?:string;attempt?:string;event?:string;headBranch?:string}) {
 const require=(ok:boolean)=>{if(!ok)throw Error('QUALIFICATION_UNCONFIRMED');};
 require(Number.isSafeInteger(run.id)&&run.id>0&&Number.isSafeInteger(run.run_attempt)&&run.run_attempt>0);
 require(run.head_sha===expected.sha&&run.workflow_id===expected.workflowId&&run.path===expected.path&&run.head_branch===(expected.headBranch??'main')&&run.event===(expected.event??'push')&&run.status==='completed'&&run.conclusion==='success');
 if(expected.runId)require(String(run.id)===expected.runId&&String(run.run_attempt)===expected.attempt);
 for(const key of ['repository','head_repository'])require(run[key]?.id===1443243170&&run[key]?.full_name===repository);
 const url=`https://github.com/${repository}/actions/runs/${run.id}`;require(run.html_url===url);
 require(Array.isArray(jobs.jobs)&&jobs.total_count===expected.names.length&&jobs.jobs.length===expected.names.length);
 require(new Set(jobs.jobs.map((j:Row)=>j.id)).size===expected.names.length);
 require(new Set(jobs.jobs.map((j:Row)=>j.name)).size===expected.names.length&&expected.names.every(n=>jobs.jobs.some((j:Row)=>j.name===n)));
 for(const j of jobs.jobs)require(Number.isSafeInteger(j.id)&&j.id>0&&j.run_id===run.id&&j.run_attempt===run.run_attempt&&j.head_sha===run.head_sha&&j.status==='completed'&&j.conclusion==='success'&&j.html_url===url+'/job/'+j.id);
}
async function api(suffix:string):Promise<Row> {
 const token=process.env.GITHUB_TOKEN;
 const response=await fetch('https://api.github.com/repos/'+repository+suffix,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:'Bearer '+token}:{})}});
 if(!response.ok)throw Error('GITHUB_EVIDENCE_UNAVAILABLE');
 const raw=await response.text();if(raw.length>2*1024*1024)throw Error('GITHUB_EVIDENCE_TOO_LARGE');return JSON.parse(raw);
}
async function classify() {
 let previousFailed=true;
 let baseline=fullGreenRecord;
 try {
  if(process.env.GITHUB_REPOSITORY!==repository||process.env.GITHUB_EVENT_NAME!=='push'||process.env.GITHUB_RUN_ATTEMPT!=='1')throw Error('NOT_RELEASE_CONTEXT');
  const b=fullGreenRecord;
  const run=await api('/actions/runs/'+b.runId);
  const jobs=await api(`/actions/runs/${b.runId}/attempts/${b.runAttempt}/jobs?per_page=100`);
  validateSuccessfulRun(run,jobs,{sha:b.sourceSha,workflowId:b.workflowId,path:b.workflowPath,names:b.jobNames,runId:b.runId,attempt:b.runAttempt});
  const workflow=execFileSync('git',['show',b.sourceSha+':'+b.workflowPath],{maxBuffer:2*1024*1024});
  if(createHash('sha256').update(workflow).digest('hex')!==b.workflowSha256)throw Error('BASELINE_WORKFLOW_CHANGED');
  // The constant-name artifact is only a bounded index. Do not download or trust
  // its contents. Actual run/jobs, reviewed workflow bytes and ancestry decide.
  const index=await api('/actions/artifacts?name=lifeos-full-green-v1&per_page=10');
  const active=await api('/actions/workflows/qualification.yml');
  if(active.path!==path||!Number.isSafeInteger(active.id)||active.state!=='active')throw Error('QUALIFICATION_WORKFLOW_CHANGED');
  const expectedHash=createHash('sha256').update(readFileSync(new URL('../.github/workflows/qualification.yml',import.meta.url))).digest('hex');
  for(const artifact of (index.artifacts??[]) as Row[]) {
   if(artifact.expired||artifact.name!=='lifeos-full-green-v1'||!Number.isSafeInteger(artifact.workflow_run?.id))continue;
   const full=await api('/actions/runs/'+artifact.workflow_run.id);
   if(full.status!=='completed'||full.conclusion!=='success'||full.path!==path||full.head_sha===process.env.SOURCE_SHA)continue;
   const cases=await api(`/actions/runs/${full.id}/attempts/${full.run_attempt}/jobs?per_page=100`);
   try {
    validateSuccessfulRun(full,cases,{sha:full.head_sha,workflowId:active.id,path,names:releasePathPolicy.qualificationJobs});
    execFileSync('git',['merge-base','--is-ancestor',baseline.sourceSha,full.head_sha],{stdio:'ignore'});
    execFileSync('git',['merge-base','--is-ancestor',full.head_sha,process.env.SOURCE_SHA!],{stdio:'ignore'});
    const bytes=execFileSync('git',['show',full.head_sha+':'+path],{maxBuffer:2*1024*1024});
    if(createHash('sha256').update(bytes).digest('hex')!==expectedHash)continue;
    baseline={...b,sourceSha:full.head_sha,treeSha:execFileSync('git',['rev-parse',full.head_sha+'^{tree}'],{encoding:'utf8'}).trim(),runId:String(full.id),runAttempt:String(full.run_attempt),workflowId:full.workflow_id,workflowPath:path,workflowSha256:expectedHash,jobNames:releasePathPolicy.qualificationJobs};
   } catch {continue;}
  }
  const history=await api('/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=10');
  const rows=(history.workflow_runs??[]) as Row[];
  const sameFailed=rows.some(r=>r.head_sha===process.env.SOURCE_SHA&&String(r.id)!==process.env.GITHUB_RUN_ID&&r.status==='completed'&&r.conclusion!=='success');
  const prior=rows.filter(r=>r.head_sha!==process.env.SOURCE_SHA).sort((a,b)=>b.id-a.id)[0];
  previousFailed=sameFailed||!prior||prior.status!=='completed'||prior.conclusion!=='success';
 } catch {previousFailed=true;}
 return localReleaseDecision(previousFailed,baseline);
}
// These positive patterns mirror the existing visual push trigger; a contract
// test prevents trigger drift from silently turning a scheduled run irrelevant.
export const VISUAL_PATHS=[
 'app/**/*.tsx','app/**/*.css','components/**','src/**/*.tsx','src/**/*.css','test/**/*browser*',
 'test/helpers/personal-*.ts','test/helpers/task-grid-performance-fixture.ts','test/helpers/auth-theme-fixture-lifecycle.ts',
 'scripts/synthetic-rendered-qualification.ts','scripts/client-bundle-evidence.mjs','scripts/attach-vtable-benchmark.py',
 'scripts/ci/prepare-runner-cjk-fonts.sh','test/ci-cjk-fonts.test.ts','.github/workflows/visual-qualification.yml',
] as const;
const visualNames=['Visual qualification scope','Visual source and isolated fixture prerequisites','Visual matrix and historical renderer benchmark'];
const visualGuard='Verify every enabled case and the finite synthetic capture manifest';
function confirmed(ok:unknown,code='QUALIFICATION_UNCONFIRMED'):asserts ok {if(!ok)throw Error(code);}
export function visualPathsApply(paths:string[]):boolean {
 // Native glob dot-segment handling is not assumed equal to Actions patterns.
 // Refuse that ambiguity; the literal .github workflow path stays supported.
 confirmed(paths.length<=300&&paths.every(p=>typeof p==='string'&&p.length>0&&!p.startsWith('/')&&!p.split('/').some((v,index)=>!v||v==='.'||v==='..'||(v.startsWith('.')&&!(index===0&&v==='.github')))&&!/[\\\x00-\x1f\x7f\ufffd]/.test(p)),'VISUAL_SCOPE_UNCONFIRMED');
 return paths.some(p=>VISUAL_PATHS.some(pattern=>matchesGlob(p,pattern)));
}
type ScopeContext={sha:string;event:string;headBranch:string;payload:unknown};
export function readVisualScope(context:ScopeContext,directory=process.cwd()):{required:boolean;reason:string} {
 const reject=()=>{throw Error('VISUAL_SCOPE_UNCONFIRMED');};
 if(!/^[a-f0-9]{40}$/.test(context.sha)||context.headBranch!=='main')return reject();
 if(context.event==='workflow_dispatch')return {required:true,reason:'explicit-dispatch'};
 const payload=context.payload as Row|null;
 if(context.event!=='push'||!payload||typeof payload!=='object'||payload.after!==context.sha||payload.ref!=='refs/heads/main'||payload.deleted!==false||payload.forced!==false||payload.repository?.id!==1443243170||payload.repository?.full_name!==repository||typeof payload.before!=='string'||!/^[a-f0-9]{40}$/.test(payload.before)||/^0+$/.test(payload.before))return reject();
 try {
  const git=(...args:string[])=>execFileSync('git',args,{cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:2*1024*1024});
  confirmed(git('rev-parse','HEAD').trim()===context.sha,'VISUAL_SCOPE_UNCONFIRMED');
  git('merge-base','--is-ancestor',payload.before,context.sha);
  const count=Number(git('rev-list','--count',payload.before+'..'+context.sha).trim());
  confirmed(Number.isSafeInteger(count)&&count>0&&count<=1000,'VISUAL_SCOPE_UNCONFIRMED');
  // Use the actual push's two-tree diff, not the cumulative full-green diff.
  // Explicit rename detection keeps unsupported R/C/type cases fail-closed.
  const fields=git('diff','--name-status','-z','--find-renames',payload.before,context.sha).split('\0');
  confirmed(fields.pop()===''&&fields.length%2===0&&fields.length<=600,'VISUAL_SCOPE_UNCONFIRMED');
  const paths:string[]=[];
  for(let i=0;i<fields.length;i+=2){confirmed(['A','D','M'].includes(fields[i]!),'VISUAL_SCOPE_UNCONFIRMED');paths.push(fields[i+1]!);}
  const required=visualPathsApply(paths);return {required,reason:required?'push-paths-match':'push-paths-not-matched'};
 }catch{return reject();}
}
type GateInput={sha:string;event:string;headBranch:string;profile:'routine'|'full';visualRequired:boolean};
type GateDependencies={api:(suffix:string)=>Promise<Row>;now:()=>number;sleep:(milliseconds:number)=>Promise<void>};
type Target={path:string;names:string[];workflowId:number;visual:boolean};
export async function waitForReleaseQualification(input:GateInput,deps:GateDependencies):Promise<{sourceSha:string;profile:string;visual:'verified'|'not-scheduled';qualificationRunId?:number;attempt?:number;visualRunId?:number;visualRunAttempt?:number}> {
 confirmed(/^[a-f0-9]{40}$/.test(input.sha)&&input.headBranch==='main'&&['push','workflow_dispatch'].includes(input.event)&&['routine','full'].includes(input.profile)&&typeof input.visualRequired==='boolean');
 const deadline=deps.now()+40*60*1000;
 const alive=()=>confirmed(deps.now()<deadline,'QUALIFICATION_NOT_COMPLETED');
 const get=async(suffix:string)=>{alive();const value=await deps.api(suffix);alive();return value;};
 const targets:Target[]=[];
 for(const descriptor of [
  ...(input.profile==='full'?[{path,names:releasePathPolicy.qualificationJobs,visual:false}]:[]),
  ...(input.visualRequired?[{path:'.github/workflows/visual-qualification.yml',names:visualNames,visual:true}]:[]),
 ]){
  const workflow=await get('/actions/workflows/'+descriptor.path.split('/').at(-1));
  confirmed(workflow.path===descriptor.path&&Number.isSafeInteger(workflow.id)&&workflow.id>0&&workflow.state==='active');
  targets.push({...descriptor,workflowId:workflow.id});
 }
 const verified=new Map<Target,{run:Row;jobs:Row}>();
 const validate=(target:Target,run:Row,jobs:Row)=>{
  validateSuccessfulRun(run,jobs,{sha:input.sha,workflowId:target.workflowId,path:target.path,names:target.names,event:input.event,headBranch:input.headBranch});
  if(target.visual){
   const steps=jobs.jobs.find((j:Row)=>j.name===visualNames[2])?.steps;
   confirmed(Array.isArray(steps));const guards=steps.filter((step:Row)=>step.name===visualGuard);
   confirmed(guards.length===1&&guards[0].status==='completed'&&guards[0].conclusion==='success','VISUAL_CAPTURE_GUARD_UNCONFIRMED');
  }
 };
 while(deps.now()<deadline){
  for(const target of targets){
   if(verified.has(target))continue;
   const index=await get(`/actions/workflows/${target.workflowId}/runs?head_sha=${input.sha}&per_page=10`);
   confirmed(Array.isArray(index.workflow_runs)&&index.workflow_runs.length<=10&&index.workflow_runs.every((r:Row)=>r&&Number.isSafeInteger(r.id)&&r.id>0));
   const run=(index.workflow_runs as Row[]).filter(r=>r.head_sha===input.sha&&r.event===input.event).sort((a,b)=>b.id-a.id)[0];
   if(run?.status!=='completed')continue;
   // The list is only an index. Read the actual current attempt before jobs.
   const current=await get('/actions/runs/'+run.id);confirmed(current.id===run.id);
   if(current.status!=='completed')continue;
   confirmed(Number.isSafeInteger(current.run_attempt)&&current.run_attempt>0);
   const jobs=await get(`/actions/runs/${current.id}/attempts/${current.run_attempt}/jobs?per_page=100`);validate(target,current,jobs);
   const after=await get('/actions/runs/'+current.id);
   if(after.run_attempt!==current.run_attempt||after.status!=='completed')continue;
   validate(target,after,jobs);verified.set(target,{run:after,jobs});
  }
  if(verified.size===targets.length){
   // One workflow may be rerun while the other is pending. Do not borrow its
   // previously successful attempt when closing the combined release gate.
   for(const [target,evidence] of verified){
    const current=await get('/actions/runs/'+evidence.run.id);
    if(current.run_attempt!==evidence.run.run_attempt||current.status!=='completed'){verified.delete(target);continue;}
    validate(target,current,evidence.jobs);
   }
   if(verified.size===targets.length){
    const required=[...verified].find(([t])=>!t.visual)?.[1].run,visual=[...verified].find(([t])=>t.visual)?.[1].run;
    return {sourceSha:input.sha,profile:input.profile,visual:visual?'verified':'not-scheduled',...(required?{qualificationRunId:required.id,attempt:required.run_attempt}:{}),...(visual?{visualRunId:visual.id,visualRunAttempt:visual.run_attempt}:{})};
   }
  }
  const remaining=deadline-deps.now();if(remaining>0)await deps.sleep(Math.min(20000,remaining));
 }
 throw Error('QUALIFICATION_NOT_COMPLETED');
}
async function main() {
 const decision=await classify();outputDecision(decision);
 if(process.argv.includes('--classify'))return;
 if(!process.argv.includes('--wait'))throw Error('MODE_REQUIRED');
 const event=process.env.GITHUB_EVENT_NAME??'',headBranch=process.env.GITHUB_HEAD_REF||process.env.GITHUB_REF?.replace(/^refs\/heads\//,'')||'main';
 let payload:unknown;try{payload=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!,'utf8'));}catch{throw Error('VISUAL_SCOPE_UNCONFIRMED');}
 const scope=readVisualScope({sha:process.env.SOURCE_SHA??'',event,headBranch,payload});
 const result=await waitForReleaseQualification({sha:process.env.SOURCE_SHA!,event,headBranch,profile:decision.profile,visualRequired:scope.required},{api,now:Date.now,sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms))});
 console.log(JSON.stringify({...result,visualScope:scope.reason}));
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(error=>{const code=error instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(error.message)?error.message:'QUALIFICATION_UNCONFIRMED';console.error('Release eligibility rejected: '+code);process.exitCode=1;});
