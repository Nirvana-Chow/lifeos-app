import test from 'node:test';
import assert from 'node:assert/strict';
import fs,{mkdtempSync,realpathSync,mkdirSync,writeFileSync,openSync,closeSync,fstatSync,chmodSync,renameSync,rmSync,linkSync,symlinkSync,constants} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readReviewConfig} from '../src/platform/private-config.ts';
const modulePath='../src/deployment-candidate/startup-mount-guard.ts';
async function api(){const m=await import(modulePath).catch(()=>({}));assert.equal(typeof m.readBoundStartupConfig,'function','startup guard must exist');return m;}
function fixture(){
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'startup-mount-')),path=join(dir,'runtime.json'),gate=join(dir,'gate');mkdirSync(gate,{mode:0o700});
 const config={LIFEOS_PLATFORM_CANDIDATE:'1',LIFEOS_PLATFORM_TARGET:'isolated-test',LIFEOS_PLATFORM_BASE_URL:'http://127.0.0.1:3002',LIFEOS_PLATFORM_OWNER_ID:'fixture-owner-a',LIFEOS_PLATFORM_OWNER_EMAIL:'fixture@example.invalid',LIFEOS_PLATFORM_SECRET:'SYNTHETIC_PRIVATE_startup_secret_000000000',LIFEOS_PLATFORM_TEST_DATABASE_URL:'postgresql://lifeos_platform_candidate_runtime:synthetic@127.0.0.1:55432/lifeos_platform_test_local'};
 const bytes=JSON.stringify(config);writeFileSync(path,bytes,{mode:0o600});
 const runtime=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW),gateFd=openSync(gate,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW),r=fstatSync(runtime,{bigint:true}),g=fstatSync(gateFd,{bigint:true});
 const proof={version:1,runtime:{dev:String(r.dev),ino:String(r.ino),sha256:createHash('sha256').update(bytes).digest('hex')},gate:{dev:String(g.dev),ino:String(g.ino)}};
 return{dir,path,gate,config,proof,fds:{runtime,gate:gateFd},cleanup(){closeSync(runtime);closeSync(gateFd);rmSync(dir,{recursive:true,force:true});}};
}
test('startup guard returns the original strict configuration from the exact verified runtime bytes',async()=>{
 const m=await api(),f=fixture();try{const value=m.readBoundStartupConfig(f.proof,f.fds);assert.equal(JSON.stringify(value)===JSON.stringify(f.config),true);assert.equal(Object.isFrozen(value),true);assert.equal(JSON.stringify(readReviewConfig(f.path))===JSON.stringify(value),true);}finally{f.cleanup();}
});
test('startup metadata is closed bounded and decimal-string identities never coerce through Number',async()=>{
 const m=await api(),f=fixture();try{
  for(const p of [null,[],{...f.proof,extra:true},{...f.proof,version:2},{...f.proof,runtime:{...f.proof.runtime,dev:1}},{...f.proof,gate:{...f.proof.gate,ino:'01'}},{...f.proof,gate:{...f.proof.gate,ino:'0'}},{...f.proof,gate:{...f.proof.gate,ino:'1e3'}},{...f.proof,runtime:{...f.proof.runtime,sha256:'A'.repeat(64)}}])assert.throws(()=>m.parseStartupMountProof(p),/STARTUP_MOUNT_UNVERIFIED/);
  let getter=false;const p=Object.defineProperty({...f.proof},'runtime',{enumerable:true,get(){getter=true;return f.proof.runtime;}});assert.throws(()=>m.parseStartupMountProof(p));assert.equal(getter,false);
  assert.equal(m.parseStartupMountProof({...f.proof,gate:{dev:'18446744073709551615',ino:'18446744073709551615'}}).gate.ino,'18446744073709551615');
  assert.equal(m.parseStartupMountArgument,undefined,'JSON argv carrier is removed');
 }finally{f.cleanup();}
});
for(const field of ['runtime-dev','runtime-ino','runtime-hash','gate-dev','gate-ino'])test('startup wrong '+field+' rejects before configuration can initialize a service',async()=>{
 const m=await api(),f=fixture();try{const p=structuredClone(f.proof);if(field==='runtime-hash')p.runtime.sha256='0'.repeat(64);else{const [side,key]=field.split('-') as ['runtime'|'gate','dev'|'ino'];p[side][key]=String(BigInt(p[side][key])+1n);}assert.throws(()=>m.readBoundStartupConfig(p,f.fds),e=>{assert.match(String(e),/STARTUP_MOUNT_UNVERIFIED/);assert.doesNotMatch(String(e),/SYNTHETIC_PRIVATE|postgresql/);return true;});}finally{f.cleanup();}
});
test('startup rejects unsafe file permissions, directory identity used as file, oversized or invalid config',async()=>{
 const m=await api();for(const mode of ['permissions','directory','oversize','invalid']){const f=fixture();try{
  if(mode==='permissions')chmodSync(f.path,0o644);if(mode==='oversize')writeFileSync(f.path,'x'.repeat(16385));if(mode==='invalid')writeFileSync(f.path,'[]');
  assert.throws(()=>m.readBoundStartupConfig(f.proof,mode==='directory'?{runtime:f.fds.gate,gate:f.fds.gate}:f.fds),/STARTUP_MOUNT_UNVERIFIED/);
 }finally{f.cleanup();}}
});
test('startup detects in-place content mutation during the bounded fd read',async()=>{
 const m=await api(),f=fixture(),original=fs.readSync;let changed=false;
 try{fs.readSync=((...args:Parameters<typeof fs.readSync>)=>{const n=(original as Function)(...args);if(!changed){changed=true;writeFileSync(f.path,JSON.stringify({...f.config,LIFEOS_PLATFORM_SECRET:'DIFFERENT_PRIVATE_0000000000000000000000'}));}return n;}) as typeof fs.readSync;syncBuiltinESMExports();assert.throws(()=>m.readBoundStartupConfig(f.proof,f.fds),/STARTUP_MOUNT_UNVERIFIED/);}finally{fs.readSync=original;syncBuiltinESMExports();f.cleanup();}
});
test('startup applies verified config without rereading a replaced pathname and removes inherited review capabilities',async()=>{
 const m=await api(),f=fixture();try{
  const config=m.readBoundStartupConfig(f.proof,f.fds);renameSync(f.path,f.path+'.old');writeFileSync(f.path,JSON.stringify({...f.config,LIFEOS_PLATFORM_SECRET:'REPLACEMENT_PRIVATE_00000000000000000000'}),{mode:0o600});
  const env:Record<string,string|undefined>={LIFEOS_REVIEW_GIT_SHA:'a'.repeat(40),LIFEOS_CHAT_CANDIDATE:'1',LIFEOS_AI_ENABLED:'1',LIFEOS_PERSONAL_RECOVERY_APPROVAL:'unreviewed',LIFEOS_PERSONAL_BOOTSTRAP:'1',LIFEOS_SYNTHETIC_MODE:'1',DATABASE_URL:'unreviewed',PATH:'/safe'};
  m.applyBoundStartupConfig(config,env);assert.equal(env.LIFEOS_PLATFORM_SECRET===f.config.LIFEOS_PLATFORM_SECRET,true);assert.equal(env.LIFEOS_REVIEW_GIT_SHA,'a'.repeat(40));assert.equal(env.LIFEOS_CHAT_CANDIDATE,undefined);assert.equal(env.LIFEOS_AI_ENABLED,undefined);assert.equal(env.LIFEOS_PERSONAL_RECOVERY_APPROVAL,undefined);assert.equal(env.LIFEOS_PERSONAL_BOOTSTRAP,undefined);assert.equal(env.LIFEOS_SYNTHETIC_MODE,undefined);assert.equal(env.DATABASE_URL,undefined);assert.equal(env.PATH,'/safe');
  assert.equal(readReviewConfig(f.path).LIFEOS_PLATFORM_SECRET!==env.LIFEOS_PLATFORM_SECRET,true,'ordinary per-request reads must remain fresh');
 }finally{f.cleanup();}
});

