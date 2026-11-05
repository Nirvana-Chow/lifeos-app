import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,lstat,readlink,rm,rmdir,readdir,cp,rename,symlink,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {buildSkillRelease} from '../src/agent-api/skill-update-channel.ts';
import {updateSkillBeforeUse,withUpdatedLifeOSSkill} from '../src/agent-api/skill-updater.ts';
const origin='https://lifeos.nirvanachow.com';
const manifestURL=origin+'/api/platform/agent-skill/manifest';
const hash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
async function fixture(t:any) {
  const root=await mkdtemp(join(tmpdir(),'lifeos-skill-update-synthetic-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const skillDirectory=join(root,'skills','lifeos-agent');
  await mkdir(join(skillDirectory,'references'),{recursive:true,mode:0o700});
  await writeFile(join(skillDirectory,'SKILL.md'),'---\nname: lifeos-agent\ndescription: Synthetic old Skill\n---\nold reviewed docs\n');
  await writeFile(join(skillDirectory,'references','local-write-runtime.md'),'Fixed synthetic binary contract13; never widen scopes.');
  await writeFile(join(skillDirectory,'references','local-runtime.md'),'Preserve legacy reader');
  await writeFile(join(skillDirectory,'references','adoption-verification.md'),'Not real write acceptance');
  const stateDirectory=join(root,'state','updates');
  await mkdir(stateDirectory,{recursive:true,mode:0o700});
  const runtimePath=join(root,'state','runtime-write.json');
  await writeFile(runtimePath,'{"synthetic":"preserve nonsecret runtime config"}');
  const requests:{url:string;options:any}[]=[];
  let manifest:Buffer=buildSkillRelease().manifestBytes;
  let archive:Uint8Array=buildSkillRelease().archive;
  const fetcher=async(url:string,options:any)=>{
    requests.push({url,options});
    if(url===manifestURL)return new Response(Uint8Array.from(manifest),{headers:{'Content-Type':'application/json'}});
    const m=JSON.parse(manifest.toString());
    assert.equal(url,origin+m.archive.path);
    return new Response(archive as Uint8Array<ArrayBuffer>,{headers:{'Content-Type':'application/gzip'}});
  };
  return {root,skillDirectory,stateDirectory,runtimePath,requests,fetcher,
    options:{skillDirectory,stateDirectory,apiVersion:2,fetcher},
    setManifest:(value:Buffer)=>{manifest=value;},setArchive:(value:Uint8Array)=>{archive=value;}};
}

test('before-use downloads only the fixed publisher and atomically activates docs, preserving local overlays/config',async t=>{
  const f=await fixture(t);
  let used=false;
  const result=await withUpdatedLifeOSSkill(f.options,async path=>{
    used=true;
    assert.ok(path.startsWith(join(f.stateDirectory,'versions')+'/'));
    assert.match(await readFile(join(path,'SKILL.md'),'utf8'),/本机运行时约束/);
    assert.match(await readFile(join(path,'SKILL.md'),'utf8'),/本次 discovery/);
    return 'synthetic-operation-ready';
  });
  assert.equal(result,'synthetic-operation-ready');assert.ok(used);
  assert.ok((await lstat(f.skillDirectory)).isSymbolicLink());
  assert.equal(await readFile(join(f.skillDirectory,'references/local-write-runtime.md'),'utf8'),'Fixed synthetic binary contract13; never widen scopes.');
  assert.equal(await readFile(f.runtimePath,'utf8'),'{"synthetic":"preserve nonsecret runtime config"}');
  assert.equal(f.requests.length,2);
  for(const request of f.requests) {
    assert.equal(request.options.redirect,'manual');assert.equal(request.options.credentials,'omit');
    assert.equal(request.options.cache,'no-store');assert.equal(request.options.headers.Authorization,undefined);
  }
  const target=await readlink(f.skillDirectory);
  assert.equal((await updateSkillBeforeUse(f.options)).status,'current');
  assert.equal(await readlink(f.skillDirectory),target);
  assert.equal(f.requests.length,3); // fresh manifest, no archive download on current version
});

test('pre-use failure never invokes the business callback or changes installed documents',async t=>{
  const f=await fixture(t);
  const old=await readFile(join(f.skillDirectory,'SKILL.md'),'utf8');
  let used=false;
  await assert.rejects(withUpdatedLifeOSSkill({...f.options,fetcher:async()=>new Response(null,{status:302,headers:{location:'https://evil.example/'}})},async()=>{used=true;}),/HTTP/);
  assert.equal(used,false);assert.equal(await readFile(join(f.skillDirectory,'SKILL.md'),'utf8'),old);
  const broken=Buffer.from(buildSkillRelease().archive);broken[20]^=1;f.setArchive(broken);
  await assert.rejects(updateSkillBeforeUse(f.options),/integrity/);
  assert.equal(await readFile(join(f.skillDirectory,'SKILL.md'),'utf8'),old);
});

test('monotonic high-water rejects rollback and same-sequence substitution; local edits are preserved',async t=>{
  const f=await fixture(t);
  await updateSkillBeforeUse(f.options);
  const target=await readlink(f.skillDirectory);
  const original=JSON.parse(buildSkillRelease().manifestBytes.toString());
  f.setManifest(Buffer.from(JSON.stringify({...original,releaseSequence:original.releaseSequence-1})));
  await assert.rejects(updateSkillBeforeUse(f.options),/rollback/);
  f.setManifest(Buffer.from(JSON.stringify(original))); // exact raw manifest digest must also match
  await assert.rejects(updateSkillBeforeUse(f.options),/sequence/);
  assert.equal(await readlink(f.skillDirectory),target);
  f.setManifest(buildSkillRelease().manifestBytes);
  await writeFile(join(f.skillDirectory,'SKILL.md'),'user local edit');
  await assert.rejects(updateSkillBeforeUse(f.options),/local.*modified/);
  assert.equal(await readFile(join(f.skillDirectory,'SKILL.md'),'utf8'),'user local edit');
});

test('failed trusted host validation rolls back the active pointer and keeps original docs recoverable',async t=>{
  const f=await fixture(t);
  await updateSkillBeforeUse(f.options);
  const target=await readlink(f.skillDirectory);
  const original=JSON.parse(buildSkillRelease().manifestBytes.toString());
  f.setManifest(Buffer.from(JSON.stringify({...original,releaseSequence:original.releaseSequence+1})+'\n'));
  await assert.rejects(updateSkillBeforeUse({...f.options,validateInstalled:async()=>{throw Error('synthetic host check failed');}}),/host check/);
  assert.equal(await readlink(f.skillDirectory),target);
  assert.match(await readFile(join(f.skillDirectory,'SKILL.md'),'utf8'),/本机运行时约束/);
  assert.ok((await readdir(join(f.stateDirectory,'versions'))).length>=3);
});

test('public routes bind the advertised manifest to exact content-addressed artifact',async()=>{
  const {GET:manifestGET}=await import('../app/api/platform/agent-skill/manifest/route.ts');
  const {GET:archiveGET}=await import('../app/api/platform/agent-skill/releases/[digest]/route.ts');
  const response=manifestGET();
  assert.equal(response.headers.get('set-cookie'),null);
  const manifest=await response.json();
  const artifact=await archiveGET(new Request(origin+manifest.archive.path),{params:Promise.resolve({digest:manifest.archive.sha256+'.tar.gz'})});
  assert.equal(artifact.status,200);
  assert.equal(hash(new Uint8Array(await artifact.arrayBuffer())),manifest.archive.sha256);
  assert.equal((await archiveGET(new Request(origin),{params:Promise.resolve({digest:'0'.repeat(64)+'.tar.gz'})})).status,404);
});


test('a crashed initial layout adoption is recovered before checking/downloading a release',async t=>{
  const f=await fixture(t);
  const versions=join(f.stateDirectory,'versions');await mkdir(versions,{mode:0o700});
  const backup=join(versions,'legacy-crash-synthetic');
  await writeFile(join(f.stateDirectory,'bootstrap.json'),JSON.stringify({backup}));
  await rename(f.skillDirectory,backup);
  await writeFile(join(f.stateDirectory,'lock'),JSON.stringify({pid:2147483647}));
  assert.equal((await updateSkillBeforeUse(f.options)).status,'updated');
  assert.equal(await readFile(join(backup,'SKILL.md'),'utf8'),'---\nname: lifeos-agent\ndescription: Synthetic old Skill\n---\nold reviewed docs\n');
  assert.equal(await readFile(join(f.skillDirectory,'references/local-runtime.md'),'utf8'),'Preserve legacy reader');
});

test('a crashed unverified activation rolls back before permitting use',async t=>{
  const f=await fixture(t);
  await updateSkillBeforeUse(f.options);
  const previous=await readlink(f.skillDirectory);
  const next=join(f.stateDirectory,'versions','release-crash-synthetic');await mkdir(next,{mode:0o700});
  await writeFile(join(f.stateDirectory,'pending.json'),JSON.stringify({previous,next}));
  await unlink(f.skillDirectory);await symlink(next,f.skillDirectory);
  assert.equal((await updateSkillBeforeUse(f.options)).status,'current');
  assert.equal(await readlink(f.skillDirectory),previous);
});

test('unsafe storage, live writer lock, oversized downloads and unknown API fail closed',async t=>{
  const f=await fixture(t);
  await writeFile(join(f.stateDirectory,'lock'),JSON.stringify({pid:process.pid}));
  await assert.rejects(updateSkillBeforeUse(f.options),/already running/);
  assert.equal(f.requests.length,0);
  await unlink(join(f.stateDirectory,'lock'));
  await assert.rejects(updateSkillBeforeUse({...f.options,apiVersion:3}),/API/);
  await assert.rejects(updateSkillBeforeUse({...f.options,fetcher:async()=>new Response('x'.repeat(16385),{headers:{'Content-Type':'application/json'}})}),/size/);
  const foreign=join(f.root,'foreign');await mkdir(foreign,{mode:0o700});
  await rmdir(join(f.stateDirectory,'versions'));
  await symlink(foreign,join(f.stateDirectory,'versions'));
  await assert.rejects(updateSkillBeforeUse(f.options),/unsafe versions/);
  assert.deepEqual(await readdir(foreign),[]);
  await assert.rejects(lstat(join(f.stateDirectory,'lock')),/ENOENT/);
});


test('local runtime-overlay changes made while downloading are retained',async t=>{
  const f=await fixture(t);
  const fetcher=async(url:string,options:RequestInit)=>{
    const response=await f.fetcher(url,options);
    if(url!==manifestURL)await writeFile(join(f.skillDirectory,'references/local-write-runtime.md'),'New trusted local restriction; binary13 unchanged');
    return response;
  };
  await updateSkillBeforeUse({...f.options,fetcher});
  assert.equal(await readFile(join(f.skillDirectory,'references/local-write-runtime.md'),'utf8'),'New trusted local restriction; binary13 unchanged');
});


test('generic installations do not inherit another hosts operation count or missing local-overlay links',async t=>{
  const f=await fixture(t);
  for(const name of ['local-runtime.md','local-write-runtime.md','adoption-verification.md'])await unlink(join(f.skillDirectory,'references',name));
  await updateSkillBeforeUse(f.options);
  const entry=await readFile(join(f.skillDirectory,'SKILL.md'),'utf8');
  assert.match(entry,/没有本机附加说明/);
  assert.doesNotMatch(entry,/local-write-runtime\.md|local-runtime\.md|13项|requirements 机器操作不受支持/);
});


test('current-version fast path stops public document edits during manifest download',async t=>{
  const f=await fixture(t);await updateSkillBeforeUse(f.options);
  let used=false;
  const fetcher=async(url:string,options:RequestInit)=>{
    const response=await f.fetcher(url,options);
    await writeFile(join(f.skillDirectory,'SKILL.md'),'concurrent unreviewed local edit');return response;
  };
  await assert.rejects(withUpdatedLifeOSSkill({...f.options,fetcher},async()=>{used=true;}),/modified|changed/);
  assert.equal(used,false);
  assert.equal(await readFile(join(f.skillDirectory,'SKILL.md'),'utf8'),'concurrent unreviewed local edit');
});

test('current-version fast path stops a target swap during manifest download',async t=>{
  const f=await fixture(t);await updateSkillBeforeUse(f.options);
  const previous=await readlink(f.skillDirectory);
  const replacement=join(f.stateDirectory,'versions','external-synthetic');await cp(previous,replacement,{recursive:true});
  let used=false;
  const fetcher=async(url:string,options:RequestInit)=>{
    const response=await f.fetcher(url,options);
    await unlink(f.skillDirectory);await symlink(replacement,f.skillDirectory);return response;
  };
  await assert.rejects(withUpdatedLifeOSSkill({...f.options,fetcher},async()=>{used=true;}),/changed/);
  assert.equal(used,false);assert.equal(await readlink(f.skillDirectory),replacement);
});
