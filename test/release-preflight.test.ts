import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkReleasePreflight,readGitCandidate,OVERLAY_PATHS,WORKFLOW_PATHS} from '../scripts/release-preflight.ts';
const sha=(x:string)=>x.repeat(40),hash=(x:string)=>x.repeat(64),now=Date.parse('2030-11-05T12:00:00Z'),config='src/personal-candidate/config.ts';
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
function fixture(){
 const before=Object.fromEntries(OVERLAY_PATHS.map(p=>[p,hash('1')])),after={...before,[config]:hash('2')},old=Object.fromEntries(OVERLAY_PATHS.map(p=>[p,hash('3')])),wanted={...old,[config]:hash('4')},workflowPins=Object.fromEntries(WORKFLOW_PATHS.map(p=>[p,hash('5')]));
 const candidate={sha:sha('c'),treeSha:sha('e'),workflowPins,publicBases:after};
 const metadata:any={version:1,repository:'Nirvana-Chow/lifeos-app',source:{kind:'root-readonly-capture',ref:'synthetic-capture-v1',observedAt:'2030-11-05T11:59:00Z',receiptSha256:hash('6'),matcherVersion:'overlay-v1'},controls:{workerSha256:hash('7'),configurationSha256:hash('8')},workflowPins,publicBases:before,overlays:old,rebases:{[sha('c')]:{treeSha:sha('e'),publicBases:after,overlays:wanted,allowDescendants:false}},profile:{sourceSha:sha('a'),runId:'100',runAttempt:'1',overlays:old},approvedOverlays:{[sha('c')]:{[config]:hash('4')}}};
 return {candidate,metadata};
}
function check(f:ReturnType<typeof fixture>,ahead:(a:string,b:string)=>boolean|undefined=()=>undefined,at=now){const raw=JSON.stringify(f.metadata);return checkReleasePreflight({candidate:f.candidate,metadataText:raw,expectedMetadataSha256:digest(raw),now:at,ahead});}
test('default exact adopted-descendant and reviewed transition follow the existing matcher without authorizing release',()=>{
 const f=fixture();assert.equal(check(f).match,'exact-rebase');
 f.metadata.rebases={};f.candidate.publicBases=f.metadata.publicBases;assert.equal(check(f).match,'default');
 const adopted=fixture();adopted.candidate.sha=sha('d');adopted.metadata.profile={...adopted.metadata.profile,sourceSha:sha('c'),overlays:adopted.metadata.rebases[sha('c')].overlays};
 assert.equal(check(adopted,(a,b)=>a===sha('c')&&b===sha('d')).match,'adopted-descendant');
 const transition=fixture();transition.candidate.sha=sha('d');transition.metadata.rebases[sha('c')].allowDescendants=true;
 const result=check(transition,(a,b)=>a===sha('a')&&b===sha('c')||a===sha('c')&&b===sha('d'));
 assert.equal(result.status,'snapshot-compatible');assert.equal(result.match,'reviewed-transition');assert.equal(result.publicationAuthorized,false);
});
test('workflow drift reports only fixed path and hashes for early review',()=>{
 const f=fixture();f.candidate.workflowPins={...f.candidate.workflowPins,[WORKFLOW_PATHS[2]!]:hash('9')};const r=check(f);
 assert.equal(r.status,'review-required');assert.equal(r.code,'WORKFLOW_PIN_REVIEW_REQUIRED');assert.deepEqual(r.differences,[{path:WORKFLOW_PATHS[2],expected:hash('5'),actual:hash('9')}]);
});
test('public config drift and a wrong exact-rebase tree fail closed',()=>{
 const f=fixture();f.candidate.publicBases={...f.candidate.publicBases,[config]:hash('b')};let r=check(f);assert.equal(r.status,'review-required');assert.ok(r.differences.some(d=>d.path===config));
 const wrong=fixture();wrong.metadata.rebases[sha('c')].treeSha=sha('f');r=check(wrong);assert.equal(r.code,'REBASE_RECORD_REVIEW_REQUIRED');
});
test('unknown current overlay and missing approved replacement evidence never qualify a transition',()=>{
 const f=fixture();f.metadata.profile.overlays={...f.metadata.profile.overlays,[config]:hash('a')};assert.equal(check(f).code,'CURRENT_PROFILE_REVIEW_REQUIRED');
 const missing=fixture();delete missing.metadata.approvedOverlays;assert.equal(check(missing).status,'unknown');assert.equal(check(missing).code,'APPROVED_OVERLAY_ARTIFACT_UNCONFIRMED');
});
test('stale unpinned malformed and unattributed JSON is unknown rather than authority',()=>{
 const f=fixture();assert.equal(check(f,()=>false,now+300000).code,'METADATA_STALE');
 const raw=JSON.stringify(f.metadata);assert.equal(checkReleasePreflight({candidate:f.candidate,metadataText:raw,now,ahead:()=>false}).code,'METADATA_HASH_UNCONFIRMED');
 const numeric=fixture();numeric.metadata.profile.runId=100;assert.equal(check(numeric).code,'METADATA_INVALID');
 f.metadata.source.kind='arbitrary-json';assert.equal(check(f).code,'METADATA_INVALID');
 const bad=checkReleasePreflight({candidate:f.candidate,metadataText:'secret-looking malformed text',expectedMetadataSha256:digest('secret-looking malformed text'),now,ahead:()=>false});assert.equal(bad.status,'unknown');assert.ok(!JSON.stringify(bad).includes('secret-looking'));
});
test('unavailable ancestry is unknown and an unadopted exact-only record cannot authorize descendants',()=>{
 const f=fixture();f.candidate.sha=sha('d');f.metadata.rebases[sha('c')].allowDescendants=true;assert.equal(check(f).code,'ANCESTRY_UNKNOWN');
 f.metadata.rebases[sha('c')].allowDescendants=false;assert.equal(check(f,()=>true).status,'review-required');
});
test('same-head old run attempt is only captured source compatibility with CI and Native unchecked',()=>{
 const f=fixture();f.metadata.profile={sourceSha:f.candidate.sha,runId:'100',runAttempt:'1',overlays:f.metadata.rebases[sha('c')].overlays};const r=check(f);
 assert.equal(r.status,'snapshot-compatible');assert.equal(r.publicationAuthorized,false);assert.equal(r.ci,'not-checked');assert.equal(r.native,'not-checked');
});
test('real CLI hashes fixed Git objects despite dirty files and never changes the repository',()=>{
 const dir=mkdtempSync(join(tmpdir(),'lifeos-preflight-'));try{
  const git=(...a:string[])=>execFileSync('git',['-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid',...a],{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();git('init','-qb','main');
  for(const p of [...WORKFLOW_PATHS,...OVERLAY_PATHS]){mkdirSync(join(dir,p,'..'),{recursive:true});writeFileSync(join(dir,p),'synthetic '+p);}
  git('add','.');git('commit','-qm','synthetic snapshot');const head=git('rev-parse','HEAD'),candidate=readGitCandidate(dir,head);
  writeFileSync(join(dir,config),'dirty working tree is not the candidate');assert.deepEqual(readGitCandidate(dir,head),candidate);
  const f=fixture();f.metadata.publicBases=candidate.publicBases;f.metadata.workflowPins=candidate.workflowPins;f.metadata.rebases={};
  f.metadata.source.observedAt='2000-01-01T00:00:00Z';const raw=JSON.stringify(f.metadata),file=join(dir,'private-metadata.json');writeFileSync(file,raw);const before=git('status','--porcelain');
  const result=spawnSync(process.execPath,[new URL('../scripts/release-preflight.ts',import.meta.url).pathname,'--candidate',head,'--metadata',file,'--metadata-sha256',digest(raw)],{cwd:dir,encoding:'utf8'});
  // The historical synthetic capture is expired at actual CLI time, never ready.
  assert.notEqual(result.status,0);const output=JSON.parse(result.stdout);assert.equal(output.publicationAuthorized,false);assert.equal(output.status,'unknown');assert.equal(git('status','--porcelain'),before);assert.equal(readFileSync(join(dir,config),'utf8'),'dirty working tree is not the candidate');
  f.metadata.source.observedAt=new Date().toISOString();const fresh=JSON.stringify(f.metadata);writeFileSync(file,fresh);const args=[new URL('../scripts/release-preflight.ts',import.meta.url).pathname,'--candidate',head,'--metadata',file,'--metadata-sha256',digest(fresh)];const success=spawnSync(process.execPath,args,{cwd:dir,encoding:'utf8'});assert.equal(success.status,0);assert.equal(JSON.parse(success.stdout).status,'snapshot-compatible');assert.equal(JSON.parse(success.stdout).publicationAuthorized,false);
  writeFileSync(file,fresh+' ');const substituted=spawnSync(process.execPath,args,{cwd:dir,encoding:'utf8'});assert.equal(substituted.status,2);assert.equal(JSON.parse(substituted.stdout).code,'METADATA_HASH_UNCONFIRMED');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