test('protected startup proof file rejects bad mode links size shape and read errors without revealing data',async()=>{
 const m=await api();assert.equal(typeof m.readStartupMountProof,'function');
 for(const mode of ['valid','permission','hardlink','oversize','malformed','closed']){
  const f=fixture(),path=join(f.gate,'startup-proof.json');let fd:number|undefined;
  try{
   writeFileSync(path,mode==='oversize'?'SYNTHETIC_PRIVATE_'.repeat(300):mode==='malformed'?'SYNTHETIC_PRIVATE_invalid':JSON.stringify(f.proof),{mode:0o600});
   if(mode==='permission')chmodSync(path,0o640);if(mode==='hardlink')linkSync(path,path+'.link');fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
   if(mode==='valid')assert.equal(JSON.stringify(m.readStartupMountProof(fd))===JSON.stringify(f.proof),true);
   else{if(mode==='closed'){closeSync(fd);fd=undefined;}assert.throws(()=>m.readStartupMountProof(fd??-1),e=>{assert.match(String(e),/STARTUP_MOUNT_UNVERIFIED/);assert.doesNotMatch(String(e),/SYNTHETIC_PRIVATE|[a-f0-9]{64}/);return true;});}
  }finally{if(fd!==undefined)closeSync(fd);f.cleanup();}
 }
});

