import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants,openSync,fstatSync,readFileSync,closeSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
/** Manual source-only advisory; never a publication or deployment gate. */
export const WORKFLOW_PATHS=['.github/workflows/ci.yml','.github/workflows/qualification.yml','.github/workflows/visual-qualification.yml'] as const;
export const OVERLAY_PATHS=['app/layout.tsx','scripts/owner-recovery-host.py','scripts/owner-recovery-operator.ts','src/personal-candidate/config.ts','src/personal-candidate/owner-recovery-access.ts','src/personal-candidate/owner-recovery-capability.ts','src/personal-candidate/owner-recovery-finish-panel.tsx','src/personal-candidate/password-page.tsx','src/platform/auth.ts','src/platform/page-access.ts','src/platform/private-config.ts','src/platform/runtime.ts','test/login-onboarding.test.ts','test/owner-account-access.test.ts','test/owner-email-reset.test.ts'] as const;
export type Candidate={sha:string;treeSha:string;workflowPins:Record<string,string>;publicBases:Record<string,string|null>};
type HashMap=Record<string,string|null>;
type Rebase={treeSha:string;publicBases:HashMap;overlays:Record<string,string>;allowDescendants?:boolean};
type Metadata={version:1;repository:string;source:{kind:string;ref:string;observedAt:string;receiptSha256:string;matcherVersion:string};controls:{workerSha256:string;configurationSha256:string};workflowPins:Record<string,string>;publicBases:HashMap;overlays:Record<string,string>;rebases:Record<string,Rebase>;profile:{sourceSha:string;runId:string;runAttempt:string;overlays:Record<string,string>};approvedOverlays?:Record<string,Record<string,string>>};
type Difference={path:string;expected:string|null;actual:string|null};
type Input={candidate:Candidate;metadataText:string;expectedMetadataSha256?:string;now:number;ahead:(base:string,head:string)=>boolean|undefined};
type Result={status:'snapshot-compatible'|'review-required'|'unknown';code:string;candidateSha:string|null;metadataSha256:string;publicationAuthorized:false;ci:'not-checked';native:'not-checked';differences:Difference[];nextStep:string;match?:string;originSha?:string};
const SHA=/^[a-f0-9]{40}$/,HASH=/^[a-f0-9]{64}$/;
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fields=(v:unknown,required:string[],optional:string[]=[])=>object(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
function hashMap(v:unknown,paths:readonly string[],nullable=false){return object(v)&&Object.keys(v).length===paths.length&&paths.every(p=>Object.hasOwn(v,p)&&(nullable&&v[p]===null||typeof v[p]==='string'&&HASH.test(v[p])));}
const equal=(a:HashMap,b:HashMap)=>OVERLAY_PATHS.every(p=>a[p]===b[p]);
const differences=(a:HashMap,b:HashMap,paths:readonly string[]=OVERLAY_PATHS)=>paths.filter(p=>a[p]!==b[p]).map(path=>({path,expected:a[path]!,actual:b[path]!}));
function validMetadata(v:unknown):v is Metadata{
 if(!fields(v,['version','repository','source','controls','workflowPins','publicBases','overlays','rebases','profile'],['approvedOverlays']))return false;
 const m=v as unknown as Metadata;
 if(m.version!==1||m.repository!=='Nirvana-Chow/lifeos-app'||!fields(m.source,['kind','ref','observedAt','receiptSha256','matcherVersion'])||m.source.kind!=='root-readonly-capture'||m.source.matcherVersion!=='overlay-v1'||typeof m.source.ref!=='string'||!m.source.ref.length||m.source.ref.length>128||typeof m.source.observedAt!=='string'||!HASH.test(m.source.receiptSha256))return false;
 if(!fields(m.controls,['workerSha256','configurationSha256'])||!Object.values(m.controls).every(v=>typeof v==='string'&&HASH.test(v)))return false;
 if(!hashMap(m.workflowPins,WORKFLOW_PATHS)||!hashMap(m.publicBases,OVERLAY_PATHS,true)||!hashMap(m.overlays,OVERLAY_PATHS))return false;
 if(!fields(m.profile,['sourceSha','runId','runAttempt','overlays'])||typeof m.profile.sourceSha!=='string'||!SHA.test(m.profile.sourceSha)||typeof m.profile.runId!=='string'||typeof m.profile.runAttempt!=='string'||!(/^[1-9][0-9]{0,19}$/).test(m.profile.runId)||!(/^[1-9][0-9]{0,9}$/).test(m.profile.runAttempt)||!hashMap(m.profile.overlays,OVERLAY_PATHS))return false;
 if(!object(m.rebases)||Object.keys(m.rebases).length>32)return false;
 for(const [origin,r] of Object.entries(m.rebases))if(!SHA.test(origin)||!fields(r,['treeSha','publicBases','overlays'],['allowDescendants'])||!SHA.test(r.treeSha)||!hashMap(r.publicBases,OVERLAY_PATHS,true)||!hashMap(r.overlays,OVERLAY_PATHS)||r.allowDescendants!==undefined&&typeof r.allowDescendants!=='boolean')return false;
 if(m.approvedOverlays!==undefined){
  if(!object(m.approvedOverlays)||Object.keys(m.approvedOverlays).length>32)return false;
  for(const [origin,artifacts] of Object.entries(m.approvedOverlays))if(!SHA.test(origin)||!object(artifacts)||!Object.entries(artifacts).every(([p,h])=>(OVERLAY_PATHS as readonly string[]).includes(p)&&typeof h==='string'&&HASH.test(h)))return false;
 }
 return true;
}
/** Digest binding is external operator evidence, not authentication or release authority. */
export function checkReleasePreflight(input:Input):Result{
 const metadataSha256=digest(input.metadataText),candidateSha=SHA.test(input.candidate?.sha)?input.candidate.sha:null;
 const result=(status:Result['status'],code:string,diffs:Difference[]=[],match?:string,originSha?:string):Result=>({status,code,candidateSha,metadataSha256,publicationAuthorized:false,ci:'not-checked',native:'not-checked',differences:diffs,nextStep:status==='snapshot-compatible'?'继续既有固定 SHA CI 与 Root 原生发布门禁；本结果不授权发布。':code==='ANCESTRY_UNKNOWN'?'补齐本地固定提交的祖先关系后重新检查。':status==='unknown'?'由 Root 重新提供来源可核验、独立固定摘要的新鲜安全快照。':'将所列差异交 Root 现有审查与采用路径，取得新快照后重新检查。',...(match?{match,originSha}:{})});
 if(!input.expectedMetadataSha256||!HASH.test(input.expectedMetadataSha256)||metadataSha256!==input.expectedMetadataSha256)return result('unknown','METADATA_HASH_UNCONFIRMED');
 let metadata:unknown;
 try{if(Buffer.byteLength(input.metadataText)>65536)throw Error();metadata=JSON.parse(input.metadataText);}catch{return result('unknown','METADATA_INVALID');}
 if(!validMetadata(metadata))return result('unknown','METADATA_INVALID');
 const m=metadata,observed=Date.parse(m.source.observedAt);
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(m.source.observedAt)||!Number.isFinite(observed)||new Date(observed).toISOString().replace('.000Z','Z')!==m.source.observedAt.replace('.000Z','Z')||!Number.isFinite(input.now)||observed>input.now||input.now-observed>300000)return result('unknown','METADATA_STALE');
 const c=input.candidate;
 if(!fields(c,['sha','treeSha','workflowPins','publicBases'])||!candidateSha||!SHA.test(c.treeSha)||!hashMap(c.workflowPins,WORKFLOW_PATHS)||!hashMap(c.publicBases,OVERLAY_PATHS,true))return result('unknown','GIT_SOURCE_UNCONFIRMED');
 const drift=differences(m.workflowPins,c.workflowPins,WORKFLOW_PATHS);if(drift.length)return result('review-required','WORKFLOW_PIN_REVIEW_REQUIRED',drift);
 // Match the existing worker's order and its two different descendant rules.
 let record=m.rebases[c.sha],origin=c.sha,match=record?'exact-rebase':'default';
 const ahead=(a:string,b:string)=>a===b?false:input.ahead(a,b);
 if(!record&&!equal(c.publicBases,m.publicBases)){
  for(const [approved,r] of Object.entries(m.rebases)){
   if(!equal(r.publicBases,c.publicBases))continue;
   let adopted=false,transition=false;
   if(equal(r.overlays,m.profile.overlays)){
    const relation=m.profile.sourceSha===approved?true:ahead(approved,m.profile.sourceSha);
    if(relation===undefined)return result('unknown','ANCESTRY_UNKNOWN');adopted=relation;
   }
   if(r.allowDescendants===true&&equal(m.profile.overlays,m.overlays)){
    const relation=m.profile.sourceSha===approved?true:ahead(m.profile.sourceSha,approved);
    if(relation===undefined)return result('unknown','ANCESTRY_UNKNOWN');transition=relation;
   }
   if(adopted||transition){
    const relation=ahead(approved,c.sha);if(relation===undefined)return result('unknown','ANCESTRY_UNKNOWN');
    if(relation){record={...r,treeSha:c.treeSha};origin=approved;match=adopted?'adopted-descendant':'reviewed-transition';break;}
   }
  }
 }
 if(!record&&!equal(c.publicBases,m.publicBases))return result('review-required','PUBLIC_BASE_REVIEW_REQUIRED',differences(m.publicBases,c.publicBases));
 if(record&&(record.treeSha!==c.treeSha||!equal(record.publicBases,c.publicBases)))return result('review-required','REBASE_RECORD_REVIEW_REQUIRED',differences(record.publicBases,c.publicBases));
 const wanted=record?.overlays??m.overlays;
 if(!equal(m.profile.overlays,m.overlays)&&!equal(m.profile.overlays,wanted))return result('review-required','CURRENT_PROFILE_REVIEW_REQUIRED',differences(wanted,m.profile.overlays));
 for(const path of OVERLAY_PATHS)if(wanted[path]!==m.profile.overlays[path]&&m.approvedOverlays?.[origin]?.[path]!==wanted[path])return result('unknown','APPROVED_OVERLAY_ARTIFACT_UNCONFIRMED',[{path,expected:wanted[path]!,actual:m.approvedOverlays?.[origin]?.[path]??null}]);
 return result('snapshot-compatible','CAPTURED_SOURCE_COMPATIBLE',[],match,origin);
}
function git(directory:string,args:string[]){return execFileSync('git',args,{cwd:directory,stdio:['ignore','pipe','pipe'],maxBuffer:2*1024*1024});}
/** Reads immutable local objects only, never the working tree, remote or hooks. */
export function readGitCandidate(directory:string,sha:string):Candidate{
 if(!SHA.test(sha)||git(directory,['rev-parse','--verify',sha+'^{commit}']).toString().trim()!==sha)throw Error('GIT_SOURCE_UNCONFIRMED');
 const blob=(path:string):string|null=>{
  const entry=git(directory,['ls-tree','-z',sha,'--',path]).toString();if(!entry)return null;
  if(!/^(100644|100755) blob [a-f0-9]{40}\t[^\0]+\0$/.test(entry))throw Error('GIT_SOURCE_UNCONFIRMED');
  return digest(git(directory,['show',sha+':'+path]));
 };
 const workflowPins:Record<string,string>={},publicBases:HashMap={};
 for(const path of WORKFLOW_PATHS){const hash=blob(path);if(!hash)throw Error('GIT_SOURCE_UNCONFIRMED');workflowPins[path]=hash;}
 for(const path of OVERLAY_PATHS)publicBases[path]=blob(path);
 return {sha,treeSha:git(directory,['rev-parse',sha+'^{tree}']).toString().trim(),workflowPins,publicBases};
}
function main(args:string[]){
 let output:Result|{status:string;code:string;publicationAuthorized:false;nextStep:string};
 try{
  if(args.length!==6||args[0]!=='--candidate'||args[2]!=='--metadata'||args[4]!=='--metadata-sha256')throw Error('CLI_ARGUMENTS_INVALID');
  const candidate=readGitCandidate(process.cwd(),args[1]!);
  const fd=openSync(args[3]!,constants.O_RDONLY|constants.O_NOFOLLOW);let raw:string;
  try{const st=fstatSync(fd);if(!st.isFile()||st.size>65536)throw Error('METADATA_INVALID');raw=readFileSync(fd,'utf8');}finally{closeSync(fd);}
  output=checkReleasePreflight({candidate,metadataText:raw,expectedMetadataSha256:args[5],now:Date.now(),ahead:(base,head)=>{
   const r=spawnSync('git',['merge-base','--is-ancestor',base,head],{cwd:process.cwd(),stdio:'ignore'});return r.status===0?true:r.status===1?false:undefined;
  }});
 }catch{output={status:'unknown',code:'INPUT_UNCONFIRMED',publicationAuthorized:false,nextStep:'核对显式参数、本地固定 Git 对象及 Root 安全元数据文件。'};}
 console.log(JSON.stringify(output));process.exitCode=output.status==='snapshot-compatible'?0:2;
}
if(resolve(process.argv[1]??'')===fileURLToPath(import.meta.url))main(process.argv.slice(2));
