import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkReleasePreflight,readGitCandidate,OVERLAY_PATHS,WORKFLOW_PATHS,type Candidate} from '../scripts/release-preflight.ts';
const sha=(x:string)=>x.repeat(40),hash=(x:string)=>x.repeat(64),now=Date.parse('2030-11-05T12:00:00Z'),config='src/personal-candidate/config.ts';
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
function fixture(){
 const before=Object.fromEntries(OVERLAY_PATHS.map(p=>[p,hash('1')])),after={...before,[config]:hash('2')},old=Object.fromEntries(OVERLAY_PATHS.map(p=>[p,hash('3')])),wanted={...old,[config]:hash('4')},workflowPins=Object.fromEntries(WORKFLOW_PATHS.map(p=>[p,hash('5')]));
 const candidate:Candidate={sha:sha('c'),treeSha:sha('e'),workflowPins,publicBases:after};
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
  if(process.platform!=='win32'){const fifo=join(dir,'not-a-capture');execFileSync('mkfifo',[fifo]);const rejected=spawnSync(process.execPath,[...args.slice(0,4),fifo,...args.slice(5)],{cwd:dir,encoding:'utf8',timeout:2000});assert.equal(rejected.error,undefined,'Non-regular metadata input must reject without blocking');assert.equal(rejected.status,2);assert.equal(JSON.parse(rejected.stdout).status,'unknown');}
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('independent: fixed candidate SHA reads its own immutable tree despite local replace refs',()=>{
 const dir=mkdtempSync(join(tmpdir(),'lifeos-preflight-replace-'));try{
  const git=(...a:string[])=>execFileSync('git',['-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid',...a],{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-qb','main');for(const p of [...WORKFLOW_PATHS,...OVERLAY_PATHS]){mkdirSync(join(dir,p,'..'),{recursive:true});writeFileSync(join(dir,p),'old '+p);}
  git('add','.');git('commit','-qm','old synthetic');const old=git('rev-parse','HEAD'),oldCandidate=readGitCandidate(dir,old);
  const newer='new actual immutable config';writeFileSync(join(dir,config),newer);git('add','.');git('commit','-qm','new synthetic');const head=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}'),realCandidate=readGitCandidate(dir,head);
  git('replace',head,old);
  assert.equal(git('--no-replace-objects','show',head+':'+config),newer);
  const candidate=readGitCandidate(dir,head);
  const f=fixture();f.metadata.publicBases=oldCandidate.publicBases;f.metadata.workflowPins=oldCandidate.workflowPins;f.metadata.rebases={};f.candidate=realCandidate;
  const real=check(f);assert.equal(real.status,'review-required');f.candidate=candidate;const replaced=check(f);
  console.log('REPLACE_REF_PROOF '+JSON.stringify({sameCandidateSha:candidate.sha===realCandidate.sha,actualTree:tree,readTree:candidate.treeSha,realStatus:real.status,replacedStatus:replaced.status,publicationAuthorized:replaced.publicationAuthorized}));
  assert.equal(replaced.status,'review-required','local replace refs must not turn real source drift into false snapshot compatibility');
  assert.equal(candidate.treeSha,tree,'fixed SHA must not silently resolve a replacement commit tree');
  assert.equal(candidate.publicBases[config],digest(newer));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('independent: JSON array is not a root capture receipt SHA256',()=>{
 const f=fixture();f.metadata.source.receiptSha256=[hash('6')];
 assert.equal(check(f).status,'unknown','array coercion must not pass capture receipt hash validation');
});
test('independent: non-string candidate SHA cannot become snapshot-compatible or an array output',()=>{
 const f=fixture();(f.candidate as any).sha=[sha('c')];
 assert.equal(check(f).status,'unknown','candidate identity must require a string, not RegExp coercion');
});
test('independent: default public-base match skips graph search and exact five-minute boundary stays advisory',()=>{
 const f=fixture();f.metadata.rebases={};f.candidate.publicBases=f.metadata.publicBases;
 let calls=0;const result=check(f,()=>{calls++;return undefined;},Date.parse(f.metadata.source.observedAt)+300000);
 assert.equal(result.status,'snapshot-compatible');assert.equal(result.publicationAuthorized,false);assert.equal(calls,0);
 assert.equal(check(f,()=>true,Date.parse(f.metadata.source.observedAt)+300001).status,'unknown');
});

test('all serialized SHA and hash fields reject single-element arrays, including rebase tree identity',()=>{
 const mutations:[string,(f:ReturnType<typeof fixture>)=>void][]=[
  ['rebase tree',f=>{f.metadata.rebases[sha('c')].treeSha=[sha('e')];}],
  ['receipt',f=>{f.metadata.source.receiptSha256=[hash('6')];}],
  ['worker',f=>{f.metadata.controls.workerSha256=[hash('7')];}],
  ['configuration',f=>{f.metadata.controls.configurationSha256=[hash('8')];}],
  ['workflow',f=>{f.metadata.workflowPins={...f.metadata.workflowPins,[WORKFLOW_PATHS[0]]:[hash('5')]};}],
  ['public base',f=>{f.metadata.publicBases={...f.metadata.publicBases,[config]:[hash('1')]};}],
  ['default overlay',f=>{f.metadata.overlays={...f.metadata.overlays,[config]:[hash('3')]};}],
  ['rebase public base',f=>{f.metadata.rebases[sha('c')].publicBases={...f.metadata.rebases[sha('c')].publicBases,[config]:[hash('2')]};}],
  ['rebase overlay',f=>{f.metadata.rebases[sha('c')].overlays={...f.metadata.rebases[sha('c')].overlays,[config]:[hash('4')]};}],
  ['profile source',f=>{f.metadata.profile.sourceSha=[sha('a')];}],
  ['profile overlay',f=>{f.metadata.profile.overlays={...f.metadata.profile.overlays,[config]:[hash('3')]};}],
  ['approved artifact',f=>{f.metadata.approvedOverlays[sha('c')][config]=[hash('4')];}],
 ];
 for(const [name,mutate] of mutations){const f=fixture();mutate(f);const result=check(f);assert.equal(result.status,'unknown',name);assert.equal(result.code,'METADATA_INVALID',name);}
});
test('exported candidate identities and hash maps require actual strings without leaking array identity',()=>{
 for(const field of ['sha','treeSha','workflow','public base']){
  const f=fixture();f.metadata.rebases={};f.candidate.publicBases=f.metadata.publicBases;
  if(field==='workflow')f.candidate.workflowPins={...f.candidate.workflowPins,[WORKFLOW_PATHS[0]]:[hash('5')] as any};
  else if(field==='public base')f.candidate.publicBases={...f.candidate.publicBases,[config]:[hash('1')] as any};
  else (f.candidate as any)[field]=[field==='sha'?sha('c'):sha('e')];
  const result=check(f);assert.equal(result.status,'unknown',field);assert.equal(result.code,'GIT_SOURCE_UNCONFIRMED',field);
  if(field==='sha')assert.equal(result.candidateSha,null);
 }
 const f=fixture(),raw=JSON.stringify(f.metadata);const result=checkReleasePreflight({candidate:f.candidate,metadataText:raw,expectedMetadataSha256:[digest(raw)] as any,now,ahead:()=>false});assert.equal(result.code,'METADATA_HASH_UNCONFIRMED');
});
test('real CLI ignores replacement ancestry without changing the caller replacement refs',()=>{
 const dir=mkdtempSync(join(tmpdir(),'lifeos-preflight-ancestry-'));try{
  const env={PATH:process.env.PATH,NODE_ENV:'test' as const,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
  const git=(...a:string[])=>execFileSync('git',['-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid',...a],{cwd:dir,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-qb','main');for(const p of [...WORKFLOW_PATHS,...OVERLAY_PATHS]){mkdirSync(join(dir,p,'..'),{recursive:true});writeFileSync(join(dir,p),'synthetic '+p);}
  git('add','.');git('commit','-qm','origin');const origin=git('rev-parse','HEAD');
  writeFileSync(join(dir,'history.txt'),'synthetic graph');git('add','.');git('commit','-qm','descendant');const descendant=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}');
  const raw=`tree ${tree}\nauthor Synthetic <synthetic@example.invalid> 1 +0000\ncommitter Synthetic <synthetic@example.invalid> 1 +0000\n\nunrelated root\n`;
  const head=execFileSync('git',['hash-object','-t','commit','-w','--stdin'],{cwd:dir,env,input:raw,encoding:'utf8'}).trim(),candidate=readGitCandidate(dir,head),f=fixture();
  f.metadata.workflowPins=candidate.workflowPins;f.metadata.publicBases={...candidate.publicBases,[config]:hash('1')};f.metadata.profile={...f.metadata.profile,sourceSha:origin,overlays:f.metadata.rebases[sha('c')].overlays};
  f.metadata.rebases={[origin]:{treeSha:git('rev-parse',origin+'^{tree}'),publicBases:candidate.publicBases,overlays:f.metadata.profile.overlays,allowDescendants:false}};
  f.metadata.source.observedAt=new Date().toISOString();const metadata=JSON.stringify(f.metadata),file=join(dir,'capture.json');writeFileSync(file,metadata);
  const args=[new URL('../scripts/release-preflight.ts',import.meta.url).pathname,'--candidate',head,'--metadata',file,'--metadata-sha256',digest(metadata)];
  const run=()=>{const r=spawnSync(process.execPath,args,{cwd:dir,env,encoding:'utf8'});assert.equal(r.error,undefined);return JSON.parse(r.stdout);};
  assert.equal(run().status,'review-required');git('replace',head,descendant);const replacements=git('replace','-l');
  assert.equal(git('merge-base','--is-ancestor',origin,head),'');assert.equal(run().status,'review-required','replacement ancestry must not promote an unrelated raw commit');
  assert.equal(git('replace','-l'),replacements);assert.equal(readGitCandidate(dir,head).treeSha,tree);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