for(const fault of ['valid','hash','inode','missing','symlink','hardlink','permission','oversize','proof-replaced','proof-read-error','runtime-read-error','extra-arg','same-bytes'])test('real launcher '+fault+' gates standalone import and DB/auth before initialization',async()=>{
 const f=fixture(),proof=join(f.gate,'startup-proof.json'),p=structuredClone(f.proof);
 try{
  if(fault==='hash')p.runtime.sha256='0'.repeat(64);if(fault==='inode')p.gate.ino=String(BigInt(p.gate.ino)+1n);
  if(fault!=='missing')writeFileSync(proof,fault==='oversize'?'X'.repeat(4097):JSON.stringify(p),{mode:0o600});
  if(fault==='symlink'){renameSync(proof,proof+'.original');symlinkSync(proof+'.original',proof);}if(fault==='hardlink')linkSync(proof,proof+'.link');if(fault==='permission')chmodSync(proof,0o644);
  const args=['--import','./test/helpers/startup-launcher-trap.mjs','scripts/platform-launch.mjs','--controlled-mounts-v1',...(fault==='extra-arg'?[JSON.stringify(p)]:[])];
  if(fault!=='extra-arg')assert.equal(args.some(v=>v.includes(p.runtime.sha256)),false);
  const child=spawnSync(process.execPath,args,{encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',FIXTURE_RUNTIME_PATH:f.path,FIXTURE_GATE_PATH:f.gate,FIXTURE_STARTUP_FAULT:fault,LIFEOS_CHAT_CANDIDATE:'unreviewed',LIFEOS_AI_ENABLED:'unreviewed',LIFEOS_REVIEW_GIT_SHA:'a'.repeat(40)}});
  const output=child.stdout+child.stderr;assert.equal(child.error===undefined,true,'child must start and finish within its deadline');assert.equal(child.signal,null);assert.equal(/SYNTHETIC_PRIVATE|postgresql|[a-f0-9]{64}|FIXTURE_DB_AUTH_IMPORT/.test(output),false,'redacted startup output invariant');
  if(['valid','same-bytes'].includes(fault)){assert.equal(child.status,0);assert.equal(output.includes('FIXTURE_SERVICE_IMPORT_SAME_BYTES'),true);assert.equal(output.includes('FIXTURE_INHERITED_CAPABILITY'),false);}
  else{assert.equal(child.status,1);assert.equal(child.stderr==='Isolated review startup unavailable\n',true,'only the fixed sanitized startup error is expected');assert.equal(output.includes('FIXTURE_SERVICE_IMPORT'),false);}
 }finally{f.cleanup();}
});


test('startup proof rejects a foreign uid even when all bytes and inode otherwise match',async()=>{
 const m=await api(),f=fixture(),path=join(f.gate,'startup-proof.json');writeFileSync(path,JSON.stringify(f.proof),{mode:0o600});const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW),original=fs.fstatSync;
 try{
  fs.fstatSync=((...args:Parameters<typeof fs.fstatSync>)=>{const s=(original as Function)(...args);if(args[0]===fd)return Object.assign(Object.create(Object.getPrototypeOf(s)),s,{uid:typeof s.uid==='bigint'?s.uid+1n:s.uid+1});return s;}) as typeof fs.fstatSync;syncBuiltinESMExports();assert.throws(()=>m.readStartupMountProof(fd),/STARTUP_MOUNT_UNVERIFIED/);
 }finally{fs.fstatSync=original;syncBuiltinESMExports();closeSync(fd);f.cleanup();}
});
