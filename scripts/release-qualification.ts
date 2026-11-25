import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {appendFileSync, readFileSync} from 'node:fs';
import {matchesGlob} from 'node:path';
import {fullGreenRecord, localReleaseDecision, outputDecision, type Decision} from './release-policy.ts';

const repository='Nirvana-Chow/lifeos-app';
const path='.github/workflows/ci.yml';
const repositoryId=1443243170;
type Row=Record<string,any>;
export function validateSuccessfulRun(run:Row, jobs:Row, expected:{sha:string;workflowId:number;path:string;names:string[];runId?:string;attempt?:string;event?:string;headBranch?:string}) {
 const require=(ok:boolean)=>{if(!ok)throw Error('QUALIFICATION_UNCONFIRMED');};
 require(Number.isSafeInteger(run.id)&&run.id>0&&Number.isSafeInteger(run.run_attempt)&&run.run_attempt>0);
 require(run.head_sha===expected.sha&&run.workflow_id===expected.workflowId&&run.path===expected.path&&run.head_branch===(expected.headBranch??'main')&&run.event===(expected.event??'push')&&run.status==='completed'&&run.conclusion==='success');
 if(expected.runId)require(String(run.id)===expected.runId&&String(run.run_attempt)===expected.attempt);
 for(const key of ['repository','head_repository'])require(run[key]?.id===repositoryId&&run[key]?.full_name===repository);
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
// Push scope uses the exact two-tree event diff. Dispatch takes an explicit UI input.
export const VISUAL_PATHS=[
 'app/**/*.tsx','app/**/*.css','components/**','src/**/*.tsx','src/**/*.css','test/**/*browser*',
 'test/helpers/personal-*.ts','test/helpers/task-grid-performance-fixture.ts','test/helpers/auth-theme-fixture-lifecycle.ts',
 'scripts/synthetic-rendered-qualification.ts','scripts/client-bundle-evidence.mjs',
 'src/workbench/theme.ts',
 'scripts/ci/prepare-runner-cjk-fonts.sh','test/ci-cjk-fonts.test.ts',
] as const;
const oauthMetadataPaths=new Set([
 'app/.well-known/oauth-authorization-server/[[...issuer]]/route.ts',
 'app/.well-known/oauth-protected-resource/[[...resource]]/route.ts',
]);
function confirmed(ok:unknown,code='QUALIFICATION_UNCONFIRMED'):asserts ok {if(!ok)throw Error(code);}
export function visualPathsApply(paths:string[]):boolean {
 // Native glob dot-segment handling is not assumed equal to Actions patterns.
 // Refuse that ambiguity except the existing root .github segment and two
 // reviewed metadata files. Those exact .ts routes do not themselves match UI.
 confirmed(paths.length<=300&&paths.every(p=>typeof p==='string'&&p.length>0&&!p.startsWith('/')&&!p.split('/').some((v,index)=>!v||v==='.'||v==='..'||(v.startsWith('.')&&!(index===0&&v==='.github')&&!(index===1&&v==='.well-known'&&oauthMetadataPaths.has(p))))&&!/[\\\x00-\x1f\x7f\ufffd]/.test(p)),'VISUAL_SCOPE_UNCONFIRMED');
 return paths.some(p=>VISUAL_PATHS.some(pattern=>matchesGlob(p,pattern)));
}
type ScopeContext={sha:string;event:string;headBranch:string;payload:unknown};
export function readVisualScope(context:ScopeContext,directory=process.cwd()):{required:boolean;reason:string} {
 const reject=()=>{throw Error('VISUAL_SCOPE_UNCONFIRMED');};
 if(!/^[a-f0-9]{40}$/.test(context.sha)||context.headBranch!=='main')return reject();
 const payload=context.payload as Row|null;
 if(context.event==='workflow_dispatch'){
  const input=payload?.inputs?.visual;
  confirmed(input===undefined||input===false||input===true||input==='false'||input==='true','VISUAL_SCOPE_UNCONFIRMED');
  const required=input===true||input==='true';
  return {required,reason:required?'explicit-dispatch':'dispatch-without-ui'};
 }
 if(context.event!=='push'||!payload||typeof payload!=='object'||payload.after!==context.sha||payload.ref!=='refs/heads/main'||payload.deleted!==false||payload.forced!==false||payload.repository?.id!==repositoryId||payload.repository?.full_name!==repository||typeof payload.before!=='string'||!/^[a-f0-9]{40}$/.test(payload.before)||/^0+$/.test(payload.before))return reject();
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

export function dependencyAuditRequired(decision:Decision,event:string) {
 return event==='workflow_dispatch'||decision.reason==='local-evidence-unavailable'||!decision.changedPaths.length||
  decision.changedPaths.some(file=>/(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|\.npmrc)$/.test(file));
}

const evidence = {
 policy: {
  name: 'Qualification policy',
  steps: ['Confirm exact source identity', 'Classify cumulative changes from the verified full-green ancestor'],
 },
 checks: {
  name: 'Unit, types and source contracts',
  steps: ['Confirm exact source and single npm lock', 'Unit and source contract tests (optional integrations are not acceptance)',
   'Generate route types without building an application', 'Type check', 'Preserve dependency identity'],
 },
 platform: {
  name: 'Isolated Auth, permissions and PostgreSQL',
  steps: ['Require compiled output from this exact attempt', 'Download exact compiled Next output', 'Read back the transferred build identity',
   'Qualify native MFA same-key scopes through mounted Next PATCH and real issuer socket',
   'Qualify organization SQL scope CAS producer fences ordered locks and ACL readiness',
   'Qualify enabled atomic classification on the source-bound organization PostgreSQL service',
   'Qualify fresh policy and storage-review SQL fences without skips', 'Qualify isolated requirements persistence and Agent grants without skips',
   'Prepare the empty runner-local synthetic PostgreSQL fixture', 'Bootstrap synthetic identities with FD3 and independent readback',
   'Run actual Auth and core/AI/calendar PostgreSQL tests with no skipped cases',
   'Verify machine grants, revocation and todo writes on synthetic PostgreSQL',
   'Run actual Next HTTP, login, ownership, rate-limit and capture tests', 'Confirm installation and verification preserved the committed lock'],
 },
 'recovery-pg': {
  name: 'Isolated PostgreSQL recovery and native MFA',
  steps: ['Confirm exact source identity', 'Create restricted synthetic fixture and failure injection triggers', 'Bootstrap fixture identities',
   'Run real PG recovery checks without skips', 'Run isolated native MFA PostgreSQL acceptance',
   'Verify isolated Agent key management after native MFA provisioning', 'Confirm verification preserved the committed lock'],
 },
 rendered: {
  name: 'Exact package and isolated TLS/browser qualification',
  steps: ['Confirm exact source identity', 'Install fixed runner-only Chinese fonts and check native Chrome/NSS',
   'Confirm verification preserved the committed lock'],
 },
};
const compiledStep = 'Publish exact compiled Next output';
const captureStep = 'Upload only named synthetic images and their finite manifest';
const fullFixtureSteps = ['Build the exact public source image and read back its source proof', 'Verify compiled default-closed routes', compiledStep,
 'Run scoped TLS recovery, permit, browser and journal scenarios', 'Verify exact scoped release cases and cleanup'];
const fullUiSteps = [
 'Qualify enabled classification review in isolated desktop and mobile Chrome',
 'Exercise key dialogs, settings and requirements in isolated desktop and mobile Chrome'];
const uiSteps = ['Check changed UI contracts early with native Chrome',
 'Verify additional UI cases actually ran'];
const visualSteps = ['Verify finite synthetic capture manifest and PNGs', captureStep];
const eligibilityName = 'Release eligibility';
const gateStep = 'Verify exact attempt and all required qualification evidence';
const indexStep = 'Publish full qualification index';
const indexName = 'lifeos-unified-full-green-v1';
type JobId = keyof typeof evidence;
type Identity = {sha:string; runId:number; attempt:number};
const positive = (n:unknown): n is number => typeof n==='number' && Number.isSafeInteger(n) && n>0;
const shaPattern = /^[0-9a-f]{40}$/;
const hashPattern = /^[0-9a-f]{64}$/;
function identityString(id:Identity) {
 return [id.sha,id.runId,id.attempt].join(':');
}
function jobResults(full:boolean): Record<JobId,'success'|'skipped'> {
 return {policy:'success',checks:'success',platform:full?'success':'skipped',
  'recovery-pg':full?'success':'skipped',rendered:full?'success':'skipped'};
}
function checkSteps(job:Row,names:string[],conclusion='success') {
 confirmed(Array.isArray(job.steps),'NAMED_STEP_EVIDENCE_UNCONFIRMED');
 for(const name of names) {
  const rows=job.steps.filter((step:Row)=>step.name===name);
  confirmed(rows.length===1&&rows[0].status==='completed'&&rows[0].conclusion===conclusion,'NAMED_STEP_EVIDENCE_UNCONFIRMED');
 }
}
function attemptJobs(id:Identity,jobs:Row) {
 confirmed(Array.isArray(jobs.jobs)&&jobs.total_count===jobs.jobs.length&&jobs.jobs.length<=Object.keys(evidence).length+1,'ATTEMPT_JOBS_UNCONFIRMED');
 const map=new Map<string,Row>(), ids=new Set<number>();
 for(const job of jobs.jobs as Row[]) {
  confirmed(positive(job.id)&&!ids.has(job.id)&&!map.has(job.name)&&
   job.run_id===id.runId&&job.run_attempt===id.attempt&&job.head_sha===id.sha&&
   job.html_url===`https://github.com/${repository}/actions/runs/${id.runId}/job/${job.id}`,'ATTEMPT_JOBS_UNCONFIRMED');
  ids.add(job.id);
  map.set(job.name,job);
 }
 return map;
}
function checkProducers(jobs:Map<string,Row>,full:boolean,ui:boolean) {
 const expected=jobResults(full);
 for(const [jobId,descriptor] of Object.entries(evidence)) {
  const result=expected[jobId as JobId];
  const job=jobs.get(descriptor.name);
  // Skipped jobs can be absent from a jobs response, but required producers
  // must be present and completed in the exact attempt.
  if(!job&&result==='skipped')continue;
  confirmed(job?.status==='completed'&&job.conclusion===result,'REQUIRED_JOB_UNCONFIRMED');
  if(result==='success')checkSteps(job,descriptor.steps);
 }
 if(full) {
  const rendered=jobs.get(evidence.rendered.name)!;
  checkSteps(rendered,fullFixtureSteps);
  checkSteps(rendered,[...uiSteps,...fullUiSteps,...visualSteps],ui?'success':'skipped');
 }
}

async function verifiedArtifact(apiRead:typeof api,artifactId:unknown,name:string,id:Identity) {
 confirmed(typeof artifactId==='string'&&positive(Number(artifactId))&&String(Number(artifactId))===artifactId,'NAMED_ARTIFACT_UNCONFIRMED');
 const artifact=await apiRead('/actions/artifacts/'+artifactId);
 confirmed(artifact.id===Number(artifactId)&&artifact.name===name&&artifact.expired===false&&
  positive(artifact.size_in_bytes)&&typeof artifact.digest==='string'&&artifact.digest.startsWith('sha256:')&&
  hashPattern.test(artifact.digest.slice(7))&&artifact.workflow_run?.id===id.runId&&artifact.workflow_run.head_sha===id.sha&&artifact.workflow_run.head_branch==='main'&&
  artifact.workflow_run.repository_id===repositoryId&&artifact.workflow_run.head_repository_id===repositoryId,'NAMED_ARTIFACT_UNCONFIRMED');
}

export async function verifyAttempt(id:Identity,ui:boolean,needs:Row,apiRead:typeof api) {
 confirmed(typeof id.sha==='string'&&shaPattern.test(id.sha)&&positive(id.runId)&&positive(id.attempt),'ATTEMPT_IDENTITY_UNCONFIRMED');
 const outputs=needs.policy?.outputs;
 confirmed(outputs?.identity===identityString(id)&&outputs.ui===String(ui)&&
  (outputs.profile==='full'||outputs.profile==='routine'),'POLICY_EVIDENCE_UNCONFIRMED');
 const full=outputs.profile==='full';
 const visual=full&&ui;
 confirmed(outputs.visual===String(visual),'POLICY_EVIDENCE_UNCONFIRMED');
 const expected=jobResults(full);
 confirmed(outputs.audit==='true'||outputs.audit==='false','POLICY_EVIDENCE_UNCONFIRMED');
 confirmed(Object.keys(needs).length===Object.keys(expected).length&&
  Object.entries(expected).every(([name,result])=>needs[name]?.result===result),'DAG_SCOPE_UNCONFIRMED');

 const jobs=attemptJobs(id,await apiRead(`/actions/runs/${id.runId}/attempts/${id.attempt}/jobs?per_page=100`));
 const allowed=new Set([eligibilityName,...Object.values(evidence).map(job=>job.name)]);
 confirmed([...jobs.keys()].every(name=>allowed.has(name)),'ATTEMPT_JOBS_UNCONFIRMED');
 checkProducers(jobs,full,ui);
 checkSteps(jobs.get(evidence.policy.name)!,['Locked dependency security audit'],outputs.audit==='true'?'success':'skipped');

 const rendered=needs.rendered.outputs??{};
 if(full) {
  confirmed(rendered.identity===identityString(id)&&typeof rendered['build-id']==='string'&&
   /^[A-Za-z0-9_-]{1,100}$/.test(rendered['build-id']),'BUILD_EVIDENCE_UNCONFIRMED');
  await verifiedArtifact(apiRead,rendered['compiled-id'],'lifeos-compiled-'+identityString(id).replaceAll(':','-'),id);
 } else confirmed(!rendered.identity&&!rendered['build-id']&&!rendered['compiled-id'],'UNEXPECTED_COMPILED_EVIDENCE');
 if(visual)await verifiedArtifact(apiRead,rendered['capture-id'],'synthetic-rendered-'+identityString(id).replaceAll(':','-'),id);
 else confirmed(!rendered['capture-id'],'UNEXPECTED_VISUAL_EVIDENCE');
 return {sourceSha:id.sha,runId:id.runId,runAttempt:id.attempt,profile:outputs.profile,visual:visual?'verified':'not-scheduled'};
}

function verifyRunOwner(run:Row,id:Identity,workflowId:number) {
 confirmed(typeof id.sha==='string'&&shaPattern.test(id.sha)&&positive(id.runId)&&positive(id.attempt)&&
  run.id===id.runId&&run.run_attempt===id.attempt&&run.head_sha===id.sha&&run.workflow_id===workflowId&&
  run.path===path&&run.head_branch==='main'&&run.event==='push'&&run.status==='completed'&&run.conclusion==='success'&&
  run.html_url===`https://github.com/${repository}/actions/runs/${id.runId}`);
 for(const key of ['repository','head_repository'])confirmed(run[key]?.id===repositoryId&&run[key]?.full_name===repository);
}

const gitBytes=(revision:string,file:string)=>execFileSync('git',['--no-replace-objects','show',revision+':'+file],{maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']});
const isAncestor=(base:string,head:string)=>execFileSync('git',['--no-replace-objects','merge-base','--is-ancestor',base,head],{stdio:'ignore'});
const sha256=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const policyFiles=[path,'scripts/release-qualification.ts','scripts/release-policy.ts','.github/release-path-policy.json'];

// The index finds prior runs. The completed run and its own attempt's named
// producers establish qualification. A current/incomplete run cannot seed itself.
export async function classify(id:Identity,event:string,apiRead:typeof api=api) {
 const seed=fullGreenRecord;
 let baseline=seed;
 let previousFailed=true;
 try {
  confirmed(event==='push'&&id.attempt===1);
  const seedRun=await apiRead('/actions/runs/'+seed.runId);
  const seedJobs=await apiRead(`/actions/runs/${seed.runId}/attempts/${seed.runAttempt}/jobs?per_page=100`);
  validateSuccessfulRun(seedRun,seedJobs,{sha:seed.sourceSha,workflowId:seed.workflowId,path:seed.workflowPath,names:seed.jobNames,runId:seed.runId,attempt:seed.runAttempt});
  confirmed(sha256(gitBytes(seed.sourceSha,seed.workflowPath))===seed.workflowSha256);
  const index=await apiRead('/actions/artifacts?name='+indexName+'&per_page=10');
  confirmed(Array.isArray(index.artifacts)&&index.artifacts.length<=10);
  for(const artifact of index.artifacts as Row[]) {
   if(artifact.expired!==false||artifact.name!==indexName||!positive(artifact.workflow_run?.id)||artifact.workflow_run.id>=id.runId)continue;
   const runId=artifact.workflow_run.id;
   try {
    const run=await apiRead('/actions/runs/'+runId);
    const candidate={sha:run.head_sha,runId,attempt:1};
    confirmed(typeof candidate.sha==='string'&&shaPattern.test(candidate.sha)&&candidate.sha!==id.sha);
    verifyRunOwner(run,candidate,seed.workflowId);
    isAncestor(baseline.sourceSha,candidate.sha);
    isAncestor(candidate.sha,id.sha);
    confirmed(policyFiles.every(file=>gitBytes(candidate.sha,file).equals(gitBytes(id.sha,file))));
    await verifiedArtifact(apiRead,String(artifact.id),indexName,candidate);
    const jobs=attemptJobs(candidate,await apiRead(`/actions/runs/${runId}/attempts/1/jobs?per_page=100`));
    confirmed(jobs.size===Object.keys(evidence).length+1);
    const eligibility=jobs.get(eligibilityName);
    const rendered=jobs.get(evidence.rendered.name);
    confirmed(eligibility?.status==='completed'&&eligibility.conclusion==='success'&&Array.isArray(rendered?.steps));
    checkSteps(eligibility,[gateStep,indexStep]);
    checkProducers(jobs,true,rendered.steps.some((step:Row)=>step.name===captureStep&&step.conclusion==='success'));
    baseline={...seed,sourceSha:candidate.sha,
     treeSha:execFileSync('git',['--no-replace-objects','rev-parse',candidate.sha+'^{tree}'],{encoding:'utf8'}).trim(),
     runId:String(runId),runAttempt:'1',workflowSha256:sha256(gitBytes(candidate.sha,path)),
     jobNames:[...Object.values(evidence).map(job=>job.name),eligibilityName]};
   } catch {continue;}
  }
  if(baseline===seed)return localReleaseDecision(true,seed);
  const history=await apiRead('/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=10');
  confirmed(Array.isArray(history.workflow_runs)&&history.workflow_runs.length<=10);
  confirmed(history.workflow_runs.every((run:Row)=>run&&positive(run.id)));
  const prior=(history.workflow_runs as Row[]).filter(run=>positive(run.id)&&run.id<id.runId).sort((a,b)=>b.id-a.id)[0];
  previousFailed=!prior||prior.status!=='completed'||prior.conclusion!=='success'||prior.head_sha===id.sha;
  if(!previousFailed)verifyRunOwner(prior,{sha:prior.head_sha,runId:prior.id,attempt:prior.run_attempt},seed.workflowId);
 } catch {previousFailed=true;}
 return localReleaseDecision(previousFailed,baseline);
}

async function main() {
 const id={sha:process.env.SOURCE_SHA??'',runId:Number(process.env.GITHUB_RUN_ID),attempt:Number(process.env.GITHUB_RUN_ATTEMPT)};
 const event=process.env.GITHUB_EVENT_NAME??'';
 confirmed(shaPattern.test(id.sha)&&id.sha===process.env.GITHUB_SHA&&positive(id.runId)&&positive(id.attempt)&&
  process.env.GITHUB_REPOSITORY===repository&&process.env.GITHUB_REPOSITORY_ID===String(repositoryId)&&
  String(id.runId)===process.env.GITHUB_RUN_ID&&String(id.attempt)===process.env.GITHUB_RUN_ATTEMPT&&
  process.env.GITHUB_REF==='refs/heads/main'&&process.env.GITHUB_WORKFLOW_SHA===id.sha&&
  process.env.GITHUB_WORKFLOW_REF===repository+'/'+path+'@refs/heads/main'&&
  execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()===id.sha,'SOURCE_IDENTITY_UNCONFIRMED');
 const payload=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!,'utf8'));
 const scope=readVisualScope({sha:id.sha,event,headBranch:'main',payload});
 if(process.argv[2]==='--classify') {
  const decision=await classify(id,event);
  outputDecision(decision);
  appendFileSync(process.env.GITHUB_OUTPUT!,`ui=${scope.required}\nvisual=${decision.profile==='full'&&scope.required}\naudit=${dependencyAuditRequired(decision,event)}\nidentity=${identityString(id)}\n`);
 } else if(process.argv[2]==='--verify') {
  const result=await verifyAttempt(id,scope.required,JSON.parse(process.env.CI_NEEDS!),api);
  console.log(JSON.stringify({...result,visualScope:scope.reason}));
 } else throw Error('MODE_REQUIRED');
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(error=>{
 const code=error instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(error.message)?error.message:'QUALIFICATION_UNCONFIRMED';
 console.error('Release eligibility rejected: '+code);
 process.exitCode=1;
});
