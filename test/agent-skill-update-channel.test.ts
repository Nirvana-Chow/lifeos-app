import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {gunzipSync,gzipSync} from 'node:zlib';
import {buildSkillArtifact} from '../src/agent-api/skill-artifact.ts';
import {buildSkillRelease,verifySkillRelease} from '../src/agent-api/skill-update-channel.ts';

const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const options=(pin:string,apiVersion=2)=>({trustedManifestSha256:pin,apiVersion});

test('release pins the actual public artifact and returns only verified-not-installed metadata',()=>{
  const release=buildSkillRelease();
  assert.deepEqual(release.archive,buildSkillArtifact());
  assert.deepEqual(release.manifestBytes,buildSkillRelease().manifestBytes);
  assert.equal(release.manifestSha256,sha(release.manifestBytes));
  const manifest=JSON.parse(Buffer.from(release.manifestBytes).toString());
  assert.equal(manifest.archive.sha256,sha(release.archive));
  assert.equal(manifest.archive.bytes,release.archive.length);
  assert.deepEqual(manifest.files.map((file:{path:string})=>file.path),['LICENSE','SKILL.md','references/credential-runtime.md','references/operations.md']);
  for(const apiVersion of [1,2]) {
    const result=verifySkillRelease(release.manifestBytes,release.archive,options(release.manifestSha256,apiVersion));
    assert.equal(result.status,'verified-not-installed');
    assert.equal(result.releaseId,'sha256:'+sha(release.archive));
    assert.equal(result.archiveURL,'https://lifeos.nirvanachow.com/api/platform/agent-skill/releases/'+sha(release.archive)+'.tar.gz');
  }
});

test('changed archive, manifest or incompatible catalog cannot become a candidate',()=>{
  const release=buildSkillRelease();
  const tampered=Buffer.from(release.archive);tampered[20]^=1;
  assert.throws(()=>verifySkillRelease(release.manifestBytes,tampered,options(release.manifestSha256)),/archive/);
  assert.throws(()=>verifySkillRelease(Buffer.concat([release.manifestBytes,Buffer.from(' ')]),release.archive,options(release.manifestSha256)),/trust/);
  assert.throws(()=>verifySkillRelease(release.manifestBytes,release.archive,options('0'.repeat(64))),/trust/);
  assert.throws(()=>verifySkillRelease(release.manifestBytes,release.archive,options(release.manifestSha256,3)),/API/);
});

test('even independently pinned metadata cannot widen allowed origin, files, schema or bounds',()=>{
  const release=buildSkillRelease();
  const cases:[string,(m:any)=>void][]=[
    ['origin',m=>{m.origin='https://evil.example';}],
    ['url',m=>{m.archive.path='//evil.example/package';}],
    ['private file',m=>{m.files[0].path='runtime.json';}],
    ['executable',m=>{m.files[0].path='scripts/install.sh';}],
    ['traversal',m=>{m.files[0].path='../SKILL.md';}],
    ['duplicate',m=>{m.files[1].path='LICENSE';}],
    ['missing file',m=>{m.files.pop();}],
    ['extra field',m=>{m.installCommand='arbitrary';}],
    ['extra nested field',m=>{m.archive.command='arbitrary';}],
    ['bad hash',m=>{m.files[0].sha256='invalid';}],
    ['negative size',m=>{m.files[0].bytes=-1;}],
    ['fractional size',m=>{m.files[0].bytes=1.5;}],
    ['oversized archive',m=>{m.archive.bytes=2**30;}],
    ['oversized file',m=>{m.files[0].bytes=2**30;}],
    ['unknown schema',m=>{m.schemaVersion=2;}],
    ['zero sequence',m=>{m.releaseSequence=0;}],
    ['fractional sequence',m=>{m.releaseSequence=1.5;}],
    ['fake release identity',m=>{m.releaseId='sha256:'+'0'.repeat(64);}],
    ['unknown catalog',m=>{m.apiVersions=[2,3];}],
  ];
  for(const [label,change] of cases) {
    const manifest=JSON.parse(Buffer.from(release.manifestBytes).toString());change(manifest);
    const bytes=Buffer.from(JSON.stringify(manifest));
    assert.throws(()=>verifySkillRelease(bytes,release.archive,options(sha(bytes))),Error,label);
  }
  const huge=Buffer.alloc(16385,32);
  assert.throws(()=>verifySkillRelease(huge,release.archive,options(sha(huge))),/manifest/);
});

// Each fixture has freshly pinned metadata and a correct whole-archive digest;
// a verifier checking only outer hashes would incorrectly accept all of them.
test('archive structure and per-file integrity are checked without extraction',()=>{
  const release=buildSkillRelease();
  const rejected=(change:(tar:Buffer)=>Buffer)=>{
    const tar=change(gunzipSync(release.archive));
    const archive=gzipSync(tar);
    const manifest=JSON.parse(Buffer.from(release.manifestBytes).toString());
    const digest=sha(archive);
    manifest.archive.sha256=digest;manifest.archive.bytes=archive.length;
    manifest.releaseId='sha256:'+digest;
    manifest.archive.path='/api/platform/agent-skill/releases/'+digest+'.tar.gz';
    const bytes=Buffer.from(JSON.stringify(manifest));
    assert.throws(()=>verifySkillRelease(bytes,archive,options(sha(bytes))));
  };
  const recheck=(tar:Buffer)=>{
    tar.fill(32,148,156);
    const sum=tar.subarray(0,512).reduce((a,b)=>a+b,0);
    tar.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');return tar;
  };
  rejected(tar=>{tar[512]^=1;return tar;});
  rejected(tar=>{tar[156]=50;return recheck(tar);}); // symlink
  rejected(tar=>{tar[0]|=128;return recheck(tar);}); // no ASCII high-bit alias
  rejected(tar=>{tar.fill(0,0,100);tar.write('lifeos-agent/../runtime.json');return recheck(tar);});
  rejected(tar=>Buffer.concat([tar,Buffer.alloc(512)]));
  rejected(tar=>tar.subarray(0,tar.length-512));
  rejected(()=>Buffer.alloc(512*1024+1));
});

test('release metadata gives a positive monotonic source sequence',()=>{
  const release=buildSkillRelease();
  const manifest=JSON.parse(release.manifestBytes.toString());
  assert.ok(Number.isSafeInteger(manifest.releaseSequence)&&manifest.releaseSequence>0);
});
