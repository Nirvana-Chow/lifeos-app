import {readFileSync, appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const fullGreenRecord = JSON.parse(readFileSync(new URL('../.github/release-full-green.json', import.meta.url), 'utf8'));
export const releasePathPolicy = JSON.parse(readFileSync(new URL('../.github/release-path-policy.json', import.meta.url), 'utf8')) as {
 schemaVersion:number; routinePaths:string[]; routinePrefixes:string[]; releaseJobs:string[]; qualificationJobs:string[];
};
export type Decision = {profile:'routine'|'full'; reason:string; baselineSha:string|null; changedPaths:string[]};
const sha = /^[a-f0-9]{40}$/;
export function classifyRelease(input: {baseline:unknown;head:string;ancestor:boolean;previousFailed:boolean;changes:{status:string;path:string}[]}): Decision {
 const b=input.baseline as typeof fullGreenRecord | null;
 const result=(profile:Decision['profile'],reason:string):Decision=>({profile,reason,baselineSha:b?.sourceSha??null,changedPaths:input.changes.map(c=>c.path)});
 if (!b || b.schemaVersion!==1 || b.repository!=='Nirvana-Chow/lifeos-app' || b.repositoryId!==1443243170 || b.conclusion!=='success' || !sha.test(b.sourceSha) || !sha.test(b.treeSha) || !/^[1-9][0-9]*$/.test(b.runId) || !/^[1-9][0-9]*$/.test(b.runAttempt) || !/^[a-f0-9]{64}$/.test(b.workflowSha256)) return result('full','full-green-evidence-invalid');
 if (!sha.test(input.head) || !input.ancestor || input.previousFailed || input.changes.length===0) return result('full','history-or-prior-result-unconfirmed');
 if (input.changes.some(({status,path})=>status!=='M' || !path || path.startsWith('/') || path.split('/').some(p=>!p || p==='.' || p==='..') || /[\\\x00-\x1f\x7f]/.test(path))) return result('full','ambiguous-change');
 if (input.changes.some(({path})=>!releasePathPolicy.routinePaths.includes(path) && !releasePathPolicy.routinePrefixes.some(prefix=>path.startsWith(prefix) && path.endsWith('.md')))) return result('full','backend-auth-policy-or-unmapped-change');
 return result('routine','presentation-only-since-full-green');
}
export function localReleaseDecision(previousFailed=true, baseline=fullGreenRecord):Decision {
 try {
  const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:4*1024*1024});
  const head=git('rev-parse','HEAD').trim();
  if (process.env.SOURCE_SHA && head!==process.env.SOURCE_SHA) throw Error('SOURCE_CHANGED');
  const tree=git('rev-parse',baseline.sourceSha+'^{tree}').trim();
  if (tree!==baseline.treeSha) throw Error('BASELINE_TREE_CHANGED');
  git('merge-base','--is-ancestor',baseline.sourceSha,head);
  // Two-tree cumulative diff, never event.before or HEAD~1. No rename inference.
  const fields=git('diff','--raw','--no-abbrev','-z','--no-renames',baseline.sourceSha,head).split('\0');
  if (fields.pop()!=='') throw Error('INCOMPLETE_DIFF');
  const changes:{status:string;path:string}[]=[];
  for(let i=0;i<fields.length;i+=2) {
   const raw=/^:(\d{6}) (\d{6}) [a-f0-9]{40} [a-f0-9]{40} ([A-Z])$/.exec(fields[i]!);
   if(!raw||!fields[i+1])throw Error('INCOMPLETE_DIFF');
   changes.push({status:raw[1]===raw[2]?raw[3]!:'T',path:fields[i+1]!});
  }
  return classifyRelease({baseline,head,ancestor:true,previousFailed,changes});
 } catch {return {profile:'full',reason:'local-evidence-unavailable',baselineSha:baseline.sourceSha,changedPaths:[]};}
}
export function outputDecision(decision:Decision) {
 console.log(JSON.stringify(decision));
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`profile=${decision.profile}\n`);
}
if(process.argv[1]===fileURLToPath(import.meta.url))outputDecision(localReleaseDecision(process.env.RELEASE_PREVIOUS_FAILED!=='false'));
