import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
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
async function main() {
 const decision=await classify();outputDecision(decision);
 if(process.argv.includes('--classify'))return;
 if(!process.argv.includes('--wait'))throw Error('MODE_REQUIRED');
 if(decision.profile==='routine')return;
 // This is a finite CI job, not a new daemon or production authority.
 const workflow=await api('/actions/workflows/qualification.yml');
 if(workflow.path!==path||!Number.isSafeInteger(workflow.id))throw Error('QUALIFICATION_WORKFLOW_CHANGED');
 const deadline=Date.now()+40*60*1000;
 while(Date.now()<deadline) {
  const runs=await api(`/actions/workflows/${workflow.id}/runs?head_sha=${process.env.SOURCE_SHA}&per_page=10`);
  const candidates=((runs.workflow_runs??[])as Row[]).filter(r=>r.head_sha===process.env.SOURCE_SHA&&r.event===process.env.GITHUB_EVENT_NAME).sort((a,b)=>b.id-a.id);
  const run=candidates[0];
  if(run?.status==='completed') {
   const jobs=await api(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
   validateSuccessfulRun(run,jobs,{sha:process.env.SOURCE_SHA!,workflowId:workflow.id,path,names:releasePathPolicy.qualificationJobs,event:process.env.GITHUB_EVENT_NAME,headBranch:process.env.GITHUB_HEAD_REF||'main'});
   console.log(JSON.stringify({qualificationRunId:run.id,attempt:run.run_attempt,sourceSha:run.head_sha,profile:'full'}));return;
  }
  await new Promise(resolve=>setTimeout(resolve,20000));
 }
 throw Error('QUALIFICATION_NOT_COMPLETED');
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Release eligibility rejected: full qualification missing, failed or unconfirmed.');process.exitCode=1;});
